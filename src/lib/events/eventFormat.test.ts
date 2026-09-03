import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatEventWhen, relativeEventDay, sameCalendarDay, stripMeetingBoilerplate } from './eventFormat.ts';

// These run under `node --test --experimental-strip-types`, so eventFormat.ts
// must stay free of $lib imports.

test('same-day timed range prints the day once', () => {
  const s = formatEventWhen('2026-08-19T18:00:00.000Z', '2026-08-19T20:00:00.000Z');
  assert.match(s, /19 Aug 2026/);
  // The date must appear exactly once — that is the bug this replaces.
  assert.equal(s.match(/Aug/g)?.length, 1);
  assert.match(s, /–/);
});

test('same-day all-day prints no times', () => {
  const s = formatEventWhen('2026-08-19T00:00:00.000Z', '2026-08-19T23:59:00.000Z', { allDay: true });
  assert.match(s, /19 Aug 2026/);
  assert.doesNotMatch(s, /\d\d:\d\d/);
});

test('multi-day timed range shows both ends', () => {
  const s = formatEventWhen('2026-08-19T18:00:00.000Z', '2026-08-21T14:00:00.000Z');
  assert.match(s, /19 Aug/);
  assert.match(s, /21 Aug/);
  assert.match(s, /→/);
});

test('multi-day all-day range omits times', () => {
  const s = formatEventWhen('2026-08-19T00:00:00.000Z', '2026-08-21T00:00:00.000Z', { allDay: true });
  assert.match(s, /19 Aug/);
  assert.match(s, /21 Aug 2026/);
  assert.doesNotMatch(s, /\d\d:\d\d/);
});

test('start with no end still reads as a moment', () => {
  const s = formatEventWhen('2026-08-19T18:00:00.000Z');
  assert.match(s, /19 Aug 2026/);
  assert.match(s, /\d\d:\d\d/);
});

test('an end equal to the start is treated as no end', () => {
  const iso = '2026-08-19T18:00:00.000Z';
  assert.equal(formatEventWhen(iso, iso), formatEventWhen(iso));
});

test('missing or unparseable input yields empty string, never "Invalid Date"', () => {
  assert.equal(formatEventWhen(null), '');
  assert.equal(formatEventWhen(undefined), '');
  assert.equal(formatEventWhen(''), '');
  assert.equal(formatEventWhen('not a date'), '');
  assert.equal(relativeEventDay('not a date'), '');
});

test('a bad end date falls back to start-only rather than printing garbage', () => {
  const s = formatEventWhen('2026-08-19T18:00:00.000Z', 'nonsense');
  assert.doesNotMatch(s, /Invalid/);
  assert.match(s, /19 Aug 2026/);
});

test('sameCalendarDay ignores clock time', () => {
  assert.equal(sameCalendarDay(new Date('2026-08-19T00:01:00'), new Date('2026-08-19T23:59:00')), true);
  assert.equal(sameCalendarDay(new Date('2026-08-19T23:59:00'), new Date('2026-08-20T00:01:00')), false);
});

test('relativeEventDay names the near days', () => {
  const now = new Date('2026-08-19T12:00:00');
  assert.equal(relativeEventDay('2026-08-19T18:00:00', now), 'today');
  assert.equal(relativeEventDay('2026-08-20T09:00:00', now), 'tomorrow');
  assert.equal(relativeEventDay('2026-08-18T09:00:00', now), 'yesterday');
});

test('relativeEventDay compares calendar days, not elapsed hours', () => {
  // 21:00 today → 09:00 tomorrow is 12 hours but one calendar day.
  const now = new Date('2026-08-19T21:00:00');
  assert.equal(relativeEventDay('2026-08-20T09:00:00', now), 'tomorrow');
});

test('relativeEventDay scales to months and years', () => {
  const now = new Date('2026-08-19T12:00:00');
  assert.match(relativeEventDay('2026-11-19T12:00:00', now), /month/);
  assert.match(relativeEventDay('2024-08-19T12:00:00', now), /year/);
});

