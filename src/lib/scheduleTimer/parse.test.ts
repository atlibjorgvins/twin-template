// Run with:  npm run test:schedule
// (uses node:test + tsx — no extra dependencies in package.json beyond tsx).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSchedule } from './parse.ts';

test('parses a normal pasted string with multiple back-to-back slots', () => {
  const raw = '13:30 - 13:40Sól5613:40 - 13:50sól 7713:50 - 14:00Sól5';
  const slots = parseSchedule(raw);

  assert.equal(slots.length, 3);
  assert.deepEqual(slots[0], { start: '13:30', end: '13:40', label: 'Sól56', type: 'session' });
  assert.deepEqual(slots[1], { start: '13:40', end: '13:50', label: 'sól 77', type: 'session' });
  assert.deepEqual(slots[2], { start: '13:50', end: '14:00', label: 'Sól5', type: 'session' });
  // Casing is preserved as typed.
  assert.equal(slots[1].label, 'sól 77');
});

test('inserts a break with the implied window from the surrounding slots when "Pása" appears', () => {
  const raw =
    '14:20 - 14:30Sól 73Pása14:40 - 14:50Sól414:50 - 15:00Sól18';
  const slots = parseSchedule(raw);

  assert.equal(slots.length, 4);
  // The break is inferred to fill 14:30 → 14:40.
  assert.deepEqual(slots[1], { start: '14:30', end: '14:40', label: 'Pása', type: 'break' });
  // Sessions on either side stay correct.
  assert.equal(slots[0].label, 'Sól 73');
  assert.equal(slots[2].label, 'Sól4');

  // A trailing "Pása" with no following slot should default to a 10-minute break.
  const trailing = parseSchedule('09:00 - 09:30StandupPása');
  assert.equal(trailing.length, 2);
  assert.deepEqual(trailing[1], { start: '09:30', end: '09:40', label: 'Pása', type: 'break' });
});

test('falls back to the time range as the label when the title is missing', () => {
  // No characters between the end-time and the next slot's start-time.
  const raw = '10:00 - 10:1510:15 - 10:30Lecture';
  const slots = parseSchedule(raw);

  assert.equal(slots.length, 2);
  assert.equal(slots[0].label, '10:00 – 10:15'); // en-dash fallback when title is absent
  assert.equal(slots[0].type, 'session');
  assert.equal(slots[1].label, 'Lecture');
});
