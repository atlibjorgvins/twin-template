// Types + pure aggregation for every marketing surface: the /marketing
// workspace, the Marketing block on /insights, the budget card on a project.
//
// NO $lib imports, deliberately — same constraint as insights/metrics.ts, so
// bare `node --test` runs the tests. data.ts is the only side that talks to
// Directus; it maps rows into these shapes and nothing else.
//
// Three rules this file exists to enforce:
//
//  1. **mk_metric is the authority on totals.** Meta's breakdown numbers do
//     not always add up to its campaign numbers. So a breakdown is used for
//     PROPORTIONS only: campaign-day spend is allocated across the platforms
//     in the ratio the breakdown reports. The KPI total therefore always
//     equals the campaign rows, whatever the splits say.
//
//  2. **Never invent a category.** Meta spend on a day no platform breakdown
//     covers reports as `meta_unsplit`, not as the platform that happens to
//     be most common. Spend with no project reports as Unassigned. Both are
//     visible gaps rather than quiet guesses.
//
//  3. **Every drill states its coverage.** A split over 60% of the spend and
//     a split over 100% look identical on a bar chart, so each carries the
//     share of filtered spend it actually explains.
import { formatCompactMoney, formatMoney, formatPercent } from '../insights/metrics.ts';
import { MEDIUM_UNSPLIT, type Medium } from './media.ts';
import { budgetStatuses, unbudgetedSpend, type Budget, type BudgetStatus } from './budget.ts';

export { formatCompactMoney, formatMoney, formatPercent };

// ── Input shapes (produced by data.ts) ───────────────────────────────────

/** One Meta campaign on one day, straight off mk_metric at level =
 *  meta_campaign. The authority on what was spent. */
export type MetaDayRow = {
  date: string;
  /** Meta campaign id — the key breakdowns join on. */
  refId: string | null;
  label: string | null;
  /** Umbrella mk_campaign. */
  campaignId: number | null;
  projectId: number | null;
  amount: number;
  currency: string;
  impressions: number;
  clicks: number;
  results: number;
};

/** One hand-entered spend, off mk_manual_spend. Already carries a real
 *  medium, so it needs no allocation. */
export type ManualRow = {
  id: number;
  date: string;
  medium: string | null;
  label: string | null;
  projectId: number | null;
  eventId: number | null;
  amount: number;
  currency: string;
  /** Carried for the Spend editor, not used by any arithmetic here. */
  endDate: string | null;
  notes: string | null;
};

export type BreakdownDimension = 'age_gender' | 'platform' | 'placement' | 'region' | 'device';

/** One day × one dimension × one value, off mk_metric_breakdown. */
export type BreakdownRow = {
  date: string;
  refId: string | null;
  label: string | null;
  campaignId: number | null;
  projectId: number | null;
  dimension: BreakdownDimension | string;
  key: string;
  /** Set on platform/placement rows only — the dimension that implies one. */
  medium: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
};

export type MarketingProject = { id: number; name: string; parentId: number | null };

export type MarketingBundle = {
  meta: MetaDayRow[];
  manual: ManualRow[];
  breakdowns: BreakdownRow[];
  budgets: Budget[];
  projects: MarketingProject[];
  mediums: Medium[];
  /** The window data.ts actually fetched, so a page can say what it read
   *  rather than implying it read everything. */
  window: { since: string; until: string };
};

// ── Filters ─────────────────────────────────────────────────────────────

export type SpendSource = 'meta' | 'manual';

export type MarketingFilters = {
  /** Inclusive, YYYY-MM-DD. Null = whatever the bundle holds. */
  since: string | null;
  until: string | null;
  projectId: number | null;
  /** Count the project's sub-projects too — a programme over its cohorts. */
  includeDescendants: boolean;
  campaignId: number | null;
  /** Empty = every medium. */
  mediums: Set<string>;
  /** Empty = both. */
  sources: Set<SpendSource>;
};

