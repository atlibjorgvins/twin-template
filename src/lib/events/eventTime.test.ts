// Is this event over? The question that was being answered by a stored field
// nobody updated, so two July events were badged "Upcoming" in August.
//
// The edge cases are the whole point: a multi-day event mid-run, an undated
// idea, and an editorial status that must beat the calendar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// From eventTime.ts, not data.ts: data.ts pulls in $lib/directus, which bare
// node cannot resolve. That constraint is why this logic lives on its own.
import { isPastEvent, eventTimeStatus, eventEnd } from './eventTime.ts';

const NOW = new Date('2026-08-06T12:00:00Z');

test('the actual bug: a July event is past in August', () => {
  // Startup SuperNova Sumarpartý 2026, dated 2026-07-10, stored status
  // "upcoming". The badge read Upcoming for 27 days.
  const e = { start: '2026-07-10', end: null, status: 'upcoming' };
  assert.equal(isPastEvent(e, NOW), true);
  assert.equal(eventTimeStatus(e, NOW), 'past', 'the stale field must not win');
});

test('a future event is upcoming even if stored as past', () => {
  const e = { start: '2026-12-01', end: null, status: 'past' };
  assert.equal(isPastEvent(e, NOW), false);
  assert.equal(eventTimeStatus(e, NOW), 'upcoming');
});

test('a multi-day event mid-run is NOT past', () => {
  // Keying off `start` would call this past on day two, which is why
  // isPastEvent reads `end`.
  const e = { start: '2026-08-04', end: '2026-08-09', status: 'upcoming' };
  assert.equal(isPastEvent(e, NOW), false);
  assert.equal(eventTimeStatus(e, NOW), 'upcoming');
});

test('a multi-day event is past only once its end has gone', () => {
  const e = { start: '2026-07-28', end: '2026-08-02', status: 'upcoming' };
  assert.equal(isPastEvent(e, NOW), true);
});

test('end wins over start', () => {
  assert.equal(eventEnd({ start: '2026-01-01', end: '2026-12-31' })?.getUTCFullYear(), 2026);
  assert.equal(eventEnd({ start: '2026-01-01', end: '2026-12-31' })?.getUTCMonth(), 11);
});

test('editorial statuses beat the calendar', () => {
  // "Planning" describes the work, not the date. A planning row dated last
  // year is still planning — saying "Past" would lose the only information
  // the field was carrying.
  for (const s of ['idea', 'planning', 'archived']) {
    const e = { start: '2020-01-01', end: null, status: s };
    assert.equal(eventTimeStatus(e, NOW), s, `${s} must survive a passed date`);
  }
});

test('an undated event is not "over"', () => {
  // Unknown is not past. An idea with no date must not be badged Past.
  const e = { start: null, end: null, status: 'upcoming' };
  assert.equal(isPastEvent(e, NOW), false);
  assert.equal(eventEnd(e), null);
});

test('an undated row keeps its stored status rather than inventing one', () => {
  assert.equal(eventTimeStatus({ start: null, end: null, status: 'planning' }, NOW), 'planning');
  // Nothing stored and nothing to derive from: idea is the honest floor.
  assert.equal(eventTimeStatus({ start: null, end: null, status: null }, NOW), 'idea');
});

test('an unparseable date is treated as undated, not as 1970', () => {
  // new Date('not a date') is Invalid, and Invalid < now is false in JS — but
  // relying on that would be an accident. eventEnd returns null explicitly.
  const e = { start: 'not a date', end: null, status: 'upcoming' };
  assert.equal(eventEnd(e), null);
  assert.equal(isPastEvent(e, NOW), false);
});

test('an event ending today is still upcoming until the moment passes', () => {
  const later = { start: '2026-08-06', end: '2026-08-06T23:00:00Z', status: 'upcoming' };
  assert.equal(isPastEvent(later, NOW), false);
  const earlier = { start: '2026-08-06', end: '2026-08-06T09:00:00Z', status: 'upcoming' };
  assert.equal(isPastEvent(earlier, NOW), true);
});
