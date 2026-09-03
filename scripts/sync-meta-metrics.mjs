#!/usr/bin/env node
// Meta insights sync — account-driven, every campaign mirrored.
// Walks each ad account linked to a project and:
//   1. finds/creates an umbrella mk_campaign to anchor the account,
//   2. pulls daily campaign insights from the Graph API (through the
//      "Meta Graph proxy" Flow, which holds the token),
//   3. creates a first-class mk_meta_campaign row for every campaign
//      that has data — attributed to the account's project by default
//      (override per campaign in twin) and stamped with objective/status,
//   4. upserts the daily numbers into mk_metric,
//   5. mirrors the same window split by age+gender, platform, placement
//      and region into mk_metric_breakdown — so those splits can be
//      trended, rolled up and shown on a project dashboard instead of
//      being fetched live by one page.
// Every campaign that delivered in the window becomes browsable +
// reportable in twin. Read-only on Meta; writes only twin's own rows.
//
//   node scripts/sync-meta-metrics.mjs                # nightly: last 30 days
//   node scripts/sync-meta-metrics.mjs --months 37    # full backfill (Meta max)
//   node scripts/sync-meta-metrics.mjs --days 7       # custom short window
//   node scripts/sync-meta-metrics.mjs --no-breakdowns
//   node scripts/sync-meta-metrics.mjs --dims age_gender,platform
//
// Re-running is safe: campaigns/metrics dedupe on (account, meta_id,
// date); attribution you set in twin (project_id) is never overwritten.
//
// Breakdown rows are a MIRROR, not a record: each (umbrella, dimension,
// window) slice is replaced wholesale. The fresh numbers are fetched
// before anything is deleted, so a Graph failure costs nothing. Skipped
// with a notice when add-marketing-breakdowns.sh hasn't been applied.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const env = Object.fromEntries(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', process.env.TWIN_ENV_FILE || '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const URL_BASE = (env.DIRECTUS_ADMIN_URL || env.PUBLIC_DIRECTUS_URL || '').replace(/\/$/, '');
const TOKEN = env.PUBLIC_DIRECTUS_TOKEN;
const META_FLOW = '772c6572-07ba-40d3-ad3a-9c528268611a'; // Meta Graph proxy
const agent = new https.Agent({ rejectUnauthorized: false }); // self-signed tailnet cert

// Window: --months M (capped at Meta's 37-month limit) wins, else
// --days N, else 30 days.
const today = new Date();
const until = today.toISOString().slice(0, 10);
const monthsArg = process.argv.indexOf('--months');
const daysArg = process.argv.indexOf('--days');
const sinceDate = new Date(today);
let windowLabel;
if (monthsArg >= 0) {
  const m = Math.min(37, Math.max(1, Number(process.argv[monthsArg + 1]) || 37));
  sinceDate.setMonth(sinceDate.getMonth() - m);
  windowLabel = `${m}mo`;
} else {
  const d = daysArg >= 0 ? Math.max(1, Number(process.argv[daysArg + 1]) || 30) : 30;
  sinceDate.setDate(sinceDate.getDate() - (d - 1));
  windowLabel = `${d}d`;
}
const since = sinceDate.toISOString().slice(0, 10);

// ── Breakdown dimensions ─────────────────────────────────────────────
// `key` builds the stored dim_key; `medium` (where the split implies one)
// maps onto the mk_medium vocabulary so spend reports by medium across
// paid and manual alike. No `reach` anywhere below: Meta does not return
// it with most breakdowns.
const DIMS = {
  age_gender: {
    breakdowns: 'age,gender',
    key: (r) => `${r.age ?? '?'} · ${r.gender ?? '?'}`
  },
  platform: {
    breakdowns: 'publisher_platform',
    key: (r) => r.publisher_platform ?? '—',
    medium: (r) => mediumFor(r.publisher_platform)
  },
  placement: {
    breakdowns: 'publisher_platform,platform_position',
    key: (r) => `${r.publisher_platform ?? '—'} · ${r.platform_position ?? '—'}`,
    medium: (r) => mediumFor(r.publisher_platform)
  },
  region: {
    breakdowns: 'region',
    key: (r) => r.region ?? '—'
  }
};

