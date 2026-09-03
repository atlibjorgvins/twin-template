#!/usr/bin/env node
// Seeds the ProjectRole catalogue from existing junction rows.
//
// 1. Reads all Project_people.role_in_project + Project_organization.role_in_project.
// 2. Normalises each non-empty value into a `{ key, label, applies_to }` row.
//    - key: lower-case, snake-case (e.g. "Lead Teacher" → "lead_teacher")
//    - label: original casing preserved
//    - applies_to: "person" if only on Project_people, "org" if only on
//      Project_organization, "both" if it appears in both junctions.
// 3. Inserts those rows into ProjectRole, skipping ones whose `key`
//    is already present (idempotent — safe to re-run).
// 4. Patches the junction rows so their stored value matches the
//    normalised `key`. Optional — controlled by --normalize-keys.
//
// Usage:
//   node scripts/backfill-project-roles.mjs           # write
//   node scripts/backfill-project-roles.mjs --dry-run # print only
//   node scripts/backfill-project-roles.mjs --normalize-keys
//     # additionally rewrite the junction rows so role_in_project
//     # equals the canonical `key`. Default keeps the original
//     # string so nothing visually shifts under the user.

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
    if (!m) continue;
    if (process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}
loadEnv();
const BASE = process.env.PUBLIC_DIRECTUS_URL;
const TOKEN = process.env.PUBLIC_DIRECTUS_TOKEN;
if (!BASE || !TOKEN) { console.error('Need PUBLIC_DIRECTUS_URL + PUBLIC_DIRECTUS_TOKEN.'); process.exit(1); }
const DRY = process.argv.includes('--dry-run');
const NORMALIZE = process.argv.includes('--normalize-keys');

const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

function slugify(s) {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'role';
}

async function fetchAll(collection, fields) {
  const url = `${BASE}/items/${collection}?fields=${fields.join(',')}&limit=-1`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${collection} ${res.status}`);
  const json = await res.json();
  return json.data ?? [];
}

async function main() {
  console.log('▶ Reading existing junction rows…');
  const [pp, po, existing] = await Promise.all([
    fetchAll('Project_people', ['id', 'role_in_project']),
    fetchAll('Project_organization', ['id', 'role_in_project']),
    fetchAll('ProjectRole', ['id', 'key', 'label', 'applies_to'])
  ]);
  console.log(`  Project_people:        ${pp.length} rows`);
  console.log(`  Project_organization:  ${po.length} rows`);
  console.log(`  ProjectRole (already): ${existing.length} rows`);

  // Collect distinct labels per junction.
  const personLabels = new Set();
  const orgLabels = new Set();
  for (const r of pp) if (r.role_in_project) personLabels.add(String(r.role_in_project).trim());
  for (const r of po) if (r.role_in_project) orgLabels.add(String(r.role_in_project).trim());

  // Merge into a label → applies_to map (case-insensitive).
  const merged = new Map(); // key: lowercased label, value: { label, applies_to }
  const mark = (label, scope) => {
    const lc = label.toLowerCase();
    const prev = merged.get(lc);
    if (!prev) merged.set(lc, { label, applies_to: scope });
    else if (prev.applies_to !== scope) prev.applies_to = 'both';
  };
  for (const l of personLabels) mark(l, 'person');
  for (const l of orgLabels)    mark(l, 'org');

  // Build target ProjectRole rows.
  const existingKeys = new Set(existing.map((r) => r.key));
  const toCreate = [];
  let sort = (existing.reduce((m, r) => Math.max(m, (r.sort ?? 0)), 0) ?? 0) + 10;
  for (const { label, applies_to } of merged.values()) {
    const key = slugify(label);
    if (existingKeys.has(key)) continue;
    toCreate.push({ key, label, applies_to, sort, status: 'published' });
    sort += 10;
    existingKeys.add(key);
  }

  console.log(`\n▶ ${toCreate.length} new role(s) to insert:`);
  for (const r of toCreate) console.log(`  · ${r.key.padEnd(24)} → "${r.label}"  (${r.applies_to})`);

  if (NORMALIZE) {
    console.log(`\n▶ Normalisation enabled — junction rows will be rewritten so role_in_project = canonical key.`);
  }

  if (DRY) { console.log('\n(dry run, no writes)'); return; }
  if (toCreate.length === 0 && !NORMALIZE) { console.log('\nNothing to do.'); return; }

  for (const row of toCreate) {
    const res = await fetch(`${BASE}/items/ProjectRole`, { method: 'POST', headers, body: JSON.stringify(row) });
    if (!res.ok) { console.error(`  ✗ ${row.key}: ${res.status} ${await res.text()}`); continue; }
    console.log(`  ✓ created ${row.key}`);
  }

  if (NORMALIZE) {
    const keyByLabelLC = new Map();
    for (const r of [...existing, ...toCreate]) keyByLabelLC.set((r.label ?? '').toLowerCase(), r.key);
    let touched = 0;
    for (const r of pp) {
      const lbl = r.role_in_project ? String(r.role_in_project).trim() : '';
      if (!lbl) continue;
      const key = keyByLabelLC.get(lbl.toLowerCase());
      if (!key || key === lbl) continue;
      await fetch(`${BASE}/items/Project_people/${r.id}`, { method: 'PATCH', headers, body: JSON.stringify({ role_in_project: key }) });
      touched++;
    }
    for (const r of po) {
      const lbl = r.role_in_project ? String(r.role_in_project).trim() : '';
      if (!lbl) continue;
      const key = keyByLabelLC.get(lbl.toLowerCase());
      if (!key || key === lbl) continue;
      await fetch(`${BASE}/items/Project_organization/${r.id}`, { method: 'PATCH', headers, body: JSON.stringify({ role_in_project: key }) });
      touched++;
    }
    console.log(`\nNormalised ${touched} junction row(s) to canonical keys.`);
  }

  console.log('\n✓ Done.');
}
main().catch((e) => { console.error(e); process.exit(1); });
