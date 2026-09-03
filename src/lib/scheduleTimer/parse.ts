// Pure parser for the Schedule Timer paste-format.
// Input is a single string with no separators between entries. Each entry is either:
//   • a timed slot:  HH:MM - HH:MM<Title>   (e.g. "13:30 - 13:40Sól56")
//   • a break:       the literal word "Pása" (case-insensitive) with no time range
//
// Break windows are inferred: start = previous slot's end, end = next slot's start.
// If there is no next slot, the break defaults to 10 minutes.

export type SlotType = 'session' | 'break';

export interface Slot {
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
  label: string;
  type: SlotType;
}

// The spec quotes [^0-9]*? for the title group, but that excludes example titles like
// "Sól56" / "SOL30" that contain digits. We widen to ".*?" and rely on the lookahead
// to terminate the title at the next slot or break token.
const SLOT_RE = /(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})(.*?)(?=\d{2}:\d{2}\s*-\s*\d{2}:\d{2}|Pása|$)/gisu;
// "Pása" — case-insensitive, with optional whitespace around it.
const BREAK_TOKEN_RE = /Pása/iu;

const DEFAULT_BREAK_MINUTES = 10;

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map((x) => parseInt(x, 10));
  return h * 60 + m;
}

function minutesToTime(min: number): string {
  // Wrap into 0..1439 so a break running past midnight still produces a valid HH:MM.
  const wrapped = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

interface RawEntry {
  kind: 'slot' | 'break';
  start?: string;
  end?: string;
  label?: string;
  index: number; // position in source string, used to interleave with breaks
}

/**
 * Walk through the input, emitting RawEntry markers in source-order.
 * We do this in two passes (slots, then break tokens) and merge by index.
 */
function tokenize(input: string): RawEntry[] {
  const entries: RawEntry[] = [];

  // 1) Find every timed slot.
  for (const m of input.matchAll(SLOT_RE)) {
    entries.push({
      kind: 'slot',
      start: m[1],
      end: m[2],
      label: (m[3] ?? '').trim(),
      index: m.index ?? 0
    });
  }

  // 2) Find every "Pása" token. Use a separate global regex so we don't fight matchAll state.
  const breakRe = new RegExp(BREAK_TOKEN_RE.source, 'giu');
  let bm: RegExpExecArray | null;
  while ((bm = breakRe.exec(input)) !== null) {
    entries.push({ kind: 'break', index: bm.index });
  }

  return entries.sort((a, b) => a.index - b.index);
}

/**
 * Parse a raw schedule string into an ordered list of Slots.
 * Returns [] for empty/invalid input rather than throwing — the UI should show an empty state.
 */
export function parseSchedule(input: string): Slot[] {
  if (!input || typeof input !== 'string') return [];
  const tokens = tokenize(input);
  if (tokens.length === 0) return [];

  // First emit raw slots in order, with break placeholders we'll fill in below.
  const out: Slot[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === 'slot' && t.start && t.end) {
      const label = t.label && t.label.length > 0 ? t.label : `${t.start} – ${t.end}`;
      out.push({ start: t.start, end: t.end, label, type: 'session' });
    } else if (t.kind === 'break') {
      // Find the previous and next slot tokens to compute the window.
      const prev = [...tokens.slice(0, i)].reverse().find((x) => x.kind === 'slot');
      const next = tokens.slice(i + 1).find((x) => x.kind === 'slot');
      const breakStart = prev?.end ?? next?.start ?? '00:00';
      const breakEnd = next?.start
        ? next.start
        : minutesToTime(timeToMinutes(breakStart) + DEFAULT_BREAK_MINUTES);
      out.push({ start: breakStart, end: breakEnd, label: 'Pása', type: 'break' });
    }
  }

  return out;
}

/** Convert an "HH:MM" today-time into a Date in the user's local timezone. */
export function todayAt(hhmm: string, base: Date = new Date()): Date {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}