const dimsArg = process.argv.indexOf('--dims');
let dims = Object.keys(DIMS);
if (dimsArg >= 0) {
  const asked = (process.argv[dimsArg + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = asked.filter((d) => !DIMS[d]);
  if (asked.length === 0 || unknown.length > 0) {
    console.error(`--dims: unknown ${unknown.join(', ') || '(empty)'} — pick from ${Object.keys(DIMS).join(', ')}`);
    process.exit(1);
  }
  dims = asked;
}
let doBreakdowns = !process.argv.includes('--no-breakdowns');

async function api(path, opts = {}) {
  const res = await fetch(`${URL_BASE}${path}`, {
    ...opts,
    // @ts-expect-error node fetch dispatcher
    agent,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) }
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

// One Graph GET through the proxy (token injected server-side).
async function graph(path) {
  const wrap = await api(`/flows/trigger/${META_FLOW}`, {
    method: 'POST',
    headers: { Authorization: '' },
    body: JSON.stringify({ method: 'GET', path })
  });
  const payload = wrap?.data ?? wrap;
  if (payload?.error?.message) throw new Error(payload.error.message);
  return payload;
}

// Page through any Graph edge (cursor-based).
async function graphAll(buildPath) {
  const out = [];
  let after;
  for (let page = 0; page < 60; page++) {
    const resp = await graph(buildPath(after));
    if (Array.isArray(resp?.data)) out.push(...resp.data);
    if (!resp?.paging?.next || !resp?.paging?.cursors?.after) break;
    after = resp.paging.cursors.after;
  }
  return out;
}

const tr = encodeURIComponent(JSON.stringify({ since, until }));
function accountInsights(accountId) {
  const act = String(accountId).startsWith('act_') ? accountId : `act_${accountId}`;
  const fields = 'campaign_id,campaign_name,spend,impressions,reach,clicks,inline_link_clicks,actions';
  return graphAll(
    (after) =>
      `${act}/insights?level=campaign&time_increment=1&fields=${fields}&time_range=${tr}&limit=500${after ? `&after=${encodeURIComponent(after)}` : ''}`
  );
}
// Campaign level, split by one set of breakdowns, over one chunk of the window.
function accountBreakdown(accountId, breakdowns, win) {
  const act = String(accountId).startsWith('act_') ? accountId : `act_${accountId}`;
  const fields = 'campaign_id,campaign_name,spend,impressions,clicks,inline_link_clicks,actions';
  const range = encodeURIComponent(JSON.stringify({ since: win.since, until: win.until }));
  return graphAll(
    (after) =>
      `${act}/insights?level=campaign&time_increment=1&fields=${fields}&breakdowns=${encodeURIComponent(breakdowns)}&time_range=${range}&limit=500${after ? `&after=${encodeURIComponent(after)}` : ''}`
  );
}
// Campaign metadata (objective/status), best-effort — keyed by id.
async function campaignMeta(accountId) {
  const act = String(accountId).startsWith('act_') ? accountId : `act_${accountId}`;
  const rows = await graphAll(
    (after) =>
      `${act}/campaigns?fields=id,name,objective,status&limit=200${after ? `&after=${encodeURIComponent(after)}` : ''}`
  );
  return new Map(rows.map((r) => [r.id, r]));
}

const num = (v) => (v ? Number(v) || 0 : 0);
// Which Meta action counts as "a result", falling back to link clicks.
// Shared by the plain rows and the breakdown rows so both agree.
function resultOf(r) {
  const action = (r.actions ?? []).find((a) =>
    /purchase|lead|complete_registration|subscribe|link_click/.test(a.action_type)
  );
  return {
    results: action ? num(action.value) : num(r.inline_link_clicks),
    result_type: action?.action_type ?? 'link_click'
  };
}
function normRow(r) {
  return {
    ref_id: r.campaign_id ?? '',
    ref_name: r.campaign_name ?? '',
    date: r.date_start ?? '',
    spend: num(r.spend),
    impressions: num(r.impressions),
    reach: num(r.reach),
    clicks: num(r.clicks),
    ...resultOf(r)
  };
}

// publisher_platform → mk_medium code, from the vocabulary itself, so a
// new platform is a row in mk_medium rather than an edit here.
let mediumByPlatform = new Map();
function mediumFor(platform) {
  if (!platform) return 'meta_other';
  return mediumByPlatform.get(String(platform).toLowerCase()) ?? 'meta_other';
}

// Meta will not serve a year of age×gender in one request — that breakdown's
// cross product is an order of magnitude bigger than the others, and the Graph
// API answers "An unknown error occurred" rather than paging it. So breakdowns
// are fetched in windows, and each window is replaced on its own: a chunk that
// fails costs its own days, not the whole backfill.
const CHUNK_DAYS = 90;
function chunkWindows(fromISO, toISO, days = CHUNK_DAYS) {
  const out = [];
  const end = new Date(`${toISO}T00:00:00Z`);
  let cursor = new Date(`${fromISO}T00:00:00Z`);
  while (cursor <= end) {
    const stop = new Date(cursor);
    stop.setUTCDate(stop.getUTCDate() + days - 1);
    out.push({
      since: cursor.toISOString().slice(0, 10),
      until: (stop < end ? stop : end).toISOString().slice(0, 10)
    });
    cursor = new Date(stop);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** Replace one (umbrella, dimension, window) slice. Rows are already in
 *  hand when this is called — the delete cannot outlive a failed fetch. */
async function replaceSlice(umbrellaId, dimension, rows, from = since, to = until) {
  const stale = (
    await api(
      `/items/mk_metric_breakdown?filter[mk_campaign_id][_eq]=${umbrellaId}` +
        `&filter[dimension][_eq]=${dimension}` +
        `&filter[date][_gte]=${from}&filter[date][_lte]=${to}&fields=id&limit=-1`
    )
  ).data;
  for (let i = 0; i < stale.length; i += 200) {
    await api('/items/mk_metric_breakdown', {
      method: 'DELETE',
      body: JSON.stringify(stale.slice(i, i + 200).map((r) => r.id))
    });
  }
  for (let i = 0; i < rows.length; i += 200) {
    await api('/items/mk_metric_breakdown', {
      method: 'POST',
      body: JSON.stringify(rows.slice(i, i + 200))
    });
  }
  return rows.length;
}

const nameKey = (m) => `meta_campaign|${(m.ref_name ?? '').trim().toLowerCase()}|${(m.date ?? '').slice(0, 10)}`;
const idKey = (m) => (m.ref_id ? `meta_campaign|id:${m.ref_id}|${(m.date ?? '').slice(0, 10)}` : nameKey(m));

async function processAccount(acct) {
  const accountId = acct.id;
  const projectId = typeof acct.project_id === 'object' ? acct.project_id?.id : acct.project_id;

  // 1 · insights first — a token that can't read the account throws here
  // (Graph #200) and we skip without provisioning anything.
  const report = (await accountInsights(accountId)).map(normRow);
  if (report.length === 0) return { account: acct.name, created: 0, written: 0, skipped: 'no data / no access' };

  // 2 · umbrella to anchor the account's campaigns
  let umbrella = (
    await api(
      `/items/mk_campaign?filter[ad_account_id][_eq]=${accountId}&filter[status][_neq]=archived&fields=id,name&limit=1`
    )
  ).data[0];
  if (!umbrella) {
    umbrella = (
      await api('/items/mk_campaign', {
        method: 'POST',
        body: JSON.stringify({
          name: acct.name || `Account ${accountId}`,
          status: 'live',
          currency: acct.currency || 'ISK',
          ad_account_id: accountId,
          project_id: projectId ?? null
        })
      })
    ).data;
    console.log(`  + umbrella "${umbrella.name}" (campaign ${umbrella.id})`);
  }

  // 3 · ensure a first-class mk_meta_campaign per delivering campaign
  const meta = await campaignMeta(accountId).catch(() => new Map());
  const structure = (
    await api(
      `/items/mk_meta_campaign?filter[mk_campaign_id][_eq]=${umbrella.id}&fields=id,name,meta_id,project_id,ad_account_id&limit=-1`
    )
  ).data;
  const byMetaId = new Map(structure.filter((m) => m.meta_id).map((m) => [String(m.meta_id), m]));
  const seen = new Map();
  for (const r of report) if (r.ref_id) seen.set(r.ref_id, r.ref_name);
  let created = 0;
  for (const [metaId, name] of seen) {
    const md = meta.get(metaId);
    const existing = byMetaId.get(metaId);
    if (!existing) {
      const mc = (
        await api('/items/mk_meta_campaign', {
          method: 'POST',
          body: JSON.stringify({
            mk_campaign_id: umbrella.id,
            name: md?.name || name || 'Untitled campaign',
            meta_id: metaId,
            objective: md?.objective ?? null,
            status: md?.status ?? null,
            ad_account_id: accountId,
            project_id: projectId ?? null // default attribution; user can override
          })
        })
      ).data;
      byMetaId.set(metaId, mc);
      created++;
    } else {
      // Backfill account + default project (never clobber a manual
      // project choice) and refresh status.
      const patch = {};
      if (!existing.ad_account_id) patch.ad_account_id = accountId;
      if (existing.project_id == null && projectId != null) patch.project_id = projectId;
      if (md?.status) patch.status = md.status;
      if (Object.keys(patch).length)
        await api(`/items/mk_meta_campaign/${existing.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    }
  }

  // 4 · upsert daily metrics
  const inputs = report.map((r) => ({
    level: 'meta_campaign',
    ref_name: byMetaId.get(r.ref_id)?.name ?? r.ref_name,
    ref_id: r.ref_id || null,
    date: r.date,
    spend: r.spend,
    impressions: r.impressions,
    reach: r.reach,
    clicks: r.clicks,
    results: r.results,
    result_type: r.result_type,
    source: 'meta'
  }));
  const existing = (
    await api(`/items/mk_metric?filter[mk_campaign_id][_eq]=${umbrella.id}&fields=id,level,ref_name,ref_id,date&limit=-1`)
  ).data;
  const byKey = new Map(existing.map((m) => [idKey(m), m]));
  let written = 0;
  for (const row of inputs) {
    const hit = byKey.get(idKey(row)) ?? (row.ref_id ? byKey.get(nameKey(row)) : undefined);
    const payload = JSON.stringify({ ...row, mk_campaign_id: umbrella.id });
    if (hit) await api(`/items/mk_metric/${hit.id}`, { method: 'PATCH', body: payload });
    else await api('/items/mk_metric', { method: 'POST', body: payload });
    written++;
  }

  // 5 · mirror the breakdowns. One Graph call per dimension per WINDOW CHUNK
  // per account (level=campaign), not per campaign — a 5-campaign account
  // costs 4 calls a chunk, not 20. A dimension or a chunk that errors is
  // skipped, not fatal: an age split Meta won't serve for one quarter must
  // cost that quarter, not the region split and not the other nine months.
  let broken = 0;
  if (doBreakdowns) {
    const windows = chunkWindows(since, until);
    for (const dim of dims) {
      const cfg = DIMS[dim];
      for (const win of windows) {
        try {
          const raw = await accountBreakdown(accountId, cfg.breakdowns, win);
          const rows = [];
          for (const r of raw) {
            const spend = num(r.spend);
            const impressions = num(r.impressions);
            const clicks = num(r.clicks);
            // Meta returns a row for every combination it considered,
            // including the ones it never spent on. Storing those would
            // bury the real numbers in zeroes.
            if (spend === 0 && impressions === 0 && clicks === 0) continue;
            const mc = r.campaign_id ? byMetaId.get(String(r.campaign_id)) : undefined;
            rows.push({
              mk_campaign_id: umbrella.id,
              level: 'meta_campaign',
              ref_id: r.campaign_id ?? null,
              ref_name: mc?.name ?? r.campaign_name ?? null,
              date: r.date_start ?? null,
              dimension: dim,
              dim_key: cfg.key(r),
              medium: cfg.medium ? cfg.medium(r) : null,
              project_id: mc?.project_id ?? projectId ?? null,
              spend,
              impressions,
              clicks,
              ...resultOf(r),
              source: 'meta'
            });
          }
          broken += await replaceSlice(umbrella.id, dim, rows, win.since, win.until);
        } catch (e) {
          console.error(`    ✗ ${acct.name} · ${dim} · ${win.since}→${win.until}: ${e.message}`);
        }
      }
    }
  }

  return { account: acct.name, created, written, broken };
}

// ── Run ──────────────────────────────────────────────────────────────
console.log(`Meta metrics sync · ${since} → ${until} (${windowLabel})`);

// Breakdowns are optional machinery: run before the schema script and the
// sync still does its original job, with one line saying what it skipped.
if (doBreakdowns) {
  const res = await fetch(`${URL_BASE}/collections/mk_metric_breakdown`, {
    // @ts-expect-error node fetch dispatcher
    agent,
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  if (!res.ok) {
    doBreakdowns = false;
    console.log('  breakdowns off — mk_metric_breakdown missing (run scripts/add-marketing-breakdowns.sh).');
  } else {
    mediumByPlatform = new Map(
      (
        await api('/items/mk_medium?filter[meta_platform][_nnull]=true&fields=code,meta_platform&limit=-1').catch(
          () => ({ data: [] })
        )
      ).data.map((m) => [String(m.meta_platform).toLowerCase(), m.code])
    );
    if (mediumByPlatform.size === 0)
      console.log('  note: no mk_medium rows map a meta_platform — platform rows will all read meta_other.');
    console.log(`  breakdowns: ${dims.join(', ')}`);
  }
}

const accounts = (
  await api('/items/mk_ad_account?filter[project_id][_nnull]=true&fields=id,name,currency,project_id,is_enabled&limit=-1')
).data.filter((a) => a.is_enabled !== false);
console.log(`${accounts.length} linked ad account(s).`);

let totalWritten = 0;
let totalCreated = 0;
let totalBroken = 0;
for (const a of accounts) {
  try {
    const r = await processAccount(a);
    totalWritten += r.written;
    totalCreated += r.created;
    totalBroken += r.broken ?? 0;
    console.log(
      `  • ${r.account}: ${r.written} rows${r.broken ? `, ${r.broken} breakdown rows` : ''}${r.created ? `, ${r.created} new campaign(s)` : ''}${r.skipped ? ` (skipped — ${r.skipped})` : ''}`
    );
  } catch (e) {
    console.error(`  ✗ ${a.name}: ${e.message}`);
  }
}
console.log(
  `Done — ${totalCreated} campaigns, ${totalWritten} metric rows upserted${doBreakdowns ? `, ${totalBroken} breakdown rows mirrored` : ''}.`
);
