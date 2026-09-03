/**
 * Receipt heuristics parser (docs/ocr-service-plan.md Phase 4).
 *
 * Pure: OCR lines in → { amount, merchant, txn_date } + per-field
 * confidence out. No network, no Directus, no clock except the
 * `capturedAt` the caller passes for date sanity bounds. That keeps it
 * unit-testable against fixtures captured by scripts/ocr-test.py, and
 * lets the Directus worker stay a thin shell around it.
 *
 * Calibrated against the Phase 0 gate run (31 real images, 2043 lines).
 * The findings that shaped it:
 *
 *  - `þ` NEVER survives the latin model (0/2043) and `ð` only sometimes
 *    (→ d, ö, ô, ő, δ). So every keyword match runs through `fold()`,
 *    which collapses those substitution classes. This is why we kept the
 *    latin model instead of falling back to `en`: accented vowels are
 *    reliable and folding fixes the rest.
 *  - One real image contained the same receipt twice (every line
 *    duplicated), so lines are de-duplicated before parsing.
 *  - ISK appears as `1.234 kr`, `1.234,00`, `12069, 00 KR`, `231.239 ISK`
 *    and bare `10127`. Dot = thousands, comma = decimals.
 */

export type OcrLine = {
  text: string;
  score: number;
  /** 4-point polygon [[x,y]×4] in image space; may be absent. */
  box?: number[][] | null;
};

export type FieldConfidence = {
  amount: number;
  merchant: number;
  txn_date: number;
  vsk_amount: number;
};

export type ParsedReceipt = {
  amount: number | null;
  merchant: string | null;
  txn_date: string | null;
  /** VAT, when the printed figure reconciles against the total. */
  vsk_amount: number | null;
  confidence: FieldConfidence;
  /** Mean rec score across the (deduped) lines — the OCR pass quality. */
  ocrConfidence: number;
};

/** Auto-fill threshold from the spec — below this the worker leaves the
 *  field null for the review UI rather than guessing. */
export const AUTOFILL_THRESHOLD = 0.7;

/**
 * Collapse the substitution classes the latin model actually produced,
 * then strip to [a-z0-9]. Accent-insensitive AND þ/ð-tolerant, so
 * `Samtals`/`SANTALS`, `Upphæð`/`Upphaô`/`Upphzδ`, `þökkum`/`pokkum` all
 * land in the same bucket.
 */
export function fold(s: string): string {
  let out = s.toLowerCase();
  const classes: Array<[RegExp, string]> = [
    [/[þ]/g, 'p'],            // þ is never emitted; it arrives as p or b
    [/[ðđďδőô]/g, 'd'],       // ð drifts across all of these
    [/[æ]/g, 'ae'],
    [/[áàâäãå]/g, 'a'],
    [/[éèêë]/g, 'e'],
    [/[íìîï]/g, 'i'],
    [/[óòôöõø]/g, 'o'],
    [/[úùûü]/g, 'u'],
    [/[ýÿ]/g, 'y'],
    [/[ç]/g, 'c']
  ];
  for (const [re, to] of classes) out = out.replace(re, to);
  return out.replace(/[^a-z0-9]/g, '');
}

/**
 * Words that name a grand total outright. A hit here is trusted.
 */
const AMOUNT_STRONG = [
  'samtals', 'samtala', 'alls', 'tilgreidslu', 'heildar', 'total', 'amtdue',
  // Misreads of "Samtals" seen in the gate run: l→i and m→n.
  'samtais', 'santals'
].map(fold);

/**
 * Words that merely name *an* amount. `Upphæð` is the commonest — and on
 * most Icelandic receipts it is the price COLUMN HEADER, sitting a few
 * rows above the line items, not the total. Reading one of these confidently
 * is how a Bónus receipt whose real total was 4.836 parsed as 229 (the
 * unit price on the row below the header). Weak hits are capped below
 * AUTOFILL_THRESHOLD, so they inform the review UI without ever writing
 * themselves into the record.
 *
 * `millisamtal` (subtotal) is weak on purpose, and must be tested before
 * the strong list — it contains `samtal` as a substring.
 */
const AMOUNT_WEAK = ['millisamtal', 'upph', 'amount', 'nettototal'].map(fold);

/** Lines that look like a total but are definitely not one.
 *
 *  `ð` sometimes arrives as `ö`, which fold() cannot rewrite to `d`
 *  (ö is a real Icelandic letter — folding it would wreck every genuine
 *  ö). So words where a ð can hide carry both folded spellings. */
