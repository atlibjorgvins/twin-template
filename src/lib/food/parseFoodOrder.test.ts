// Run with:  npm run test:food
// (node:test + --experimental-strip-types, same convention as
//  receiptParser.test.ts — no new dev dependencies.)
//
// SCREENSHOT is not transcribed by hand: it is the verbatim response from the
// NAS OCR service (rapidocr-onnxruntime, PP-OCRv6_det + latin_PP-OCRv5_rec)
// for a real order screenshot, boxes reduced to their bounding rectangle.
// That is deliberate — it pins the exact glyph failures the model makes
// ("ÞRIÐJUDAGUR"→"PRIDJUDAGUR", "MIÐVIKUDAGUR"→"MIDVIKUDAGUR",
// "valið"→"valiö") so a parser change that only works on clean text fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, matchDayHeader, resolveYear, parseFoodOrder, type OcrLine } from './parseFoodOrder.ts';

const SCREENSHOT: OcrLine[] = [
  { text: 'Staðfesta pöntun', score: 0.99, box: [[354, 39], [645, 39], [645, 82], [354, 82]] },
  { text: 'MÁNUDAGUR 10. ÁGÚST', score: 0.998, box: [[398, 102], [601, 102], [601, 129], [398, 129]] },
  { text: 'Hádegismatur', score: 1.0, box: [[48, 133], [157, 133], [157, 156], [48, 156]] },
  { text: 'FÖNIX', score: 0.991, box: [[58, 167], [119, 167], [119, 197], [58, 197]] },
  { text: '×', score: 0.992, box: [[921, 172], [940, 172], [940, 192], [921, 192]] },
  { text: 'Kjúklingur í ostrusósu', score: 0.992, box: [[61, 194], [211, 194], [211, 218], [61, 218]] },
  { text: 'PRIDJUDAGUR 11. ÁGÚST', score: 0.996, box: [[394, 250], [605, 250], [605, 276], [394, 276]] },
  { text: 'Hádegismatur', score: 1.0, box: [[48, 280], [156, 280], [156, 303], [48, 303]] },
  { text: 'TOKYO SUSHI', score: 0.994, box: [[62, 320], [173, 320], [173, 343], [62, 343]] },
  { text: '×', score: 0.98, box: [[921, 320], [939, 320], [939, 338], [921, 338]] },
  { text: 'Vegan bliss poké skál', score: 0.98, box: [[62, 341], [210, 341], [210, 365], [62, 365]] },
  { text: 'Vegan', score: 1.0, box: [[69, 371], [120, 371], [120, 393], [69, 393]] },
  { text: 'MIDVIKUDAGUR 12. ÁGÚST', score: 0.997, box: [[387, 426], [610, 426], [610, 456], [387, 456]] },
  { text: 'Ekkert valiö', score: 0.912, box: [[62, 473], [144, 473], [144, 494], [62, 494]] },
  { text: 'FIMMTUDAGUR 13. ÁGÚST', score: 0.993, box: [[391, 527], [608, 527], [608, 553], [391, 553]] },
  { text: 'Ekkert valiö', score: 0.912, box: [[62, 572], [144, 572], [144, 593], [62, 593]] },
  { text: 'FÖSTUDAGUR 14. ÁGÚST', score: 0.998, box: [[396, 626], [603, 626], [603, 652], [396, 652]] },
  { text: 'Hádegismatur', score: 1.0, box: [[49, 655], [156, 655], [156, 678], [49, 678]] },
  { text: 'SUSHI TRAIN', score: 0.998, box: [[62, 696], [168, 696], [168, 719], [62, 719]] },
  { text: '×', score: 0.982, box: [[921, 696], [940, 696], [940, 714], [921, 714]] },
  { text: 'Korean pokeskál', score: 1.0, box: [[61, 717], [177, 717], [177, 740], [61, 740]] },
  { text: 'Breyta pöntun', score: 0.987, box: [[66, 789], [175, 789], [175, 817], [66, 817]] },
  { text: 'Staðfesta', score: 0.87, box: [[854, 785], [938, 785], [938, 819], [854, 819]] }
];

const MONDAY = new Date('2026-08-07T09:00:00Z'); // the Friday before that week

// ── fold ──────────────────────────────────────────────────────────────
test('fold collapses the glyphs the recogniser cannot produce', () => {
  // The model prints these; folding the truth the same way makes them meet.
  assert.equal(fold('ÞRIÐJUDAGUR'), fold('PRIDJUDAGUR'));
  assert.equal(fold('MIÐVIKUDAGUR'), fold('MIDVIKUDAGUR'));
  assert.equal(fold('Hádegismatur'), 'hadegismatur');
  assert.equal(fold('ÁGÚST'), 'agust');
});

test('fold strips punctuation and collapses whitespace', () => {
  assert.equal(fold('  FÖNIX  —  '), 'fonix');
  assert.equal(fold('Vegan bliss poké skál'), 'vegan bliss poke skal');
});

// ── day headers ───────────────────────────────────────────────────────
test('day headers parse despite the þ/ð failures', () => {
  assert.deepEqual(matchDayHeader('MÁNUDAGUR 10. ÁGÚST'), { day: 10, month: 8 });
  assert.deepEqual(matchDayHeader('PRIDJUDAGUR 11. ÁGÚST'), { day: 11, month: 8 });
  assert.deepEqual(matchDayHeader('MIDVIKUDAGUR 12. ÁGÚST'), { day: 12, month: 8 });
});

test('every Icelandic month name is recognised', () => {
  const months = ['janúar', 'febrúar', 'mars', 'apríl', 'maí', 'júní', 'júlí', 'ágúst', 'september', 'október', 'nóvember', 'desember'];
  months.forEach((name, i) => {
    assert.deepEqual(matchDayHeader(`MÁNUDAGUR 3. ${name.toUpperCase()}`), { day: 3, month: i + 1 }, name);
  });
});

