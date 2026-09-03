// Marketing sheets for the /insights workbook.
//
// Kept out of insights/export.ts so that file stays about the programme's people
// and money-in; this one is money-out. Both end up in one .xlsx, because a
// programme report that needs two exports stapled together is two reports.
//
// Pure: takes the computed metrics and the bundle, returns tables. No $lib
// imports and no Directus, so it is as testable as the arithmetic it formats.
import type { CsvTable } from '../insights/export.ts';
import { mediumLabel } from './media.ts';
import { DIMENSION_LABELS, type MarketingBundle, type MarketingMetrics } from './metrics.ts';

export type SheetSpec = { name: string; table: CsvTable };

const round = (n: number) => Math.round(n);
const pct = (share: number) => Math.round(share * 1000) / 10;

/** One row per (dimension, value) across every split the slice supports, so a
 *  reader can pivot on it without us guessing which cut they wanted. */
export function marketingSheets(m: MarketingMetrics, bundle: MarketingBundle): SheetSpec[] {
  if (m.rows.length === 0) return [];

  const summary: CsvTable = {
    columns: ['Metric', 'Value'],
    rows: [
      ['Spend', round(m.kpi.spend)],
      ['Currency', m.kpi.currency + (m.kpi.mixedCurrency ? ' (mixed — raw amounts, no conversion)' : '')],
      ['Days with spend', m.kpi.days],
      ['Campaigns', m.kpi.campaigns],
      ['Mediums', m.kpi.mediums],
      ['Impressions', round(m.kpi.impressions)],
      ['Clicks', round(m.kpi.clicks)],
      ['Results', round(m.kpi.results)],
      ['Cost per click', m.kpi.cpc == null ? 'n/a' : round(m.kpi.cpc)],
      ['Cost per result', m.kpi.cpr == null ? 'n/a' : round(m.kpi.cpr)],
      ['Cost per 1,000 impressions', m.kpi.cpm == null ? 'n/a' : round(m.kpi.cpm)],
      ['Click-through rate (%)', m.kpi.ctr == null ? 'n/a' : pct(m.kpi.ctr)],
      ['Spend with no project (%)', pct(m.unattributed.share)],
      ['Spend outside every budget', round(m.unbudgeted.spend)],
      ['Meta spend split by platform (%)', pct(m.mediumCoverage)],
      ['Stored spend covers', `${bundle.window.since} → ${bundle.window.until}`]
    ]
  };

  const splitRows = (label: string, rows: MarketingMetrics['byMedium'], coverage: number) =>
    rows.map((r) => [
      label,
      r.label,
      round(r.spend),
      pct(r.share),
      round(r.impressions),
      round(r.clicks),
      round(r.results),
      pct(coverage)
    ]);

  const splits: CsvTable = {
    columns: [
      'Split', 'Value', 'Spend', 'Share (%)', 'Impressions', 'Clicks', 'Results',
      'Split covers (% of Meta spend)'
    ],
    rows: [
      ...splitRows('Medium', m.byMedium, 1),
      ...splitRows('Project', m.byProject, 1),
      ...splitRows('Campaign', m.byCampaign, 1),
      ...splitRows('Source', m.bySource, 1),
      // The stored Meta breakdowns — age+gender, platform, placement, region.
      // Each carries its own coverage, because none of them is guaranteed to
      // explain the whole slice.
      ...m.drills.flatMap((d) =>
        splitRows(DIMENSION_LABELS[d.dimension] ?? d.dimension, d.rows, d.coverage)
      )
    ]
  };

  const budgets: CsvTable = {
    columns: [
      'Envelope', 'Scope', 'Status', 'Medium', 'Period', 'Period start',
      'Budget', 'Spent', 'Committed', 'Remaining', 'Used (%)', 'Currency'
    ],
    rows: m.budgets.map((s) => [
      s.budget.label ?? `#${s.budget.id}`,
      String(s.budget.scope),
      String(s.budget.status),
      s.budget.medium ? mediumLabel(bundle.mediums, s.budget.medium) : '—',
      String(s.budget.period),
      s.budget.periodStart ?? '',
      round(s.budget.amount),
      round(s.spent),
      round(s.committed),
      round(s.remaining),
      pct(s.usedShare),
      s.budget.currency
    ])
  };

  const daily: CsvTable = {
    columns: ['Date', 'Medium', 'Project', 'Campaign', 'Source', 'Spend', 'Impressions', 'Clicks', 'Results'],
    rows: m.rows
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => [
        r.date,
        mediumLabel(bundle.mediums, r.medium),
        r.projectId == null
          ? 'Unassigned'
          : (bundle.projects.find((p) => p.id === r.projectId)?.name ?? `#${r.projectId}`),
        r.label ?? '',
        r.source,
        round(r.amount),
        round(r.impressions),
        round(r.clicks),
        round(r.results)
      ])
  };

  const sheets: SheetSpec[] = [
    { name: 'Marketing', table: summary },
    { name: 'Marketing splits', table: splits },
    { name: 'Marketing daily', table: daily }
  ];
  // An empty budgets sheet is worse than none — it reads as "budget: nothing".
  if (m.budgets.length > 0) sheets.splice(2, 0, { name: 'Marketing budgets', table: budgets });
  return sheets;
}
