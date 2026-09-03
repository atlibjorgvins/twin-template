// Marketing — the /marketing workspace
//
// The largest section moved so far, and the most depended-upon: eighteen
// names left in directus.ts read it.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { Filter } from '$lib/data/repo';
import type { Organization, Project } from '$lib/data/types';
import type { Tag } from '$lib/data/tags';

// ── Marketing (/marketing) ───────────────────────────────────────────
// Umbrella client campaigns with the Meta (Facebook Ads) structure
// nested underneath: mk_campaign → mk_meta_campaign → mk_ad_set →
// mk_ad, plus mk_metric daily performance rows. The `mk_` prefix
// avoids the Evergreen machine's existing `campaign` collection.
//
// V1 publishes via Ads Manager's "Import Ads in Bulk" file (see
// src/lib/campaigns/metaBulk.ts) — no Meta app or token required.
// A later phase swaps in the Marketing API through a Directus Flow
// proxy (same pattern as BUFFER_FLOW_ID above); the meta_id fields
// on each level are reserved for that.

export type MkCampaignStatus = 'planning' | 'live' | 'paused' | 'completed' | 'archived';

/** A Meta ad account visible to the connected Ads MCP user — names
 *  and ids only, no performance data. organization_id links it to the
 *  client org; that link is the gate: unlinked accounts are never
 *  pushed to or pulled from. */
export type MkAdAccount = {
  id: string;
  name?: string | null;
  business_name?: string | null;
  currency?: string | null;
  account_status?: string | null;
  is_enabled?: boolean | null;
  project_id?: number | Project | null;
  date_synced?: string | null;
};

export async function listMkAdAccounts(): Promise<MkAdAccount[]> {
  return repo.list<MkAdAccount>('mk_ad_account', {
    fields: ['*', { project_id: ['id', 'name'] }],
    sort: ['name'],
    limit: -1
  });
}

export async function updateMkAdAccount(
  id: string,
  patch: Partial<MkAdAccount>
): Promise<MkAdAccount> {
  return repo.update<MkAdAccount>('mk_ad_account', id, patch as Record<string, unknown>);
}

export type MkCampaign = {
  id: number;
  name?: string | null;
  status?: MkCampaignStatus | string;
  client_org_id?: number | Organization | null;
  project_id?: number | Project | null;
  brief?: string | null;
  objective_summary?: string | null;
  budget_total?: number | string | null;
  currency?: string | null;
  date_start?: string | null;
  date_end?: string | null;
  /** Meta ad account this campaign publishes into — required before
   *  pushing via the Ads MCP (/meta-push). */
  ad_account_id?: string | MkAdAccount | null;
  date_created?: string | null;
  date_updated?: string | null;
};

export type MkCampaignTag = {
  id: number;
  mk_campaign_id: number | MkCampaign;
  tag_id: number | Tag;
};

export type MkMetaCampaign = {
  id: number;
  mk_campaign_id?: number | MkCampaign | null;
  name?: string | null;
  objective?: string | null;
  buying_type?: string | null;
  status?: 'PAUSED' | 'ACTIVE' | string;
  budget_mode?: 'daily' | 'lifetime' | 'adset' | string;
  budget_amount?: number | string | null;
  meta_id?: string | null;
  /** Sub-project this campaign is attributed to (reporting roll-up). */
  project_id?: number | Project | null;
  /** Ad account it ran in — denormalised at import for browse/filter. */
  ad_account_id?: string | MkAdAccount | null;
  date_created?: string | null;
  date_updated?: string | null;
};

export type MkTargeting = {
  countries?: string[];
  ageMin?: number | null;
  ageMax?: number | null;
  genders?: 'all' | 'male' | 'female' | string;
  interests?: string | null;
  placements?: string | null;
};

