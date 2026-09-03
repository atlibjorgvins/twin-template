// Run with:  npm run test:clockify
//
// Tests the pure decisions in the Clockify path — which stretches become
// sessions, and which sessions may be pushed. Both are places where a quiet
// mistake is expensive: too-eager recording fills Clockify with mis-clicks,
// and a bad idempotency check double-bills real hours.
//
// No $lib imports: bare node cannot resolve them, so the rules under test are
// mirrored here as the small pure functions they are. Keep them in step with
// focusSession.ts — that file is the implementation, this is the contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const MIN_SESSION_SECONDS = 60;

/** The recordSession rule: is this stretch worth keeping? */
function sessionFrom(startedAt: string | null, endedAt: string): { seconds: number } | null {
  if (!startedAt) return null;
  const a = Date.parse(startedAt);
  const b = Date.parse(endedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const seconds = Math.floor((b - a) / 1000);
  if (seconds < MIN_SESSION_SECONDS) return null;
  return { seconds };
}

/** The pushSession guard: may this row be sent? */
function mayPush(s: {
  clockify_entry_id: string | null;
  ended_at: string | null;
  configured: boolean;
}): boolean {
  if (s.clockify_entry_id) return false;
  if (!s.ended_at) return false;
  if (!s.configured) return false;
  return true;
}

// ── what becomes a session ────────────────────────────────────────────
test('a real stretch of work is recorded with its true length', () => {
  const s = sessionFrom('2026-08-10T09:00:00.000Z', '2026-08-10T10:30:00.000Z');
  assert.equal(s?.seconds, 5400);
});

test('a mis-click is not a session', () => {
  // Start then immediately stop. Recording these would fill Clockify with
  // dozens of one-second entries that have to be deleted by hand.
  assert.equal(sessionFrom('2026-08-10T09:00:00.000Z', '2026-08-10T09:00:04.000Z'), null);
});

test('the threshold is inclusive at exactly a minute', () => {
  assert.equal(sessionFrom('2026-08-10T09:00:00.000Z', '2026-08-10T09:01:00.000Z')?.seconds, 60);
  assert.equal(sessionFrom('2026-08-10T09:00:00.000Z', '2026-08-10T09:00:59.000Z'), null);
});

test('a task that was never started produces nothing', () => {
  // started_at is null on every paused task, and pausing an already-paused
  // task must not invent a zero-length stretch.
  assert.equal(sessionFrom(null, '2026-08-10T10:00:00.000Z'), null);
});

test('an unparseable timestamp is dropped, not stored as NaN', () => {
  assert.equal(sessionFrom('not a date', '2026-08-10T10:00:00.000Z'), null);
});

test('a clock that went backwards does not produce a negative session', () => {
  assert.equal(sessionFrom('2026-08-10T10:00:00.000Z', '2026-08-10T09:00:00.000Z'), null);
});

// ── what may be pushed ────────────────────────────────────────────────
test('a pending finished session is pushable', () => {
  assert.equal(mayPush({ clockify_entry_id: null, ended_at: '2026-08-10T10:00:00Z', configured: true }), true);
});

test('an already-pushed session is never sent twice', () => {
  // The idempotency guard. Without it, retrying a batch after a partial
  // failure double-bills every entry that succeeded the first time.
  assert.equal(mayPush({ clockify_entry_id: 'abc123', ended_at: '2026-08-10T10:00:00Z', configured: true }), false);
});

test('an unfinished session is not pushable', () => {
  // No end means the timer is still running; Clockify would get an entry that
  // claims work already finished.
  assert.equal(mayPush({ clockify_entry_id: null, ended_at: null, configured: true }), false);
});

test('nothing is pushed before the Flow exists', () => {
  // Sessions still accumulate as pending — the local history is kept and the
  // backlog pushes once connected, rather than being lost.
  assert.equal(mayPush({ clockify_entry_id: null, ended_at: '2026-08-10T10:00:00Z', configured: false }), false);
});
