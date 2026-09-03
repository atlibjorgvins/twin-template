#!/usr/bin/env node
// Fill Person.full_name from first_name + last_name where it's empty.
//
// Some legacy rows (and older imports) stored only the split-name
// fields, leaving full_name null. The UI rendered the computed name
// as placeholder text so it *looked* set, but searches and dedupe
// queries that match on full_name missed those rows — leading to
// the same person being imported twice.
//
// Dry-run by default; --apply to write.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(ROOT, process.env.TWIN_ENV_FILE || '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const URL_BASE = (process.env.DIRECTUS_ADMIN_URL || process.env.PUBLIC_DIRECTUS_URL || '').replace(/\/$/, '');
const TOKEN = process.env.PUBLIC_DIRECTUS_TOKEN || '';
if (!URL_BASE || !TOKEN) { console.error('Missing PUBLIC_DIRECTUS_URL / PUBLIC_DIRECTUS_TOKEN'); process.exit(1); }

const APPLY = process.argv.includes('--apply');

async function api(path, init = {}) {
  const r = await fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? null : r.json();
}

async function fetchAll() {
  // Rows where full_name is null/empty but first_name OR last_name is set.
  const filter = encodeURIComponent(JSON.stringify({
    _and: [
      { status: { _neq: 'archived' } },
      {
        _or: [
          { full_name: { _null: true } },
          { full_name: { _empty: true } }
        ]
      },
      {
        _or: [
          { first_name: { _nnull: true } },
          { last_name: { _nnull: true } }
        ]
      }
    ]
  }));
  const fields = 'id,full_name,first_name,last_name';
  const out = [];
  let offset = 0;
  for (;;) {
    const data = await api(`/items/Person?fields=${fields}&filter=${filter}&limit=1000&offset=${offset}&sort=id`);
    out.push(...data.data);
    if (data.data.length < 1000) break;
    offset += 1000;
  }
  return out;
}

function computed(p) {
  return [p.first_name, p.last_name].filter((s) => s && s.trim()).join(' ').trim();
}

async function main() {
  console.log('▶ Loading rows with empty full_name…');
  const rows = await fetchAll();
  const updatable = rows.filter((r) => computed(r));
  console.log(`  ${rows.length} candidates, ${updatable.length} have a usable first+last.`);
  if (!updatable.length) return;
  for (const r of updatable.slice(0, 12)) {
    console.log(`  #${r.id}  first="${r.first_name ?? ''}" last="${r.last_name ?? ''}"  →  "${computed(r)}"`);
  }
  if (updatable.length > 12) console.log(`  …and ${updatable.length - 12} more.`);

  if (!APPLY) { console.log('\n(dry-run — pass --apply to write.)'); return; }

  console.log(`\n▶ Patching ${updatable.length} rows…`);
  let done = 0;
  for (const r of updatable) {
    await api(`/items/Person/${r.id}`, { method: 'PATCH', body: JSON.stringify({ full_name: computed(r) }) });
    done++;
    if (done % 50 === 0) process.stdout.write(`  ${done}/${updatable.length}\r`);
  }
  console.log(`✓ Done. Updated ${done} rows.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
