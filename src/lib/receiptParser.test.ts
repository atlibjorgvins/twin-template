// Run with:  npm run test:receipt
// (node:test + --experimental-strip-types, same convention as
//  scheduleTimer/parse.test.ts — no new dev dependencies.)
//
// Fixtures are inline rather than loaded from ocr-fixtures/: that folder
// holds real receipts (card last-4, kennitölur, amounts) and is
// gitignored. Every case below is transcribed from the Phase 0 gate run
// with identifiers redacted, so the tests still exercise the exact OCR
// mangling that real receipts produced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseReceipt,
  autofillable,
  fold,
  moneyIn,
  dedupeLines,
  AUTOFILL_THRESHOLD,
  type OcrLine
} from './receiptParser.ts';

/** Build a line with a box at a given y so geometry rules are exercised. */
const L = (text: string, score = 0.98, y = 0): OcrLine => ({
  text,
  score,
  box: [
    [0, y],
    [100, y],
    [100, y + 10],
    [0, y + 10]
  ]
});

// ── fold(): the þ/ð tolerance the gate proved we need ────────────────
test('fold collapses the substitutions the latin model actually produced', () => {
  // þ is never emitted; it arrived as p or b.
  assert.equal(fold('þökkum'), fold('pokkum'));
  assert.equal(fold('Þín'), fold('PIN'));
  // ð drifted across d / ö / ô / ő / δ.
  assert.equal(fold('Upphæð'), fold('Upphaed'));
  assert.equal(fold('með'), fold('med'));
  assert.equal(fold('Upphaô'), fold('Upphad'));
  assert.equal(fold('Upphaδ'), fold('Upphad'));
  // Accented vowels, which the model got right, still normalise.
  assert.equal(fold('Bónus'), 'bonus');
  assert.equal(fold('SANTALS'), 'santals');
  assert.equal(fold('Samtals'), 'samtals');
  // ð→ö is the one substitution fold() must NOT normalise, because ö is a
  // real letter. The keyword lists carry both spellings instead — see the
  // Sundurliöun case below.
  assert.equal(fold('Sundurliðun'), 'sundurlidun');
  assert.equal(fold('Sundurliöun'), 'sundurlioun');
});

test('a VSK breakdown spelled Sundurliöun is not mistaken for the total', () => {
  const p = parseReceipt(
    [
      L('Sundurliöun', 0.95, 100),
      L('99.999', 1.0, 110),
      L('Samtals', 0.98, 200),
      L('4.836', 1.0, 210)
    ],
    { capturedAt: '2026-01-30T10:00:00Z' }
  );
  assert.equal(p.amount, 4836);
});

// ── moneyIn(): ISK formats seen on real receipts ─────────────────────
test('moneyIn handles dot-thousands, comma-decimals and OCR spacing', () => {
  assert.deepEqual(moneyIn('1.234 kr'), [1234]);
  assert.deepEqual(moneyIn('1.234,00'), [1234]);
  assert.deepEqual(moneyIn('12069, 00 KR'), [12069]);   // real N1 spacing
  assert.deepEqual(moneyIn('231.239 ISK'), [231239]);
  assert.deepEqual(moneyIn('10127'), [10127]);
  assert.deepEqual(moneyIn('238.575,00'), [238575]);
});

test('moneyIn ignores long digit runs that are identifiers, not money', () => {
  // kennitala, card PAN, terminal id — all appear near totals.
  assert.deepEqual(moneyIn('Kt. 590269-1249'), []);
  assert.deepEqual(moneyIn('A0000000031010'), []);
  assert.deepEqual(moneyIn('MID:000000000001856'), []);
});

// ── dedupe: one gate image contained the same receipt twice ──────────
test('dedupeLines collapses repeated lines and keeps the best score', () => {
  const out = dedupeLines([
    L('Samtals kr', 0.92),
    L('Samtals kr', 0.99),
    L('4.836', 1.0)
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].score, 0.99);
});

