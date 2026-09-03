// Envelope matching. The failure mode here is quiet: an envelope that claims
// spend it shouldn't makes an over-budget project look funded, and a period
// that resolves a day short drops the last day of every month.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeBudgets,
  budgetBounds,
  budgetCovers,
  budgetStatus,
  unbudgetedSpend,
  type Budget
} from './budget.ts';
import type { SpendRow } from './metrics.ts';

const budget = (over: Partial<Budget> = {}): Budget => ({
  id: 1,
  label: 'Envelope',
  scope: 'project',
  status: 'approved',
  projectId: 1,
  includeDescendants: true,
  campaignId: null,
  medium: null,
  period: 'total',
  periodStart: null,
  amount: 100_000,
  currency: 'ISK',
  committed: 0,
  ...over
});

const row = (over: Partial<SpendRow> = {}): SpendRow => ({
  date: '2026-08-15',
  medium: 'meta_facebook',
  projectId: 2,
  campaignId: 9,
  refId: '120001',
  label: 'Demo day',
  amount: 10_000,
  currency: 'ISK',
  impressions: 1000,
  clicks: 50,
  results: 5,
  source: 'meta',
  ...over
});

const tree = new Set([1, 2, 3]);
const descendantsFor = () => tree;

// ── Period bounds ────────────────────────────────────────────────────────

test('a yearly period covers the whole year, whatever day it starts on', () => {
  assert.deepEqual(budgetBounds(budget({ period: 'year', periodStart: '2026-04-01' })), {
    since: '2026-01-01',
    until: '2026-12-31'
  });
});

test('a monthly period ends on the real last day, February included', () => {
  assert.deepEqual(budgetBounds(budget({ period: 'month', periodStart: '2026-08-01' })), {
    since: '2026-08-01',
    until: '2026-08-31'
  });
  // 2026 is not a leap year; 2028 is. Both must land on the right day.
  assert.equal(budgetBounds(budget({ period: 'month', periodStart: '2026-02-10' })).until, '2026-02-28');
  assert.equal(budgetBounds(budget({ period: 'month', periodStart: '2028-02-10' })).until, '2028-02-29');
});

test('a total period with no start date is unbounded on both sides', () => {
  assert.deepEqual(budgetBounds(budget()), { since: null, until: null });
});

test('a total period with a start date is open-ended forward', () => {
  assert.deepEqual(budgetBounds(budget({ periodStart: '2026-01-15' })), {
    since: '2026-01-15',
    until: null
  });
});

// ── Coverage ─────────────────────────────────────────────────────────────

test('a project envelope claims a cohort row only when descendants are included', () => {
  assert.equal(budgetCovers(budget(), row(), tree), true);
  assert.equal(budgetCovers(budget({ includeDescendants: false }), row(), null), false);
  assert.equal(budgetCovers(budget({ includeDescendants: false }), row({ projectId: 1 }), null), true);
});

test('unattributed spend is claimed by no project envelope', () => {
  assert.equal(budgetCovers(budget(), row({ projectId: null }), tree), false);
});

test('a medium narrows any scope, not just scope = medium', () => {
  const narrowed = budget({ medium: 'meta_instagram' });
  assert.equal(budgetCovers(narrowed, row({ medium: 'meta_facebook' }), tree), false);
  assert.equal(budgetCovers(narrowed, row({ medium: 'meta_instagram' }), tree), true);
});

test('a campaign envelope ignores other campaigns', () => {
  const c = budget({ scope: 'campaign', projectId: null, campaignId: 9 });
  assert.equal(budgetCovers(c, row(), null), true);
  assert.equal(budgetCovers(c, row({ campaignId: 10 }), null), false);
});

test('a medium-scoped envelope spans every project', () => {
  const m = budget({ scope: 'medium', projectId: null, medium: 'meta_facebook' });
  assert.equal(budgetCovers(m, row({ projectId: 99 }), null), true);
  assert.equal(budgetCovers(m, row({ projectId: 99, medium: 'ooh' }), null), false);
});

test('a row outside the period is not claimed', () => {
  const july = budget({ period: 'month', periodStart: '2026-07-01' });
  assert.equal(budgetCovers(july, row({ date: '2026-07-31' }), tree), true);
  assert.equal(budgetCovers(july, row({ date: '2026-08-01' }), tree), false);
});

// ── Status ───────────────────────────────────────────────────────────────

test('committed money counts against remaining', () => {
  const s = budgetStatus(budget({ committed: 30_000 }), [row()], descendantsFor);
  assert.equal(s.spent, 10_000);
  assert.equal(s.remaining, 60_000);
  assert.equal(s.usedShare, 0.4);
  assert.equal(s.over, false);
});

test('over-spending reports negative remaining rather than clamping to zero', () => {
  const s = budgetStatus(budget({ amount: 5_000 }), [row()], descendantsFor);
  assert.equal(s.remaining, -5_000);
  assert.equal(s.over, true);
});

test('a zero envelope has a zero used share, not an infinite one', () => {
  const s = budgetStatus(budget({ amount: 0 }), [row()], descendantsFor);
  assert.equal(s.usedShare, 0);
  assert.equal(Number.isFinite(s.usedShare), true);
});

test('draft envelopes are excluded from roll-ups, closed ones are not', () => {
  const list = [budget({ id: 1, status: 'draft' }), budget({ id: 2, status: 'closed' })];
  assert.deepEqual(activeBudgets(list).map((b) => b.id), [2]);
});

test('unbudgeted spend counts rows no active envelope claims', () => {
  const rows = [row(), row({ projectId: 99, amount: 7_000 })];
  const out = unbudgetedSpend([budget()], rows, descendantsFor);
  assert.equal(out.spend, 7_000);
  assert.equal(out.rows.length, 1);
  assert.equal(Math.round(out.share * 100) / 100, 0.41);
});

test('a draft envelope does not hide spend from the unbudgeted total', () => {
  const out = unbudgetedSpend([budget({ status: 'draft' })], [row()], descendantsFor);
  assert.equal(out.spend, 10_000);
  assert.equal(out.share, 1);
});
