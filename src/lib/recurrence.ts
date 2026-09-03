// Tiny RRULE-lite helper. Supports the subset of RFC 5545 we actually
// use today — FREQ + INTERVAL — anchored on the event's `start` date.
// Complex BYMONTH/BYDAY/BYSETPOS combinations are out of scope; if we
// need movable feasts (Bolludagur, Easter Monday, etc.) we can either
// store explicit dates per year or extend this later.

import type { DateEvent } from '$lib/directus';

export type RruleFreq = 'YEARLY' | 'MONTHLY' | 'WEEKLY' | 'DAILY';

export type ParsedRule = {
  freq: RruleFreq;
  interval: number;
  until?: Date | null;
  /** RFC-5545 COUNT — max number of occurrences (anchor counts as #1).
   *  Apple Calendar stores "ends after N times" recurrences this way; if
   *  we drop it on parse, a 5-time meeting expands forever. */
  count?: number | null;
  /** RFC-5545 BYDAY — `['MO','TU']` etc. We honour it only for WEEKLY
   *  rules; other freqs ignore it for now (treated as the default cadence
   *  anchored on the original start day-of-week). */
  byDay?: number[] | null; // 0=Sunday..6=Saturday
};

/** Parse a `RRULE` string like `FREQ=YEARLY;INTERVAL=1`. Returns null
 *  on anything we don't understand, so callers can fall back to a
 *  one-shot event. */
export function parseRrule(rule?: string | null): ParsedRule | null {
  if (!rule) return null;
  const parts = rule.split(';').map((p) => p.trim()).filter(Boolean);
  const out: Partial<ParsedRule> = { interval: 1 };
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (!k || !v) continue;
    const key = k.toUpperCase();
    const val = v.toUpperCase();
    if (key === 'FREQ' && (val === 'YEARLY' || val === 'MONTHLY' || val === 'WEEKLY' || val === 'DAILY')) {
      out.freq = val as RruleFreq;
    } else if (key === 'INTERVAL') {
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n > 0) out.interval = n;
    } else if (key === 'UNTIL') {
      // UNTIL can be 20251231 or 20251231T235959Z. The Date ctor handles
      // the ISO form; the bare-date form needs hyphens injected.
      const bare = /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v;
      const d = new Date(bare);
      if (!Number.isNaN(d.getTime())) out.until = d;
    } else if (key === 'COUNT') {
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n > 0) out.count = n;
    } else if (key === 'BYDAY') {
      // SU MO TU WE TH FR SA — ignore leading +1/-2 (Apple's "first Monday of
      // the month" pattern); the weekday is the last 2 chars.
      const map: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
      const days = v
        .split(',')
        .map((tok) => map[tok.trim().slice(-2).toUpperCase()])
        .filter((d): d is number => d != null);
      if (days.length) out.byDay = days;
    }
  }
  if (!out.freq) return null;
  return out as ParsedRule;
}

/** Build a friendly summary like "Every year · 25 Dec" for UI use. */
export function describeRrule(rule: string | null | undefined, anchor?: Date | null): string {
  const parsed = parseRrule(rule);
  if (!parsed) return '';
  const every = parsed.interval > 1 ? `Every ${parsed.interval} ` : 'Every ';
  const unit = (
    {
      YEARLY: parsed.interval === 1 ? 'year' : 'years',
      MONTHLY: parsed.interval === 1 ? 'month' : 'months',
      WEEKLY: parsed.interval === 1 ? 'week' : 'weeks',
      DAILY: parsed.interval === 1 ? 'day' : 'days'
    } as const
  )[parsed.freq];
  const tail = anchor
    ? ' · ' +
      new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        ...(parsed.freq === 'WEEKLY' ? { weekday: 'long', day: undefined, month: undefined } : {})
      }).format(anchor)
    : '';
  return `${every}${unit}${tail}`;
}

/** Advance `d` by one period of `freq` × `interval`. Mutates and
 *  returns the same Date for chaining. */
function bump(d: Date, freq: RruleFreq, interval: number): Date {
  switch (freq) {
    case 'YEARLY':  d.setFullYear(d.getFullYear() + interval); break;
    case 'MONTHLY': d.setMonth(d.getMonth() + interval); break;
    case 'WEEKLY':  d.setDate(d.getDate() + 7 * interval); break;
    case 'DAILY':   d.setDate(d.getDate() + interval); break;
  }
  return d;
}

