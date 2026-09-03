// Meta (Graph API) integration
//
// Ad accounts, campaigns and metric pulls from the Graph API.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import { PUBLIC_DIRECTUS_URL } from '$env/static/public';
import type { Project } from '$lib/data/types';

// ── Meta (Graph API) integration ─────────────────────────────────────
// twin publishes to Facebook Pages + Instagram and pulls ad reports
// straight from Meta through a Directus Flow ("Meta Graph proxy") that
// holds a System User token (expiration: never) server-side — same
// shape as the Buffer proxy above. The browser never sees the token;
// graph.facebook.com's CORS never applies.
//
// The proxy is deliberately *thin*: a single Web Request operation that
// forwards { method, path } to https://graph.facebook.com/<ver>/<path>
// with the System User token injected as an Authorization header. ALL
// the multi-step logic (page lookup, IG's create-container-then-publish
// dance, insight shaping) lives here in twin and rides on top of the
// passthrough — so the Flow stays a one-operation copy/paste and the
// token is appended only server-side. (Directus' Run Script sandbox has
// no network access, which is why this is a Web Request, not a script.)
//
// Set META_FLOW_ID to the Flow's id once it exists; the empty
// placeholder makes every call throw a clear "not wired yet" error.
// The exact Flow setup is shown in twin under Settings → Meta.
const META_FLOW_ID = ''; // ← Directus Flow id for the "Meta Graph proxy"
const META_GRAPH_VERSION = 'v21.0';

export type MetaChannelKind = 'facebook_page' | 'instagram';
export type MetaChannel = {
  id: string;
  name?: string | null;
  kind?: MetaChannelKind | string | null;
  page_id?: string | null;
  ig_user_id?: string | null;
  username?: string | null;
  category?: string | null;
  avatar?: string | null;
  is_enabled?: boolean | null;
  project_id?: number | Project | null;
  date_synced?: string | null;
};

/** Is the Meta proxy wired up yet? UI uses this to show setup vs ready. */
export function metaConfigured(): boolean {
  return META_FLOW_ID.length > 0;
}

