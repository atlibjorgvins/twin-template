// Meta two-way controls — writes to live Meta
//
// Pausing and budget changes that hit the real ad account. Needed
// metaBudgetToMinor, which lives in the Meta import section below.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { MkMetaCampaign, MkMetricInput } from '$lib/data/marketing';
import { fetchMetaAdReport, metaGraph, metaQuery } from '$lib/data/meta';
import { getMkStructure, upsertMkMetrics } from '$lib/data/marketing';
import { metaBudgetToMinor } from '$lib/data/metaImport';

// ── Two-way controls (writes to live Meta) ───────────────────────────
// These mutate the real campaign on Meta via the proxy, then mirror the
// change into mk_meta_campaign. Callers MUST confirm with the user first
// — this changes live ad delivery.

/** Pause or activate a Meta campaign. */
export async function setMetaCampaignLiveStatus(
  twinId: number,
  metaCampaignId: string,
  status: 'ACTIVE' | 'PAUSED'
): Promise<void> {
  await metaGraph('POST', metaQuery(metaCampaignId, { status }));
  // Mirror is best-effort: the Meta write is the source of truth, and
  // the next sync re-stamps status. Don't fail the whole op (and mislead
  // the user into thinking Meta didn't change) if only the mirror fails.
  await repo.update('mk_meta_campaign', twinId, { status }).catch(() => {});
}

/** Set a Meta campaign's budget (campaign-level). `amount` is in whole
 *  currency units; converted to Meta's minor units via the account
 *  currency (ISK et al. are zero-decimal). Throws Meta's message if the
 *  campaign isn't campaign-budget-optimised. */
export async function setMetaCampaignLiveBudget(
  twinId: number,
  metaCampaignId: string,
  mode: 'daily' | 'lifetime',
  amount: number,
  currency?: string | null
): Promise<void> {
  const field = mode === 'daily' ? 'daily_budget' : 'lifetime_budget';
  await metaGraph('POST', metaQuery(metaCampaignId, { [field]: metaBudgetToMinor(amount, currency ?? undefined) }));
  await repo
    .update('mk_meta_campaign', twinId, { budget_mode: mode, budget_amount: amount })
    .catch(() => {});
}

export type MetaSyncResult = {
  created: number;
  updated: number;
  /** Meta campaign names in this umbrella that received data. */
  matched: string[];
  /** Names Meta returned that aren't in this umbrella's structure. */
  unmatched: string[];
  /** mk_meta_campaign rows whose meta_id we backfilled this run. */
  linkedIds: number;
  /** Total daily rows the account returned (before matching). */
  rows: number;
};

/** On-demand: pull live daily insights for one umbrella campaign's
 *  linked ad account and upsert them as Meta-sourced mk_metric rows.
 *
 *  Only rows whose Meta campaign matches one in *this* umbrella's
 *  structure (by meta_id, else by name) are stored — a shared ad
 *  account never bleeds another client's numbers in. Matched structure
 *  rows get their meta_id backfilled so future syncs key on the id and
 *  the Marketing-API phase already has the link. Everything here is a
 *  Graph *read* plus twin-side writes; it never mutates anything on
 *  Meta. */
export async function syncMkCampaignFromMeta(
  campaignId: number,
  opts: { accountId: string; since?: string; until?: string }
): Promise<MetaSyncResult> {
  const report = await fetchMetaAdReport({
    accountId: opts.accountId,
    since: opts.since,
    until: opts.until,
    level: 'campaign'
  });

  const { metaCampaigns } = await getMkStructure(campaignId);
  const byMetaId = new Map<string, MkMetaCampaign>();
  const byName = new Map<string, MkMetaCampaign>();
  for (const mc of metaCampaigns) {
    if (mc.meta_id) byMetaId.set(String(mc.meta_id), mc);
    if (mc.name) byName.set(mc.name.trim().toLowerCase(), mc);
  }

  const inputs: MkMetricInput[] = [];
  const matched = new Set<string>();
  const unmatched = new Set<string>();
  const toLink = new Map<number, string>(); // mk_meta_campaign.id → meta_id

  for (const r of report) {
    const mc =
      (r.ref_id ? byMetaId.get(r.ref_id) : undefined) ??
      byName.get((r.ref_name ?? '').trim().toLowerCase());
    if (!mc) {
      if (r.ref_name) unmatched.add(r.ref_name);
      continue;
    }
    matched.add(mc.name ?? r.ref_name);
    if (r.ref_id && !mc.meta_id) toLink.set(mc.id, r.ref_id);
    inputs.push({
      level: 'meta_campaign',
      ref_name: mc.name ?? r.ref_name,
      ref_id: r.ref_id || null,
      date: r.date,
      spend: r.spend,
      impressions: r.impressions,
      reach: r.reach,
      clicks: r.clicks,
      results: r.results,
      result_type: r.result_type,
      source: 'meta'
    });
  }

  for (const [id, metaId] of toLink) {
    await repo.update('mk_meta_campaign', id, { meta_id: metaId });
  }

  const { created, updated } = inputs.length
    ? await upsertMkMetrics(campaignId, inputs)
    : { created: 0, updated: 0 };

  return {
    created,
    updated,
    matched: [...matched],
    unmatched: [...unmatched],
    linkedIds: toLink.size,
    rows: report.length
  };
}
