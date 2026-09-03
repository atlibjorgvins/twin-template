// Asana project ⇄ twin project links
//
// Two-way project mapping and task push-back.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { FocusTask } from '$lib/data/focus';
import type { MkAd, MkAdSet, MkCampaignTag, MkMetaCampaign, MkMetric, MkTargeting } from '$lib/data/marketing';
import type { Tag } from '$lib/data/tags';
import { createMkAd, createMkAdSet, createMkMetaCampaign } from '$lib/data/marketing';

// ── Asana project ⇄ twin project links ───────────────────────────────────
// The remembered mapping. Connect "Markaðsmál" to KLAK once and every task
// that later arrives from that Asana project lands on KLAK by itself.

export type AsanaProjectLink = {
  id: number;
  asana_project_gid: string;
  asana_project_name?: string | null;
  project_id?: number | { id: number; name?: string | null } | null;
  task_count?: number | null;
  last_applied?: string | null;
  date_created?: string | null;
};

const ASANA_LINK_FIELDS = ['*', { project_id: ['id', 'name'] }];

export async function listAsanaProjectLinks(): Promise<AsanaProjectLink[]> {
  return repo.list<AsanaProjectLink>('asana_project_link', {
    fields: ASANA_LINK_FIELDS,
    sort: ['asana_project_name'],
    limit: -1
  });
}

/**
 * Remember (or re-point) one mapping.
 *
 * Upsert by gid, not by id — the gid is the natural key and connecting the
 * same Asana project twice should move the arrow, not create a duplicate
 * that silently wins depending on sort order.
 */
export async function saveAsanaProjectLink(p: {
  asana_project_gid: string;
  asana_project_name?: string | null;
  project_id: number | null;
}): Promise<AsanaProjectLink> {
  const existing = await repo.list<{ id: number }>('asana_project_link', {
    where: { field: 'asana_project_gid', op: 'eq', value: p.asana_project_gid },
    fields: ['id'],
    limit: 1
  });

  if (existing.length > 0) {
    return repo.update<AsanaProjectLink>('asana_project_link', existing[0].id, {
      asana_project_name: p.asana_project_name ?? null,
      project_id: p.project_id
    });
  }
  return repo.create<AsanaProjectLink>('asana_project_link', p as Record<string, unknown>);
}

export async function deleteAsanaProjectLink(id: number): Promise<void> {
  await repo.remove('asana_project_link', id);
}

/**
 * Apply the remembered mappings to tasks that don't have a twin project yet.
 *
 * Two passes, cheapest first:
 *
 *   1. Tasks that already know their Asana project (gid cached on the row)
 *      are matched against the links with no network calls at all.
 *   2. Only what's left gets asked of Asana — once per task — and the answer
 *      is written back to the row so it never has to be asked again.
 *
 * `resolveViaAsana` is injected rather than imported so this stays callable
 * (and testable) when Asana is unreachable: pass null and step 2 is skipped,
 * which is exactly the behaviour while the proxy has no token.
 *
 * Returns what it did, so the UI can say "4 tasks assigned" instead of
 * silently rearranging the board.
 */