export type MkAdSet = {
  id: number;
  mk_meta_campaign_id?: number | MkMetaCampaign | null;
  name?: string | null;
  status?: string;
  optimization_goal?: string | null;
  billing_event?: string | null;
  budget_mode?: 'daily' | 'lifetime' | string;
  budget_amount?: number | string | null;
  start_time?: string | null;
  end_time?: string | null;
  targeting?: MkTargeting | null;
  meta_id?: string | null;
  date_created?: string | null;
  date_updated?: string | null;
};

export type MkAd = {
  id: number;
  mk_ad_set_id?: number | MkAdSet | null;
  name?: string | null;
  status?: string;
  body?: string | null;
  title?: string | null;
  description?: string | null;
  link_url?: string | null;
  call_to_action?: string | null;
  image_id?: string | null;
  meta_id?: string | null;
  date_created?: string | null;
  date_updated?: string | null;
};

export type MkMetricLevel = 'campaign' | 'meta_campaign' | 'ad_set' | 'ad';

export type MkMetric = {
  id: number;
  mk_campaign_id?: number | MkCampaign | null;
  level?: MkMetricLevel | string;
  ref_name?: string | null;
  /** Meta entity id when the row came from an MCP insights pull —
   *  id-based upserts beat name matching. */
  ref_id?: string | null;
  date?: string | null;
  spend?: number | string | null;
  impressions?: number | null;
  reach?: number | null;
  clicks?: number | null;
  results?: number | null;
  result_type?: string | null;
  source?: 'import' | 'manual' | string;
  date_created?: string | null;
  date_updated?: string | null;
};

// Meta enum → human label maps, so selects stay accurate to what
// Ads Manager expects in the bulk file.
export const MK_OBJECTIVES: { value: string; label: string }[] = [
  { value: 'OUTCOME_AWARENESS', label: 'Awareness' },
  { value: 'OUTCOME_TRAFFIC', label: 'Traffic' },
  { value: 'OUTCOME_ENGAGEMENT', label: 'Engagement' },
  { value: 'OUTCOME_LEADS', label: 'Leads' },
  { value: 'OUTCOME_APP_PROMOTION', label: 'App promotion' },
  { value: 'OUTCOME_SALES', label: 'Sales' }
];

export const MK_OPTIMIZATION_GOALS: { value: string; label: string }[] = [
  { value: 'LINK_CLICKS', label: 'Link clicks' },
  { value: 'LANDING_PAGE_VIEWS', label: 'Landing page views' },
  { value: 'REACH', label: 'Reach' },
  { value: 'IMPRESSIONS', label: 'Impressions' },
  { value: 'OFFSITE_CONVERSIONS', label: 'Conversions' },
  { value: 'LEAD_GENERATION', label: 'Lead generation' },
  { value: 'POST_ENGAGEMENT', label: 'Post engagement' }
];

export const MK_CTA_OPTIONS: { value: string; label: string }[] = [
  { value: 'LEARN_MORE', label: 'Learn more' },
  { value: 'SIGN_UP', label: 'Sign up' },
  { value: 'SHOP_NOW', label: 'Shop now' },
  { value: 'APPLY_NOW', label: 'Apply now' },
  { value: 'CONTACT_US', label: 'Contact us' },
  { value: 'DOWNLOAD', label: 'Download' },
  { value: 'GET_OFFER', label: 'Get offer' },
  { value: 'BOOK_TRAVEL', label: 'Book now' },
  { value: 'SUBSCRIBE', label: 'Subscribe' },
  { value: 'NO_BUTTON', label: 'No button' }
];

export const MK_STATUS_LABELS: Record<string, string> = {
  planning: 'Planning',
  live: 'Live',
  paused: 'Paused',
  completed: 'Completed',
  archived: 'Archived'
};

/** "1.234.567 kr." — Icelandic grouping. */
export function formatISK(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0);
  if (!Number.isFinite(n)) return '0 kr.';
  return `${Math.round(n).toLocaleString('is-IS')} kr.`;
}

