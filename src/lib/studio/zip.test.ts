// The zip writer is byte arithmetic, so it either produces a valid archive or
// silently produces something no tool will open. These tests assert the header
// structure; scripts/verify-zip.mjs additionally writes a real archive and has
// the system `unzip` validate it, which is the only proof that matters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeZip, crc32, safeZipName } from './zip.ts';

const enc = new TextEncoder();
const AT = new Date('2026-08-06T10:30:00');

test('crc32 matches the known value for "123456789"', () => {
  // The standard CRC-32 check value — if this is wrong every entry is corrupt.
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
});

test('crc32 of empty input is 0', () => {
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('an archive starts with the local header signature and ends with EOCD', () => {
  const z = makeZip([{ name: 'a.txt', bytes: enc.encode('hello') }], AT);
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  assert.equal(dv.getUint32(0, true), 0x04034b50, 'local file header');
  assert.equal(dv.getUint32(z.length - 22, true), 0x06054b50, 'end of central directory');
});

test('the entry count in EOCD matches what went in', () => {
  const files = [
    { name: 'a.png', bytes: enc.encode('one') },
    { name: 'b.png', bytes: enc.encode('two') },
    { name: 'c.png', bytes: enc.encode('three') }
  ];
  const z = makeZip(files, AT);
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  assert.equal(dv.getUint16(z.length - 22 + 8, true), 3);
  assert.equal(dv.getUint16(z.length - 22 + 10, true), 3);
});

test('stored method, and sizes recorded uncompressed', () => {
  const payload = enc.encode('some bytes here');
  const z = makeZip([{ name: 'x.bin', bytes: payload }], AT);
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  assert.equal(dv.getUint16(8, true), 0, 'method must be 0 (stored)');
  assert.equal(dv.getUint32(18, true), payload.length, 'compressed size');
  assert.equal(dv.getUint32(22, true), payload.length, 'uncompressed size');
  assert.equal(dv.getUint32(14, true), crc32(payload), 'crc in the local header');
});

test('the UTF-8 name flag is set, so Icelandic filenames survive', () => {
  const z = makeZip([{ name: 'Gróska-kynning.png', bytes: enc.encode('x') }], AT);
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  assert.equal(dv.getUint16(6, true) & 0x0800, 0x0800, 'bit 11 must be set');
  // And the name is stored as UTF-8 bytes, longer than its character count.
  const nameLen = dv.getUint16(26, true);
  assert.equal(nameLen, enc.encode('Gróska-kynning.png').length);
  assert.ok(nameLen > 'Gróska-kynning.png'.length, 'ó is multi-byte');
});

test('the central directory offset points at the first central header', () => {
  const z = makeZip([{ name: 'a', bytes: enc.encode('1') }, { name: 'b', bytes: enc.encode('22') }], AT);
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const cdOffset = dv.getUint32(z.length - 22 + 16, true);
  assert.equal(dv.getUint32(cdOffset, true), 0x02014b50, 'central directory signature');
});

test('an empty archive is still a valid zip', () => {
  const z = makeZip([], AT);
  assert.equal(z.length, 22, 'just the EOCD');
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  assert.equal(dv.getUint32(0, true), 0x06054b50);
  assert.equal(dv.getUint16(8, true), 0);
});

test('over 65535 entries is refused rather than written corrupt', () => {
  const many = Array.from({ length: 65536 }, (_, i) => ({ name: `${i}`, bytes: new Uint8Array(0) }));
  assert.throws(() => makeZip(many, AT), /at most 65535/);
});

// ── Names ────────────────────────────────────────────────────────────────

test('slashes cannot create folders and .. cannot escape', () => {
  const taken = new Set<string>();
  assert.equal(safeZipName('a/b/c.png', taken), 'a-b-c.png');
  assert.ok(!safeZipName('../../etc/passwd', new Set()).includes('..'));
});

test('duplicate labels get suffixed instead of overwriting', () => {
  // Two records with the same name is normal, and losing one silently would
  // be the worst outcome: you would think the batch downloaded fully.
  const taken = new Set<string>();
  assert.equal(safeZipName('KLAK.png', taken), 'KLAK.png');
  assert.equal(safeZipName('KLAK.png', taken), 'KLAK (2).png');
  assert.equal(safeZipName('KLAK.png', taken), 'KLAK (3).png');
});

test('an empty or dot-only name still yields something openable', () => {
  assert.equal(safeZipName('', new Set()), 'image');
  assert.equal(safeZipName('...', new Set()), 'image');
});

test('a very long name keeps its extension', () => {
  const n = safeZipName('x'.repeat(300) + '.png', new Set());
  assert.ok(n.length <= 120);
  assert.ok(n.endsWith('.png'), 'truncation must not eat the extension');
});