const AMOUNT_ANTI_KEYWORDS = [
  // "Upphafstími" is a start TIME, not an amount, but the loose `upph`
  // marker matches it — and its row holds a plausible-looking number.
  'upphafs',
  'undurlidun', 'sundurlidun', 'undurlioun', 'nettoupph',
  'afslattur', 'afsl', 'baraf', 'parafvsk', 'skuld', 'vextir', 'basei'
].map(fold);

/**
 * How much this line's wording is worth as a grand-total label:
 * 2 = strong, 1 = weak, 0 = not a total.
 */
function amountKeywordStrength(folded: string): 0 | 1 | 2 {
  if (AMOUNT_ANTI_KEYWORDS.some((k) => folded.includes(k))) return 0;
  const strong = AMOUNT_STRONG.some((k) => folded.includes(k));
  // `vsk` alone marks a VAT breakdown row — but "Samtals ISK með vsk." is
  // the grand total and also contains it, so it only disqualifies a line
  // that has no total word of its own.
  if (folded.includes('vsk') && !strong) return 0;
  if (AMOUNT_WEAK.some((k) => folded.includes(k))) return 1;
  return strong ? 2 : 0;
}

const MERCHANT_ALIASES: Array<{ canonical: string; match: string[] }> = [
  { canonical: 'Bónus', match: ['bonus'] },
  { canonical: 'Krónan', match: ['kronan'] },
  { canonical: 'Hagkaup', match: ['hagkaup'] },
  { canonical: 'Nettó', match: ['netto'] },
  { canonical: 'Olís', match: ['olis'] },
  // "N1" is read as "Ni" often enough (1→i) that the station phrase earns
  // its own entry; it is long enough to be matched as a substring safely,
  // where a bare "ni" token would fire on ordinary words.
  { canonical: 'N1', match: ['n1', 'n1hringbraut', 'n1sjalfsali', 'nisjalfsali'] },
  { canonical: 'Atlantsolía', match: ['atlantsolia'] },
  { canonical: 'Costco', match: ['costco'] },
  { canonical: 'BYKO', match: ['byko'] },
  { canonical: 'Húsasmiðjan', match: ['husasmidjan'] },
  { canonical: 'JYSK', match: ['jysk', 'rumfatalagerinn'] },
  { canonical: 'A4', match: ['a4'] },
  { canonical: 'Nova', match: ['nova', 'inova'] },
  { canonical: 'Hertz', match: ['hertz'] },
  { canonical: 'Fífa', match: ['fifa', 'fifabarna'] },
  { canonical: 'Innnes', match: ['innnes'] },
  { canonical: 'Egill Árnason', match: ['egillarnason'] },
  { canonical: 'Progastro', match: ['progastro'] },
  { canonical: 'Instavolt', match: ['instavolt', 'husavik'] },
  { canonical: 'Íslandsbanki', match: ['islandsbanki'] }
];

/** Header noise that is never a merchant name. */
const MERCHANT_SKIP = [
  'reikningur', 'kvittun', 'kvitt', 'eintakkorthafa', 'stadgreitt',
  'cardholdercopy', 'yourreceipt', 'thankyou', 'callagain', 'afritreiknings',
  'itrekunarbref', 'vsk', 'kt', 'kennitala', 'simi', 'dags', 'visa',
  'mastercard', 'snertilaust', 'approved', 'sala', 'debit', 'credit'
].map(fold);

/**
 * Drop double-detections: the same text found twice in the same place.
 * Order is preserved and the highest-scoring instance is kept.
 *
 * Position is part of the identity, and that matters. Keying on text alone
 * looked tidier but silently broke parsing: `fold()` strips the minus sign,
 * so `4.836` and `-4.836` (total and card payment) became one key, and the
 * copy that survived was often the one in the other column — leaving
 * `Samtals kr` with no figure beside it. A photo holding the same receipt
 * twice keeps both copies now, which parsing handles anyway.
 */
export function dedupeLines(lines: OcrLine[]): OcrLine[] {
  const seen = new Map<string, OcrLine>();
  const order: string[] = [];
  for (const l of lines) {
    const text = fold(l.text);
    if (!text) continue;
    const y = midY(l);
    const x = l.box?.length ? l.box.reduce((a, p) => a + p[0], 0) / l.box.length : null;
    // ~10px buckets: a re-detection lands in the same cell, the other
    // column does not.
    const where =
      y === null || x === null ? '' : `@${Math.round(y / 10)},${Math.round(x / 10)}`;
    const key = text + where;
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, l);
      order.push(key);
    } else if (l.score > prev.score) {
      seen.set(key, l);
    }
  }
  return order.map((k) => seen.get(k)!);
}