export function formatMoney(
  value: number | string | null | undefined,
  currency?: string | null
): string {
  const cur = (currency ?? 'ISK').toUpperCase();
  if (cur === 'ISK') return formatISK(value);
  const n = typeof value === 'string' ? Number(value) : (value ?? 0);
  if (!Number.isFinite(n)) return `0 ${cur}`;
  return `${n.toLocaleString('is-IS', { maximumFractionDigits: 2 })} ${cur}`;
}

// — umbrella campaign CRUD —

export async function listMkCampaigns(): Promise<MkCampaign[]> {
  return repo.list<MkCampaign>('mk_campaign', {
    where: { field: 'status', op: 'neq', value: 'archived' },
    fields: ['*', { client_org_id: ['id', 'name'] }, { project_id: ['id', 'name'] }],
    sort: ['-date_updated'],
    limit: -1
  });
}

export async function getMkCampaign(id: number): Promise<MkCampaign> {
  const c = await repo.get<MkCampaign>('mk_campaign', id, {
    fields: ['*', { client_org_id: ['id', 'name'] }, { project_id: ['id', 'name'] }]
  });
  if (!c) throw new Error(`mk_campaign ${id} not found`);
  return c;
}

export async function createMkCampaign(patch: Partial<MkCampaign>): Promise<MkCampaign> {
  return repo.create<MkCampaign>('mk_campaign', patch as Record<string, unknown>);
}

export async function updateMkCampaign(id: number, patch: Partial<MkCampaign>): Promise<MkCampaign> {
  return repo.update<MkCampaign>('mk_campaign', id, patch as Record<string, unknown>);
}

export async function deleteMkCampaign(id: number): Promise<void> {
  await repo.remove('mk_campaign', id);
}

// — Meta structure (campaign → ad set → ad) —

/** The whole Meta tree for one umbrella campaign, in three flat
 *  queries (ad sets and ads filtered through their parent relation). */
export async function getMkStructure(campaignId: number): Promise<{
  metaCampaigns: MkMetaCampaign[];
  adSets: MkAdSet[];
  ads: MkAd[];
}> {
  const [metaCampaigns, adSets, ads] = await Promise.all([
    repo.list<MkMetaCampaign>('mk_meta_campaign', {
      where: { field: 'mk_campaign_id', op: 'eq', value: campaignId },
      sort: ['date_created'],
      limit: -1
    }),
    repo.list<MkAdSet>('mk_ad_set', {
      where: { field: 'mk_meta_campaign_id.mk_campaign_id', op: 'eq', value: campaignId },
      sort: ['date_created'],
      limit: -1
    }),
    repo.list<MkAd>('mk_ad', {
      where: {
        field: 'mk_ad_set_id.mk_meta_campaign_id.mk_campaign_id',
        op: 'eq',
        value: campaignId
      },
      sort: ['date_created'],
      limit: -1
    })
  ]);
  return { metaCampaigns, adSets, ads };
}

export async function createMkMetaCampaign(patch: Partial<MkMetaCampaign>): Promise<MkMetaCampaign> {
  return repo.create<MkMetaCampaign>('mk_meta_campaign', patch as Record<string, unknown>);
}
export async function updateMkMetaCampaign(
  id: number,
  patch: Partial<MkMetaCampaign>
): Promise<MkMetaCampaign> {
  return repo.update<MkMetaCampaign>('mk_meta_campaign', id, patch as Record<string, unknown>);
}
export async function deleteMkMetaCampaign(id: number): Promise<void> {
  await repo.remove('mk_meta_campaign', id);
}

export async function createMkAdSet(patch: Partial<MkAdSet>): Promise<MkAdSet> {
  return repo.create<MkAdSet>('mk_ad_set', patch as Record<string, unknown>);
}
export async function updateMkAdSet(id: number, patch: Partial<MkAdSet>): Promise<MkAdSet> {
  return repo.update<MkAdSet>('mk_ad_set', id, patch as Record<string, unknown>);
}
export async function deleteMkAdSet(id: number): Promise<void> {
  await repo.remove('mk_ad_set', id);
}

