import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeInvite, decodeInvite, inviteLink, type VaultInvite } from './vaultInvite.ts';

const INV: VaultInvite = {
  name: 'KLAK',
  supabaseUrl: 'https://egpzbyhoukwddomwmnit.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiJ9.payload.sig',
  managed: true
};

test('encode → decode round-trips every field', () => {
  const back = decodeInvite(encodeInvite(INV));
  assert.deepEqual(back, INV);
});

test('decode pulls the code out of a full link (hash or query)', () => {
  const code = encodeInvite(INV);
  assert.deepEqual(decodeInvite(`https://twin.example.com/join#i=${code}`), INV);
  assert.deepEqual(decodeInvite(`https://twin.example.com/join?i=${code}`), INV);
});

test('decode rejects junk and non-twin strings', () => {
  assert.equal(decodeInvite(''), null);
  assert.equal(decodeInvite('hello'), null);
  assert.equal(decodeInvite('https://example.com/join#i=notacode'), null);
  assert.equal(decodeInvite('twinvault1:@@@notbase64@@@'), null);
});

test('a non-managed invite keeps managed=false', () => {
  const back = decodeInvite(encodeInvite({ ...INV, managed: false }));
  assert.equal(back?.managed, false);
});

test('inviteLink builds a hash link and trims a trailing slash', () => {
  const link = inviteLink('https://twin.example.com/', INV);
  assert.match(link, /^https:\/\/twin\.example\.com\/join#i=twinvault1:/);
  assert.deepEqual(decodeInvite(link), INV);
});

test('the invite never carries a password or admin key', () => {
  // The type has no such field, but pin it: the encoded payload must not leak
  // anything beyond name/url/anon-key/managed even if a caller over-supplies.
  const code = encodeInvite({ ...INV, ...({ password: 'x', adminKey: 'y' } as object) } as VaultInvite);
  assert.ok(!/password|adminKey|"x"|"y"/.test(Buffer.from(code.split(':')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()));
});
