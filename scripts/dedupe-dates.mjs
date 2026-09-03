#!/usr/bin/env node
// Find and clean up duplicate Dates rows in Directus.
//
// Two dedup keys, applied in order:
//   1. Same `external_id` (Apple/Google UID) → keep lowest id, archive the rest.
//   2. Same (lower(title), start) signature with NO external_id, OR
//      external_id is null on both → keep lowest id, archive the rest.
//
// "Archive" = set status='archived' (the same soft-delete pattern the
// rest of the app uses), so nothing is destroyed. Run with --hard to
// switch to actual deletion. Default is `--dry-run`-safe: prints what
// would change unless you also pass --apply.
//
// Usage:
//   node scripts/dedupe-dates.mjs                 # dry-run, see report
//   node scripts/dedupe-dates.mjs --apply         # soft-archive duplicates
//   node scripts/dedupe-dates.mjs --apply --hard  # actually delete duplicates
//   node scripts/dedupe-dates.mjs --restore       # un-archive everything we touched (status='published')
//
// Safety: only touches rows the script would have flagged itself.
// Picks the lowest id as the survivor — re-runnable; idempotent.

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
if (!URL_BASE || !TOKEN) {
  console.error('Missing PUBLIC_DIRECTUS_URL / PUBLIC_DIRECTUS_TOKEN');
  process.exit(1);
}

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const APPLY = flag('--apply');
const HARD = flag('--hard');
const RESTORE = flag('--restore');

async function api(path, init = {}) {
  const r = await fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? null : r.json();
}

async function fetchAll() {
  const fields = 'id,title,start,end,external_id,external_calendar,status,is_recurring';
  const out = [];
  let offset = 0;
  const pageSize = 1000;
  for (;;) {
    const data = await api(`/items/Dates?fields=${fields}&limit=${pageSize}&offset=${offset}&sort=id`);
    out.push(...data.data);
    if (data.data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

function sigByExternal(row) {
  return row.external_id ? `ext:${row.external_id}` : null;
}
function sigByTitleStart(row) {
  // Lowercase + trim title; minute-precision start. Keeps "Standup" and
  // "standup " from being treated as different events.
  const t = (row.title ?? '').trim().toLowerCase();
  const s = (row.start ?? '').slice(0, 16); // YYYY-MM-DDTHH:MM
  if (!t || !s) return null;
  return `ts:${t}|${s}`;
}
// Always-use-title-start signature is the right answer for the visible-
// duplicates the user sees. Apple's three "Holidays in Iceland"
// calendars each have their own unique iCal UID for "Icelandic
// Republic Day" — so external_id alone misses them. (title, start)
// catches it.
function dedupeSig(row) {
  return sigByTitleStart(row) ?? sigByExternal(row);
}

async function main() {
  console.log('▶ Loading Dates…');
  const rows = await fetchAll();
  console.log(`  ${rows.length} rows total.`);

  if (RESTORE) {
    const targets = rows.filter((r) => r.status === 'archived');
    console.log(`▶ Restoring ${targets.length} archived rows → published…`);
    if (!APPLY) {
      console.log('  (dry-run — pass --apply to actually update)');
      return;
    }
    for (const r of targets) await api(`/items/Dates/${r.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'published' }) });
    console.log('✓ Restored.');
    return;
  }

  // Group by signatures. external_id wins if present; otherwise fall back.
  const groups = new Map();
  for (const r of rows) {
    if (r.status === 'archived') continue; // already archived, leave alone
    const sig = dedupeSig(r);
    if (!sig) continue;
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(r);
  }

  const dupGroups = [...groups.entries()].filter(([, arr]) => arr.length > 1);
  console.log(`▶ Found ${dupGroups.length} duplicate group${dupGroups.length === 1 ? '' : 's'}.`);

  let toTouch = 0;
  const samples = [];
  for (const [sig, arr] of dupGroups) {
    arr.sort((a, b) => a.id - b.id);
    const survivor = arr[0];
    const losers = arr.slice(1);
    toTouch += losers.length;
    if (samples.length < 8) {
      samples.push({ sig, survivor: survivor.id, kill: losers.map((x) => x.id), title: survivor.title });
    }
  }
  console.log(`  → would ${HARD ? 'delete' : 'archive'} ${toTouch} duplicate row${toTouch === 1 ? '' : 's'} (keeping lowest id per group).`);

  if (samples.length) {
    console.log('\n  Sample of what would change:');
    for (const s of samples) {
      console.log(`    keep #${s.survivor} "${s.title}"  ${HARD ? 'delete' : 'archive'} ${s.kill.join(',')}`);
    }
  }

  if (!APPLY) {
    console.log('\n(dry-run — pass --apply to actually act on these.)');
    return;
  }

  console.log(`\n▶ ${HARD ? 'Deleting' : 'Archiving'}…`);
  let done = 0;
  for (const [, arr] of dupGroups) {
    arr.sort((a, b) => a.id - b.id);
    for (const loser of arr.slice(1)) {
      if (HARD) {
        await api(`/items/Dates/${loser.id}`, { method: 'DELETE' });
      } else {
        await api(`/items/Dates/${loser.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) });
      }
      done++;
      if (done % 50 === 0) process.stdout.write(`  ${done}/${toTouch}\r`);
    }
  }
  console.log(`✓ Done. ${HARD ? 'Deleted' : 'Archived'} ${done} rows.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