export async function createMkAd(patch: Partial<MkAd>): Promise<MkAd> {
  return repo.create<MkAd>('mk_ad', patch as Record<string, unknown>);
}
export async function updateMkAd(id: number, patch: Partial<MkAd>): Promise<MkAd> {
  return repo.update<MkAd>('mk_ad', id, patch as Record<string, unknown>);
}
export async function deleteMkAd(id: number): Promise<void> {
  await repo.remove('mk_ad', id);
}

/** Deep copy: umbrella + meta campaigns + ad sets + ads (not metrics). */
export async function duplicateMkCampaign(id: number): Promise<MkCampaign> {
  const src = await getMkCampaign(id);
  const { metaCampaigns, adSets, ads } = await getMkStructure(id);
  const copy = await createMkCampaign({
    name: `${src.name ?? 'Campaign'} (copy)`,
    status: 'planning',
    client_org_id: typeof src.client_org_id === 'object' ? src.client_org_id?.id : src.client_org_id,
    project_id: typeof src.project_id === 'object' ? src.project_id?.id : src.project_id,
    brief: src.brief,
    objective_summary: src.objective_summary,
    budget_total: src.budget_total,
    currency: src.currency,
    date_start: src.date_start,
    date_end: src.date_end
  });
  for (const mc of metaCampaigns) {
    const mcCopy = await createMkMetaCampaign({
      mk_campaign_id: copy.id,
      name: mc.name,
      objective: mc.objective,
      buying_type: mc.buying_type,
      status: 'PAUSED',
      budget_mode: mc.budget_mode,
      budget_amount: mc.budget_amount
    });
    for (const as of adSets.filter((a) => Number(a.mk_meta_campaign_id) === mc.id)) {
      const asCopy = await createMkAdSet({
        mk_meta_campaign_id: mcCopy.id,
        name: as.name,
        status: 'PAUSED',
        optimization_goal: as.optimization_goal,
        billing_event: as.billing_event,
        budget_mode: as.budget_mode,
        budget_amount: as.budget_amount,
        start_time: as.start_time,
        end_time: as.end_time,
        targeting: as.targeting
      });
      for (const ad of ads.filter((a) => Number(a.mk_ad_set_id) === as.id)) {
        await createMkAd({
          mk_ad_set_id: asCopy.id,
          name: ad.name,
          status: 'PAUSED',
          body: ad.body,
          title: ad.title,
          description: ad.description,
          link_url: ad.link_url,
          call_to_action: ad.call_to_action,
          image_id: ad.image_id
        });
      }
    }
  }
  return copy;
}

// — metrics —

export async function listMkMetrics(campaignId: number): Promise<MkMetric[]> {
  return repo.list<MkMetric>('mk_metric', {
    where: { field: 'mk_campaign_id', op: 'eq', value: campaignId },
    sort: ['date'],
    limit: -1
  });
}

export type MkMetricInput = Omit<MkMetric, 'id' | 'date_created' | 'date_updated'>;

/** Insert-or-update on (mk_campaign_id, level, ref_name, date) so
 *  re-importing the same Ads Manager report never duplicates rows.
 *  Returns counts for the import summary. */
export async function upsertMkMetrics(
  campaignId: number,
  rows: MkMetricInput[]
): Promise<{ created: number; updated: number }> {
  const existing = await listMkMetrics(campaignId);
  // ref_id (Meta entity id) wins when present; CSV imports without
  // ids fall back to the name-based key.
  const nameKey = (m: { level?: string | null; ref_name?: string | null; date?: string | null }) =>
    `${m.level ?? ''}|${(m.ref_name ?? '').trim().toLowerCase()}|${(m.date ?? '').slice(0, 10)}`;
  const key = (m: {
    level?: string | null;
    ref_name?: string | null;
    ref_id?: string | null;
    date?: string | null;
  }) => (m.ref_id ? `${m.level ?? ''}|id:${m.ref_id}|${(m.date ?? '').slice(0, 10)}` : nameKey(m));
  const byKey = new Map(existing.map((m) => [key(m), m]));
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    // An id-keyed (Meta-synced) row also matches a pre-existing
    // name-keyed (CSV/manual) row for the same campaign+date, so the
    // first sync absorbs legacy rows instead of double-counting them.
    const hit = byKey.get(key(row)) ?? (row.ref_id ? byKey.get(nameKey(row)) : undefined);
    if (hit) {
      await repo.update('mk_metric', hit.id, { ...row, mk_campaign_id: campaignId } as Record<string, unknown>);
      updated++;
    } else {
      await repo.create('mk_metric', { ...row, mk_campaign_id: campaignId } as Record<string, unknown>);
      created++;
    }
  }
  return { created, updated };
}