/** Vertical centre of a line's box, or null when boxes are absent. */
function midY(l: OcrLine): number | null {
  if (!l.box || l.box.length === 0) return null;
  const ys = l.box.map((p) => p[1]);
  return ys.reduce((a, b) => a + b, 0) / ys.length;
}

/** Box height, used to size the "same row, or just below" window. */
function heightOf(l: OcrLine): number | null {
  if (!l.box || l.box.length === 0) return null;
  const ys = l.box.map((p) => p[1]);
  return Math.max(...ys) - Math.min(...ys) || null;
}

/**
 * Lines visually adjacent to `anchor`: on its row, or within two rows
 * below it.
 *
 * Reading order is NOT adjacency. A photo containing two receipts side by
 * side (or any two-column layout) makes PaddleOCR interleave them, so the
 * line after `Samtals` in the array can belong to the other receipt
 * entirely — that is how an early version read `Time: 10:28` as a total
 * of 28. Geometry is the only reliable neighbour relation. With no boxes
 * we fall back to index order, which is all that is left.
 */
function neighbours(lines: OcrLine[], i: number): { sameRow: OcrLine[]; below: OcrLine[] } {
  const anchor = lines[i];
  const y = midY(anchor);
  const h = heightOf(anchor);
  if (y === null || h === null) {
    return { sameRow: [], below: [lines[i + 1], lines[i + 2]].filter(Boolean) as OcrLine[] };
  }
  const sameRow: OcrLine[] = [];
  const below: OcrLine[] = [];
  for (let j = 0; j < lines.length; j++) {
    if (j === i) continue;
    const ly = midY(lines[j]);
    if (ly === null) continue;
    const dy = ly - y;
    // Box centres jitter by a few px on a shared baseline, hence the slack
    // in both directions for "same row".
    if (dy > -h * 0.6 && dy < h * 0.6) sameRow.push(lines[j]);
    else if (dy > 0 && dy < h * 2.5) below.push(lines[j]);
  }
  return { sameRow, below };
}

/**
 * Parse every ISK-ish money value out of a line.
 * Dot/space = thousands separator, comma = decimals — so `1.234` is 1234,
 * `1.234,00` is 1234, and `12069, 00` (OCR spacing) is 12069.
 */
export function moneyIn(text: string): number[] {
  const out: number[] = [];
  const re = /(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:\s*,\s*(\d{1,2}))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const whole = m[1].replace(/[.\s]/g, '');
    if (!whole) continue;
    // A run of >=7 digits is an id (kennitala, card, terminal), not money.
    if (whole.length >= 7) continue;
    // Hyphen- or slash-joined digit groups are ids too: a kennitala
    // reads 590269-1249, and both halves are short enough to pass the
    // length test above. Reject anything glued to another number.
    const before = text[m.index - 1] ?? '';
    const after = text[m.index + m[0].length] ?? '';
    if (/[-/]/.test(before) || /[-/]/.test(after)) continue;
    const cents = m[2] ? Number(m[2]) / 100 : 0;
    const value = Number(whole) + cents;
    if (Number.isFinite(value) && value > 0) out.push(value);
  }
  return out;
}

