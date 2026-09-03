#!/usr/bin/env node
// Seeds the Grant catalogue with Iceland's main public-funding
// programmes (focused on what KLAK / startup alumni typically tap).
//
// Idempotent: looks up by short_name (or name) and skips if a row
// already exists. Run with --dry-run to print the payloads only.
//
//   node scripts/seed-iceland-grants.mjs
//   node scripts/seed-iceland-grants.mjs --dry-run

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

const PROGRAMMES = [
  {
    name: 'Tækniþróunarsjóður',
    short_name: 'TÞS',
    funder_label: 'Rannís',
    category: 'rnd',
    country: 'Iceland',
    currency: 'ISK',
    is_recurring: true,
    recurrence: 'annual',
    typical_duration_years: 2,
    website: 'https://www.rannis.is/sjodir/atvinnulif/taeknithrounarsjodur/',
    summary: 'Iceland\'s flagship R&D fund for technology innovation. Staged calls: Sproti (early), Sprota (pilot), Vöxtur (growth). Multi-year staged payouts.',
    color: '#2C8C99'
  },
  {
    name: 'Rannsóknasjóður',
    short_name: 'Rannsóknasjóður',
    funder_label: 'Rannís',
    category: 'research',
    country: 'Iceland',
    currency: 'ISK',
    is_recurring: true,
    recurrence: 'annual',
    typical_duration_years: 3,
    website: 'https://www.rannis.is/sjodir/rannsoknir/rannsoknasjodur/',
    summary: 'The main competitive research grant for Icelandic universities and institutes. Typically 1–3 year awards.',
    color: '#6B5ADB'
  },
  {
    name: 'Markáætlun',
    short_name: 'Markáætlun',
    funder_label: 'Rannís',
    category: 'research',
    country: 'Iceland',
    currency: 'ISK',
    is_recurring: false,
    recurrence: 'ad_hoc',
    typical_duration_years: 3,
    website: 'https://www.rannis.is/sjodir/rannsoknir/markaaetlun/',
    summary: 'Strategic research and development programme. Thematic calls — e.g. health, ocean, AI — typically multi-year.',
    color: '#9C4DCC'
  },
  {
    name: 'Innviðasjóður',
    short_name: 'Innviðasjóður',
    funder_label: 'Rannís',
    category: 'infrastructure',
    country: 'Iceland',
    currency: 'ISK',
    is_recurring: true,
    recurrence: 'annual',
    typical_duration_years: 1,
    website: 'https://www.rannis.is/sjodir/rannsoknir/innvidasjodur/',
    summary: 'Research infrastructure fund — equipment and shared facilities.',
    color: '#5C6B7A'
  },
  {
    name: 'Loftslagssjóður',
    short_name: 'Loftslagssjóður',
    funder_label: 'Rannís',
    category: 'climate',
    country: 'Iceland',
    currency: 'ISK',
    is_recurring: true,
    recurrence: 'annual',
    typical_duration_years: 1,
    website: 'https://www.rannis.is/sjodir/umhverfismal/loftslagssjodur/',
    summary: 'Climate Fund — projects reducing greenhouse-gas emissions and supporting climate adaptation.',
    color: '#3F8A5F'
  },
  {
    name: 'Nýsköpunarsjóður námsmanna',
    short_name: 'NSN',
    funder_label: 'Rannís',
    category: 'student',
    country: 'Iceland',
    currency: 'ISK',
    is_recurring: true,
    recurrence: 'annual',
    typical_duration_years: 1,
    website: 'https://www.rannis.is/sjodir/atvinnulif/nysk%C3%B6punarsj%C3%B3%C3%B0ur-n%C3%A1msmanna/',
    summary: 'Student Innovation Fund — summer research grants for university students paired with an academic supervisor.',
    color: '#C6762A'
  },
  {
    name: 'Hönnunarsjóður',
    short_name: 'Hönnunarsjóður',
    funder_label: 'Miðstöð hönnunar og arkitektúrs',
    category: 'design',
    country: 'Iceland',
    currency: 'ISK',
    is_recurring: true,
    recurrence: 'annual',
    typical_duration_years: 1,
    website: 'https://www.rannis.is/sjodir/atvinnulif/honnunarsjodur/',
    summary: 'Design Fund — supports innovation and value creation through design.',
    color: '#D44A6B'
  },
  {
    name: 'Kvikmyndasjóður Íslands',
    short_name: 'Kvikmyndasjóður',
    funder_label: 'Kvikmyndamiðstöð Íslands',
    category: 'culture',
    country: 'Iceland',
    currency: 'ISK',
    is_recurring: true,
    recurrence: 'quarterly',
    typical_duration_years: 1,
    website: 'https://kvikmyndamidstod.is',
    summary: 'Icelandic Film Centre — development, production, post-production and distribution grants for film and TV.',
    color: '#7A8593'
  },
  {
    name: 'Horizon Europe',
    short_name: 'Horizon',
    funder_label: 'European Union',
    category: 'rnd',
    country: 'EU (Iceland is associated)',
    currency: 'EUR',
    is_recurring: true,
    recurrence: 'annual',
    typical_duration_years: 3,
    website: 'https://www.rannis.is/sjodir/horizon-europe/',
    summary: 'EU\'s flagship research and innovation programme. Open to Icelandic participants. Many topic-specific calls — typically large multi-partner consortia.',
    color: '#1D6BFE'
  },
  {
    name: 'Eurostars',
    short_name: 'Eurostars',
    funder_label: 'Eureka / EU',
    category: 'rnd',
    country: 'EU',
    currency: 'EUR',
    is_recurring: true,
    recurrence: 'biannual',
    typical_duration_years: 3,
    website: 'https://www.eurostars-eureka.eu/',
    summary: 'Joint EU programme for SME-led international collaborative R&D projects. Typically two cut-offs per year.',
    color: '#0EA5A5'
  }
];

async function existingShortNames() {
  const r = await fetch(`${BASE}/items/Grant?limit=-1&fields=id,name,short_name`, { headers: HEADERS });
  if (!r.ok) throw new Error(`list grants: ${r.status}`);
  const j = await r.json();
  return new Map((j.data ?? []).map((g) => [(g.short_name || g.name || '').toLowerCase(), g]));
}

async function main() {
  console.log('▶ Seeding Iceland grant programmes…');
  const existing = await existingShortNames();
  let created = 0, skipped = 0;
  for (const p of PROGRAMMES) {
    const key = (p.short_name || p.name).toLowerCase();
    if (existing.has(key)) { console.log(`  · skip ${p.name} (exists)`); skipped++; continue; }
    if (DRY) { console.log(`  · would create ${p.name}`); continue; }
    const res = await fetch(`${BASE}/items/Grant`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ status: 'published', ...p }) });
    if (!res.ok) { console.error(`  ✗ ${p.name}: ${res.status} ${await res.text()}`); continue; }
    console.log(`  ✓ created ${p.name}`);
    created++;
  }
  console.log(`\nDone. Created ${created}, skipped ${skipped}, total ${PROGRAMMES.length}.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