export async function deleteMkMetric(id: number): Promise<void> {
  await repo.remove('mk_metric', id);
}

/** Spend-to-date per umbrella campaign for the list page — one
 *  aggregated query across all campaigns. */
export async function mkSpendByCampaign(): Promise<Map<number, number>> {
  const rows = await repo.aggregate<{
    mk_campaign_id: number;
    sum: { spend: string | number | null };
  }>('mk_metric', {
    aggregate: { sum: ['spend'] },
    groupBy: ['mk_campaign_id'],
    limit: -1
  });
  const map = new Map<number, number>();
  for (const r of rows) {
    const v = Number(r.sum?.spend ?? 0);
    if (r.mk_campaign_id != null && Number.isFinite(v)) map.set(Number(r.mk_campaign_id), v);
  }
  return map;
}

export type MkDashboardSummary = {
  totals: { spend: number; impressions: number; clicks: number; results: number };
  /** Daily spend summed across every campaign, oldest → newest. */
  dailySpend: { date: string; spend: number }[];
};

/** Portfolio-wide KPI rollup for the campaign dashboard — one
 *  aggregate query for the totals, one grouped query for the trend.
 *  `since` (YYYY-MM-DD) optionally trims to a trailing window. */
export async function mkDashboardSummary(since?: string): Promise<MkDashboardSummary> {
  const dateFilter: Filter | undefined = since
    ? { field: 'date', op: 'gte', value: since }
    : undefined;

  const [totalRows, dayRows] = await Promise.all([
    repo.aggregate<{
      sum: { spend: string | null; impressions: string | null; clicks: string | null; results: string | null };
    }>('mk_metric', {
      aggregate: { sum: ['spend', 'impressions', 'clicks', 'results'] },
      where: dateFilter,
      limit: 1
    }),
    repo.aggregate<{ date: string | null; sum: { spend: string | null } }>('mk_metric', {
      aggregate: { sum: ['spend'] },
      groupBy: ['date'],
      where: dateFilter,
      sort: ['date'],
      limit: -1
    })
  ]);

  const s = totalRows[0]?.sum;
  return {
    totals: {
      spend: Number(s?.spend ?? 0) || 0,
      impressions: Number(s?.impressions ?? 0) || 0,
      clicks: Number(s?.clicks ?? 0) || 0,
      results: Number(s?.results ?? 0) || 0
    },
    dailySpend: dayRows
      .filter((r) => r.date)
      .map((r) => ({ date: String(r.date).slice(0, 10), spend: Number(r.sum?.spend ?? 0) || 0 }))
  };
}

// — All Meta campaigns (account-wide browse + sub-project attribution) —
// Every imported mk_meta_campaign as a first-class, reportable row:
// its account + sub-project links resolved, and lifetime totals rolled
// up from mk_metric (matched on ref_id = the Meta campaign id).

export type MetaCampaignTotals = {
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
  firstDate: string | null;
  lastDate: string | null;
};
export type MetaCampaignRow = MkMetaCampaign & { totals: MetaCampaignTotals };

const emptyTotals = (): MetaCampaignTotals => ({
  spend: 0, impressions: 0, clicks: 0, results: 0, firstDate: null, lastDate: null
});

