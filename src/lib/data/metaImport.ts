// Import existing Meta structure
//
// Pulls an existing campaign structure into twin.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

// Lazy client: this module rides the eager data layer, and a static client
// import would drag @directus/sdk into every boot (see the hub's same fix).
const directus = {
  request: (async (query: unknown) =>
    (await import('$lib/data/client')).directus.request(query as never)) as (typeof import('$lib/data/client'))['directus']['request']
};
import type { MkAd, MkAdSet, MkMetaCampaign, MkTargeting } from '$lib/data/marketing';
import { createMkAd, createMkAdSet, createMkMetaCampaign, getMkStructure } from '$lib/data/marketing';
import { metaGraphAll } from '$lib/data/meta';

// ── Import existing Meta structure ───────────────────────────────────
// Pulls the live campaign → ad set → ad tree out of an ad account and
// mirrors it into one umbrella, so existing Ads Manager campaigns can
// be reported on without rebuilding them by hand. All reads; the only
// writes are to twin's own collections. Dedupes by meta_id, so it's
// safe to re-run (already-imported objects are skipped).

type GraphCampaign = {
  id: string;
  name?: string;
  objective?: string;
  status?: string;
  buying_type?: string;
  daily_budget?: string;
  lifetime_budget?: string;
};
type GraphAdSet = {
  id: string;
  name?: string;
  status?: string;
  optimization_goal?: string;
  billing_event?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  end_time?: string;
  targeting?: {
    geo_locations?: { countries?: string[] };
    age_min?: number;
    age_max?: number;
    genders?: number[];
    publisher_platforms?: string[];
    flexible_spec?: { interests?: { name?: string }[] }[];
  };
};
type GraphAd = {
  id: string;
  name?: string;
  status?: string;
  creative?: {
    title?: string;
    body?: string;
    object_story_spec?: {
      link_data?: {
        message?: string;
        name?: string;
        description?: string;
        link?: string;
        call_to_action?: { type?: string };
      };
    };
  };
};

// Currencies Meta returns in whole units (no minor denomination). For
// everything else amounts come in cents → divide by 100.
const META_ZERO_DECIMAL = new Set(['ISK', 'JPY', 'KRW', 'VND', 'CLP', 'HUF', 'TWD', 'UGX']);
function metaBudget(raw: string | undefined, currency: string | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return META_ZERO_DECIMAL.has((currency ?? 'ISK').toUpperCase()) ? n : n / 100;
}
/** Inverse of metaBudget: whole units → Meta's minor units for writes. */
// Exported because metaWrites.ts reads it.
export function metaBudgetToMinor(amount: number, currency: string | undefined): number {
  return META_ZERO_DECIMAL.has((currency ?? 'ISK').toUpperCase()) ? Math.round(amount) : Math.round(amount * 100);
}
function metaTargeting(t: GraphAdSet['targeting']): MkTargeting {
  const countries = t?.geo_locations?.countries ?? [];
  const g = t?.genders ?? [];
  const genders = g.length === 0 || (g.includes(1) && g.includes(2)) ? 'all' : g.includes(1) ? 'male' : 'female';
  const interests = (t?.flexible_spec ?? [])
    .flatMap((s) => s.interests ?? [])
    .map((i) => i.name)
    .filter(Boolean)
    .join(', ');
  return {
    countries: countries.length ? countries : ['IS'],
    ageMin: t?.age_min ?? null,
    ageMax: t?.age_max ?? null,
    genders,
    interests: interests || null,
    placements: t?.publisher_platforms?.length ? t.publisher_platforms.join(', ') : 'automatic'
  };
}

export type MetaImportResult = {
  /** Active campaigns the account returned. */
  fetched: number;
  campaignsCreated: number;
  adSetsCreated: number;
  adsCreated: number;
  /** Objects already present (matched by meta_id) and left untouched. */
  skipped: number;
};

/** Import every ACTIVE campaign (with its ad sets and ads) from an ad
 *  account into one umbrella campaign. Returns the freshly-created rows
 *  so the caller can splice them into local state, plus a count
 *  summary. Existing structure (matched by meta_id) is left as-is. */
