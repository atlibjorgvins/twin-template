// Run with:  npm run test:regions
//
// The invariant worth guarding is the collision one. The obvious short code
// for North America is NA, which is already Norðurland eystra — adopting it
// would silently move real Icelandic organizations across the Atlantic, and
// nothing in the UI would look wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REGION_CHOICES,
  FOREIGN_REGION_CHOICES,
  ALL_REGION_CHOICES,
  isForeignRegion,
  regionLabel
} from './regions.ts';

test('no foreign code collides with an Icelandic one', () => {
  const icelandic = new Set(REGION_CHOICES.map((r) => r.value));
  for (const f of FOREIGN_REGION_CHOICES) {
    assert.equal(icelandic.has(f.value), false, `${f.value} collides with a landshluti`);
  }
});

test('every code is unique across the whole list', () => {
  const all = ALL_REGION_CHOICES.map((r) => r.value);
  assert.equal(new Set(all).size, all.length);
});

test('the Icelandic list stays exactly the eight Rannís acronyms', () => {
  // Grant awards are matched against this feed. An extra entry here would be
  // offered on the award form, where "Evrópa" is not a possible answer.
  assert.deepEqual(
    REGION_CHOICES.map((r) => r.value),
    ['HB', 'RN', 'VL', 'VF', 'NV', 'NA', 'AL', 'SL']
  );
});

test('every choice is grouped for the picker', () => {
  assert.equal(
    ALL_REGION_CHOICES.every((r) => r.group === 'Ísland' || r.group === 'Erlent'),
    true
  );
});

test('foreign codes are recognisable without a lookup', () => {
  assert.equal(isForeignRegion('X-NORDIC'), true);
  assert.equal(isForeignRegion('NA'), false);
  assert.equal(isForeignRegion(null), false);
  assert.equal(isForeignRegion(undefined), false);
  assert.equal(isForeignRegion(''), false);
});

test('labels resolve on both sides of the list', () => {
  assert.equal(regionLabel('NA'), 'Norðurland eystra (NA)');
  assert.equal(regionLabel('X-NAM'), 'Norður-Amerika (X-NAM)');
});

test('an unknown code is shown, not blanked', () => {
  // Values arrive from imports. Blanking one makes the row look empty while
  // the database says otherwise — the worst of both.
  assert.equal(regionLabel('ZZ'), 'ZZ');
  assert.equal(regionLabel(null), null);
  assert.equal(regionLabel(''), null);
});