// ── full parses, transcribed from real gate output ───────────────────
test('N1 fuel receipt: amount, date and merchant all confident', () => {
  const p = parseReceipt(
    [
      L('N1 sjálfsali #2', 0.95, 0),
      L('Kringlumýrarbraut 100', 0.99, 20),
      L('KENNITALA: 411003-3370', 0.98, 40),
      L('20-04-2026 17:21:49', 1.0, 60),
      L('Bensin ET', 1.0, 120),
      L('Samtals', 0.99, 200),
      L('12069, 00 KR', 0.99, 210),
      L('VSK', 1.0, 230),
      L('2335, 35 KR', 0.98, 240),
      L('Staðfest af tæki', 0.97, 300)
    ],
    { capturedAt: '2026-04-20T18:00:00Z' }
  );
  assert.equal(p.amount, 12069);
  assert.equal(p.txn_date, '2026-04-20');
  assert.equal(p.merchant, 'N1');
  assert.ok(p.confidence.amount >= AUTOFILL_THRESHOLD, 'amount should auto-fill');
  assert.ok(p.confidence.txn_date >= AUTOFILL_THRESHOLD, 'date should auto-fill');
  assert.ok(p.confidence.merchant >= AUTOFILL_THRESHOLD, 'merchant should auto-fill');
});

test('Bónus receipt: mangled ð/þ lines still parse', () => {
  const p = parseReceipt(
    [
      L('BÓNUS', 0.94, 0),
      L('Bónus Nýbýlavegur', 0.89, 20),
      L('KT. 450199-3389 VSK: 106034', 0.96, 40),
      L('Dags.: 29.01.26 19:54', 0.96, 60),
      L('bónus poki margnota', 0.96, 120),
      L('Samtals kr', 0.92, 200),
      L('4.836', 1.0, 205),
      L('VSKx Nettoupph', 0.97, 240),   // must NOT be taken as the total
      L('3.900', 1.0, 250),
      L('pökkum viöskiptin', 0.91, 300) // þökkum viðskiptin, mangled
    ],
    { capturedAt: '2026-01-30T10:00:00Z' }
  );
  assert.equal(p.amount, 4836, 'grand total, not the VSK net line');
  assert.equal(p.txn_date, '2026-01-29');
  assert.equal(p.merchant, 'Bónus');
});

test('two-digit years and dd.mm.yyyy both resolve', () => {
  const a = parseReceipt([L('Dags.: 09.07.25 17:41', 0.99), L('Samtals Kr.', 0.98), L('32.756', 1.0)], {
    capturedAt: '2025-07-10T10:00:00Z'
  });
  assert.equal(a.txn_date, '2025-07-09');

  const b = parseReceipt([L('Dagsetning', 1.0), L('12.08.2022', 1.0), L('Samtals ISK meô vsk.', 0.96), L('91.520', 1.0)], {
    capturedAt: '2022-08-13T10:00:00Z'
  });
  assert.equal(b.txn_date, '2022-08-12');
  assert.equal(b.amount, 91520, 'keyword match survives ð→ô in "meô"');
});

test('version strings and out-of-window dates are rejected', () => {
  const p = parseReceipt(
    [
      L('VSC 7.7.2.10', 0.98),          // looks like d.m.y — must not win
      L('Dags.: 10.12.2024', 0.98),
      L('Samtals', 0.99),
      L('8.692', 1.0)
    ],
    { capturedAt: '2024-12-11T10:00:00Z' }
  );
  assert.equal(p.txn_date, '2024-12-10');
});

test('receipt where only the amount is confident leaves the rest null', () => {
  // No merchant alias, no header text, no parsable date — the spec's
  // "only auto-fill above threshold" case.
  const p = parseReceipt(
    [
      L('4', 0.46, 0),
      L('!!!', 0.3, 10),
      L('Samtals', 0.97, 100),
      L('14.900', 0.97, 110)
    ],
    { capturedAt: '2026-07-26T10:00:00Z' }
  );
  assert.equal(p.amount, 14900);
  assert.equal(p.txn_date, null);
  const fill = autofillable(p);
  assert.equal(fill.amount, 14900);
  assert.equal('txn_date' in fill, false, 'date must not be auto-filled');
  assert.equal('merchant' in fill, false, 'weak merchant must not be auto-filled');
});

