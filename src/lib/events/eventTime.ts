// Whether an event has happened. Pure date arithmetic, deliberately in its own
// module with NO $lib imports so it can be unit-tested by bare node — the same
// reason scheduleTimer/parse.ts and receiptParser.ts are standalone. data.ts
// re-exports these so existing import sites are unchanged.

// ── Upcoming or past is a fact about the date ─────────────────────────────
// It used to be read off the stored `status`, which nobody updates when a date
// passes: on 2026-08-06 two events dated 1 and 10 July were still badged
// "Upcoming". Meanwhile LinkedEvents had always grouped by date, so the app
// held two conventions and only one of them could be right.
//
// These are the single implementation. `status` keeps the EDITORIAL values —
// idea, planning, archived — which say something a calendar cannot.

/** Editorial statuses win over the date: an archived event is archived
 *  whenever it happened, and an idea has nothing to be late for. */
const EDITORIAL_STATUSES = new Set(['idea', 'planning', 'archived']);

/** When the event finishes. Falls back to `start` for single-moment events;
 *  null when it has no date at all, which is normal for an idea. */
export function eventEnd(e: { start?: string | null; end?: string | null }): Date | null {
  const raw = e.end ?? e.start;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Has this event finished?
 *
 * An event is past once its END has gone by — not its start. A three-day
 * conference on its second day is not "past", and keying off `start` would say
 * it was. Returns false for an undated event: unknown is not over.
 */
export function isPastEvent(
  e: { start?: string | null; end?: string | null },
  now: Date = new Date()
): boolean {
  const end = eventEnd(e);
  return end ? end < now : false;
}

/**
 * What the badge should say.
 *
 * Editorial status first, then the date. So a `planning` event dated last year
 * still reads "Planning" — that is a statement about the work, not the
 * calendar — while anything else gets the truth from its dates.
 */
export function eventTimeStatus(
  e: { start?: string | null; end?: string | null; status?: string | null },
  now: Date = new Date()
): string {
  const s = e.status ?? '';
  if (EDITORIAL_STATUSES.has(s)) return s;
  if (!eventEnd(e)) return s || 'idea';   // undated: nothing to derive from
  return isPastEvent(e, now) ? 'past' : 'upcoming';
}