export async function applyAsanaProjectLinks(
  tasks: FocusTask[],
  links: AsanaProjectLink[],
  resolveViaAsana: ((gid: string) => Promise<{ gid: string; name?: string }[]>) | null
): Promise<{
  assigned: number;
  resolved: number;
  unmatched: number;
  failed: number;
  /** Not attempted — Asana was unreachable, or the failure streak tripped. */
  skipped: number;
}> {
  const byGid = new Map<string, AsanaProjectLink>();
  for (const l of links) {
    const pid = typeof l.project_id === 'object' ? l.project_id?.id : l.project_id;
    if (l.asana_project_gid && typeof pid === 'number') byGid.set(l.asana_project_gid, l);
  }
  const out = { assigned: 0, resolved: 0, unmatched: 0, failed: 0, skipped: 0 };
  if (byGid.size === 0) return out;

  const needsProject = tasks.filter(
    (t) => t.source === 'asana' && !t.project_id && t.source_ref
  );
  const touched = new Map<string, number>();

  // Two real passes, not one interleaved loop. The free work must all land
  // before any network call, so a token-less Asana still leaves you with every
  // assignment the cache could already make.
  const cached = needsProject.filter((t) => t.asana_project_gid);
  const needsLookup = needsProject.filter((t) => !t.asana_project_gid);

  const resolvedGid = new Map<number, { gid: string; name: string | null }>();

  if (resolveViaAsana && needsLookup.length > 0) {
    // Stop after three consecutive failures. A missing or rejected token fails
    // EVERY task identically, and grinding through all of them cost 22 seconds
    // to learn one fact. Whatever is left is reported as skipped, not silently
    // dropped.
    let consecutive = 0;
    for (const t of needsLookup) {
      if (consecutive >= 3) { out.skipped++; continue; }
      try {
        const projects = await resolveViaAsana(t.source_ref as string);
        consecutive = 0;
        // Prefer a project we actually have a link for — a task in several
        // projects otherwise resolves by Asana's ordering, which would make
        // the mapping look unreliable rather than merely ambiguous.
        const hit = projects.find((p) => byGid.has(p.gid)) ?? projects[0];
        if (!hit) { out.unmatched++; continue; }
        resolvedGid.set(t.id, { gid: hit.gid, name: hit.name ?? null });
        out.resolved++;
      } catch {
        out.failed++;
        consecutive++;
      }
    }
  } else if (needsLookup.length > 0) {
    out.skipped += needsLookup.length;
  }

  for (const t of [...cached, ...needsLookup]) {
    const found = resolvedGid.get(t.id);
    const gid = t.asana_project_gid ?? found?.gid ?? null;
    const name = t.asana_project_name ?? found?.name ?? null;
    if (!gid) continue;   // already counted as failed/skipped/unmatched above

    const link = byGid.get(gid);
    const pid = link && (typeof link.project_id === 'object' ? link.project_id?.id : link.project_id);

    // Cache the Asana project on the row even when it maps to nothing — the
    // point of the cache is to stop asking, and an unmapped project is still
    // an answer.
    const patch: Record<string, unknown> = {};
    if (gid && gid !== t.asana_project_gid) patch.asana_project_gid = gid;
    if (name && name !== t.asana_project_name) patch.asana_project_name = name;
    if (typeof pid === 'number') { patch.project_id = pid; }

    if (Object.keys(patch).length > 0) {
      try {
        await repo.update('focus_task', t.id, patch);
        if (typeof pid === 'number') {
          out.assigned++;
          touched.set(link!.asana_project_gid, (touched.get(link!.asana_project_gid) ?? 0) + 1);
        } else {
          out.unmatched++;
        }
      } catch {
        out.failed++;
      }
    } else {
      out.unmatched++;
    }
  }

  // Stamp the links that did work, so the UI can show a mapping is live
  // rather than merely configured.
  await Promise.all(
    [...touched].map(([gid, n]) => {
      const l = byGid.get(gid)!;
      return repo
        .update('asana_project_link', l.id, {
          task_count: (l.task_count ?? 0) + n,
          last_applied: new Date().toISOString()
        })
        .catch(() => undefined);
    })
  );

  return out;
}

/** Every daily Meta-campaign metric row (lightweight fields), for the
 *  reporting dashboard to slice client-side by date / sub-project /
 *  account / status. mk_metric carries no project link, so callers map
 *  ref_id (= the Meta campaign id) back through mk_meta_campaign. */
export async function listMetaMetricRows(): Promise<
  { date: string; ref_id: string | null; spend: number; results: number; clicks: number; impressions: number }[]
> {
  const rows = await repo.list<MkMetric>('mk_metric', {
    where: { field: 'level', op: 'eq', value: 'meta_campaign' },
    fields: ['date', 'ref_id', 'spend', 'results', 'clicks', 'impressions'],
    sort: ['date'],
    limit: -1
  });
  return rows.map((r) => ({
    date: (r.date ?? '').slice(0, 10),
    ref_id: r.ref_id ?? null,
    spend: Number(r.spend ?? 0) || 0,
    results: r.results ?? 0,
    clicks: r.clicks ?? 0,
    impressions: r.impressions ?? 0
  }));
}