/** Expand a recurring DateEvent into one occurrence per period that
 *  overlaps the [rangeStart, rangeEnd] window. Non-recurring events
 *  pass through as a single occurrence (or none if outside the range).
 *  The returned shape preserves the original event but stamps fresh
 *  start/end Dates per occurrence — the caller adapts to its own
 *  rendering surface. */
export type Occurrence = {
  event: DateEvent;
  /** ISO string — same shape as DateEvent.start. */
  start: string;
  /** ISO string — same shape as DateEvent.end. May be null if the
   *  source had no end. */
  end: string | null;
  /** Stable key per occurrence so Svelte's keyed each blocks don't
   *  re-mount on adjacent periods. */
  key: string;
};

export function expandRecurrence(
  event: DateEvent,
  rangeStart: Date,
  rangeEnd: Date
): Occurrence[] {
  if (!event.start) return [];
  const anchorStart = new Date(event.start);
  if (Number.isNaN(anchorStart.getTime())) return [];
  const anchorEnd = event.end ? new Date(event.end) : null;
  const durationMs = anchorEnd && !Number.isNaN(anchorEnd.getTime())
    ? anchorEnd.getTime() - anchorStart.getTime()
    : null;

  // Non-recurring: just include if it overlaps the window.
  const rule = event.is_recurring ? parseRrule(event.recurrence_rule) : null;
  if (!rule) {
    const end = anchorEnd ?? anchorStart;
    if (anchorStart < rangeEnd && end >= rangeStart) {
      return [
        {
          event,
          start: anchorStart.toISOString(),
          end: anchorEnd ? anchorEnd.toISOString() : null,
          key: `dates:${event.id}`
        }
      ];
    }
    return [];
  }

  // Recurring — bump the cursor until it leaves the window. Multiple
  // safety nets so a misconfigured DAILY rule can't render thousands
  // of chips per month:
  //   - cap of 366 emitted occurrences per event per window (a year
  //     of dailies is plenty; longer windows would re-fetch anyway)
  //   - explicit `until` honoured
  //   - explicit `count` honoured (across all calls — we track
  //     cumulative occurrences from the anchor, not just emitted ones,
  //     so a 5-time meeting always tops out at #5)
  const cap = 366;
  const occurrences: Occurrence[] = [];
  const cursor = new Date(anchorStart);
  // `seq` counts every occurrence we've stepped past since the anchor
  // (1 = the anchor itself). Drives COUNT termination regardless of
  // whether we ended up inside the visible window.
  let seq = 1;

  // Helper: does the cursor's weekday match a BYDAY constraint?
  // (Only honoured for WEEKLY freq — for other freqs BYDAY semantics
  // need BYSETPOS / BYMONTH context we don't model.)
  const matchesByDay = (): boolean => {
    if (rule.freq !== 'WEEKLY' || !rule.byDay || rule.byDay.length === 0) return true;
    return rule.byDay.includes(cursor.getDay());
  };

  // Fast-forward the cursor into the window.
  while (cursor < rangeStart) {
    const occEnd = durationMs != null ? new Date(cursor.getTime() + durationMs) : cursor;
    if (occEnd >= rangeStart) break; // overlap from below
    if (rule.count && seq >= rule.count) return occurrences;
    bump(cursor, rule.freq, rule.interval);
    seq++;
    if (rule.until && cursor > rule.until) return occurrences;
  }

  for (let i = 0; i < cap; i++) {
    if (cursor >= rangeEnd) break;
    if (rule.until && cursor > rule.until) break;
    if (rule.count && seq > rule.count) break;
    if (matchesByDay()) {
      const occStart = new Date(cursor);
      const occEnd = durationMs != null ? new Date(cursor.getTime() + durationMs) : null;
      occurrences.push({
        event,
        start: occStart.toISOString(),
        end: occEnd ? occEnd.toISOString() : null,
        key: `dates:${event.id}:${occStart.toISOString().slice(0, 10)}`
      });
    }
    bump(cursor, rule.freq, rule.interval);
    seq++;
  }
  return occurrences;
}

/** Helper for create flows — turn user picks into the canonical
 *  RRULE string we store. */
export function buildRrule(
  freq: RruleFreq,
  interval = 1,
  until?: Date | null
): string {
  const parts = [`FREQ=${freq}`];
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (until) parts.push(`UNTIL=${until.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`);
  return parts.join(';');
}