// ── stripMeetingBoilerplate ────────────────────────────────────────────
// Fixtures are real rows from the Dates collection, trimmed only in length.

const GOOGLE_BLOCK =
  '-::~:~::~:~:~:~:~:~:~:~:~:~:~:~:~:~::~:~::-\n' +
  'Join with Google Meet: https://meet.google.com/nnc-etnz-gya\n' +
  'Or dial: (IS) +354 539 0680 PIN: 7723645902601#\n' +
  'More phone numbers: https://tel.meet/nnc-etnz-gya?pin=7723645902601&hs=7\n\n' +
  'Learn more about Meet at: https://support.google.com/a/users/answer/9282720\n\n' +
  'Please do not edit this section.\n' +
  '-::~:~::~:~:~:~:~:~:~:~:~:~:~:~:~:~::~:~::-';

test('a description that is only a Google Meet block strips to nothing', () => {
  assert.equal(stripMeetingBoilerplate(GOOGLE_BLOCK), '');
});

test('human text before a Meet block survives', () => {
  const real = 'Hlusta a mig taka eitt rennsli og fá feedback fra ykkur.';
  assert.equal(stripMeetingBoilerplate(`${real}\n\n${GOOGLE_BLOCK}`), real);
});

test('human text after a Meet block survives', () => {
  assert.equal(stripMeetingBoilerplate(`${GOOGLE_BLOCK}\n\nBring the deck.`), 'Bring the deck.');
});

test('an unclosed Meet fence still strips (truncated rows exist)', () => {
  const cut = 'Agenda below.\n\n-::~:~::~:~::-\nJoin with Google Meet: https://meet.google.com/abc';
  assert.equal(stripMeetingBoilerplate(cut), 'Agenda below.');
});

test('Teams boilerplate strips from its underscore rule', () => {
  const teams =
    'Quick sync.\n' +
    '________________________________________________________________________________\n' +
    'Microsoft Teams Need help?<https://aka.ms/JoinTeamsMeeting?omkt=en-GB>\n' +
    'Join the meeting now<https://teams.microsoft.com/l/meetup-join/19%3ameeting_X>\n' +
    'Meeting ID: 380 238 149 439\nPasscode: PuA4o8';
  assert.equal(stripMeetingBoilerplate(teams), 'Quick sync.');
});

test('a hand-typed underscore rule is NOT treated as Teams', () => {
  const hand = 'Agenda\n________________________________________\n1. Budget\n2. Hiring';
  assert.equal(stripMeetingBoilerplate(hand), hand);
});

test('Zoom join blocks strip', () => {
  const zoom = 'Catch-up.\n\nJoin Zoom Meeting\nhttps://zoom.us/j/1234567890\nPasscode: 99';
  assert.equal(stripMeetingBoilerplate(zoom), 'Catch-up.');
});

test('an ordinary description is returned untouched', () => {
  const plain = 'Retro for the sprint.\nBring notes.';
  assert.equal(stripMeetingBoilerplate(plain), plain);
});

test('prose merely mentioning a meeting link is kept', () => {
  const s = 'We will use Google Meet for this one — link to follow.';
  assert.equal(stripMeetingBoilerplate(s), s);
});

test('empty and nullish inputs are safe', () => {
  assert.equal(stripMeetingBoilerplate(null), '');
  assert.equal(stripMeetingBoilerplate(undefined), '');
  assert.equal(stripMeetingBoilerplate(''), '');
  assert.equal(stripMeetingBoilerplate('   \n  '), '');
});

test('runs of blank lines left behind are collapsed', () => {
  assert.equal(stripMeetingBoilerplate(`Top.\n\n\n\n${GOOGLE_BLOCK}\n\n\n\nBottom.`), 'Top.\n\nBottom.');
});