export async function listAllMetaCampaigns(): Promise<MetaCampaignRow[]> {
  const [campaigns, agg] = await Promise.all([
    repo.list<MkMetaCampaign>('mk_meta_campaign', {
      // Expand the account's + umbrella's project so the UI can scope
      // the sub-project picker to the campaign's main project family.
      fields: [
        '*',
        { project_id: ['id', 'name'] },
        { ad_account_id: ['id', 'name', 'currency', { project_id: ['id', 'name'] }] },
        { mk_campaign_id: ['id', { project_id: ['id', 'name'] }] }
      ],
      sort: ['name'],
      limit: -1
    }),
    repo.aggregate<{
      ref_id: string | null;
      sum: { spend: string | null; impressions: string | null; clicks: string | null; results: string | null };
      min: { date: string | null };
      max: { date: string | null };
    }>('mk_metric', {
      // Only campaign-level rows, so per-campaign totals can't double-count
      // any ad-set/ad rows that share the campaign's ref_id (matches the
      // level filter listMetaMetricRows uses for the dashboard/report).
      where: { field: 'level', op: 'eq', value: 'meta_campaign' },
      aggregate: { sum: ['spend', 'impressions', 'clicks', 'results'], min: ['date'], max: ['date'] },
      groupBy: ['ref_id'],
      limit: -1
    })
  ]);
  const byRef = new Map<string, MetaCampaignTotals>();
  for (const r of agg) {
    if (!r.ref_id) continue;
    byRef.set(String(r.ref_id), {
      spend: Number(r.sum?.spend ?? 0) || 0,
      impressions: Number(r.sum?.impressions ?? 0) || 0,
      clicks: Number(r.sum?.clicks ?? 0) || 0,
      results: Number(r.sum?.results ?? 0) || 0,
      firstDate: r.min?.date ? String(r.min.date).slice(0, 10) : null,
      lastDate: r.max?.date ? String(r.max.date).slice(0, 10) : null
    });
  }
  return campaigns.map((c) => ({
    ...c,
    totals: (c.meta_id ? byRef.get(String(c.meta_id)) : undefined) ?? emptyTotals()
  }));
}

/** Attribute a Meta campaign to a sub-project (or clear it). */
export async function setMetaCampaignProject(id: number, projectId: number | null): Promise<void> {
  await repo.update('mk_meta_campaign', id, { project_id: projectId } as Record<string, unknown>);
}

// — Event tagging (mk_meta_campaign_event, M2M) —

/** All campaign↔event links with event names resolved, for the browse
 *  view to show chips + filter by event (one query, grouped client-side). */
export async function listMetaCampaignEventLinks(): Promise<
  { mk_meta_campaign_id: number; event: { id: number; name: string } }[]
> {
  const rows = await repo.list<{
    mk_meta_campaign_id: number;
    event_id: { id: number; name: string | null } | null;
  }>('mk_meta_campaign_event', {
    fields: ['mk_meta_campaign_id', { event_id: ['id', 'name'] }],
    limit: -1
  });
  return rows
    .filter((r) => r.event_id)
    .map((r) => ({
      mk_meta_campaign_id: Number(r.mk_meta_campaign_id),
      event: { id: r.event_id!.id, name: r.event_id!.name ?? `#${r.event_id!.id}` }
    }));
}

/** Replace the set of events tagged on one Meta campaign. */
export async function setMetaCampaignEvents(metaCampaignId: number, eventIds: number[]): Promise<void> {
  const existing = await repo.list<{ id: number; event_id: number | null }>('mk_meta_campaign_event', {
    where: { field: 'mk_meta_campaign_id', op: 'eq', value: metaCampaignId },
    limit: -1
  });
  const have = new Set(existing.map((r) => Number(r.event_id)));
  const want = new Set(eventIds);
  for (const r of existing) {
    if (!want.has(Number(r.event_id))) await repo.remove('mk_meta_campaign_event', r.id);
  }
  for (const id of eventIds) {
    if (!have.has(id)) {
      await repo.create('mk_meta_campaign_event', {
        mk_meta_campaign_id: metaCampaignId,
        event_id: id
      } as Record<string, unknown>);
    }
  }
}