/** Daily series for one Meta campaign (by its Meta id) — feeds the
 *  per-campaign trend in the browse view. */
export async function listMetaCampaignDaily(
  metaId: string
): Promise<{ date: string; spend: number; results: number; clicks: number; impressions: number }[]> {
  const rows = await repo.list<MkMetric>('mk_metric', {
    where: { field: 'ref_id', op: 'eq', value: metaId },
    sort: ['date'],
    fields: ['date', 'spend', 'results', 'clicks', 'impressions'],
    limit: -1
  });
  return rows.map((r) => ({
    date: (r.date ?? '').slice(0, 10),
    spend: Number(r.spend ?? 0) || 0,
    results: r.results ?? 0,
    clicks: r.clicks ?? 0,
    impressions: r.impressions ?? 0
  }));
}

// — tags —

export async function listMkCampaignTags(campaignId: number): Promise<Tag[]> {
  const rows = await repo.list<{ id: number; tag_id: Tag }>('mk_campaign_tag', {
    where: { field: 'mk_campaign_id', op: 'eq', value: campaignId },
    fields: ['id', { tag_id: ['id', 'name', 'color'] }],
    limit: -1
  });
  return rows.map((r) => r.tag_id).filter(Boolean);
}

export async function setMkCampaignTags(campaignId: number, tagIds: number[]): Promise<void> {
  const rows = await repo.list<MkCampaignTag>('mk_campaign_tag', {
    where: { field: 'mk_campaign_id', op: 'eq', value: campaignId },
    limit: -1
  });
  const have = new Set(rows.map((r) => Number(r.tag_id)));
  const want = new Set(tagIds);
  for (const r of rows) {
    if (!want.has(Number(r.tag_id))) await repo.remove('mk_campaign_tag', r.id);
  }
  for (const tid of tagIds) {
    if (!have.has(tid)) {
      await repo.create('mk_campaign_tag', { mk_campaign_id: campaignId, tag_id: tid });
    }
  }
}

// — templates —
// Reusable snapshots of Meta structures (whole tree or any subtree).
// Stored as JSON so a template survives the records it was saved
// from; image_id references stay valid as Directus files.

export type MkTemplateLevel = 'structure' | 'meta_campaign' | 'ad_set' | 'ad';

export type MkAdSnapshot = {
  name?: string | null;
  body?: string | null;
  title?: string | null;
  description?: string | null;
  link_url?: string | null;
  call_to_action?: string | null;
  image_id?: string | null;
};

export type MkAdSetSnapshot = {
  name?: string | null;
  optimization_goal?: string | null;
  billing_event?: string | null;
  budget_mode?: string;
  budget_amount?: number | string | null;
  targeting?: MkTargeting | null;
  ads: MkAdSnapshot[];
};

export type MkMetaCampaignSnapshot = {
  name?: string | null;
  objective?: string | null;
  buying_type?: string | null;
  budget_mode?: string;
  budget_amount?: number | string | null;
  adSets: MkAdSetSnapshot[];
};

export type MkStructureSnapshot = { metaCampaigns: MkMetaCampaignSnapshot[] };

export type MkTemplatePayload =
  | MkStructureSnapshot
  | MkMetaCampaignSnapshot
  | MkAdSetSnapshot
  | MkAdSnapshot;

export type MkTemplate = {
  id: number;
  name?: string | null;
  level?: MkTemplateLevel | string;
  payload?: MkTemplatePayload | null;
  date_created?: string | null;
  date_updated?: string | null;
};

export async function listMkTemplates(): Promise<MkTemplate[]> {
  return repo.list<MkTemplate>('mk_template', { sort: ['name'], limit: -1 });
}

export async function createMkTemplate(patch: Partial<MkTemplate>): Promise<MkTemplate> {
  return repo.create<MkTemplate>('mk_template', patch as Record<string, unknown>);
}

export async function deleteMkTemplate(id: number): Promise<void> {
  await repo.remove('mk_template', id);
}

// snapshot builders — strip ids/status/schedule, keep settings + creative

export function snapshotMkAd(ad: MkAd): MkAdSnapshot {
  return {
    name: ad.name,
    body: ad.body,
    title: ad.title,
    description: ad.description,
    link_url: ad.link_url,
    call_to_action: ad.call_to_action,
    image_id: ad.image_id
  };
}

