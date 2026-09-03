#!/usr/bin/env node
// Find Dates rows whose recurrence is open-ended (no UNTIL/COUNT) on a
// short cadence (DAILY/WEEKLY) and offer to cap or disable them. Apple's
// "every weekday until I stop coming to work" rules ingest as FREQ=DAILY
// with no bound — they explode in the calendar grid otherwise.
//
// Modes:
//   (default)        list problematic rows (dry-run)
//   --apply --cap    add UNTIL = today + N days (default 365) to each
//   --apply --disable set is_recurring=false (keeps only the anchor occurrence)
//   --apply --delete archive the row (status=archived)
//
// Filtering:
//   --freq DAILY,WEEKLY   (default — only short cadences are dangerous)
//   --min-age-days N      only flag rows whose anchor is older than N days (default 90)
//                         keeps brand-new recurring events alone
//   --title-contains S    extra title filter (case-insensitive substring)

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

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, dflt) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : dflt; };
const APPLY = flag('--apply');
const CAP = flag('--cap');
const DISABLE = flag('--disable');
const DELETE = flag('--delete');
const FREQS = (opt('--freq', 'DAILY,WEEKLY')).split(',').map((s) => s.trim().toUpperCase());
const MIN_AGE = parseInt(opt('--min-age-days', '90'), 10);
const CAP_DAYS = parseInt(opt('--cap-days', '365'), 10);
const TITLE_SUB = (opt('--title-contains', '') || '').toLowerCase();

if (APPLY && [CAP, DISABLE, DELETE].filter(Boolean).length !== 1) {
  console.error('With --apply you must pick exactly one of --cap / --disable / --delete.');
  process.exit(1);
}

async function api(path, init = {}) {
  const r = await fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? null : r.json();
}

async function fetchAll() {
  const fields = 'id,title,start,end,is_recurring,recurrence_rule,recurrence_end_date,external_id,external_calendar,status';
  const filter = encodeURIComponent(JSON.stringify({
    _and: [
      { is_recurring: { _eq: true } },
      { status: { _neq: 'archived' } }
    ]
  }));
  const out = [];
  let offset = 0;
  for (;;) {
    const data = await api(`/items/Dates?fields=${fields}&filter=${filter}&limit=1000&offset=${offset}&sort=id`);
    out.push(...data.data);
    if (data.data.length < 1000) break;
    offset += 1000;
  }
  return out;
}

function parseRule(r) {
  if (!r) return null;
  const out = { freq: null, hasUntil: false, hasCount: false };
  for (const part of r.split(';')) {
    const [k, v] = part.split('=');
    if (!k || !v) continue;
    const key = k.toUpperCase();
    if (key === 'FREQ') out.freq = v.toUpperCase();
    if (key === 'UNTIL') out.hasUntil = true;
    if (key === 'COUNT') out.hasCount = true;
  }
  return out;
}

function isBad(row, now) {
  const r = parseRule(row.recurrence_rule);
  if (!r || !r.freq) return false;
  if (!FREQS.includes(r.freq)) return false;
  if (r.hasUntil || r.hasCount) return false;
  if (row.recurrence_end_date) return false; // user already set a cutoff in our column
  if (!row.start) return false;
  const ageDays = (now.getTime() - new Date(row.start).getTime()) / (86400 * 1000);
  if (ageDays < MIN_AGE) return false;
  if (TITLE_SUB && !(row.title ?? '').toLowerCase().includes(TITLE_SUB)) return false;
  return true;
}

function withUntil(rule, untilIso) {
  // UTC compact form: 20260529T235959Z
  const compact = untilIso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `${rule};UNTIL=${compact}`;
}

async function main() {
  console.log('▶ Loading recurring Dates rows…');
  const rows = await fetchAll();
  const now = new Date();
  const bad = rows.filter((r) => isBad(r, now));

  console.log(`  ${rows.length} recurring rows total, ${bad.length} flagged.`);
  console.log(`  Criteria: freq in [${FREQS.join(',')}], no UNTIL/COUNT, anchor age ≥ ${MIN_AGE} days${TITLE_SUB ? `, title contains "${TITLE_SUB}"` : ''}.`);

  if (bad.length === 0) { console.log('Nothing to fix.'); return; }

  for (const r of bad.slice(0, 30)) {
    console.log(`  #${r.id}  ${r.start?.slice(0, 10)}  rule="${r.recurrence_rule}"  ${r.title}`);
  }
  if (bad.length > 30) console.log(`  …and ${bad.length - 30} more.`);

  if (!APPLY) { console.log('\n(dry-run — pass --apply with --cap | --disable | --delete to act.)'); return; }

  const untilDate = new Date(now);
  untilDate.setDate(untilDate.getDate() + CAP_DAYS);
  const untilIso = untilDate.toISOString();
  console.log(`\n▶ Applying ${CAP ? `--cap (UNTIL=${untilIso.slice(0, 10)})` : DISABLE ? '--disable' : '--delete'} to ${bad.length} rows…`);

  let done = 0;
  for (const r of bad) {
    if (CAP) {
      await api(`/items/Dates/${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          recurrence_rule: withUntil(r.recurrence_rule, untilIso),
          recurrence_end_date: untilIso.slice(0, 10)
        })
      });
    } else if (DISABLE) {
      await api(`/items/Dates/${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_recurring: false, recurrence_rule: null })
      });
    } else if (DELETE) {
      await api(`/items/Dates/${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'archived' })
      });
    }
    done++;
    if (done % 50 === 0) process.stdout.write(`  ${done}/${bad.length}\r`);
  }
  console.log(`✓ Done. Touched ${done} rows.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
