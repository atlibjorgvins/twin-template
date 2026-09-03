#!/usr/bin/env node
// Bulk-imports the canonical Icelandic-holiday catalogue from
// https://dagarnir.is/ into the Dates collection.
//
// Fixed-date entries (Christmas, Bun Day, Independence Day…) are
// stored as recurring YEARLY anchors so they repeat forever. Movable
// feasts (Easter, Good Friday, etc.) are stored as one-shot 2026
// rows — Directus has no Easter resolver and our recurrence-engine
// can't compute Paschal offsets yet, so the user can edit each year
// or replace them with explicit yearly rows.
//
// Usage:
//   PUBLIC_DIRECTUS_URL=… PUBLIC_DIRECTUS_TOKEN=… \
//     node scripts/import-icelandic-holidays.mjs
//
// The script reads the .env file at the repo root by default — pass
// --dry-run to print the payloads without writing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// ── Load .env (minimal parser — KEY=VALUE per line, no quoting magic).
function loadEnv() {
  const envPath = path.join(repoRoot, process.env.TWIN_ENV_FILE || '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key]) continue; // existing env wins
    process.env[key] = raw.replace(/^"(.*)"$/, '$1');
  }
}
loadEnv();

const BASE = process.env.PUBLIC_DIRECTUS_URL;
const TOKEN = process.env.PUBLIC_DIRECTUS_TOKEN;
if (!BASE || !TOKEN) {
  console.error('Need PUBLIC_DIRECTUS_URL and PUBLIC_DIRECTUS_TOKEN.');
  process.exit(1);
}

const DRY = process.argv.includes('--dry-run');

// ── Catalogue (scraped from dagarnir.is, 2026 reference year). ───────
// `fixed: true`  → anchored on the listed month/day, FREQ=YEARLY.
// `fixed: false` → movable feast, stored as a one-shot 2026 row.
// `flag`         → notes a flag-day observance in the description.
const ANCHOR_YEAR = 2026;
const HOLIDAYS = [
  ['Nýársdagur',                   "New Year's Day",            '01-01', true,  true],
  ['Þrettándinn',                  'Epiphany',                  '01-06', true,  false],
  ['Bóndadagur',                   "Farmer's Day",              '01-23', true,  false],
  ['Valentínusardagurinn',         "Valentine's Day",           '02-14', true,  false],
  ['Bolludagur',                   'Bun Day',                   '02-16', true,  false],
  ['Sprengidagur',                 'Explosion Day',             '02-17', true,  false],
  ['Öskudagur',                    'Ash Wednesday',             '02-18', false, false],
  ['Konudagur',                    "Women's Day",               '02-22', true,  false],
  ['Pálmasunnudagur',              'Palm Sunday',               '03-29', false, false],
  ['Skírdagur',                    'Maundy Thursday',           '04-02', false, false],
  ['Föstudagurinn langi',          'Good Friday',               '04-03', false, true],
  ['Páskadagur',                   'Easter Sunday',             '04-05', false, true],
  ['Annar í páskum',               'Easter Monday',             '04-06', false, false],
  ['Sumardagurinn fyrsti',         'First Day of Summer',       '04-23', true,  true],
  ['Baráttudagur verkalýðsins',    'Labour Day',                '05-01', true,  true],
  ['Mæðradagurinn',                "Mother's Day",              '05-10', true,  false],
  ['Uppstigningardagur',           'Ascension Day',             '05-14', false, false],
  ['Hvítasunnudagur',              'Whit Sunday',               '05-24', false, true],
  ['Annar í Hvítasunnu',           'Whit Monday',               '05-25', false, false],
  ['Sjómannadagurinn',             "Seamen's Day",              '06-07', true,  true],
  ['Þjóðhátíðardagur Íslendinga',  'Icelandic National Day',    '06-17', true,  true],
  ['Frídagur verzlunarmanna',      "Merchants' Holiday",        '08-03', true,  false],
  ['Reykjavík Pride / Gleðigangan','Reykjavík Pride',           '08-08', true,  false],
  ['Menningarnótt',                'Culture Night',             '08-22', true,  false],
  ['Fæðingardagur forseta',        "President's Birthday",      '10-11', true,  true],
  ['Fyrsti vetrardagur',           'First Day of Winter',       '10-24', true,  false],
  ['Hrekkjavaka',                  'Halloween',                 '10-31', true,  false],
  ['Feðradagurinn',                "Father's Day",              '11-08', true,  false],
  ['Dagur íslenzkrar tungu',       'Icelandic Language Day',    '11-16', true,  true],
  ['Fullveldisdagurinn',           'Independence Day',          '12-01', true,  true],
  ['Aðfangadagur jóla',            'Christmas Eve',             '12-24', true,  false],
  ['Jóladagur',                    'Christmas Day',             '12-25', true,  true],
  ['Annar í jólum',                'Boxing Day',                '12-26', true,  false],
  ['Gamlárskvöld',                 "New Year's Eve",            '12-31', true,  false]
];

// ── Build payload rows. ──────────────────────────────────────────────
function row([title, en, monthDay, fixed, flag]) {
  const startISO = new Date(`${ANCHOR_YEAR}-${monthDay}T00:00:00Z`).toISOString();
  const endISO = new Date(`${ANCHOR_YEAR}-${monthDay}T23:59:59Z`).toISOString();
  const desc = [
    `${en}.`,
    'Imported from dagarnir.is.',
    flag ? 'Official Icelandic flag day.' : null,
    fixed ? null : 'Movable feast — date varies year to year; update or replace with the correct date per year.'
  ]
    .filter(Boolean)
    .join(' ');
  return {
    title,
    description: desc,
    event_type: 'holiday',
    all_day: true,
    start: startISO,
    end: endISO,
    is_recurring: fixed,
    recurrence_rule: fixed ? 'FREQ=YEARLY' : null,
    color: flag ? '#3B82F6' : '#F87171',
    scope: 'both',
    source: 'dagarnir.is',
    source_ref: `dagarnir:${title}`,
    status: 'published'
  };
}

const payloads = HOLIDAYS.map(row);

if (DRY) {
  console.log(JSON.stringify(payloads, null, 2));
  console.log(`\n— Would create ${payloads.length} rows (dry run).`);
  process.exit(0);
}

// ── POST each row. ───────────────────────────────────────────────────
let created = 0;
let skipped = 0;
let failed = 0;

// Light dedup: if a Dates row already exists with the same source_ref,
// skip it so re-running the script is idempotent.
async function existsByRef(ref) {
  const url = `${BASE}/items/Dates?filter[source_ref][_eq]=${encodeURIComponent(ref)}&fields=id&limit=1`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) return false;
  const j = await res.json();
  return Array.isArray(j.data) && j.data.length > 0;
}

for (const p of payloads) {
  try {
    if (await existsByRef(p.source_ref)) {
      console.log(`· skip   ${p.title} (already imported)`);
      skipped++;
      continue;
    }
    const res = await fetch(`${BASE}/items/Dates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`
      },
      body: JSON.stringify(p)
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`${res.status} ${txt.slice(0, 200)}`);
    }
    console.log(`✓ create ${p.title}${p.is_recurring ? ' (yearly)' : ' (one-shot)'}`);
    created++;
  } catch (e) {
    console.error(`✗ fail   ${p.title}: ${e.message}`);
    failed++;
  }
}

console.log(`\nDone. Created ${created}, skipped ${skipped}, failed ${failed}.`);
process.exit(failed > 0 ? 1 : 0);
