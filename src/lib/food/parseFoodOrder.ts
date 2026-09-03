// Turns OCR lines from an office-lunch order screenshot into dated entries.
//
// The screenshots come from the canteen ordering site: a page title, then a
// repeating block of  DAY HEADER → meal label → restaurant → dish → optional
// diet tag, with "Ekkert valið" standing in for days nothing was ordered.
//
// Two facts about the input shape the whole parser:
//
//  1. The page prints no year — only "MÁNUDAGUR 10. ÁGÚST". Orders are always
//     placed for the coming week, never far ahead, so the year is resolved
//     *forward*: the candidate year that puts the date nearest to today
//     without being more than a month in the past.
//
//  2. The recogniser is the latin PP-OCRv5 model, which has no uppercase þ or
//     ð. Measured against a real screenshot it reads "ÞRIÐJUDAGUR" as
//     "PRIDJUDAGUR" and "MIÐVIKUDAGUR" as "MIDVIKUDAGUR", every time.
//     Lowercase ð is fine ("Staðfesta", "Hádegismatur"). So nothing is matched
//     on raw text — everything goes through fold(), which folds those
//     confusions together rather than trying to correct them.
//
// Weekday names are therefore only a sanity check, never the date source: the
// day number and month name are unambiguous on their own.

/** One OCR line as returned by the NAS service (`POST /ocr`). */
export type OcrLine = {
  text: string;
  score: number;
  /** 4-point polygon [[x,y]×4] in image space; may be absent. */
  box?: number[][] | null;
};

export type FoodOrderEntry = {
  /** ISO date, year resolved forward from today. */
  date: string;
  /** Canonical meal key, or null when the screenshot didn't label one. */
  meal: MealKey | null;
  restaurant: string;
  dish: string;
  /** Diet tags printed as pills under the dish, e.g. ["vegan"]. */
  diet: string[];
  /** Mean OCR score across the lines this entry was built from. */
  confidence: number;
};

export type MealKey = 'breakfast' | 'lunch' | 'dinner';

/** Days the screenshot listed but nothing was ordered for — surfaced so the
 *  review UI can say "Wednesday was empty" instead of silently dropping it. */
export type ParsedFoodOrder = {
  entries: FoodOrderEntry[];
  emptyDates: string[];
  /** Mean rec score across every line — the OCR pass quality. */
  ocrConfidence: number;
};

const MONTHS: Record<string, number> = {
  januar: 1,
  februar: 2,
  mars: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  agust: 8,
  september: 9,
  oktober: 10,
  november: 11,
  desember: 12
};

const WEEKDAYS = [
  'manudagur',
  'pridjudagur',
  'midvikudagur',
  'fimmtudagur',
  'fostudagur',
  'laugardagur',
  'sunnudagur'
];

const MEALS: { key: MealKey; match: string[] }[] = [
  { key: 'breakfast', match: ['morgunmatur', 'morgunverdur'] },
  { key: 'lunch', match: ['hadegismatur', 'hadegisverdur', 'hadegi'] },
  { key: 'dinner', match: ['kvoldmatur', 'kvoldverdur'] }
];

/** Diet pills the site prints. Matched on folded text, stored lowercase. */
const DIET_TAGS: { tag: string; match: string[] }[] = [
  { tag: 'vegan', match: ['vegan'] },
  { tag: 'vegetarian', match: ['graenmetisfaedi', 'graenmeti', 'vegetarian'] },
  { tag: 'gluten-free', match: ['glutenlaust', 'glutenfritt', 'gluten free'] },
  { tag: 'lactose-free', match: ['laktosalaust', 'mjolkurlaust'] },
  { tag: 'fish', match: ['fiskur'] }
];

/** Chrome that is never part of an order: the page title, the buttons, the
 *  per-card remove affordance. Matched as whole folded lines. */
const CHROME = [
  'stadfesta pontun',
  'stadfesta',
  'breyta pontun',
  'pontun',
  'x',
  '×',
  'hadegismatur'
];

const EMPTY_MARKERS = ['ekkert valid', 'ekkert valio', 'ekkert'];