function parseAmount(lines: OcrLine[]): { value: number | null; confidence: number } {
  // Pass 1: a keyword line. The amount is usually on it, else on the row
  // beside or just below it (receipts wrap the label and figure apart).
  let best: { value: number; strength: 1 | 2; score: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const strength = amountKeywordStrength(fold(lines[i].text));
    if (strength === 0) continue;

    // The figure belongs to the label's own row: "Samtals kr" on the left,
    // "4.836" on the right. Only when that row holds no figure at all does
    // the label wrap, and we look at the rows below. Searching both at once
    // let an unrelated number 35px lower (a terminal id) outbid the real
    // total, because the winner among candidates is the largest.
    const { sameRow, below } = neighbours(lines, i);
    const own = moneyIn(lines[i].text);
    const row = [...own, ...sameRow.flatMap((l) => moneyIn(l.text))];
    const candidates = row.length > 0 ? row : below.flatMap((l) => moneyIn(l.text));
    if (candidates.length === 0) continue;

    // Grand total is the largest figure on or beside the label.
    const value = Math.max(...candidates);
    // Strongest wording wins; between equals, the largest figure. Every
    // other labelled amount on a receipt — subtotal, VAT, per-line price,
    // the footer's repeat of the VAT summary — is smaller than the grand
    // total, so "biggest" survives footers that "lowest on the page" does
    // not.
    if (!best || strength > best.strength || (strength === best.strength && value > best.value)) {
      best = { value, strength, score: lines[i].score };
    }
  }

  if (best) {
    const confidence =
      best.strength === 2
        ? Math.min(0.95, 0.6 + best.score * 0.35)
        : // Weak label: report it, but never above the autofill bar.
          Math.min(AUTOFILL_THRESHOLD - 0.05, 0.4 + best.score * 0.25);
    return { value: best.value, confidence };
  }

  // Pass 2 (fallback): largest money value in the bottom third — totals
  // live at the foot of a receipt. Low confidence by construction.
  const withY = lines.map((l) => ({ l, y: midY(l) })).filter((x) => x.y !== null) as
    Array<{ l: OcrLine; y: number }>;
  let pool = lines;
  if (withY.length > 0) {
    const maxY = Math.max(...withY.map((x) => x.y));
    pool = withY.filter((x) => x.y >= maxY * 0.6).map((x) => x.l);
  }
  const all = pool.flatMap((l) => moneyIn(l.text));
  if (all.length === 0) return { value: null, confidence: 0 };
  return { value: Math.max(...all), confidence: 0.4 };
}

/**
 * Two numbers, a shared separator, then a run of digits.
 *
 * The trailing run is deliberately open-ended, because OCR frequently loses
 * the space between a date and the time beside it — `Dags.:29.01.2619:54`,
 * `2026-04-04193015`, `20-04-202617:21:49` are all real. An earlier version
 * required a word boundary after a 2-4 digit year, so it read `2619` as the
 * year, failed the sanity window, and never retried the shorter reading. The
 * separator is a backreference, which rejects mixed junk like `1.2-34`.
 */
const DATE_RE = /(\d{1,4})([./-])(\d{1,2})\2(\d{2,})/g;

function toIsoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Every plausible date a match could encode. The caller's sanity window is
 * what picks between them, so ambiguity is resolved by "which reading lands
 * near when the photo was taken" rather than by guessing here.
 */
function dateCandidates(a: string, b: string, tail: string): string[] {
  const out: string[] = [];
  const push = (iso: string | null) => {
    if (iso && !out.includes(iso)) out.push(iso);
  };
  const first = Number(a);
  const mid = Number(b);

  // yyyy-mm-dd, with any glued time discarded.
  if (a.length === 4) push(toIsoDate(first, mid, Number(tail.slice(0, 2))));

  // dd.mm.yyyy and dd.mm.yy — try the 4-digit year first, then the 2-digit
  // one, since a glued time makes the tail longer than the year itself.
  if (tail.length >= 4) push(toIsoDate(Number(tail.slice(0, 4)), mid, first));
  const short = Number(tail.slice(0, 2));
  push(toIsoDate(short + (short < 70 ? 2000 : 1900), mid, first));
  return out;
}

function parseDate(
  lines: OcrLine[],
  capturedAt?: string | Date | null
): { value: string | null; confidence: number } {
  const captured = capturedAt ? new Date(capturedAt) : new Date();
  const capturedMs = captured.getTime();
  // Sanity window from the spec: no future dates, nothing older than a
  // year before capture. Kills version strings like "VSC 7.7.2.10".
  const oldest = capturedMs - 400 * 24 * 3600 * 1000;
  const newest = capturedMs + 2 * 24 * 3600 * 1000;

  const found: Array<{ iso: string; score: number }> = [];
  for (const l of lines) {
    DATE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DATE_RE.exec(l.text)) !== null) {
      // First reading inside the window wins, then stop: one match must
      // contribute one date, or the frequency count below would be skewed
      // by a single ambiguous string voting several times.
      for (const iso of dateCandidates(m[1], m[3], m[4])) {
        const ms = new Date(`${iso}T12:00:00Z`).getTime();
        if (ms < oldest || ms > newest) continue;
        found.push({ iso, score: l.score });
        break;
      }
    }
  }
  if (found.length === 0) return { value: null, confidence: 0 };
  // Most frequent wins (receipts print the date more than once); ties go
  // to the highest OCR score.
  const counts = new Map<string, { n: number; score: number }>();
  for (const f of found) {
    const c = counts.get(f.iso) ?? { n: 0, score: 0 };
    counts.set(f.iso, { n: c.n + 1, score: Math.max(c.score, f.score) });
  }
  const best = [...counts.entries()].sort(
    (a, b) => b[1].n - a[1].n || b[1].score - a[1].score
  )[0];
  const conf = Math.min(0.95, 0.55 + best[1].score * 0.3 + (best[1].n > 1 ? 0.1 : 0));
  return { value: best[0], confidence: conf };
}