export async function importMetaStructure(
  umbrellaId: number,
  opts: { accountId: string; currency?: string | null }
): Promise<{
  created: { metaCampaigns: MkMetaCampaign[]; adSets: MkAdSet[]; ads: MkAd[] };
  result: MetaImportResult;
}> {
  const act = opts.accountId.startsWith('act_') ? opts.accountId : `act_${opts.accountId}`;
  const cur = opts.currency ?? 'ISK';

  const existing = await getMkStructure(umbrellaId);
  const campIdMap = new Map<string, number>(); // meta campaign id → twin id
  const setIdMap = new Map<string, number>(); // meta adset id → twin id
  const haveAd = new Set<string>();
  for (const c of existing.metaCampaigns) if (c.meta_id) campIdMap.set(String(c.meta_id), c.id);
  for (const s of existing.adSets) if (s.meta_id) setIdMap.set(String(s.meta_id), s.id);
  for (const a of existing.ads) if (a.meta_id) haveAd.add(String(a.meta_id));

  const createdC: MkMetaCampaign[] = [];
  const createdS: MkAdSet[] = [];
  const createdA: MkAd[] = [];
  let skipped = 0;

  const campaigns = await metaGraphAll<GraphCampaign>(`${act}/campaigns`, {
    fields: 'id,name,objective,status,buying_type,daily_budget,lifetime_budget',
    effective_status: '["ACTIVE"]'
  });

  for (const c of campaigns) {
    let mcId = campIdMap.get(c.id);
    if (mcId) {
      skipped++;
    } else {
      const mc = await createMkMetaCampaign({
        mk_campaign_id: umbrellaId,
        name: c.name ?? 'Untitled campaign',
        objective: c.objective ?? null,
        buying_type: c.buying_type ?? 'AUCTION',
        status: c.status ?? 'PAUSED',
        budget_mode: c.daily_budget ? 'daily' : c.lifetime_budget ? 'lifetime' : 'adset',
        budget_amount: metaBudget(c.daily_budget, cur) ?? metaBudget(c.lifetime_budget, cur),
        meta_id: c.id
      });
      mcId = mc.id;
      campIdMap.set(c.id, mc.id);
      createdC.push(mc);
    }

    const sets = await metaGraphAll<GraphAdSet>(`${c.id}/adsets`, {
      fields:
        'id,name,status,optimization_goal,billing_event,daily_budget,lifetime_budget,start_time,end_time,targeting'
    });
    for (const s of sets) {
      let asId = setIdMap.get(s.id);
      if (asId) {
        skipped++;
      } else {
        const as = await createMkAdSet({
          mk_meta_campaign_id: mcId,
          name: s.name ?? 'Untitled ad set',
          status: s.status ?? 'PAUSED',
          optimization_goal: s.optimization_goal ?? 'LINK_CLICKS',
          billing_event: s.billing_event ?? 'IMPRESSIONS',
          budget_mode: s.daily_budget ? 'daily' : s.lifetime_budget ? 'lifetime' : 'daily',
          budget_amount: metaBudget(s.daily_budget, cur) ?? metaBudget(s.lifetime_budget, cur),
          start_time: s.start_time ? s.start_time.slice(0, 16) : null,
          end_time: s.end_time ? s.end_time.slice(0, 16) : null,
          targeting: metaTargeting(s.targeting),
          meta_id: s.id
        });
        asId = as.id;
        setIdMap.set(s.id, as.id);
        createdS.push(as);
      }

      const ads = await metaGraphAll<GraphAd>(`${s.id}/ads`, {
        fields: 'id,name,status,creative{title,body,object_story_spec}'
      });
      for (const ad of ads) {
        if (haveAd.has(ad.id)) {
          skipped++;
          continue;
        }
        const link = ad.creative?.object_story_spec?.link_data;
        const created = await createMkAd({
          mk_ad_set_id: asId,
          name: ad.name ?? 'Untitled ad',
          status: ad.status ?? 'PAUSED',
          title: ad.creative?.title ?? link?.name ?? null,
          body: ad.creative?.body ?? link?.message ?? null,
          description: link?.description ?? null,
          link_url: link?.link ?? null,
          call_to_action: link?.call_to_action?.type ?? 'LEARN_MORE',
          meta_id: ad.id
        });
        haveAd.add(ad.id);
        createdA.push(created);
      }
    }
  }

  return {
    created: { metaCampaigns: createdC, adSets: createdS, ads: createdA },
    result: {
      fetched: campaigns.length,
      campaignsCreated: createdC.length,
      adSetsCreated: createdS.length,
      adsCreated: createdA.length,
      skipped
    }
  };
}

// Photo navigator — photo_person CRUD — moved to $lib/data/photoPeople.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
// Marketing — the /marketing workspace — moved to $lib/data/marketing.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
