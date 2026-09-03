#!/usr/bin/env node
// Convert Grant.funder_label (free text) into Grant.funder_org_id
// (M2O → organization). For every Grant with a funder_label set:
//   1. Look up an org whose name matches (case-insensitive).
//   2. If none exists, create one (sourced from the funder_label,
//      lifecycle_status = active so it surfaces in the org list).
//   3. Set the grant's funder_org_id to that org.
//
// Idempotent. Pass --dry-run to print actions only.
//
//   node scripts/backfill-grant-funders.mjs
//   node scripts/backfill-grant-funders.mjs --dry-run

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function loadEnv() {
  const envPath = path.join(repoRoot, process.env.TWIN_ENV_FILE || '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}
loadEnv();
const BASE = process.env.PUBLIC_DIRECTUS_URL;
const TOKEN = process.env.PUBLIC_DIRECTUS_TOKEN;
if (!BASE || !TOKEN) { console.error('Need PUBLIC_DIRECTUS_URL + PUBLIC_DIRECTUS_TOKEN.'); process.exit(1); }
const DRY = process.argv.includes('--dry-run');
const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function findOrgByName(name) {
  const url = `${BASE}/items/organization?limit=1&fields=id,name&filter[name][_iexact]=${encodeURIComponent(name)}`;
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) return null;
  const j = await r.json();
  return (j.data ?? [])[0] ?? null;
}

async function findOrgFuzzy(name) {
  // First try iexact, then fall back to icontains so "Rannís" / "RANNIS"
  // / "Rannis" all resolve. Limits to 5 to keep the choice tight.
  const exact = await findOrgByName(name);
  if (exact) return exact;
  const url = `${BASE}/items/organization?limit=5&fields=id,name&filter[name][_icontains]=${encodeURIComponent(name)}`;
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) return null;
  const j = await r.json();
  return (j.data ?? [])[0] ?? null;
}

async function createOrg(name) {
  if (DRY) { console.log(`  (would create org: ${name})`); return { id: -1, name }; }
  const r = await fetch(`${BASE}/items/organization`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ name, status: 'published', is_active: true, lifecycle_status: 'active' })
  });
  if (!r.ok) throw new Error(`create org "${name}": ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.data;
}

async function patchGrant(id, payload) {
  if (DRY) return;
  const r = await fetch(`${BASE}/items/Grant/${id}`, { method: 'PATCH', headers: HEADERS, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(`patch Grant ${id}: ${r.status} ${await r.text()}`);
}

async function main() {
  console.log('▶ Backfilling Grant.funder_org_id from funder_label…');
  const r = await fetch(`${BASE}/items/Grant?limit=-1&fields=id,name,funder_label,funder_org_id`, { headers: HEADERS });
  if (!r.ok) { console.error(`list grants: ${r.status}`); process.exit(1); }
  const grants = (await r.json()).data ?? [];

  // Cache so we don't create the same funder org twice within a run.
  const cache = new Map();

  let touched = 0, created = 0, skipped = 0;
  for (const g of grants) {
    if (g.funder_org_id) { skipped++; continue; }
    const label = (g.funder_label ?? '').trim();
    if (!label) { skipped++; continue; }
    let org = cache.get(label.toLowerCase());
    if (!org) {
      org = await findOrgFuzzy(label);
      if (!org) {
        console.log(`  · create funder org: ${label}`);
        org = await createOrg(label);
        created++;
      }
      cache.set(label.toLowerCase(), org);
    }
    console.log(`  · ${g.name} → funder_org_id = ${org.name} (#${org.id})`);
    await patchGrant(g.id, { funder_org_id: org.id });
    touched++;
  }
  console.log(`\nDone. Touched ${touched} grants, created ${created} funder org(s), skipped ${skipped}.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