function parseMerchant(lines: OcrLine[]): { value: string | null; confidence: number } {
  // Alias hit anywhere is the strongest signal — a folded match against
  // the known-merchant map survives even mangled headers.
  for (const l of lines) {
    const f = fold(l.text);
    // Match whole words, not substrings. fold() strips spaces, so a plain
    // `includes` made "Net Total:" read as the merchant Nettó — short
    // aliases hide inside ordinary words. Long aliases keep the substring
    // path because they span words themselves ("Egill Árnason") or carry a
    // trailing branch number ("HUSAVIK-3").
    // Split on any non-alphanumeric, not just whitespace: a merchant often
    // appears only inside an email or domain ("nova@nova.is"), which a
    // whitespace split leaves as one unmatchable token. Do NOT also split
    // digit/letter boundaries — that would tear "N1" into "n" and "1".
    const tokens = l.text.split(/[^\p{L}\p{N}]+/u).map(fold).filter(Boolean);
    for (const alias of MERCHANT_ALIASES) {
      const hit = alias.match.some(
        (m) => tokens.includes(m) || (m.length >= 7 && f.includes(m))
      );
      if (hit) {
        return { value: alias.canonical, confidence: Math.min(0.95, 0.7 + l.score * 0.25) };
      }
    }
  }

  // Fallback: header zone (top 25% by y when boxes exist, else first
  // lines), skipping numeric and boilerplate lines. Low confidence.
  const withY = lines.map((l) => ({ l, y: midY(l) })).filter((x) => x.y !== null) as
    Array<{ l: OcrLine; y: number }>;
  let header = lines.slice(0, 5);
  if (withY.length > 0) {
    const maxY = Math.max(...withY.map((x) => x.y));
    header = withY.filter((x) => x.y <= maxY * 0.25).map((x) => x.l).slice(0, 6);
  }
  for (const l of header) {
    const t = l.text.trim();
    const f = fold(t);
    if (f.length < 3) continue;
    if (/^[\d\s.,:/-]+$/.test(t)) continue;              // pure numbers
    if (MERCHANT_SKIP.some((s) => f.startsWith(s))) continue;
    if (/^kt\.?\s*\d/i.test(t)) continue;                // kennitala line
    return { value: t, confidence: 0.45 };
  }
  return { value: null, confidence: 0 };
}

/** Icelandic VAT rates. 24% standard, 11% reduced (food, books, heating). */
const VSK_RATES = [24, 11];

/**
 * VAT on the receipt — but only when it can be *proved*.
 *
 * The trap: on an Icelandic receipt most lines containing "VSK" are the
 * company's VAT REGISTRATION NUMBER, not money. `VSK: 106034`,
 * `Vsknr. 9079`, `Vsk-númer: 141887`. Reading those as amounts would file
 * 106.034 kr of VAT against a 4.836 kr purchase — confidently, and wrongly.
 *
 * The defence is arithmetic. VAT is a fixed fraction of the gross total, so
 * a candidate only survives if `total - total/(1+rate)` lands on it. That
 * check is decisive: on a real 4.836 kr Bónus receipt the printed 936
 * reconciles exactly at 24%, while the VAT number 106034 misses by orders of
 * magnitude. Rounding on the till costs under a krona (a real N1 receipt
 * printed 2335.35 against a computed 2335.94), so the tolerance is small.
 *
 * No total means no proof, so no VAT. We do NOT derive it from the total
 * either — a derived figure is a guess about which rate applied, and mixed
 * baskets carry both.
 */