/** Build a `path?query` string with params encoded (skips null/undefined). */
// Exported because code still in directus.ts reads it.
export function metaQuery(path: string, params?: Record<string, string | number | boolean | null | undefined>): string {
  if (!params) return path;
  const qs = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  if (!qs) return path;
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

/** Low-level: forward one Graph request through the proxy flow and
 *  return Meta's JSON. Throws with Meta's own error message on failure.
 *  All query params should already be baked into `path` via metaQuery. */
// Exported because code still in directus.ts reads it.
export async function metaGraph<T = unknown>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string
): Promise<T> {
  if (!META_FLOW_ID) {
    throw new Error(
      'Meta isn’t connected yet — create the "Meta Graph proxy" Flow (see Settings → Meta) and set META_FLOW_ID in src/lib/directus.ts.'
    );
  }
  const res = await fetch(`${PUBLIC_DIRECTUS_URL}/flows/trigger/${META_FLOW_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, path })
  });
  const wrapper = (await res.json().catch(() => null)) as
    | ({ status?: number; data?: unknown } & Record<string, unknown>)
    | null;
  if (!wrapper) throw new Error('Meta proxy returned an unreadable response');
  // The flow forwards Graph's body through; Graph errors surface as
  // { error: { message, code } } regardless of HTTP shaping.
  const payload = (wrapper.data ?? wrapper) as { error?: { message?: string; code?: number } } & Record<string, unknown>;
  const status = (wrapper.status as number | undefined) ?? res.status;
  if (payload?.error?.message) {
    if (payload.error.code === 190 || status === 401 || status === 403) {
      throw new Error('Meta rejected the token — refresh the System User token in the "Meta Graph proxy" Flow.');
    }
    throw new Error(payload.error.message);
  }
  if (status < 200 || status >= 300) {
    throw new Error(`Meta proxy HTTP ${status}`);
  }
  return payload as T;
}

/** Follow Graph cursor paging and return every row across an edge.
 *  Capped at 20 pages so a runaway never hammers the proxy. */
// Exported because code still in directus.ts reads it.
export async function metaGraphAll<T>(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>
): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const resp = await metaGraph<{
      data?: T[];
      paging?: { next?: string; cursors?: { after?: string } };
    }>('GET', metaQuery(path, { limit: 200, ...params, after }));
    if (resp.data?.length) out.push(...resp.data);
    if (!resp.paging?.next || !resp.paging.cursors?.after) break;
    after = resp.paging.cursors.after;
  }
  return out;
}

/** Publishing targets, org link expanded for display. */
export async function listMetaChannels(): Promise<MetaChannel[]> {
  return repo.list<MetaChannel>('meta_channel', {
    fields: ['*', { project_id: ['id', 'name'] }],
    sort: ['kind', 'name'],
    limit: -1
  });
}

export async function updateMetaChannel(id: string, patch: Partial<MetaChannel>): Promise<MetaChannel> {
  return repo.update<MetaChannel>('meta_channel', id, patch as Record<string, unknown>);
}

type GraphPage = {
  id: string;
  name?: string;
  category?: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
};

/** Pull the Pages + Instagram accounts the System User can reach and
 *  upsert them into meta_channel (preserving the org link + is_enabled
 *  on rows that already exist). Returns the synced rows. */
export async function syncMetaChannels(): Promise<MetaChannel[]> {
  const path = metaQuery('me/accounts', {
    fields:
      'id,name,category,picture.type(large){url},instagram_business_account{id,username,profile_picture_url}',
    limit: 100
  });
  const resp = await metaGraph<{ data?: GraphPage[] }>('GET', path);
  const pages = resp.data ?? [];

  // Flatten pages → one row per Facebook Page, plus one per linked IG.
  const rows: Partial<MetaChannel>[] = [];
  for (const p of pages) {
    rows.push({
      id: p.id,
      name: p.name ?? p.id,
      kind: 'facebook_page',
      page_id: p.id,
      category: p.category ?? null,
      avatar: p.picture?.data?.url ?? null
    });
    const ig = p.instagram_business_account;
    if (ig?.id) {
      rows.push({
        id: ig.id,
        name: ig.username ? `@${ig.username}` : p.name ?? ig.id,
        kind: 'instagram',
        page_id: p.id,
        ig_user_id: ig.id,
        username: ig.username ?? null,
        avatar: ig.profile_picture_url ?? null
      });
    }
  }

  const existing = await listMetaChannels();
  const byId = new Map(existing.map((c) => [c.id, c]));
  const now = new Date().toISOString();
  for (const row of rows) {
    const id = row.id as string;
    if (byId.has(id)) {
      // Preserve org link + is_enabled; refresh the synced fields.
      const { id: _omit, ...fields } = row;
      void _omit;
      await repo.update('meta_channel', id, { ...fields, date_synced: now } as Record<string, unknown>);
    } else {
      await repo.create('meta_channel', {
        ...row,
        is_enabled: true,
        date_synced: now
      } as Record<string, unknown>);
    }
  }
  return listMetaChannels();
}

export type MetaPublishInput = {
  channel: MetaChannel;
  /** FB: post body / IG: caption. */
  text: string;
  /** Public image URL (required for Instagram). Use publicAssetUrl(). */
  imageUrl?: string | null;
  /** FB link attachment (ignored for IG). */
  linkUrl?: string | null;
};

/** Publish straight to Meta. Returns the created post/media id.
 *  FB: text → {page}/feed, or photo → {page}/photos when an image is
 *  given. IG: the two-step create-container → media_publish dance. */
export async function publishToMeta(input: MetaPublishInput): Promise<{ id: string }> {
  const { channel, text, imageUrl, linkUrl } = input;

  if (channel.kind === 'instagram') {
    const igId = channel.ig_user_id || channel.id;
    if (!imageUrl) throw new Error('Instagram posts need an image.');
    const container = await metaGraph<{ id: string }>(
      'POST',
      metaQuery(`${igId}/media`, { image_url: imageUrl, caption: text })
    );
    return metaGraph<{ id: string }>(
      'POST',
      metaQuery(`${igId}/media_publish`, { creation_id: container.id })
    );
  }

  const pageId = channel.page_id || channel.id;
  if (imageUrl) {
    return metaGraph<{ id: string; post_id?: string }>(
      'POST',
      metaQuery(`${pageId}/photos`, { url: imageUrl, caption: text })
    );
  }
  return metaGraph<{ id: string }>(
    'POST',
    metaQuery(`${pageId}/feed`, { message: text, link: linkUrl ?? undefined })
  );
}

/** One row of Meta ad insights, normalised toward MkMetric. */
export type MetaAdReportRow = {
  ref_id: string;
  ref_name: string;
  level: 'campaign' | 'adset' | 'ad';
  date: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  results: number;
  result_type: string;
};

type GraphInsightRow = {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  date_start?: string;
  actions?: { action_type: string; value: string }[];
};

/** Pull daily ad insights for an ad account over a date range. The
 *  account id may be bare ("123…") or already prefixed ("act_123…"). */
export async function fetchMetaAdReport(opts: {
  accountId: string;
  since?: string;
  until?: string;
  level?: 'campaign' | 'adset' | 'ad';
}): Promise<MetaAdReportRow[]> {
  const level = opts.level ?? 'campaign';
  const act = opts.accountId.startsWith('act_') ? opts.accountId : `act_${opts.accountId}`;
  const idField = level === 'campaign' ? 'campaign_id' : level === 'adset' ? 'adset_id' : 'ad_id';
  const nameField = level === 'campaign' ? 'campaign_name' : level === 'adset' ? 'adset_name' : 'ad_name';
  const params: Record<string, string | number> = {
    level,
    time_increment: 1,
    fields: `${idField},${nameField},spend,impressions,reach,clicks,inline_link_clicks,actions`,
    limit: 500
  };
  if (opts.since && opts.until) {
    params.time_range = JSON.stringify({ since: opts.since, until: opts.until });
  }
  const resp = await metaGraph<{ data?: GraphInsightRow[] }>('GET', metaQuery(`${act}/insights`, params));
  const num = (v: string | undefined) => (v ? Number(v) || 0 : 0);
  return (resp.data ?? []).map((r): MetaAdReportRow => {
    // "Results" on Meta is the optimised action; surface the first
    // meaningful conversion-ish action, else fall back to link clicks.
    const action = r.actions?.find((a) =>
      /purchase|lead|complete_registration|subscribe|link_click/.test(a.action_type)
    );
    return {
      ref_id: (r[idField as keyof GraphInsightRow] as string) ?? '',
      ref_name: (r[nameField as keyof GraphInsightRow] as string) ?? '',
      level,
      date: r.date_start ?? '',
      spend: num(r.spend),
      impressions: num(r.impressions),
      reach: num(r.reach),
      clicks: num(r.clicks),
      results: action ? num(action.value) : num(r.inline_link_clicks),
      result_type: action?.action_type ?? 'link_click'
    };
  });
}

/** One breakdown bucket of a campaign's insights (placement, age/gender,
 *  region, or an ad set / ad). */
export type MetaBreakdownRow = {
  key: string;
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
};

function pickResult(r: { actions?: { action_type: string; value: string }[]; inline_link_clicks?: string }): number {
  const a = (r.actions ?? []).find((x) => /purchase|lead|complete_registration|subscribe|link_click/.test(x.action_type));
  return a ? Number(a.value) || 0 : Number(r.inline_link_clicks ?? 0) || 0;
}

/** Live breakdown of one Meta campaign's insights by placement
 *  (publisher_platform), age+gender, or region. Queries the campaign
 *  node directly. Read-only; returns [] on any error (e.g. an account
 *  the token can't read). */
export async function fetchCampaignBreakdown(
  metaCampaignId: string,
  breakdown: 'publisher_platform' | 'age,gender' | 'region',
  opts: { since?: string; until?: string } = {}
): Promise<MetaBreakdownRow[]> {
  try {
    const params: Record<string, string | number> = {
      fields: 'spend,impressions,clicks,inline_link_clicks,actions',
      breakdowns: breakdown,
      limit: 500
    };
    if (opts.since && opts.until) params.time_range = JSON.stringify({ since: opts.since, until: opts.until });
    const resp = await metaGraph<{ data?: Record<string, string & { actions?: never }>[] }>(
      'GET',
      metaQuery(`${metaCampaignId}/insights`, params)
    );
    return (resp.data ?? []).map((r) => {
      const row = r as Record<string, string | undefined> & { actions?: { action_type: string; value: string }[] };
      const key =
        breakdown === 'publisher_platform'
          ? (row.publisher_platform ?? '—')
          : breakdown === 'age,gender'
            ? `${row.age ?? '?'} · ${row.gender ?? '?'}`
            : (row.region ?? '—');
      return {
        key: String(key),
        spend: Number(row.spend ?? 0) || 0,
        impressions: Number(row.impressions ?? 0) || 0,
        clicks: Number(row.clicks ?? 0) || 0,
        results: pickResult(row)
      };
    });
  } catch {
    return [];
  }
}

/** Per-ad-set or per-ad insights for one campaign (read-only, [] on error). */
export async function fetchCampaignSubLevel(
  metaCampaignId: string,
  level: 'adset' | 'ad',
  opts: { since?: string; until?: string } = {}
): Promise<MetaBreakdownRow[]> {
  try {
    const nameField = level === 'adset' ? 'adset_name' : 'ad_name';
    const params: Record<string, string | number> = {
      level,
      fields: `${nameField},spend,impressions,clicks,inline_link_clicks,actions`,
      limit: 200
    };
    if (opts.since && opts.until) params.time_range = JSON.stringify({ since: opts.since, until: opts.until });
    const resp = await metaGraph<{ data?: Record<string, string>[] }>(
      'GET',
      metaQuery(`${metaCampaignId}/insights`, params)
    );
    return (resp.data ?? []).map((r) => {
      const row = r as Record<string, string | undefined> & { actions?: { action_type: string; value: string }[] };
      return {
        key: String(row[nameField] ?? '—'),
        spend: Number(row.spend ?? 0) || 0,
        impressions: Number(row.impressions ?? 0) || 0,
        clicks: Number(row.clicks ?? 0) || 0,
        results: pickResult(row)
      };
    });
  } catch {
    return [];
  }
}
