import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACCENTS, initialsFor, isAccentId } from './profileCore.ts';

test('initialsFor takes the first letter of the first two words', () => {
  assert.equal(initialsFor('Atli Björgvins'), 'AB');
  assert.equal(initialsFor('atli'), 'A');
  assert.equal(initialsFor('  atli   már   kristinsson '), 'AM');
  assert.equal(initialsFor(''), '');
  assert.equal(initialsFor('   '), '');
});

test('initialsFor uppercases Icelandic letters correctly', () => {
  assert.equal(initialsFor('þóra ævarsdóttir'), 'ÞÆ');
  assert.equal(initialsFor('örn davíðsson'), 'ÖD');
});

test('isAccentId accepts every preset and rejects everything else', () => {
  for (const a of ACCENTS) assert.ok(isAccentId(a.id), a.id);
  assert.ok(!isAccentId('teal'));
  assert.ok(!isAccentId(''));
  assert.ok(!isAccentId(undefined));
});

// The presets promise "we ship CSS for this id". Hold profileCore and app.css
// to that promise so a picker swatch can never select an accent that silently
// does nothing (the exact hand-kept-lists-disagree failure the plugin registry
// exists to prevent).
test('every non-default preset has a light and a dark block in app.css', () => {
  const css = readFileSync(fileURLToPath(new URL('../app.css', import.meta.url)), 'utf8');
  for (const a of ACCENTS) {
    if (a.id === 'default') continue; // default = attribute absent, base palette
    assert.ok(
      css.includes(`:root[data-accent='${a.id}']`),
      `app.css lacks a light block for accent '${a.id}'`
    );
    assert.ok(
      css.includes(`[data-theme='dark'][data-accent='${a.id}']`),
      `app.css lacks a dark block for accent '${a.id}'`
    );
  }
});