export function emptyMarketingFilters(): MarketingFilters {
  return {
    since: null,
    until: null,
    projectId: null,
    includeDescendants: true,
    campaignId: null,
    mediums: new Set(),
    sources: new Set()
  };
}

// ── Project tree ────────────────────────────────────────────────────────

/** A project and everything under it. Cycles in parent_id (which a hand-edited
 *  tree can absolutely contain) terminate instead of hanging. */
export function descendantIds(projects: MarketingProject[], rootId: number): Set<number> {
  const children = new Map<number, number[]>();
  for (const p of projects) {
    if (p.parentId == null) continue;
    if (!children.has(p.parentId)) children.set(p.parentId, []);
    children.get(p.parentId)!.push(p.id);
  }
  const out = new Set<number>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      queue.push(child);
    }
  }
  return out;
}

// ── The unified spend fact ──────────────────────────────────────────────

/** One row of money, with a real medium on it. Meta campaign-days are
 *  exploded per platform (see rule 1); manual rows pass through. */
export type SpendRow = {
  date: string;
  medium: string;
  projectId: number | null;
  campaignId: number | null;
  refId: string | null;
  label: string | null;
  amount: number;
  currency: string;
  impressions: number;
  clicks: number;
  results: number;
  source: SpendSource;
};

const dayKey = (refId: string | null, date: string) => `${refId ?? '—'}|${date}`;

/** Allocate a campaign-day across the platforms its breakdown reports.
 *
 *  Spend is split in the ratio of breakdown spend; each other metric is split
 *  in the ratio of ITS own breakdown values, falling back to the spend ratio
 *  when Meta returned nothing for it. The parts always sum to the campaign
 *  row — which is the invariant that lets a medium split and a KPI tile sit
 *  on the same page without contradicting each other. */
function allocate(row: MetaDayRow, platformRows: BreakdownRow[]): SpendRow[] {
  const sum = (pick: (b: BreakdownRow) => number) => platformRows.reduce((s, b) => s + pick(b), 0);
  const totals = {
    spend: sum((b) => b.spend),
    impressions: sum((b) => b.impressions),
    clicks: sum((b) => b.clicks),
    results: sum((b) => b.results)
  };
  if (totals.spend <= 0) return [unsplit(row)];

  return platformRows.map((b) => {
    const spendShare = b.spend / totals.spend;
    const share = (value: number, total: number) => (total > 0 ? value / total : spendShare);
    return {
      date: row.date,
      medium: b.medium ?? MEDIUM_UNSPLIT,
      projectId: row.projectId,
      campaignId: row.campaignId,
      refId: row.refId,
      label: row.label,
      amount: row.amount * spendShare,
      currency: row.currency,
      impressions: row.impressions * share(b.impressions, totals.impressions),
      clicks: row.clicks * share(b.clicks, totals.clicks),
      results: row.results * share(b.results, totals.results),
      source: 'meta' as const
    };
  });
}

function unsplit(row: MetaDayRow): SpendRow {
  return {
    date: row.date,
    medium: MEDIUM_UNSPLIT,
    projectId: row.projectId,
    campaignId: row.campaignId,
    refId: row.refId,
    label: row.label,
    amount: row.amount,
    currency: row.currency,
    impressions: row.impressions,
    clicks: row.clicks,
    results: row.results,
    source: 'meta'
  };
}

/** Every row of money in one shape. Pure; the same input always gives the
 *  same output, which is what makes the whole read model testable. */
