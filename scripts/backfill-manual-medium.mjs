#!/usr/bin/env node
// Fill mk_manual_spend.medium from the older `channel` value.
//
// `channel` was a free-ish dropdown (billboard / print / radio / tv /
// sponsorship / other, allowOther on). `medium` is the shared vocabulary
// in mk_medium that Meta spend also reports through. This maps the old
// values onto the new codes so historical manual spend shows up in a
// by-medium split.
//
//   node scripts/backfill-manual-medium.mjs --dry-run   # show what would change
//   node scripts/backfill-manual-medium.mjs             # write it
//
// Only touches rows where medium is empty — a medium you set by hand is
// never overwritten. Safe to re-run.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const env = Object.fromEntries(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', process.env.TWIN_ENV_FILE ?? '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const URL_BASE = (env.DIRECTUS_ADMIN_URL || env.PUBLIC_DIRECTUS_URL || '').replace(/\/$/, '');
const TOKEN = env.PUBLIC_DIRECTUS_TOKEN;
const agent = new https.Agent({ rejectUnauthorized: false }); // self-signed tailnet cert
const DRY = process.argv.includes('--dry-run');

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

// Old channel value → medium code. Anything already equal to a medium
// code passes through untouched (allowOther let arbitrary values in).
const MAP = {
  billboard: 'ooh',
  print: 'print',
  radio: 'radio',
  tv: 'tv',
  sponsorship: 'sponsorship',
  other: 'other'
};

const codes = new Set(
  (await api('/items/mk_medium?fields=code&limit=-1')).data.map((m) => m.code)
);
if (codes.size === 0) {
  console.error('mk_medium is empty — run scripts/add-marketing-media.sh first.');
  process.exit(1);
}

const rows = (
  await api('/items/mk_manual_spend?filter[medium][_null]=true&fields=id,label,channel,amount&limit=-1')
).data;
console.log(`${rows.length} manual spend row(s) without a medium.`);

// Group by target so each medium is one PATCH, not one per row.
const groups = new Map();
const unknown = []; // channel value we didn't recognise — fell back to `other`
const skipped = []; // no usable target at all
for (const r of rows) {
  const ch = (r.channel ?? '').trim().toLowerCase();
  const mapped = codes.has(ch) ? ch : MAP[ch];
  const target = mapped ?? 'other';
  if (!codes.has(target)) {
    skipped.push(r);
    continue;
  }
  if (!mapped) unknown.push({ ...r, target });
  if (!groups.has(target)) groups.set(target, []);
  groups.get(target).push(r.id);
}

for (const [medium, ids] of [...groups.entries()].sort()) {
  console.log(`  ${DRY ? 'would set' : 'setting'} medium=${medium} on ${ids.length} row(s)`);
  if (DRY) continue;
  // Uniform update over many keys — one request per medium.
  for (let i = 0; i < ids.length; i += 100) {
    await api('/items/mk_manual_spend', {
      method: 'PATCH',
      body: JSON.stringify({ keys: ids.slice(i, i + 100), data: { medium } })
    });
  }
}

if (unknown.length > 0) {
  console.log(`\n${unknown.length} row(s) had a channel outside the known list — check these landed sensibly:`);
  for (const r of unknown.slice(0, 20)) {
    console.log(`  #${r.id} "${r.label ?? '(no label)'}" channel="${r.channel ?? ''}" → ${r.target}`);
  }
}
if (skipped.length > 0) {
  console.log(`\n${skipped.length} row(s) skipped — the "other" medium is missing from mk_medium.`);
}
console.log(DRY ? '\nDry run — nothing written.' : '\nDone.');
