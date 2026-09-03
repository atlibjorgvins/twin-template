// The read model's arithmetic. These are the mistakes a spend dashboard makes
// silently: double-counting a campaign that has both a campaign row and a
// platform breakdown, inventing a platform for days Meta never split, letting
// breakdown numbers that don't add up move the headline total, and reporting a
// drill over 60% of the spend as though it covered all of it. Each has a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMarketing,
  descendantIds,
  emptyMarketingFilters,
  explodeSpend,
  daysBefore,
  spendByMonth,
  windowForYears,
  type BreakdownRow,
  type MarketingBundle,
  type ManualRow,
  type MetaDayRow
} from './metrics.ts';
import { MEDIUM_UNSPLIT, type Medium } from './media.ts';
import type { Budget } from './budget.ts';

// ── Fixture ──────────────────────────────────────────────────────────────
// One programme ("SuperNova", id 1) with two cohorts (2, 3). One Meta campaign
// runs two days against cohort 2: day one has a platform breakdown that splits
// 60/40 Facebook/Instagram, day two has none. A billboard lands on cohort 3.
const mediums: Medium[] = [
  { code: 'meta_facebook', label: 'Facebook (Meta)', kind: 'paid_social', sort: 10, manualEntry: false, metaPlatform: 'facebook', isEnabled: true },
  { code: 'meta_instagram', label: 'Instagram (Meta)', kind: 'paid_social', sort: 20, manualEntry: false, metaPlatform: 'instagram', isEnabled: true },
  { code: MEDIUM_UNSPLIT, label: 'Meta (not split by platform)', kind: 'paid_social', sort: 70, manualEntry: false, metaPlatform: null, isEnabled: true },
  { code: 'ooh', label: 'Billboard / OOH', kind: 'ooh', sort: 200, manualEntry: true, metaPlatform: null, isEnabled: true }
];

const metaDay = (date: string, amount: number, extra: Partial<MetaDayRow> = {}): MetaDayRow => ({
  date,
  refId: '120001',
  label: 'Event: Demo day',
  campaignId: 9,
  projectId: 2,
  amount,
  currency: 'ISK',
  impressions: 1000,
  clicks: 50,
  results: 5,
  ...extra
});

const platformRow = (date: string, medium: string, spend: number, extra: Partial<BreakdownRow> = {}): BreakdownRow => ({
  date,
  refId: '120001',
  label: 'Event: Demo day',
  campaignId: 9,
  projectId: 2,
  dimension: 'platform',
  key: medium === 'meta_facebook' ? 'facebook' : 'instagram',
  medium,
  spend,
  impressions: 500,
  clicks: 25,
  results: 2,
  ...extra
});

const ageRow = (date: string, key: string, spend: number): BreakdownRow => ({
  date,
  refId: '120001',
  label: 'Event: Demo day',
  campaignId: 9,
  projectId: 2,
  dimension: 'age_gender',
  key,
  medium: null,
  spend,
  impressions: 400,
  clicks: 20,
  results: 1
});

const billboard: ManualRow = {
  id: 1,
  date: '2026-08-15',
  medium: 'ooh',
  label: 'Lækjartorg billboard',
  projectId: 3,
  eventId: null,
  amount: 50_000,
  currency: 'ISK',
  endDate: null,
  notes: null
};

function bundle(over: Partial<MarketingBundle> = {}): MarketingBundle {
  return {
    meta: [metaDay('2026-08-14', 10_000), metaDay('2026-08-15', 6_000)],
    manual: [billboard],
    breakdowns: [
      platformRow('2026-08-14', 'meta_facebook', 600),
      platformRow('2026-08-14', 'meta_instagram', 400),
      ageRow('2026-08-14', '25-34 · female', 700),
      ageRow('2026-08-14', '35-44 · male', 300)
    ],
    budgets: [],
    projects: [
      { id: 1, name: 'SuperNova', parentId: null },
      { id: 2, name: 'SuperNova 2026', parentId: 1 },
      { id: 3, name: 'SuperNova 2025', parentId: 1 },
      { id: 4, name: 'Unrelated', parentId: null }
    ],
    mediums,
    window: { since: '2026-08-01', until: '2026-08-31' },
    ...over
  };
}

const f = () => emptyMarketingFilters();
const round = (n: number) => Math.round(n * 100) / 100;

// ── Allocation ───────────────────────────────────────────────────────────

test('a campaign-day with a breakdown is split, not counted twice', () => {
  const rows = explodeSpend(bundle()).filter((r) => r.source === 'meta');
  // Day one becomes two platform rows; day two stays one unsplit row.
  assert.equal(rows.length, 3);
  assert.equal(round(rows.reduce((s, r) => s + r.amount, 0)), 16_000);
});

test('breakdown ratios allocate, breakdown totals do not overrule mk_metric', () => {
  // The breakdown says 600 + 400 = 1,000; the campaign row says 10,000. The
  // split must be 60/40 OF 10,000 — not 1,000, and not 11,000.
  const rows = explodeSpend(bundle()).filter((r) => r.date === '2026-08-14');
  const fb = rows.find((r) => r.medium === 'meta_facebook')!;
  const ig = rows.find((r) => r.medium === 'meta_instagram')!;
  assert.equal(round(fb.amount), 6_000);
  assert.equal(round(ig.amount), 4_000);
  assert.equal(round(fb.amount + ig.amount), 10_000);
});

