#!/usr/bin/env node
// Retire the legacy `brand_colors` JSON column into brand_palette_color rows.
//
// The brand editor showed TWO colour sections — "Roles" (the real model) and
// "Palette", which was reading whichever of two stores happened to be
// populated: the brand_colors JSON blob, or brand_palette_color rows. Three
// stores for one concept is why the section was labelled "older list" and why
// nobody could say where a colour lived. After this runs there is one store.
//
//   node scripts/migrate-brand-colors.mjs            # dry run — prints the plan
//   node scripts/migrate-brand-colors.mjs --commit
//
// Idempotent: a colour already present in brand_palette_color for that owner
// (same hex, case-insensitive) is skipped rather than duplicated, and
// brand_colors is only cleared once its colours are safely across.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT = process.argv.includes('--commit');
const env = Object.fromEntries(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', process.env.TWIN_ENV_FILE || '.env'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const URL_BASE = (env.DIRECTUS_ADMIN_URL || env.PUBLIC_DIRECTUS_URL || '').replace(/\/+$/, '');
const TOKEN = env.PUBLIC_DIRECTUS_TOKEN;
if (!URL_BASE || !TOKEN) {
  console.error('Missing PUBLIC_DIRECTUS_URL / PUBLIC_DIRECTUS_TOKEN in .env');
  process.exit(1);
}

async function api(path, init = {}) {
  const res = await fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : (await res.json()).data;
}

// Both collections carry the column, even though only projects use it today —
// checking both means an org that gains one later is not silently missed.
const OWNERS = [
  { kind: 'project', collection: 'Project' },
  { kind: 'organization', collection: 'organization' }
];

const norm = (h) => String(h || '').trim().toUpperCase();

const existing = await api('/items/brand_palette_color?limit=-1');
const have = new Set(existing.map((r) => `${r.owner_kind}:${r.owner_id}:${norm(r.hex)}`));
const maxSort = new Map();
for (const r of existing) {
  const k = `${r.owner_kind}:${r.owner_id}`;
  maxSort.set(k, Math.max(maxSort.get(k) ?? -1, r.sort ?? 0));
}

let planned = 0;
let skipped = 0;
const clears = [];

for (const { kind, collection } of OWNERS) {
  const rows = await api(`/items/${collection}?limit=-1&fields=id,name,brand_colors`);
  for (const row of rows) {
    const legacy = row.brand_colors;
    if (!Array.isArray(legacy) || legacy.length === 0) continue;

    console.log(`\n${collection} #${row.id} — ${row.name}`);
    let moved = 0;
    for (const c of legacy) {
      const hex = norm(c?.hex);
      if (!/^#[0-9A-F]{6}$/.test(hex)) {
        console.log(`  ! skipping unparseable entry: ${JSON.stringify(c)}`);
        continue;
      }
      const key = `${kind}:${row.id}:${hex}`;
      if (have.has(key)) {
        console.log(`  = ${hex} already in brand_palette_color — skipping`);
        skipped++;
        continue;
      }
      const k = `${kind}:${row.id}`;
      const sort = (maxSort.get(k) ?? -1) + 1;
      maxSort.set(k, sort);
      // 'support' is the honest group for these: the legacy list had no
      // grouping, and every entry in it is an identity colour, not a surface.
      const body = {
        owner_kind: kind,
        owner_id: row.id,
        name: (c?.label || '').trim() || hex,
        group: 'support',
        hex,
        sort
      };
      console.log(`  + ${hex}  "${body.name}"`);
      if (COMMIT) await api('/items/brand_palette_color', { method: 'POST', body: JSON.stringify(body) });
      have.add(key);
      planned++;
      moved++;
    }
    // Clear only when everything in the blob is accounted for — either moved
    // now or already present. A partial clear would lose a colour.
    clears.push({ collection, id: row.id, name: row.name, count: legacy.length, moved });
  }
}

for (const c of clears) {
  console.log(`\nclear ${c.collection} #${c.id} brand_colors (${c.count} entr${c.count === 1 ? 'y' : 'ies'})`);
  if (COMMIT) await api(`/items/${c.collection}/${c.id}`, { method: 'PATCH', body: JSON.stringify({ brand_colors: null }) });
}

console.log(
  `\n${COMMIT ? 'Done' : 'Dry run'} — ${planned} palette row(s) to create, ${skipped} already present, ` +
  `${clears.length} owner(s) to clear.${COMMIT ? '' : '\nRe-run with --commit to apply.'}`
);
