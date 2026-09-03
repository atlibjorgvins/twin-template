// Marketing data layer — the only part of the feature that talks to Directus.
// Kept out of directus.ts on purpose: that file is 10k lines and adding a
// tenth reporting helper to it is how it got there.
//
// Loads one bundle for a window and hands it to metrics.ts, which does all the
// arithmetic. Every secondary query degrades to an empty list rather than
// throwing: a missing mk_budget permission must cost you the budget cards, not
// the whole dashboard.
//
// Money comes from stored daily rows only — mk_metric for Meta,
// mk_manual_spend for everything else. The campaign builder authors intent and
// never reports; that separation is the point of the redesign.
import { listProjectsForTree } from '$lib/directus';
import { repo } from '$lib/data/repo';
import type { Filter } from '$lib/data/repo';
import type { Medium } from './media.ts';
import type {
  BreakdownRow,
  ManualRow,
  MarketingBundle,
  MarketingProject,
  MetaDayRow
} from './metrics.ts';
import type { Budget } from './budget.ts';

/** Directus returns numerics as strings often enough that every read goes
 *  through this rather than trusting the shape. */
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const idOf = (v: unknown): number | null => {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'id' in v) {
    const id = (v as { id?: unknown }).id;
    return typeof id === 'number' ? id : null;
  }
  return null;
};
const day = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 10) : '');

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Default window: the trailing year. Long enough for a yearly budget to
 *  mean something, short enough that the breakdown table stays small. */
