// Human-readable event time ranges.
//
// Pure — no $lib imports — so it can be unit tested with
// `node --test --experimental-strip-types` like eventTime.ts next door.
//
// The point is to collapse a start/end pair into ONE line. The old event page
// showed two datetime-local inputs, so reading "when is this" meant parsing
// "19.08.2026, 18:00" and "19.08.2026, 20:00" and spotting that the dates
// matched. Same-day ranges now print the day once.

const DAY = 'en-GB';

function fmt(d: Date, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(DAY, opts).format(d);
}

export function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * One-line time range.
 *
 *   same day, timed   Wed 19 Aug 2026, 18:00–20:00
 *   same day, all-day Wed 19 Aug 2026
 *   spanning, timed   19 Aug 18:00 → 21 Aug 14:00
 *   spanning, all-day 19–21 Aug 2026
 *   start only        Wed 19 Aug 2026, 18:00
 */
export function formatEventWhen(
  startIso?: string | null,
  endIso?: string | null,
  opts: { allDay?: boolean } = {}
): string {
  if (!startIso) return '';
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return '';
  const end = endIso ? new Date(endIso) : null;
  const hasEnd = !!end && !Number.isNaN(end.getTime()) && end.getTime() !== start.getTime();
  const allDay = opts.allDay ?? false;

  const dayFull = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } as const;
  const dayShort = { day: 'numeric', month: 'short' } as const;
  const time = { hour: '2-digit', minute: '2-digit' } as const;

  if (!hasEnd) {
    return allDay ? fmt(start, dayFull) : `${fmt(start, dayFull)}, ${fmt(start, time)}`;
  }

  if (sameCalendarDay(start, end!)) {
    // The end date is redundant here — that's the whole reason this exists.
    return allDay ? fmt(start, dayFull) : `${fmt(start, dayFull)}, ${fmt(start, time)}–${fmt(end!, time)}`;
  }

  if (allDay) return `${fmt(start, dayShort)} – ${fmt(end!, dayFull)}`;
  return `${fmt(start, dayShort)} ${fmt(start, time)} → ${fmt(end!, dayShort)} ${fmt(end!, time)}`;
}

/** Countdown/elapsed label, e.g. "in 3 days", "today", "2 months ago". */
export function relativeEventDay(startIso?: string | null, now: Date = new Date()): string {
  if (!startIso) return '';
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return '';
  // Compare calendar days, not instants: an event at 09:00 tomorrow is "in 1
  // day", not "in 15 hours", because nobody plans by the hour at this zoom.
  const a = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((a.getTime() - b.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  const rtf = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
  const abs = Math.abs(days);
  if (abs < 31) return rtf.format(days, 'day');
  if (abs < 365) return rtf.format(Math.round(days / 30), 'month');
  return rtf.format(Math.round(days / 365), 'year');
}

// ── Meeting boilerplate ────────────────────────────────────────────────
//
// Calendar descriptions are mostly not descriptions. Of 1,189 rows with a
// description in this database, 486 carry a Google Meet block and 88 a
// Microsoft Teams one. Stripping them empties 366 rows outright — the
// "description" was only ever the dial-in — and reveals the buried human
// text in 226 more, including one that went from 2,858 characters to 54.
//
// Everything here is anchored on a delimiter the provider emits, never on
// the prose, so a description that merely mentions a meeting link survives.

/** Google's fenced block: -::~:~::…::~:~::- … -::~:~::…::~:~::- */
const GOOGLE_FENCE = /-::~[~:]*::-[\s\S]*?-::~[~:]*::-/g;
/** The same opener with no closer — truncated rows do occur. */
const GOOGLE_UNCLOSED = /-::~[~:]*::-[\s\S]*$/;
/** Teams opens with a rule of 20+ underscores. */
const TEAMS_RULE = /_{20,}[\s\S]*$/;
const TEAMS_HINT = /teams\.microsoft|Microsoft Teams|aka\.ms\/JoinTeamsMeeting/i;
const ZOOM_HINT = /zoom\.us\/j\/|Join Zoom Meeting/i;
const ZOOM_BLOCK = /(?:^|\n)[^\n]*(?:Join Zoom Meeting|zoom\.us\/j\/)[\s\S]*$/i;

/**
 * Remove provider-generated meeting boilerplate, keeping whatever a human
 * actually wrote. Returns '' when the description was nothing else.
 */
export function stripMeetingBoilerplate(text?: string | null): string {
  if (!text) return '';
  let s = text.replace(GOOGLE_FENCE, '').replace(GOOGLE_UNCLOSED, '');

  // Only cut at the underscore rule when the block below it is really Teams;
  // a long rule is also just a divider somebody might type by hand.
  const teams = TEAMS_RULE.exec(s);
  if (teams && TEAMS_HINT.test(teams[0])) s = s.slice(0, teams.index);

  if (ZOOM_HINT.test(s)) s = s.replace(ZOOM_BLOCK, '');

  return s.replace(/\n{3,}/g, '\n\n').trim();
}