/**
 * Lowercase and strip everything the recogniser is unreliable about, so
 * matching never depends on a glyph the model cannot produce.
 *
 * þ→p and ð→d deliberately collapse *toward the OCR error*: the model prints
 * "PRIDJUDAGUR" for "ÞRIÐJUDAGUR", so folding the truth the same way makes the
 * two meet. ö→o likewise, because "valið" comes back as "valiö" — an ð read as
 * ö — and folding both to a bare letter makes that harmless.
 */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents: á→a, é→e
    .replace(/þ/g, 'p')
    .replace(/ð/g, 'd')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/[^a-z0-9. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Top edge of a line, for reading the page in visual order. */
function topOf(l: OcrLine): number {
  const b = l.box;
  if (!b || b.length === 0) return 0;
  return Math.min(...b.map((p) => p[1]));
}
function leftOf(l: OcrLine): number {
  const b = l.box;
  if (!b || b.length === 0) return 0;
  return Math.min(...b.map((p) => p[0]));
}

/**
 * Resolve a bare day+month to a full date. Orders are placed for the coming
 * days, so of the three candidate years the winner is the one nearest to
 * today, with anything more than `graceDays` in the past pushed forward — a
 * screenshot taken on 28 December for 2 January must land in the new year.
 */
export function resolveYear(day: number, month: number, today: Date, graceDays = 31): string {
  const base = today.getFullYear();
  let best: { iso: string; rank: number } | null = null;
  for (const y of [base - 1, base, base + 1]) {
    const d = new Date(Date.UTC(y, month - 1, day));
    // Reject impossible dates (31 February rolls over into March).
    if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) continue;
    const deltaDays = Math.round(
      (d.getTime() - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000
    );
    // Past beyond the grace window is heavily penalised, so a date that has
    // just gone by still wins over the same date a year out.
    const rank = deltaDays < -graceDays ? 100000 + Math.abs(deltaDays) : Math.abs(deltaDays);
    if (!best || rank < best.rank) {
      best = { iso: `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, rank };
    }
  }
  return best!.iso;
}

/** A day header like "MÁNUDAGUR 10. ÁGÚST" — weekday optional and unused. */
export function matchDayHeader(text: string): { day: number; month: number } | null {
  const f = fold(text);
  const m = f.match(/(?:^|\s)(\d{1,2})\s*\.\s*([a-z]+)/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2]];
  if (!month || day < 1 || day > 31) return null;
  // Require a weekday word too when one is present-looking, so a stray
  // "12. mars" inside a dish name can't open a new day block.
  const hasWeekday = WEEKDAYS.some((w) => f.includes(w));
  const startsWithDay = /^\d{1,2}\s*\./.test(f);
  if (!hasWeekday && !startsWithDay) return null;
  return { day, month };
}

function matchMeal(text: string): MealKey | null {
  const f = fold(text);
  for (const m of MEALS) if (m.match.some((x) => f === x || f.startsWith(x))) return m.key;
  return null;
}

function matchDiet(text: string): string | null {
  const f = fold(text);
  for (const d of DIET_TAGS) if (d.match.some((x) => f === x)) return d.tag;
  return null;
}

function isChrome(text: string): boolean {
  const f = fold(text);
  return f.length === 0 || CHROME.includes(f);
}

function isEmptyMarker(text: string): boolean {
  const f = fold(text);
  return EMPTY_MARKERS.some((m) => f === m || f.startsWith('ekkert val'));
}

/** Restaurant names are set in caps on this site; dishes are sentence case.
 *  Measured on real output: "FÖNIX", "TOKYO SUSHI", "SUSHI TRAIN". */
function looksLikeRestaurant(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2) return false;
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
  return upper / letters.length >= 0.8;
}

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Walk the page top-to-bottom, opening a new block at each day header and
 * filling it from the lines beneath. One entry per restaurant line, so a day
 * with both lunch and dinner ordered yields two rows.
 */
export function parseFoodOrder(lines: OcrLine[], today: Date = new Date()): ParsedFoodOrder {
  const ordered = [...lines].sort((a, b) => topOf(a) - topOf(b) || leftOf(a) - leftOf(b));

  const entries: FoodOrderEntry[] = [];
  const emptyDates: string[] = [];

  let date: string | null = null;
  let meal: MealKey | null = null;
  let sawSomething = false;
  let current: FoodOrderEntry | null = null;

  const closeDay = () => {
    if (date && !sawSomething) emptyDates.push(date);
  };

  for (const line of ordered) {
    const header = matchDayHeader(line.text);
    if (header) {
      closeDay();
      current = null;
      date = resolveYear(header.day, header.month, today);
      meal = null;
      sawSomething = false;
      continue;
    }
    if (date === null) continue; // page title and anything above the first day

    if (isEmptyMarker(line.text)) {
      current = null;
      continue;
    }

    const asMeal = matchMeal(line.text);
    if (asMeal) {
      meal = asMeal;
      current = null;
      continue;
    }

    if (isChrome(line.text)) continue;

    const diet = matchDiet(line.text);
    if (diet && current) {
      if (!current.diet.includes(diet)) current.diet.push(diet);
      continue;
    }

    if (looksLikeRestaurant(line.text) && (!current || current.dish !== '')) {
      current = {
        date,
        meal,
        restaurant: line.text.trim(),
        dish: '',
        diet: [],
        confidence: line.score
      };
      entries.push(current);
      sawSomething = true;
      continue;
    }

    if (current && current.dish === '') {
      current.dish = line.text.trim();
      current.confidence = mean([current.confidence, line.score]);
      sawSomething = true;
      continue;
    }
    // Anything else on the card (a second description line) is appended so
    // nothing printed is silently thrown away.
    if (current) current.dish = `${current.dish} ${line.text.trim()}`.trim();
  }
  closeDay();

  return {
    entries: entries.filter((e) => e.restaurant !== '' || e.dish !== ''),
    emptyDates,
    ocrConfidence: mean(lines.map((l) => l.score))
  };
}