export function explodeSpend(bundle: MarketingBundle): SpendRow[] {
  const platforms = new Map<string, BreakdownRow[]>();
  for (const b of bundle.breakdowns) {
    if (b.dimension !== 'platform') continue;
    const k = dayKey(b.refId, b.date);
    if (!platforms.has(k)) platforms.set(k, []);
    platforms.get(k)!.push(b);
  }

  const out: SpendRow[] = [];
  for (const row of bundle.meta) {
    const hit = platforms.get(dayKey(row.refId, row.date));
    if (hit && hit.length > 0) out.push(...allocate(row, hit));
    else out.push(unsplit(row));
  }
  for (const m of bundle.manual) {
    out.push({
      date: m.date,
      // A manual row with no medium is 'other', never guessed from its label.
      medium: m.medium ?? 'other',
      projectId: m.projectId,
      campaignId: null,
      refId: null,
      label: m.label,
      amount: m.amount,
      currency: m.currency,
      impressions: 0,
      clicks: 0,
      results: 0,
      source: 'manual'
    });
  }
  return out;
}

// ── Output shapes ───────────────────────────────────────────────────────

export type Slice = {
  key: string;
  label: string;
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
  /** Of the filtered spend. */
  share: number;
};

export type Drill = {
  dimension: BreakdownDimension | string;
  rows: Slice[];
  /** Share of filtered Meta spend these rows explain. Below 1 means the
   *  window includes days, or accounts, the sync has no breakdown for. */
  coverage: number;
  /** A medium filter is active but this dimension carries no medium, so it
   *  could not be narrowed — the rows shown are wider than the KPIs. */
  mediumFilterIgnored: boolean;
};

export type MarketingMetrics = {
  rows: SpendRow[];
  kpi: {
    spend: number;
    impressions: number;
    clicks: number;
    results: number;
    /** Null rather than 0 when the denominator is 0 — a CPC of "0 ISK"
     *  reads as free, which is the opposite of unknown. */
    cpc: number | null;
    cpm: number | null;
    cpr: number | null;
    ctr: number | null;
    days: number;
    campaigns: number;
    mediums: number;
    currency: string;
    /** More than one currency in the slice — the totals are then sums of
     *  unlike things and the UI should say so. */
    mixedCurrency: boolean;
  };
  trend: { labels: string[]; spend: number[]; results: number[] };
  byMedium: Slice[];
  byProject: Slice[];
  byCampaign: Slice[];
  bySource: Slice[];
  drills: Drill[];
  budgets: BudgetStatus[];
  unbudgeted: { spend: number; share: number };
  /** Spend with no project attribution — the number that decides whether a
   *  project dashboard can be trusted. */
  unattributed: { spend: number; share: number };
  /** Share of Meta spend that carries a real platform, i.e. is not
   *  meta_unsplit. */
  mediumCoverage: number;
};

const DRILL_ORDER: BreakdownDimension[] = ['age_gender', 'platform', 'placement', 'region', 'device'];

export const DIMENSION_LABELS: Record<string, string> = {
  age_gender: 'Age & gender',
  platform: 'Platform',
  placement: 'Placement',
  region: 'Region',
  device: 'Device'
};

/** Dimensions whose rows carry a medium, so a medium filter can narrow them. */
const MEDIUM_BEARING = new Set<string>(['platform', 'placement']);

function ratio(top: number, bottom: number): number | null {
  return bottom > 0 ? top / bottom : null;
}

function slices(
  rows: Array<{ key: string; label: string; spend: number; impressions: number; clicks: number; results: number }>,
  total: number
): Slice[] {
  const groups = new Map<string, Slice>();
  for (const r of rows) {
    let g = groups.get(r.key);
    if (!g) {
      g = { key: r.key, label: r.label, spend: 0, impressions: 0, clicks: 0, results: 0, share: 0 };
      groups.set(r.key, g);
    }
    g.spend += r.spend;
    g.impressions += r.impressions;
    g.clicks += r.clicks;
    g.results += r.results;
  }
  return [...groups.values()]
    .map((g) => ({ ...g, share: total > 0 ? g.spend / total : 0 }))
    .sort((a, b) => b.spend - a.spend || a.label.localeCompare(b.label, 'is'));
}