test('a day with no breakdown reports as unsplit rather than a guessed platform', () => {
  const rows = explodeSpend(bundle());
  const day2 = rows.filter((r) => r.date === '2026-08-15' && r.source === 'meta');
  assert.equal(day2.length, 1);
  assert.equal(day2[0].medium, MEDIUM_UNSPLIT);
  assert.equal(day2[0].amount, 6_000);
});

test('a breakdown whose spend is all zero does not erase the day', () => {
  const b = bundle({
    breakdowns: [platformRow('2026-08-14', 'meta_facebook', 0), platformRow('2026-08-14', 'meta_instagram', 0)]
  });
  const rows = explodeSpend(b).filter((r) => r.source === 'meta');
  assert.equal(round(rows.reduce((s, r) => s + r.amount, 0)), 16_000);
  assert.ok(rows.every((r) => r.medium === MEDIUM_UNSPLIT));
});

test('a metric with no breakdown values of its own falls back to the spend ratio', () => {
  // Meta returned spend per platform but zero impressions on both.
  const b = bundle({
    breakdowns: [
      platformRow('2026-08-14', 'meta_facebook', 600, { impressions: 0 }),
      platformRow('2026-08-14', 'meta_instagram', 400, { impressions: 0 })
    ]
  });
  const rows = explodeSpend(b).filter((r) => r.date === '2026-08-14');
  assert.equal(round(rows.find((r) => r.medium === 'meta_facebook')!.impressions), 600);
  assert.equal(round(rows.reduce((s, r) => s + r.impressions, 0)), 1000);
});

test('manual spend keeps its own medium and never claims Meta metrics', () => {
  const row = explodeSpend(bundle()).find((r) => r.source === 'manual')!;
  assert.equal(row.medium, 'ooh');
  assert.equal(row.amount, 50_000);
  assert.equal(row.impressions, 0);
  assert.equal(row.clicks, 0);
});

test('manual spend with no medium lands in other, not in a guess', () => {
  const b = bundle({ manual: [{ ...billboard, medium: null }] });
  assert.equal(explodeSpend(b).find((r) => r.source === 'manual')!.medium, 'other');
});

// ── KPIs ─────────────────────────────────────────────────────────────────

test('the headline total is Meta plus manual, once each', () => {
  const m = computeMarketing(bundle(), f());
  assert.equal(round(m.kpi.spend), 66_000);
  assert.equal(m.kpi.days, 2);
});

test('per-unit costs are null, not zero, when the denominator is zero', () => {
  const m = computeMarketing(bundle({ meta: [], breakdowns: [] }), f());
  assert.equal(m.kpi.spend, 50_000);
  assert.equal(m.kpi.cpc, null);
  assert.equal(m.kpi.cpm, null);
  assert.equal(m.kpi.ctr, null);
});

test('mixed currencies are flagged rather than quietly summed', () => {
  const b = bundle({ manual: [{ ...billboard, currency: 'EUR' }] });
  assert.equal(computeMarketing(b, f()).kpi.mixedCurrency, true);
  assert.equal(computeMarketing(bundle(), f()).kpi.mixedCurrency, false);
});

// ── Filters ──────────────────────────────────────────────────────────────

test('a project filter includes cohorts, and excludes them when told to', () => {
  const withCohorts = computeMarketing(bundle(), { ...f(), projectId: 1, includeDescendants: true });
  assert.equal(round(withCohorts.kpi.spend), 66_000);

  const parentOnly = computeMarketing(bundle(), { ...f(), projectId: 1, includeDescendants: false });
  // Nothing is attributed to the parent row itself.
  assert.equal(parentOnly.kpi.spend, 0);

  const oneCohort = computeMarketing(bundle(), { ...f(), projectId: 3, includeDescendants: true });
  assert.equal(oneCohort.kpi.spend, 50_000);
});

test('a medium filter narrows the total to the allocated share', () => {
  const m = computeMarketing(bundle(), { ...f(), mediums: new Set(['meta_instagram']) });
  assert.equal(round(m.kpi.spend), 4_000);
});

test('a date filter clips both Meta and manual rows', () => {
  const m = computeMarketing(bundle(), { ...f(), since: '2026-08-15', until: '2026-08-15' });
  assert.equal(round(m.kpi.spend), 56_000);
});

test('a source filter separates Meta from the offline channels', () => {
  const m = computeMarketing(bundle(), { ...f(), sources: new Set(['manual' as const]) });
  assert.equal(m.kpi.spend, 50_000);
  assert.equal(m.bySource.length, 1);
});

// ── Splits and drills ────────────────────────────────────────────────────

test('the medium split adds up to the headline total', () => {
  const m = computeMarketing(bundle(), f());
  assert.equal(round(m.byMedium.reduce((s, r) => s + r.spend, 0)), round(m.kpi.spend));
  assert.equal(round(m.byMedium.reduce((s, r) => s + r.share, 0)), 1);
});