// — Manual ad spend (mk_manual_spend) —
// Spend on channels twin isn't connected to (billboards, print, radio…),
// tracked so reporting can blend it with Meta.

// The three collections the marketing redesign added, in the snake_case
// shape the backend returns — relations either an id or an expanded object.
// The camelCase domain types live in $lib/marketing/{media,budget,metrics};
// these are the row shapes the `repo` calls below are parameterised on.

/** mk_medium — the one medium vocabulary. Primary key is the code itself, so
 *  a spend row stores the value rather than an id to resolve. */
export type MkMediumRow = {
  code: string;
  label?: string | null;
  kind?: string | null;
  sort?: number | null;
  manual_entry?: boolean | null;
  meta_platform?: string | null;
  is_enabled?: boolean | null;
};

/** mk_budget — a spending envelope: project, campaign or medium, per period. */
export type MkBudgetRow = {
  id: number;
  label?: string | null;
  scope?: 'project' | 'campaign' | 'medium' | string | null;
  status?: 'draft' | 'approved' | 'closed' | string | null;
  project_id?: number | Project | null;
  include_descendants?: boolean | null;
  campaign_id?: number | MkCampaign | null;
  medium?: string | MkMediumRow | null;
  period?: 'total' | 'year' | 'month' | string | null;
  period_start?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  committed?: number | string | null;
  notes?: string | null;
  date_created?: string | null;
  date_updated?: string | null;
};

/** mk_metric_breakdown — one day x one dimension x one value. A mirror of
 *  Meta's insights, replaced wholesale by the sync; nothing here is
 *  hand-edited. */
export type MkMetricBreakdownRow = {
  id: number;
  mk_campaign_id?: number | MkCampaign | null;
  level?: MkMetricLevel | string | null;
  ref_id?: string | null;
  ref_name?: string | null;
  date?: string | null;
  dimension?: string | null;
  dim_key?: string | null;
  medium?: string | null;
  project_id?: number | Project | null;
  spend?: number | string | null;
  impressions?: number | null;
  clicks?: number | null;
  results?: number | null;
  result_type?: string | null;
  source?: string | null;
  date_created?: string | null;
};

export type MkManualSpend = {
  id: number;
  label?: string | null;
  channel?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  spend_date?: string | null;
  end_date?: string | null;
  project_id?: number | Project | null;
  event_id?: number | { id: number; name?: string | null } | null;
  notes?: string | null;
  date_created?: string | null;
  date_updated?: string | null;
};

export const MK_MANUAL_CHANNELS: { value: string; label: string }[] = [
  { value: 'billboard', label: 'Billboard / OOH' },
  { value: 'print', label: 'Print' },
  { value: 'radio', label: 'Radio' },
  { value: 'tv', label: 'TV' },
  { value: 'sponsorship', label: 'Sponsorship' },
  { value: 'other', label: 'Other' }
];

export async function listManualSpend(): Promise<MkManualSpend[]> {
  return repo.list<MkManualSpend>('mk_manual_spend', {
    fields: ['*', { project_id: ['id', 'name'] }, { event_id: ['id', 'name'] }],
    sort: ['-spend_date'],
    limit: -1
  });
}

export async function createManualSpend(patch: Partial<MkManualSpend>): Promise<MkManualSpend> {
  return repo.create<MkManualSpend>('mk_manual_spend', patch as Record<string, unknown>);
}
export async function updateManualSpend(id: number, patch: Partial<MkManualSpend>): Promise<MkManualSpend> {
  return repo.update<MkManualSpend>('mk_manual_spend', id, patch as Record<string, unknown>);
}
export async function deleteManualSpend(id: number): Promise<void> {
  await repo.remove('mk_manual_spend', id);
}

// Actively working on — the focus queue — moved to $lib/data/focus.ts, re-exported at the end of
// this file. See docs/opening-up-twin.md.
// Closing a focus task, and getting that back to Asana — moved to $lib/data/taskClosing.ts and re-exported
// at the end of this file. See docs/opening-up-twin.md.
