#!/usr/bin/env node
// Seed event_platform_link from existing klak.is imports. Each twin
// event imported from klak.is carries external_ref "klak:<wpId>" and a
// source_url; this creates the matching platform='wordpress' link row
// (status 'publish' — imported events are live on klak.is) so the
// WordPress push dedups against it instead of re-creating posts.
//
//   node scripts/backfill-event-platform-links.mjs            # dry run
//   node scripts/backfill-event-platform-links.mjs --commit
//
// Idempotent: skips events that already have a wordpress link.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const COMMIT = process.argv.includes('--commit');
const env = Object.fromEntries(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', process.env.TWIN_ENV_FILE || '.env'), 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const DIRECTUS = env.PUBLIC_DIRECTUS_URL.replace(/\/$/, '');
const TOKEN = env.PUBLIC_DIRECTUS_TOKEN;
const agent = new https.Agent({ rejectUnauthorized: false });

async function dx(path, opts = {}) {
  const res = await fetch(`${DIRECTUS}${path}`, {
    ...opts, agent,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) }
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body?.data;
}

const events = await dx('/items/event?fields=id,name,external_ref,source_url&filter[external_ref][_starts_with]=klak:&limit=-1');
const existing = await dx('/items/event_platform_link?fields=event_id,platform&filter[platform][_eq]=wordpress&limit=-1');
const have = new Set(existing.map((r) => r.event_id));

const now = new Date().toISOString();
let made = 0, skip = 0;
for (const e of events) {
  if (have.has(e.id)) { skip++; continue; }
  const wpId = e.external_ref.slice('klak:'.length);
  const row = { event_id: e.id, platform: 'wordpress', external_id: wpId, url: e.source_url ?? null, status: 'publish', synced_at: now };
  console.log(`  ${COMMIT ? '+' : '·'} event ${e.id} "${e.name}" → wordpress:${wpId}`);
  if (COMMIT) { await dx('/items/event_platform_link', { method: 'POST', body: JSON.stringify(row) }); made++; }
}
console.log(COMMIT ? `✓ ${made} link(s) created, ${skip} already linked.` : `Dry run — ${events.length - skip} would seed (${skip} already linked). Re-run with --commit.`);