test('spend with no project reads as Unassigned instead of vanishing', () => {
  const b = bundle({ meta: [metaDay('2026-08-14', 10_000, { projectId: null })], breakdowns: [] });
  const m = computeMarketing(b, f());
  const row = m.byProject.find((r) => r.key === 'none')!;
  assert.equal(row.label, 'Unassigned');
  assert.equal(row.spend, 10_000);
  assert.equal(round(m.unattributed.share), round(10_000 / 60_000));
});

test('a drill states the share of spend it explains', () => {
  const m = computeMarketing(bundle(), f());
  const age = m.drills.find((d) => d.dimension === 'age_gender')!;
  // Age rows cover day one only: 1,000 of 16,000 Meta spend.
  assert.equal(round(age.coverage), round(1_000 / 16_000));
  assert.equal(age.rows.length, 2);
  // Shares are of the covered spend, so the bars still read as a whole.
  assert.equal(round(age.rows.reduce((s, r) => s + r.share, 0)), 1);
});

test('a dimension with no medium of its own says it ignored the medium filter', () => {
  const m = computeMarketing(bundle(), { ...f(), mediums: new Set(['meta_facebook']) });
  assert.equal(m.drills.find((d) => d.dimension === 'age_gender')!.mediumFilterIgnored, true);
  assert.equal(m.drills.find((d) => d.dimension === 'platform')!.mediumFilterIgnored, false);
});

test('medium coverage reports the share of Meta spend with a real platform', () => {
  const m = computeMarketing(bundle(), f());
  // Day one (10,000) is split; day two (6,000) is not.
  assert.equal(round(m.mediumCoverage), round(10_000 / 16_000));
});

// ── Budgets, through computeMarketing ────────────────────────────────────

const envelope = (over: Partial<Budget> = {}): Budget => ({
  id: 1,
  label: 'SuperNova 2026',
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

test('a programme envelope claims the cohorts spend', () => {
  const m = computeMarketing(bundle({ budgets: [envelope()] }), f());
  const status = m.budgets[0];
  assert.equal(round(status.spent), 66_000);
  assert.equal(round(status.remaining), 34_000);
  assert.equal(m.unbudgeted.spend, 0);
});

test('spend outside every envelope is reported, not absorbed', () => {
  const m = computeMarketing(bundle({ budgets: [envelope({ projectId: 3, includeDescendants: false })] }), f());
  assert.equal(m.budgets[0].spent, 50_000);
  assert.equal(round(m.unbudgeted.spend), 16_000);
});

// ── Tree ─────────────────────────────────────────────────────────────────

test('the descendant walk terminates on a cycle', () => {
  const projects = [
    { id: 1, name: 'A', parentId: 2 },
    { id: 2, name: 'B', parentId: 1 }
  ];
  assert.deepEqual([...descendantIds(projects, 1)].sort(), [1, 2]);
});

test('daysBefore counts inclusively', () => {
  assert.equal(daysBefore('2026-08-18', 7), '2026-08-12');
  assert.equal(daysBefore('2026-03-01', 1), '2026-03-01');
});

// ── The /insights bridge ─────────────────────────────────────────────────

test('no year chips means the whole window the bundle holds', () => {
  const fallback = { since: '2025-01-01', until: '2026-08-18' };
  assert.deepEqual(windowForYears(new Set(), fallback), fallback);
});

test('year chips map to whole calendar years, not to the data we happen to have', () => {
  const fallback = { since: '2025-08-18', until: '2026-08-18' };
  assert.deepEqual(windowForYears(new Set([2026]), fallback), {
    since: '2026-01-01',
    until: '2026-12-31'
  });
  // Two chips span both ends, gaps included — the same slice the cohort
  // figures use.
  assert.deepEqual(windowForYears(new Set([2024, 2026]), fallback), {
    since: '2024-01-01',
    until: '2026-12-31'
  });
});

test('a year with no spend gives an empty slice rather than the nearest data', () => {
  const w = windowForYears(new Set([2021]), { since: '2025-08-18', until: '2026-08-18' });
  const m = computeMarketing(bundle(), { ...f(), since: w.since, until: w.until });
  assert.equal(m.kpi.spend, 0);
  assert.equal(m.rows.length, 0);
});

test('monthly buckets are ordered and sum to the total', () => {
  const m = computeMarketing(bundle(), f());
  const months = spendByMonth(m.rows);
  assert.deepEqual(months.map((x) => x.month), ['2026-08']);
  assert.equal(round(months.reduce((s, x) => s + x.spend, 0)), round(m.kpi.spend));
});

test('monthly buckets keep months apart', () => {
  const b = bundle({ meta: [metaDay('2026-07-31', 1_000), metaDay('2026-08-01', 2_000)], breakdowns: [] });
  const m = computeMarketing(b, f());
  const months = spendByMonth(m.rows);
  assert.deepEqual(months.map((x) => `${x.month}:${x.spend}`), ['2026-07:1000', '2026-08:52000']);
});
