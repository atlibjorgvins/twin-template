// The workbook sheets. A spreadsheet is where these numbers go to be argued
// over in a board meeting, so the failure modes that matter are: a split whose
// coverage isn't stated, an empty budgets sheet that reads as "budget: nothing",
// and daily rows in whatever order the API happened to return them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketingSheets } from './export.ts';
import { computeMarketing, emptyMarketingFilters, type MarketingBundle } from './metrics.ts';
import { MEDIUM_UNSPLIT, type Medium } from './media.ts';
import type { Budget } from './budget.ts';

const mediums: Medium[] = [
  { code: 'meta_facebook', label: 'Facebook (Meta)', kind: 'paid_social', sort: 10, manualEntry: false, metaPlatform: 'facebook', isEnabled: true },
  { code: MEDIUM_UNSPLIT, label: 'Meta (not split by platform)', kind: 'paid_social', sort: 70, manualEntry: false, metaPlatform: null, isEnabled: true },
  { code: 'ooh', label: 'Billboard / OOH', kind: 'ooh', sort: 200, manualEntry: true, metaPlatform: null, isEnabled: true }
];

function bundle(over: Partial<MarketingBundle> = {}): MarketingBundle {
  return {
    meta: [
      { date: '2026-08-14', refId: '1', label: 'Demo day', campaignId: 9, projectId: 2, amount: 10_000, currency: 'ISK', impressions: 1000, clicks: 50, results: 5 },
      { date: '2026-08-12', refId: '1', label: 'Demo day', campaignId: 9, projectId: 2, amount: 6_000, currency: 'ISK', impressions: 600, clicks: 30, results: 3 }
    ],
    manual: [
      { id: 1, date: '2026-08-15', medium: 'ooh', label: 'Billboard', projectId: 3, eventId: null, amount: 50_000, currency: 'ISK', endDate: null, notes: null }
    ],
    breakdowns: [
      { date: '2026-08-14', refId: '1', label: 'Demo day', campaignId: 9, projectId: 2, dimension: 'platform', key: 'facebook', medium: 'meta_facebook', spend: 1000, impressions: 500, clicks: 25, results: 2 },
      { date: '2026-08-14', refId: '1', label: 'Demo day', campaignId: 9, projectId: 2, dimension: 'age_gender', key: '25-34 · female', medium: null, spend: 700, impressions: 400, clicks: 20, results: 1 }
    ],
    budgets: [],
    projects: [
      { id: 1, name: 'SuperNova', parentId: null },
      { id: 2, name: 'SuperNova 2026', parentId: 1 },
      { id: 3, name: 'SuperNova 2025', parentId: 1 }
    ],
    mediums,
    window: { since: '2026-01-01', until: '2026-12-31' },
    ...over
  };
}

const envelope: Budget = {
  id: 1, label: 'SuperNova 2026', scope: 'project', status: 'approved', projectId: 1,
  includeDescendants: true, campaignId: null, medium: null, period: 'total',
  periodStart: null, amount: 100_000, currency: 'ISK', committed: 0
};

const sheetsFor = (b: MarketingBundle) =>
  marketingSheets(computeMarketing(b, emptyMarketingFilters()), b);

test('an empty slice produces no sheets at all', () => {
  assert.deepEqual(sheetsFor(bundle({ meta: [], manual: [], breakdowns: [] })), []);
});

test('the summary sheet states the window the data actually covers', () => {
  const summary = sheetsFor(bundle()).find((s) => s.name === 'Marketing')!;
  const row = summary.table.rows.find((r) => r[0] === 'Stored spend covers');
  assert.equal(row?.[1], '2026-01-01 → 2026-12-31');
  assert.equal(summary.table.rows.find((r) => r[0] === 'Spend')?.[1], 66_000);
});

test('a missing denominator is "n/a" in the sheet, never 0', () => {
  const summary = sheetsFor(bundle({ meta: [], breakdowns: [] })).find((s) => s.name === 'Marketing')!;
  // Manual spend only: no clicks, so cost-per-click has no answer.
  assert.equal(summary.table.rows.find((r) => r[0] === 'Cost per click')?.[1], 'n/a');
});

test('every split row carries the share of spend its split explains', () => {
  const splits = sheetsFor(bundle()).find((s) => s.name === 'Marketing splits')!;
  const idx = splits.table.columns.indexOf('Split covers (% of Meta spend)');
  assert.ok(idx > 0);
  // Medium/project/campaign explain the whole slice; the age split covers
  // 700 of 16,000 Meta spend.
  const age = splits.table.rows.find((r) => r[0] === 'Age & gender')!;
  assert.equal(age[idx], Math.round((700 / 16_000) * 1000) / 10);
  assert.equal(splits.table.rows.find((r) => r[0] === 'Medium')![idx], 100);
});

test('the splits sheet includes every stored breakdown, not just the medium cut', () => {
  const splits = sheetsFor(bundle()).find((s) => s.name === 'Marketing splits')!;
  const kinds = new Set(splits.table.rows.map((r) => String(r[0])));
  assert.deepEqual([...kinds].sort(), ['Age & gender', 'Campaign', 'Medium', 'Platform', 'Project', 'Source']);
});

test('no budgets means no budgets sheet — an empty one reads as "budget: nothing"', () => {
  const names = sheetsFor(bundle()).map((s) => s.name);
  assert.equal(names.includes('Marketing budgets'), false);
  const withBudget = sheetsFor(bundle({ budgets: [envelope] })).map((s) => s.name);
  assert.deepEqual(withBudget, ['Marketing', 'Marketing splits', 'Marketing budgets', 'Marketing daily']);
});

test('the budgets sheet reports over-spend as a negative remaining', () => {
  const sheets = sheetsFor(bundle({ budgets: [{ ...envelope, amount: 5_000 }] }));
  const row = sheets.find((s) => s.name === 'Marketing budgets')!.table.rows[0];
  const cols = sheets.find((s) => s.name === 'Marketing budgets')!.table.columns;
  assert.equal(row[cols.indexOf('Remaining')], 5_000 - 66_000);
});

test('daily rows are ordered by date and name the project rather than its id', () => {
  const daily = sheetsFor(bundle()).find((s) => s.name === 'Marketing daily')!;
  const dates = daily.table.rows.map((r) => String(r[0]));
  assert.deepEqual(dates, [...dates].sort());
  const projects = new Set(daily.table.rows.map((r) => String(r[2])));
  assert.ok(projects.has('SuperNova 2026'));
  assert.ok(projects.has('SuperNova 2025'));
});

test('unattributed spend is named, not left blank', () => {
  const b = bundle({ manual: [{ id: 2, date: '2026-08-15', medium: 'ooh', label: 'Loose', projectId: null, eventId: null, amount: 1_000, currency: 'ISK', endDate: null, notes: null }] });
  const daily = sheetsFor(b).find((s) => s.name === 'Marketing daily')!;
  assert.ok(daily.table.rows.some((r) => r[2] === 'Unassigned'));
});