export function snapshotMkAdSet(as: MkAdSet, ads: MkAd[]): MkAdSetSnapshot {
  return {
    name: as.name,
    optimization_goal: as.optimization_goal,
    billing_event: as.billing_event,
    budget_mode: as.budget_mode,
    budget_amount: as.budget_amount,
    targeting: as.targeting,
    ads: ads.filter((a) => Number(a.mk_ad_set_id) === as.id).map(snapshotMkAd)
  };
}

export function snapshotMkMetaCampaign(
  mc: MkMetaCampaign,
  adSets: MkAdSet[],
  ads: MkAd[]
): MkMetaCampaignSnapshot {
  return {
    name: mc.name,
    objective: mc.objective,
    buying_type: mc.buying_type,
    budget_mode: mc.budget_mode,
    budget_amount: mc.budget_amount,
    adSets: adSets
      .filter((a) => Number(a.mk_meta_campaign_id) === mc.id)
      .map((a) => snapshotMkAdSet(a, ads))
  };
}

// instantiation — create real records from a snapshot under a parent.
// Everything lands PAUSED; schedules are deliberately not part of a
// template (they're campaign-specific).

export async function instantiateMkAd(snapshot: MkAdSnapshot, adSetId: number): Promise<MkAd> {
  return createMkAd({
    mk_ad_set_id: adSetId,
    status: 'PAUSED',
    name: snapshot.name,
    body: snapshot.body,
    title: snapshot.title,
    description: snapshot.description,
    link_url: snapshot.link_url,
    call_to_action: snapshot.call_to_action,
    image_id: snapshot.image_id
  });
}

export async function instantiateMkAdSet(
  snapshot: MkAdSetSnapshot,
  metaCampaignId: number
): Promise<{ adSet: MkAdSet; ads: MkAd[] }> {
  const adSet = await createMkAdSet({
    mk_meta_campaign_id: metaCampaignId,
    status: 'PAUSED',
    name: snapshot.name,
    optimization_goal: snapshot.optimization_goal,
    billing_event: snapshot.billing_event,
    budget_mode: snapshot.budget_mode,
    budget_amount: snapshot.budget_amount,
    targeting: snapshot.targeting
  });
  const ads: MkAd[] = [];
  for (const a of snapshot.ads ?? []) ads.push(await instantiateMkAd(a, adSet.id));
  return { adSet, ads };
}

export async function instantiateMkMetaCampaign(
  snapshot: MkMetaCampaignSnapshot,
  campaignId: number
): Promise<{ metaCampaign: MkMetaCampaign; adSets: MkAdSet[]; ads: MkAd[] }> {
  const metaCampaign = await createMkMetaCampaign({
    mk_campaign_id: campaignId,
    status: 'PAUSED',
    name: snapshot.name,
    objective: snapshot.objective,
    buying_type: snapshot.buying_type,
    budget_mode: snapshot.budget_mode,
    budget_amount: snapshot.budget_amount
  });
  const adSets: MkAdSet[] = [];
  const ads: MkAd[] = [];
  for (const s of snapshot.adSets ?? []) {
    const r = await instantiateMkAdSet(s, metaCampaign.id);
    adSets.push(r.adSet);
    ads.push(...r.ads);
  }
  return { metaCampaign, adSets, ads };
}

export async function instantiateMkStructure(
  snapshot: MkStructureSnapshot,
  campaignId: number
): Promise<{ metaCampaigns: MkMetaCampaign[]; adSets: MkAdSet[]; ads: MkAd[] }> {
  const metaCampaigns: MkMetaCampaign[] = [];
  const adSets: MkAdSet[] = [];
  const ads: MkAd[] = [];
  for (const s of snapshot.metaCampaigns ?? []) {
    const r = await instantiateMkMetaCampaign(s, campaignId);
    metaCampaigns.push(r.metaCampaign);
    adSets.push(...r.adSets);
    ads.push(...r.ads);
  }
  return { metaCampaigns, adSets, ads };
}


// Project brand segment — moved to $lib/data/projectBrand.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
