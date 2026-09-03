#!/usr/bin/env node
// Walk Person.phone, Person.phone_secondary, Person_organization.work_phone, organization.phone
// and rewrite each into canonical E.164 form.
//
// Defaults to Iceland (+354) when no country code can be inferred.
// Usage:
//   node scripts/normalize-phones.mjs           # dry-run, prints diffs
//   node scripts/normalize-phones.mjs --write   # apply patches
//   node scripts/normalize-phones.mjs --collection Person  # limit scope
//
// Reads PUBLIC_DIRECTUS_URL + PUBLIC_DIRECTUS_TOKEN from twin/.env.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', process.env.TWIN_ENV_FILE || '.env');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    })
);
const URL_BASE = (env.DIRECTUS_ADMIN_URL || env.PUBLIC_DIRECTUS_URL || '').replace(/\/$/, '');
const TOKEN = env.PUBLIC_DIRECTUS_TOKEN;
if (!URL_BASE || !TOKEN) {
  console.error('Missing PUBLIC_DIRECTUS_URL or PUBLIC_DIRECTUS_TOKEN in twin/.env');
  process.exit(1);
}

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const SCOPE = (() => {
  const i = args.indexOf('--collection');
  return i >= 0 ? args[i + 1] : null;
})();

// ── Phone parsing — kept identical to twin/src/lib/phone.ts logic. ──────────
const COUNTRIES = [
  { code: '+354', digits: '354', iso2: 'IS' },
  { code: '+1',   digits: '1',   iso2: 'US' },
  { code: '+44',  digits: '44',  iso2: 'GB' },
  { code: '+45',  digits: '45',  iso2: 'DK' },
  { code: '+46',  digits: '46',  iso2: 'SE' },
  { code: '+47',  digits: '47',  iso2: 'NO' },
  { code: '+358', digits: '358', iso2: 'FI' },
  { code: '+49',  digits: '49',  iso2: 'DE' },
  { code: '+33',  digits: '33',  iso2: 'FR' },
  { code: '+34',  digits: '34',  iso2: 'ES' },
  { code: '+39',  digits: '39',  iso2: 'IT' },
  { code: '+31',  digits: '31',  iso2: 'NL' },
  { code: '+32',  digits: '32',  iso2: 'BE' },
  { code: '+41',  digits: '41',  iso2: 'CH' },
  { code: '+43',  digits: '43',  iso2: 'AT' },
  { code: '+351', digits: '351', iso2: 'PT' },
  { code: '+353', digits: '353', iso2: 'IE' },
  { code: '+48',  digits: '48',  iso2: 'PL' },
  { code: '+91',  digits: '91',  iso2: 'IN' },
  { code: '+86',  digits: '86',  iso2: 'CN' },
  { code: '+81',  digits: '81',  iso2: 'JP' },
  { code: '+61',  digits: '61',  iso2: 'AU' },
  { code: '+972', digits: '972', iso2: 'IL' },
  { code: '+55',  digits: '55',  iso2: 'BR' },
  { code: '+52',  digits: '52',  iso2: 'MX' }
];
const DEFAULT = COUNTRIES[0];
const BY_DIGITS = new Map(COUNTRIES.map((c) => [c.digits, c]));

function bareDigits(s) { return s.replace(/[^\d+]/g, ''); }
function matchPrefix(d) {
  for (const len of [3, 2, 1]) {
    const head = d.slice(0, len);
    if (BY_DIGITS.has(head)) return BY_DIGITS.get(head);
  }
  return null;
}

function normalize(input) {
  if (input == null) return null;
  const raw = bareDigits(String(input)).replace(/^00/, '+');
  if (!raw) return null;
  if (raw.startsWith('+')) {
    const digits = raw.slice(1);
    const cc = matchPrefix(digits);
    if (cc) return `+${cc.digits}${digits.slice(cc.digits.length)}`;
    return `+${digits}`; // unknown country — keep + and digits
  }
  // Short numbers (≤8 digits) — treat as default-country local. Avoids
  // mis-reading e.g. "8636760" (Iceland mobile) as +86 (China) + "36760".
  if (raw.length <= 8) return `+${DEFAULT.digits}${raw}`;
  const cc = matchPrefix(raw);
  if (cc) {
    const rest = raw.slice(cc.digits.length);
    if (rest.length >= 7 && rest.length <= 13) return `+${cc.digits}${rest}`;
  }
  return `+${DEFAULT.digits}${raw}`;
}

// ── HTTP helpers ────────────────────────────────────────────────────────────
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json'
};

async function readAll(collection, fields) {
  const all = [];
  let page = 1;
  const limit = 200;
  for (;;) {
    const url = `${URL_BASE}/items/${collection}?fields=${fields.join(',')}&limit=${limit}&page=${page}`;
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`${collection} GET ${r.status}`);
    const { data } = await r.json();
    all.push(...data);
    if (data.length < limit) break;
    page++;
  }
  return all;
}

async function patch(collection, id, body) {
  const r = await fetch(`${URL_BASE}/items/${collection}/${id}`, {
    method: 'PATCH', headers, body: JSON.stringify(body)
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`${collection} PATCH ${id} ${r.status}: ${text}`);
  }
}

// ── Per-collection plan ─────────────────────────────────────────────────────
const PLAN = [
  { collection: 'Person',                fields: ['phone', 'phone_secondary'] },
  { collection: 'organization',          fields: ['phone', 'phone_secondary'] },
  { collection: 'Person_organization',   fields: ['work_phone'] }
];

function diff(rec, fields) {
  const patches = {};
  for (const f of fields) {
    const before = rec[f];
    if (before == null || String(before).trim() === '') continue;
    const after = normalize(before);
    if (after !== before) patches[f] = { before, after };
  }
  return patches;
}

// ── Main ────────────────────────────────────────────────────────────────────
let totalChecked = 0;
let totalChanged = 0;
let totalFieldsChanged = 0;

for (const { collection, fields } of PLAN) {
  if (SCOPE && SCOPE !== collection) continue;
  process.stdout.write(`\n=== ${collection} (${fields.join(', ')}) ===\n`);
  let rows;
  try { rows = await readAll(collection, ['id', ...fields]); }
  catch (e) {
    console.error(`  skipped: ${e.message}`);
    continue;
  }
  console.log(`  ${rows.length} rows`);
  for (const rec of rows) {
    totalChecked++;
    const d = diff(rec, fields);
    const keys = Object.keys(d);
    if (keys.length === 0) continue;
    totalChanged++;
    totalFieldsChanged += keys.length;
    const lines = keys.map((k) => `    ${k}: ${JSON.stringify(d[k].before)} → ${JSON.stringify(d[k].after)}`);
    console.log(`  #${rec.id}\n${lines.join('\n')}`);
    if (WRITE) {
      const body = Object.fromEntries(keys.map((k) => [k, d[k].after]));
      try { await patch(collection, rec.id, body); }
      catch (e) { console.error(`    !! write failed: ${e.message}`); }
    }
  }
}

console.log(
  `\n${WRITE ? 'Wrote' : 'Would write'} ${totalFieldsChanged} field updates across ${totalChanged}/${totalChecked} rows.`
);
if (!WRITE) console.log('Re-run with --write to apply.');