export function computeMarketing(bundle: MarketingBundle, f: MarketingFilters): MarketingMetrics {
  const projectScope =
    f.projectId == null
      ? null
      : f.includeDescendants
        ? descendantIds(bundle.projects, f.projectId)
        : new Set([f.projectId]);
  const projectName = new Map(bundle.projects.map((p) => [p.id, p.name]));
  const mediumLabels = new Map(bundle.mediums.map((m) => [m.code, m.label]));

  const inWindow = (date: string) => {
    if (f.since && date < f.since) return false;
    if (f.until && date > f.until) return false;
    return true;
  };
  const inProject = (projectId: number | null) => !projectScope || (projectId != null && projectScope.has(projectId));

  const rows = explodeSpend(bundle).filter(
    (r) =>
      inWindow(r.date) &&
      inProject(r.projectId) &&
      (f.campaignId == null || r.campaignId === f.campaignId) &&
      (f.mediums.size === 0 || f.mediums.has(r.medium)) &&
      (f.sources.size === 0 || f.sources.has(r.source))
  );

  const spend = rows.reduce((s, r) => s + r.amount, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const results = rows.reduce((s, r) => s + r.results, 0);
  const currencies = new Set(rows.map((r) => r.currency).filter(Boolean));

  // ── Trend: one point per day that has spend, ascending.
  const byDate = new Map<string, { spend: number; results: number }>();
  for (const r of rows) {
    const cur = byDate.get(r.date) ?? { spend: 0, results: 0 };
    cur.spend += r.amount;
    cur.results += r.results;
    byDate.set(r.date, cur);
  }
  const labels = [...byDate.keys()].sort();

  // ── Drills, from the breakdown rows under the same filters. Project and
  // date filtering applies; medium filtering only where the rows carry one.
  const metaSpend = rows.filter((r) => r.source === 'meta').reduce((s, r) => s + r.amount, 0);
  const drills: Drill[] = [];
  for (const dimension of DRILL_ORDER) {
    const bearing = MEDIUM_BEARING.has(dimension);
    const mediumFilterIgnored = f.mediums.size > 0 && !bearing;
    const source = bundle.breakdowns.filter(
      (b) =>
        b.dimension === dimension &&
        inWindow(b.date) &&
        inProject(b.projectId) &&
        (f.campaignId == null || b.campaignId === f.campaignId) &&
        (!bearing || f.mediums.size === 0 || (b.medium != null && f.mediums.has(b.medium)))
    );
    if (source.length === 0) continue;
    const covered = source.reduce((s, b) => s + b.spend, 0);
    drills.push({
      dimension,
      rows: slices(
        source.map((b) => ({
          key: b.key,
          label: dimension === 'platform' ? (mediumLabels.get(b.medium ?? '') ?? b.key) : b.key,
          spend: b.spend,
          impressions: b.impressions,
          clicks: b.clicks,
          results: b.results
        })),
        covered
      ),
      // Against Meta spend only: manual spend has no Meta breakdown to miss.
      coverage: metaSpend > 0 ? Math.min(1, covered / metaSpend) : 0,
      mediumFilterIgnored
    });
  }

  const descendantsFor = (projectId: number) => descendantIds(bundle.projects, projectId);
  const unattributedSpend = rows.filter((r) => r.projectId == null).reduce((s, r) => s + r.amount, 0);
  const unsplitSpend = rows
    .filter((r) => r.source === 'meta' && r.medium === MEDIUM_UNSPLIT)
    .reduce((s, r) => s + r.amount, 0);

  return {
    rows,
    kpi: {
      spend,
      impressions,
      clicks,
      results,
      cpc: ratio(spend, clicks),
      cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
      cpr: ratio(spend, results),
      ctr: ratio(clicks, impressions),
      days: byDate.size,
      campaigns: new Set(rows.map((r) => r.refId ?? `c${r.campaignId}`).filter(Boolean)).size,
      mediums: new Set(rows.map((r) => r.medium)).size,
      currency: currencies.size === 1 ? [...currencies][0] : 'ISK',
      mixedCurrency: currencies.size > 1
    },
    trend: {
      labels,
      spend: labels.map((d) => byDate.get(d)!.spend),
      results: labels.map((d) => byDate.get(d)!.results)
    },
    byMedium: slices(
      rows.map((r) => ({
        key: r.medium,
        label: mediumLabels.get(r.medium) ?? r.medium,
        spend: r.amount,
        impressions: r.impressions,
        clicks: r.clicks,
        results: r.results
      })),
      spend
    ),
    byProject: slices(
      rows.map((r) => ({
        key: r.projectId == null ? 'none' : `p${r.projectId}`,
        label: r.projectId == null ? 'Unassigned' : (projectName.get(r.projectId) ?? `Project #${r.projectId}`),
        spend: r.amount,
        impressions: r.impressions,
        clicks: r.clicks,
        results: r.results
      })),
      spend
    ),
    byCampaign: slices(
      rows.map((r) => ({
        key: r.refId ?? (r.campaignId != null ? `c${r.campaignId}` : 'none'),
        label: r.label ?? 'Untitled',
        spend: r.amount,
        impressions: r.impressions,
        clicks: r.clicks,
        results: r.results
      })),
      spend
    ),
    bySource: slices(
      rows.map((r) => ({
        key: r.source,
        label: r.source === 'meta' ? 'Meta' : 'Manual (other channels)',
        spend: r.amount,
        impressions: r.impressions,
        clicks: r.clicks,
        results: r.results
      })),
      spend
    ),
    drills,
    budgets: budgetStatuses(bundle.budgets, rows, descendantsFor),
    unbudgeted: (({ spend: s, share }) => ({ spend: s, share }))(
      unbudgetedSpend(bundle.budgets, rows, descendantsFor)
    ),
    unattributed: { spend: unattributedSpend, share: spend > 0 ? unattributedSpend / spend : 0 },
    mediumCoverage: metaSpend > 0 ? 1 - unsplitSpend / metaSpend : 0
  };
}

// ── Small helpers the pages share ───────────────────────────────────────

/** Every medium present in the bundle, for a filter row — vocabulary order,
 *  and only the ones that actually occur, so the picker isn't 22 options
 *  long when two were used. */
export function availableMediums(bundle: MarketingBundle): Medium[] {
  const used = new Set(explodeSpend(bundle).map((r) => r.medium));
  return bundle.mediums.filter((m) => used.has(m.code)).sort((a, b) => a.sort - b.sort);
}

/** The date window a set of cohort years covers.
 *
 *  /insights filters by cohort YEAR; spend is filtered by DATE. This is the
 *  bridge, so the Marketing block reads the same slice as every other figure on
 *  that page instead of growing a second filter row. An empty set means "every
 *  year", which maps to the whole window the bundle holds.
 *
 *  Deliberately NOT clipped to the bundle: pick 2021 and you should see "no
 *  spend recorded", next to a line saying which dates we actually hold. A
 *  silently widened window would report 2026 money under a 2021 heading. */
export function windowForYears(
  years: Set<number>,
  fallback: { since: string; until: string }
): { since: string; until: string } {
  if (years.size === 0) return fallback;
  const sorted = [...years].sort((a, b) => a - b);
  return { since: `${sorted[0]}-01-01`, until: `${sorted[sorted.length - 1]}-12-31` };
}

/** Month buckets over the filtered rows — the shape a management overview
 *  reads, where a 365-point daily line is noise. */
export function spendByMonth(rows: SpendRow[]): Array<{ month: string; spend: number; results: number }> {
  const byMonth = new Map<string, { spend: number; results: number }>();
  for (const r of rows) {
    const key = r.date.slice(0, 7);
    const cur = byMonth.get(key) ?? { spend: 0, results: 0 };
    cur.spend += r.amount;
    cur.results += r.results;
    byMonth.set(key, cur);
  }
  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ month, ...v }));
}

/** ISO date N days back from `until`, for the period chips. */
export function daysBefore(until: string, days: number): string {
  const d = new Date(`${until}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}