function parseVsk(
  lines: OcrLine[],
  total: number | null
): { value: number | null; confidence: number } {
  if (total === null || total <= 0) return { value: null, confidence: 0 };

  // Lines naming a registration number are excluded outright: they carry a
  // 5-6 digit number that is never an amount.
  const isRegistration = (f: string) =>
    /vsknr|vsknumer|vskn\d|vskkodi|vsknr/.test(f) || /^kt\d/.test(f);

  const candidates: Array<{ value: number; score: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const f = fold(lines[i].text);
    if (!f.includes('vsk') && !f.includes('vat')) continue;
    if (isRegistration(f)) continue;
    const { sameRow, below } = neighbours(lines, i);
    const pool = [lines[i], ...sameRow, ...below];
    for (const l of pool) {
      // Skip the neighbour if IT is a registration line.
      if (l !== lines[i] && isRegistration(fold(l.text))) continue;
      for (const v of moneyIn(l.text)) candidates.push({ value: v, score: lines[i].score });
    }
  }
  if (candidates.length === 0) return { value: null, confidence: 0 };

  let best: { value: number; score: number; delta: number } | null = null;
  for (const rate of VSK_RATES) {
    const expected = total - total / (1 + rate / 100);
    // A krona or two of till rounding, and no more — the whole point is that
    // a loose tolerance would let a VAT number through.
    const tolerance = Math.max(2, expected * 0.01);
    for (const c of candidates) {
      const delta = Math.abs(c.value - expected);
      if (delta > tolerance) continue;
      if (!best || delta < best.delta) best = { ...c, delta };
    }
  }
  if (!best) return { value: null, confidence: 0 };
  return { value: best.value, confidence: Math.min(0.95, 0.7 + best.score * 0.25) };
}

/**
 * True when the receipt is priced in something other than ISK.
 *
 * `finance_receipt.amount` has no currency beside it, so auto-filling a
 * foreign figure is worse than auto-filling nothing: 60 would land in an
 * ISK field where ~8.500 belongs, and it would look plausible enough to
 * survive review. Software invoices in the fixture set (n8n, PRIME400) are
 * all like this. We keep the parsed value for the review UI and only
 * withhold the auto-fill.
 */
function looksForeignCurrency(lines: OcrLine[]): boolean {
  let foreign = false;
  for (const l of lines) {
    const t = l.text;
    if (/[€$£]|\b(EUR|USD|GBP|DKK|SEK|NOK)\b/i.test(t)) foreign = true;
    // An explicit ISK marker outranks any stray glyph.
    if (/\bISK\b|\bkr\.?\b|\bkrónur\b/i.test(t)) return false;
  }
  return foreign;
}

/** The one entry point the worker calls. */
export function parseReceipt(
  rawLines: OcrLine[],
  opts: { capturedAt?: string | Date | null } = {}
): ParsedReceipt {
  const lines = dedupeLines(rawLines ?? []);
  const scores = lines.map((l) => l.score);
  const amount = parseAmount(lines);
  const date = parseDate(lines, opts.capturedAt);
  const merchant = parseMerchant(lines);
  if (looksForeignCurrency(lines)) amount.confidence = Math.min(amount.confidence, 0.5);
  // VAT is checked against the total, so it has to be parsed after it — and
  // it inherits the total's fate: an amount we would not auto-fill cannot
  // vouch for a VAT figure either.
  const vsk = parseVsk(lines, amount.confidence >= AUTOFILL_THRESHOLD ? amount.value : null);
  return {
    amount: amount.value,
    merchant: merchant.value,
    txn_date: date.value,
    vsk_amount: vsk.value,
    confidence: {
      amount: Number(amount.confidence.toFixed(2)),
      merchant: Number(merchant.confidence.toFixed(2)),
      txn_date: Number(date.confidence.toFixed(2)),
      vsk_amount: Number(vsk.confidence.toFixed(2))
    },
    ocrConfidence: scores.length
      ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(4))
      : 0
  };
}

/** Fields whose confidence clears the auto-fill bar. The worker writes
 *  only these and leaves the rest null for the review UI. */
export function autofillable(p: ParsedReceipt): Partial<{
  amount: number;
  merchant: string;
  txn_date: string;
  vsk_amount: number;
}> {
  const out: Record<string, unknown> = {};
  if (p.amount !== null && p.confidence.amount >= AUTOFILL_THRESHOLD) out.amount = p.amount;
  if (p.merchant !== null && p.confidence.merchant >= AUTOFILL_THRESHOLD) out.merchant = p.merchant;
  if (p.txn_date !== null && p.confidence.txn_date >= AUTOFILL_THRESHOLD) out.txn_date = p.txn_date;
  if (p.vsk_amount !== null && p.confidence.vsk_amount >= AUTOFILL_THRESHOLD) {
    out.vsk_amount = p.vsk_amount;
  }
  return out;
}