export function defaultWindow(): { since: string; until: string } {
  const until = today();
  const d = new Date(`${until}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return { since: d.toISOString().slice(0, 10), until };
}

// ── mk_medium ───────────────────────────────────────────────────────────

export async function listMediums(): Promise<Medium[]> {
  const rows = await repo.list<Record<string, unknown>>('mk_medium', {
    fields: ['code', 'label', 'kind', 'sort', 'manual_entry', 'meta_platform', 'is_enabled'],
    sort: ['sort']
  });
  return rows.map((r) => ({
    code: String(r.code),
    label: typeof r.label === 'string' && r.label ? r.label : String(r.code),
    kind: typeof r.kind === 'string' ? r.kind : 'other',
    sort: num(r.sort),
    manualEntry: r.manual_entry !== false,
    metaPlatform: typeof r.meta_platform === 'string' && r.meta_platform ? r.meta_platform : null,
    isEnabled: r.is_enabled !== false
  }));
}

/** Retire a medium, or change whether hand-entered spend offers it. The
 *  vocabulary is data, so Setup edits it without a deploy. */
export async function updateMedium(code: string, patch: Partial<Medium>): Promise<void> {
  const out: Record<string, unknown> = {};
  if ('label' in patch) out.label = patch.label;
  if ('kind' in patch) out.kind = patch.kind;
  if ('sort' in patch) out.sort = patch.sort;
  if ('manualEntry' in patch) out.manual_entry = patch.manualEntry;
  if ('metaPlatform' in patch) out.meta_platform = patch.metaPlatform;
  if ('isEnabled' in patch) out.is_enabled = patch.isEnabled;
  await repo.update('mk_medium', code, out);
}

// ── mk_budget ───────────────────────────────────────────────────────────

function toBudget(r: Record<string, unknown>): Budget {
  return {
    id: num(r.id),
    label: typeof r.label === 'string' ? r.label : null,
    scope: typeof r.scope === 'string' ? r.scope : 'project',
    status: typeof r.status === 'string' ? r.status : 'approved',
    projectId: idOf(r.project_id),
    includeDescendants: r.include_descendants !== false,
    campaignId: idOf(r.campaign_id),
    medium: typeof r.medium === 'string' && r.medium ? r.medium : null,
    period: typeof r.period === 'string' ? r.period : 'total',
    periodStart: r.period_start ? day(r.period_start) : null,
    amount: num(r.amount),
    currency: typeof r.currency === 'string' && r.currency ? r.currency : 'ISK',
    committed: num(r.committed)
  };
}

export async function listBudgets(): Promise<Budget[]> {
  const rows = await repo.list<Record<string, unknown>>('mk_budget', {
    fields: ['*', { project_id: ['id', 'name'] }, { campaign_id: ['id', 'name'] }],
    sort: ['-period_start', 'label']
  });
  return rows.map(toBudget);
}

/** The Directus row shape, for writes. Kept separate from Budget so the UI
 *  can send a partial without knowing the column names. */
function budgetPatch(patch: Partial<Budget>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ('label' in patch) out.label = patch.label;
  if ('scope' in patch) out.scope = patch.scope;
  if ('status' in patch) out.status = patch.status;
  if ('projectId' in patch) out.project_id = patch.projectId;
  if ('includeDescendants' in patch) out.include_descendants = patch.includeDescendants;
  if ('campaignId' in patch) out.campaign_id = patch.campaignId;
  if ('medium' in patch) out.medium = patch.medium;
  if ('period' in patch) out.period = patch.period;
  if ('periodStart' in patch) out.period_start = patch.periodStart;
  if ('amount' in patch) out.amount = patch.amount;
  if ('currency' in patch) out.currency = patch.currency;
  if ('committed' in patch) out.committed = patch.committed;
  return out;
}

export async function createBudget(patch: Partial<Budget>): Promise<Budget> {
  const row = await repo.create<Record<string, unknown>>('mk_budget', budgetPatch(patch));
  return toBudget(row);
}

export async function updateBudget(id: number, patch: Partial<Budget>): Promise<Budget> {
  const row = await repo.update<Record<string, unknown>>('mk_budget', id, budgetPatch(patch));
  return toBudget(row);
}

export async function deleteBudget(id: number): Promise<void> {
  await repo.remove('mk_budget', id);
}

// ── The bundle ──────────────────────────────────────────────────────────

async function loadMetaDays(since: string, until: string): Promise<MetaDayRow[]> {
  // Three reads rather than one expanded one: mk_metric joins to a Meta
  // campaign by the STRING ref_id, which Directus can't expand, so the
  // attribution has to be stitched here.
  const [metrics, metaCampaigns, umbrellas] = await Promise.all([
    // level = meta_campaign only. Ad-set and ad rows share their
    // campaign's spend, so mixing levels double-counts every krona.
    repo.list<Record<string, unknown>>('mk_metric', {
      where: {
        and: [
          { field: 'level', op: 'eq', value: 'meta_campaign' },
          { field: 'date', op: 'gte', value: since },
          { field: 'date', op: 'lte', value: until }
        ]
      },
      fields: ['mk_campaign_id', 'ref_id', 'ref_name', 'date', 'spend', 'impressions', 'clicks', 'results']
    }),
    repo.list<Record<string, unknown>>('mk_meta_campaign', {
      fields: ['id', 'name', 'meta_id', 'project_id', 'mk_campaign_id']
    }),
    repo.list<Record<string, unknown>>('mk_campaign', {
      fields: ['id', 'name', 'project_id', 'currency']
    })
  ]);

  const umbrellaById = new Map(umbrellas.map((u) => [num(u.id), u]));
  const byMetaId = new Map(
    metaCampaigns.filter((m) => m.meta_id).map((m) => [String(m.meta_id), m])
  );

  const meta: MetaDayRow[] = metrics.map((r) => {
    const mc = r.ref_id ? byMetaId.get(String(r.ref_id)) : undefined;
    const campaignId = idOf(r.mk_campaign_id) ?? (mc ? idOf(mc.mk_campaign_id) : null);
    const umbrella = campaignId != null ? umbrellaById.get(campaignId) : undefined;
    return {
      date: day(r.date),
      refId: r.ref_id ? String(r.ref_id) : null,
      label: (typeof mc?.name === 'string' && mc.name) || (typeof r.ref_name === 'string' ? r.ref_name : null),
      campaignId,
      // Attribution set on the Meta campaign wins; the umbrella's project is
      // the fallback the sync itself defaults to.
      projectId: (mc ? idOf(mc.project_id) : null) ?? (umbrella ? idOf(umbrella.project_id) : null),
      amount: num(r.spend),
      currency: (typeof umbrella?.currency === 'string' && umbrella.currency) || 'ISK',
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      results: num(r.results)
    };
  });

  return meta;
}

async function loadManual(since: string, until: string): Promise<ManualRow[]> {
  const rows = await repo.list<Record<string, unknown>>('mk_manual_spend', {
    where: {
      and: [
        { field: 'spend_date', op: 'gte', value: since },
        { field: 'spend_date', op: 'lte', value: until }
      ]
    },
    fields: [
      'id', 'label', 'channel', 'medium', 'amount', 'currency',
      'spend_date', 'end_date', 'project_id', 'event_id', 'notes'
    ],
    sort: ['-spend_date']
  });
  return rows.map((r) => ({
    id: num(r.id),
    date: day(r.spend_date),
    // `channel` is the pre-vocabulary column. Reading it as a fallback means
    // a row entered before the backfill still reports somewhere sensible.
    medium:
      (typeof r.medium === 'string' && r.medium) || (typeof r.channel === 'string' && r.channel) || null,
    label: typeof r.label === 'string' ? r.label : null,
    projectId: idOf(r.project_id),
    eventId: idOf(r.event_id),
    amount: num(r.amount),
    currency: typeof r.currency === 'string' && r.currency ? r.currency : 'ISK',
    endDate: r.end_date ? day(r.end_date) : null,
    notes: typeof r.notes === 'string' ? r.notes : null
  }));
}

// ── mk_manual_spend writes ──────────────────────────────────────────────
// Owned here rather than in directus.ts, whose MkManualSpend type predates the
// `medium` column. One writer per collection beats two that disagree.

/** Legacy `channel` values, mirrored so a row written today still reads
 *  correctly anywhere that column is still consulted. */
const CHANNEL_FOR_MEDIUM: Record<string, string> = {
  ooh: 'billboard',
  print: 'print',
  radio: 'radio',
  tv: 'tv',
  sponsorship: 'sponsorship'
};

export type ManualSpendInput = {
  label: string | null;
  medium: string | null;
  amount: number;
  currency: string;
  date: string;
  endDate: string | null;
  projectId: number | null;
  eventId: number | null;
  notes: string | null;
};

function manualPatch(input: ManualSpendInput): Record<string, unknown> {
  return {
    label: input.label,
    medium: input.medium,
    channel: input.medium ? (CHANNEL_FOR_MEDIUM[input.medium] ?? 'other') : 'other',
    amount: input.amount,
    currency: input.currency,
    spend_date: input.date,
    end_date: input.endDate,
    project_id: input.projectId,
    event_id: input.eventId,
    notes: input.notes
  };
}

function toManual(r: Record<string, unknown>): ManualRow {
  return {
    id: num(r.id),
    date: day(r.spend_date),
    medium: (typeof r.medium === 'string' && r.medium) || (typeof r.channel === 'string' && r.channel) || null,
    label: typeof r.label === 'string' ? r.label : null,
    projectId: idOf(r.project_id),
    eventId: idOf(r.event_id),
    amount: num(r.amount),
    currency: typeof r.currency === 'string' && r.currency ? r.currency : 'ISK',
    endDate: r.end_date ? day(r.end_date) : null,
    notes: typeof r.notes === 'string' ? r.notes : null
  };
}

export async function createManualSpendRow(input: ManualSpendInput): Promise<ManualRow> {
  return toManual(await repo.create<Record<string, unknown>>('mk_manual_spend', manualPatch(input)));
}

export async function updateManualSpendRow(id: number, input: ManualSpendInput): Promise<ManualRow> {
  return toManual(await repo.update<Record<string, unknown>>('mk_manual_spend', id, manualPatch(input)));
}

export async function deleteManualSpendRow(id: number): Promise<void> {
  await repo.remove('mk_manual_spend', id);
}

async function loadBreakdowns(since: string, until: string): Promise<BreakdownRow[]> {
  const rows = await repo.list<Record<string, unknown>>('mk_metric_breakdown', {
    where: {
      and: [
        { field: 'level', op: 'eq', value: 'meta_campaign' },
        { field: 'date', op: 'gte', value: since },
        { field: 'date', op: 'lte', value: until }
      ]
    },
    fields: [
      'mk_campaign_id', 'ref_id', 'ref_name', 'date', 'dimension', 'dim_key',
      'medium', 'project_id', 'spend', 'impressions', 'clicks', 'results'
    ]
  });
  return rows.map((r) => ({
    date: day(r.date),
    refId: r.ref_id ? String(r.ref_id) : null,
    label: typeof r.ref_name === 'string' ? r.ref_name : null,
    campaignId: idOf(r.mk_campaign_id),
    projectId: idOf(r.project_id),
    dimension: typeof r.dimension === 'string' ? r.dimension : '',
    key: typeof r.dim_key === 'string' ? r.dim_key : '—',
    medium: typeof r.medium === 'string' && r.medium ? r.medium : null,
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    results: num(r.results)
  }));
}

async function loadProjects(): Promise<MarketingProject[]> {
  const rows = await listProjectsForTree();
  return rows.map((p) => ({
    id: p.id,
    name: p.name ?? `Project #${p.id}`,
    parentId: idOf(p.parent_id)
  }));
}