test('unreadable image yields nothing rather than garbage', () => {
  // Mirrors the 0.435-mean image from the gate run.
  const p = parseReceipt(
    [L('AE ASN B T', 0.27, 0), L('NINIGONONININ', 0.56, 20), L('LEEEROERL', 0.23, 40)],
    { capturedAt: '2026-07-26T10:00:00Z' }
  );
  assert.equal(p.amount, null);
  assert.equal(p.txn_date, null);
  assert.deepEqual(autofillable(p), {});
});

test('interleaved columns: the line after the keyword is not its neighbour', () => {
  // Straight from a real photo of two receipts side by side. PaddleOCR
  // emits them interleaved, so "Samtals0" (left column, y=506) is
  // followed in the array by "Time: 10:28" from the right column — an
  // earlier index-adjacency rule read that as a total of 28.
  const p = parseReceipt(
    [
      L('Samtals0', 0.97, 506),
      L('1282002', 0.98, 565),
      L('Time: 10:28', 0.98, 562),
      L('Vibakips', 0.95, 581),
      L('91.820', 0.99, 588)
    ],
    { capturedAt: '2022-08-13T10:00:00Z' }
  );
  assert.notEqual(p.amount, 28, 'must not read a clock as the total');
  assert.ok(
    p.confidence.amount < AUTOFILL_THRESHOLD,
    'nothing sits beside the keyword, so any guess stays out of autofill'
  );
  assert.equal('amount' in autofillable(p), false);
});

test('the figure on the label row beats a bigger number below it', () => {
  // Real Bónus layout: "Samtals kr | 4.836", and 35px lower a terminal
  // number 5060 that is larger. Searching one band and taking the max
  // picked the terminal id.
  const p = parseReceipt(
    [
      L('Samtals kr', 0.96, 475),
      L('4.836', 1.0, 478),
      L('Greiðslukort', 0.97, 486),
      L('5060', 0.99, 510)
    ],
    { capturedAt: '2026-01-30T10:00:00Z' }
  );
  assert.equal(p.amount, 4836);
  assert.ok(p.confidence.amount >= AUTOFILL_THRESHOLD);
});

test('Upphæð as a column header does not auto-fill a line-item price', () => {
  const p = parseReceipt(
    [
      L('Lýsing', 0.97, 392),
      L('Upphæð', 0.95, 396),
      L('bónus poki margnota', 0.96, 416),
      L('2 stk @ 229', 0.94, 428)
    ],
    { capturedAt: '2026-01-30T10:00:00Z' }
  );
  assert.ok(
    p.confidence.amount < AUTOFILL_THRESHOLD,
    'a weak label must never write itself into the record'
  );
  assert.equal('amount' in autofillable(p), false);
});

test('Upphafstími is a start time, not an amount', () => {
  const p = parseReceipt(
    [L('Upphafstími', 0.97, 291), L('14:40', 0.99, 294)],
    { capturedAt: '2025-07-29T10:00:00Z' }
  );
  assert.equal('amount' in autofillable(p), false);
});

test('"Net Total" is not the merchant Nettó, and EUR amounts do not fill', () => {
  const p = parseReceipt(
    [L('PRIME400', 0.98, 40), L('Net Total:', 0.97, 401), L('60.51€', 0.96, 401)],
    { capturedAt: '2026-07-02T10:00:00Z' }
  );
  assert.notEqual(p.merchant, 'Nettó', 'short aliases must match whole words only');
  assert.equal(
    'amount' in autofillable(p),
    false,
    'a foreign figure must not land in an ISK field'
  );
});

test('an ISK marker outranks a stray currency glyph', () => {
  const p = parseReceipt(
    [L('Samtals kr', 0.98, 200), L('4.836', 1.0, 200), L('€ 0,00 afsláttur', 0.9, 260)],
    { capturedAt: '2026-01-30T10:00:00Z' }
  );
  assert.equal(autofillable(p).amount, 4836);
});

// ── VSK (VAT) ────────────────────────────────────────────────────────
test('VSK is taken from a breakdown row that reconciles against the total', () => {
  // Real Bónus layout: 4.836 gross, 3.900 net, 936 VAT at 24%.
  // 4836 - 4836/1.24 = 936 exactly.
  const p = parseReceipt(
    [
      L('Samtals kr', 0.96, 200),
      L('4.836', 1.0, 200),
      L('VSK% Nettoupph', 0.95, 300),
      L('24', 0.99, 320),
      L('3.900', 1.0, 320),
      L('936', 1.0, 320)
    ],
    { capturedAt: '2026-01-30T10:00:00Z' }
  );
  assert.equal(p.amount, 4836);
  assert.equal(p.vsk_amount, 936);
  assert.equal(autofillable(p).vsk_amount, 936);
});