test('a date inside a dish name does not open a new day', () => {
  assert.equal(matchDayHeader('Pizza 4. hluti með osti'), null);
  assert.equal(matchDayHeader('Kjúklingur í ostrusósu'), null);
  assert.equal(matchDayHeader('TOKYO SUSHI'), null);
});

// ── year resolution ───────────────────────────────────────────────────
test('year resolves to the nearest upcoming occurrence', () => {
  const today = new Date('2026-08-07T00:00:00Z');
  assert.equal(resolveYear(10, 8, today), '2026-08-10'); // three days out
});

test('a December screenshot for January rolls into the next year', () => {
  const today = new Date('2026-12-28T00:00:00Z');
  assert.equal(resolveYear(2, 1, today), '2027-01-02');
});

test('a date just gone by keeps the current year rather than jumping a year', () => {
  const today = new Date('2026-08-07T00:00:00Z');
  assert.equal(resolveYear(3, 8, today), '2026-08-03');
});

test('29 February resolves to a year that actually has one', () => {
  const today = new Date('2027-02-01T00:00:00Z');
  assert.equal(resolveYear(29, 2, today), '2028-02-29');
});

// ── whole screenshot ──────────────────────────────────────────────────
test('the real screenshot yields exactly the three ordered meals', () => {
  const { entries } = parseFoodOrder(SCREENSHOT, MONDAY);
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((e) => [e.date, e.restaurant, e.dish]),
    [
      ['2026-08-10', 'FÖNIX', 'Kjúklingur í ostrusósu'],
      ['2026-08-11', 'TOKYO SUSHI', 'Vegan bliss poké skál'],
      ['2026-08-14', 'SUSHI TRAIN', 'Korean pokeskál']
    ]
  );
});

test('the meal label carries onto the entry', () => {
  const { entries } = parseFoodOrder(SCREENSHOT, MONDAY);
  assert.deepEqual(entries.map((e) => e.meal), ['lunch', 'lunch', 'lunch']);
});

test('the diet pill lands on its own dish and no other', () => {
  const { entries } = parseFoodOrder(SCREENSHOT, MONDAY);
  assert.deepEqual(entries.map((e) => e.diet), [[], ['vegan'], []]);
});

test('"Ekkert valið" days are reported empty, not dropped or invented', () => {
  const { entries, emptyDates } = parseFoodOrder(SCREENSHOT, MONDAY);
  assert.deepEqual(emptyDates, ['2026-08-12', '2026-08-13']);
  assert.ok(!entries.some((e) => emptyDates.includes(e.date)));
});

test('page title and buttons never become an entry', () => {
  const { entries } = parseFoodOrder(SCREENSHOT, MONDAY);
  const text = entries.flatMap((e) => [e.restaurant, e.dish]).join(' ');
  for (const chrome of ['Staðfesta', 'Breyta', 'pöntun', '×']) {
    assert.ok(!text.includes(chrome), `"${chrome}" leaked into an entry`);
  }
});

test('ocrConfidence is the mean across every line', () => {
  const { ocrConfidence } = parseFoodOrder(SCREENSHOT, MONDAY);
  assert.ok(ocrConfidence > 0.97 && ocrConfidence <= 1);
});

// ── shapes the screenshot did not contain ─────────────────────────────
test('two meals on one day yield two entries sharing the date', () => {
  const lines: OcrLine[] = [
    { text: 'MÁNUDAGUR 10. ÁGÚST', score: 1, box: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    { text: 'Hádegismatur', score: 1, box: [[0, 10], [1, 10], [1, 11], [0, 11]] },
    { text: 'FÖNIX', score: 1, box: [[0, 20], [1, 20], [1, 21], [0, 21]] },
    { text: 'Súpa dagsins', score: 1, box: [[0, 30], [1, 30], [1, 31], [0, 31]] },
    { text: 'Kvöldmatur', score: 1, box: [[0, 40], [1, 40], [1, 41], [0, 41]] },
    { text: 'TOKYO SUSHI', score: 1, box: [[0, 50], [1, 50], [1, 51], [0, 51]] },
    { text: 'Poké skál', score: 1, box: [[0, 60], [1, 60], [1, 61], [0, 61]] }
  ];
  const { entries } = parseFoodOrder(lines, MONDAY);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.meal), ['lunch', 'dinner']);
  assert.ok(entries.every((e) => e.date === '2026-08-10'));
});

test('lines are read in visual order, not array order', () => {
  const shuffled = [...SCREENSHOT].reverse();
  const a = parseFoodOrder(SCREENSHOT, MONDAY).entries;
  const b = parseFoodOrder(shuffled, MONDAY).entries;
  assert.deepEqual(b, a);
});

test('an empty page yields nothing rather than throwing', () => {
  const { entries, emptyDates } = parseFoodOrder([], MONDAY);
  assert.deepEqual(entries, []);
  assert.deepEqual(emptyDates, []);
});

test('lines above the first day header are ignored', () => {
  const { entries } = parseFoodOrder(
    [
      { text: 'Einhver fyrirsögn', score: 1, box: [[0, 0], [1, 0], [1, 1], [0, 1]] },
      { text: 'MÁNUDAGUR 10. ÁGÚST', score: 1, box: [[0, 10], [1, 10], [1, 11], [0, 11]] },
      { text: 'FÖNIX', score: 1, box: [[0, 20], [1, 20], [1, 21], [0, 21]] },
      { text: 'Súpa', score: 1, box: [[0, 30], [1, 30], [1, 31], [0, 31]] }
    ],
    MONDAY
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].restaurant, 'FÖNIX');
});