/** The narrow read behind the project budget card.
 *
 *  loadMarketing() pulls every breakdown row in the window — 10k+ for a year,
 *  which is fine for a dashboard you navigated to on purpose and much too heavy
 *  to hang on every project page. This scopes to one project family and asks
 *  only for the `platform` breakdown, which is all the card needs to name a top
 *  medium. Drills other than platform therefore come back empty — the card
 *  links to /insights for those rather than pretending to have them.
 *
 *  `projectIds` is the project plus its descendants; the caller already has
 *  that list (the project page resolves it for the grants card). */
export async function loadProjectSpend(
  projectIds: number[],
  window: { since: string; until: string } = defaultWindow()
): Promise<MarketingBundle> {
  const { since, until } = window;
  if (projectIds.length === 0) {
    return { meta: [], manual: [], breakdowns: [], budgets: [], projects: [], mediums: [], window };
  }
  const inProjects: Filter = { field: 'project_id', op: 'in', value: projectIds };

  const [metaCampaigns, umbrellas, projects, mediums] = await Promise.all([
    repo.list<Record<string, unknown>>('mk_meta_campaign', {
      where: inProjects,
      fields: ['id', 'name', 'meta_id', 'project_id', 'mk_campaign_id']
    }),
    repo.list<Record<string, unknown>>('mk_campaign', {
      fields: ['id', 'name', 'project_id', 'currency']
    }),
    loadProjects().catch(() => [] as MarketingProject[]),
    listMediums().catch(() => [] as Medium[])
  ]);

  const refIds = metaCampaigns.map((m) => String(m.meta_id ?? '')).filter(Boolean);
  const umbrellaById = new Map(umbrellas.map((u) => [num(u.id), u]));
  const byMetaId = new Map(metaCampaigns.filter((m) => m.meta_id).map((m) => [String(m.meta_id), m]));

  const [metrics, manual, breakdowns, budgets] = await Promise.all([
    refIds.length === 0
      ? Promise.resolve([] as Array<Record<string, unknown>>)
      : repo.list<Record<string, unknown>>('mk_metric', {
          where: {
            and: [
              { field: 'level', op: 'eq', value: 'meta_campaign' },
              { field: 'ref_id', op: 'in', value: refIds },
              { field: 'date', op: 'gte', value: since },
              { field: 'date', op: 'lte', value: until }
            ]
          },
          fields: [
            'mk_campaign_id', 'ref_id', 'ref_name', 'date',
            'spend', 'impressions', 'clicks', 'results'
          ]
        }),
    repo.list<Record<string, unknown>>('mk_manual_spend', {
      where: {
        and: [inProjects, { field: 'spend_date', op: 'gte', value: since }, { field: 'spend_date', op: 'lte', value: until }]
      },
      fields: [
        'id', 'label', 'channel', 'medium', 'amount', 'currency',
        'spend_date', 'end_date', 'project_id', 'event_id', 'notes'
      ]
    }).catch(() => [] as Array<Record<string, unknown>>),
    // Platform only: enough to name a medium, a fraction of the rows.
    repo.list<Record<string, unknown>>('mk_metric_breakdown', {
      where: {
        and: [
          { field: 'dimension', op: 'eq', value: 'platform' },
          inProjects,
          { field: 'date', op: 'gte', value: since },
          { field: 'date', op: 'lte', value: until }
        ]
      },
      fields: [
        'mk_campaign_id', 'ref_id', 'ref_name', 'date', 'dimension', 'dim_key',
        'medium', 'project_id', 'spend', 'impressions', 'clicks', 'results'
      ]
    }).catch(() => [] as Array<Record<string, unknown>>),
    repo.list<Record<string, unknown>>('mk_budget', {
      where: inProjects,
      fields: ['*']
    }).catch(() => [] as Array<Record<string, unknown>>)
  ]);

  const meta: MetaDayRow[] = metrics.map((r) => {
    const mc = r.ref_id ? byMetaId.get(String(r.ref_id)) : undefined;
    const campaignId = idOf(r.mk_campaign_id) ?? (mc ? idOf(mc.mk_campaign_id) : null);
    const umbrella = campaignId != null ? umbrellaById.get(campaignId) : undefined;
    return {
      date: day(r.date),
      refId: r.ref_id ? String(r.ref_id) : null,
      label: (typeof mc?.name === 'string' && mc.name) || (typeof r.ref_name === 'string' ? r.ref_name : null),
      campaignId,
      projectId: (mc ? idOf(mc.project_id) : null) ?? (umbrella ? idOf(umbrella.project_id) : null),
      amount: num(r.spend),
      currency: (typeof umbrella?.currency === 'string' && umbrella.currency) || 'ISK',
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      results: num(r.results)
    };
  });

  return {
    meta,
    manual: manual.map(toManual),
    breakdowns: breakdowns.map((r) => ({
      date: day(r.date),
      refId: r.ref_id ? String(r.ref_id) : null,
      label: typeof r.ref_name === 'string' ? r.ref_name : null,
      campaignId: idOf(r.mk_campaign_id),
      projectId: idOf(r.project_id),
      dimension: typeof r.dimension === 'string' ? r.dimension : '',
      key: typeof r.dim_key === 'string' ? r.dim_key : '—',
      medium: typeof r.medium === 'string' && r.medium ? r.medium : null,
      spend: num(r.spend),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      results: num(r.results)
    })),
    budgets: budgets.map(toBudget),
    projects,
    mediums,
    window
  };
}

/** Everything a marketing surface needs for one window, in as few
 *  round-trips as the schema allows. */
export async function loadMarketing(
  window: { since: string; until: string } = defaultWindow()
): Promise<MarketingBundle> {
  const { since, until } = window;
  const [meta, manual, breakdowns, budgets, projects, mediums] = await Promise.all([
    loadMetaDays(since, until),
    loadManual(since, until).catch(() => [] as ManualRow[]),
    loadBreakdowns(since, until).catch(() => [] as BreakdownRow[]),
    listBudgets().catch(() => [] as Budget[]),
    loadProjects().catch(() => [] as MarketingProject[]),
    listMediums().catch(() => [] as Medium[])
  ]);
  return { meta, manual, breakdowns, budgets, projects, mediums, window };
}