test('a VSK registration number is never mistaken for VAT', () => {
  // The whole reason this needs arithmetic: "VSK: 106034" is the company's
  // VAT number. Filing 106.034 kr of VAT on a 4.836 kr receipt would be
  // both wrong and plausible-looking.
  const p = parseReceipt(
    [
      L('KT. 450199-3389 VSK: 106034', 0.96, 40),
      L('Samtals kr', 0.96, 200),
      L('4.836', 1.0, 200)
    ],
    { capturedAt: '2026-01-30T10:00:00Z' }
  );
  assert.equal(p.amount, 4836);
  assert.equal(p.vsk_amount, null);
  assert.equal('vsk_amount' in autofillable(p), false);
});

test('Vsknr / Vsk-númer lines are excluded outright', () => {
  for (const line of ['Vsknr. 9079', 'Vsk-númer: 141887', 'VSKNR. 133198']) {
    const p = parseReceipt(
      [L(line, 0.97, 40), L('Samtals', 0.98, 200), L('4.836', 1.0, 200)],
      { capturedAt: '2026-01-30T10:00:00Z' }
    );
    assert.equal(p.vsk_amount, null, `${line} must not yield VAT`);
  }
});

test('till rounding is tolerated but a wrong rate is not', () => {
  // A real N1 receipt printed 2335.35 where 24% of 12.069 computes to
  // 2335.94 — under a krona out, and it should still be accepted.
  const ok = parseReceipt(
    [L('Samtals', 0.99, 200), L('12069, 00 KR', 0.99, 200), L('VSK', 1.0, 240), L('2335, 35 KR', 0.98, 240)],
    { capturedAt: '2026-04-23T10:00:00Z' }
  );
  assert.equal(ok.vsk_amount, 2335.35);

  // A figure consistent with NEITHER rate is rejected. 4.836 implies 936 at
  // 24% or 479 at 11%; 700 is neither, so it is not VAT.
  const wrong = parseReceipt(
    [L('Samtals', 0.99, 200), L('4.836', 1.0, 200), L('VSK', 1.0, 240), L('700', 1.0, 240)],
    { capturedAt: '2026-01-30T10:00:00Z' }
  );
  assert.equal(wrong.vsk_amount, null);
});

test('either legal rate is accepted — 11% baskets are real', () => {
  // Reconciliation proves internal consistency, not which rate the shop
  // charged. 11% applies to food, books and heating, so 479 on a 4.836
  // total is a legitimate reading and must not be thrown away.
  const p = parseReceipt(
    [L('Samtals', 0.99, 200), L('4.836', 1.0, 200), L('VSK 11%', 1.0, 240), L('479', 1.0, 240)],
    { capturedAt: '2026-01-30T10:00:00Z' }
  );
  assert.equal(p.vsk_amount, 479);
});

test('no trustworthy total means no VAT', () => {
  // Without a total there is nothing to reconcile against, so a printed
  // figure stays unclaimed rather than being taken on faith.
  const p = parseReceipt(
    [L('VSK', 1.0, 240), L('936', 1.0, 240)],
    { capturedAt: '2026-01-30T10:00:00Z' }
  );
  assert.equal(p.vsk_amount, null);
});

test('fallback amount uses the bottom third and stays below the bar', () => {
  // No keyword at all → low-confidence geometric fallback only.
  const p = parseReceipt(
    [L('Kaffi', 0.99, 0), L('550', 0.99, 10), L('4.671', 0.99, 900)],
    { capturedAt: '2026-07-26T10:00:00Z' }
  );
  assert.equal(p.amount, 4671, 'largest value in the bottom third');
  assert.ok(p.confidence.amount < AUTOFILL_THRESHOLD, 'fallback must not auto-fill');
  assert.equal('amount' in autofillable(p), false);
});
