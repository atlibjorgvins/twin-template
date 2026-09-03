#!/usr/bin/env node
/**
 * Migrate the organization.industry field to a canonical fixed list.
 *
 * What it does:
 *   1. Walk every org with a non-empty `industry` value.
 *   2. If the existing value already maps to a canonical option (by exact
 *      match, value match, or a small alias table), update the org to the
 *      canonical `value`.
 *   3. Otherwise, attach the existing label as a Tag on the org and clear
 *      the industry field.
 *
 * Run with --dry-run first to see what would change. Pass --apply to write.
 *
 * Then update the Directus field metadata (separate step, see end of file)
 * to lock it down as a select-dropdown with the canonical choices, so the
 * admin UI can no longer accept free text.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Tiny .env loader so we don't need a dotenv dependency.
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envText = readFileSync(resolve(__dirname, '..', process.env.TWIN_ENV_FILE || '.env'), 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {
  /* .env optional */
}

const URL = (process.env.DIRECTUS_ADMIN_URL || process.env.PUBLIC_DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '');
const TOKEN = process.env.PUBLIC_DIRECTUS_TOKEN;
if (!TOKEN) {
  console.error('Set PUBLIC_DIRECTUS_TOKEN in .env');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');

const auth = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json'
};

// ─── Canonical list (must match src/lib/directus.ts) ────────────────────────
const CANONICAL = [
  { value: 'accommodation',          label: 'Accommodation Services' },
  { value: 'administrative',         label: 'Administrative & Support Services' },
  { value: 'construction',           label: 'Construction' },
  { value: 'consumer_services',      label: 'Consumer Services' },
  { value: 'education',              label: 'Education' },
  { value: 'entertainment',          label: 'Entertainment Providers' },
  { value: 'farming_forestry',       label: 'Farming & Forestry' },
  { value: 'financial_services',     label: 'Financial Services' },
  { value: 'fisheries',              label: 'Fisheries & Aquaculture' },
  { value: 'government',             label: 'Government Administration' },
  { value: 'healthcare',             label: 'Hospitals & Health Care' },
  { value: 'manufacturing',          label: 'Manufacturing' },
  { value: 'oil_gas_mining',         label: 'Oil, Gas & Mining' },
  { value: 'professional_services',  label: 'Professional Services' },
  { value: 'real_estate',            label: 'Real Estate' },
  { value: 'retail',                 label: 'Retail' },
  { value: 'technology',             label: 'Technology, Information & Media' },
  { value: 'transportation',         label: 'Transportation & Logistics' },
  { value: 'utilities',              label: 'Utilities' },
  { value: 'wholesale',              label: 'Wholesale' }
];

const VALUES = new Set(CANONICAL.map((o) => o.value));
const BY_LABEL = new Map(CANONICAL.map((o) => [o.label.toLowerCase(), o.value]));
const BY_VALUE = new Map(CANONICAL.map((o) => [o.value.toLowerCase(), o.value]));

// Loose alias table — maps common free-text industries to canonical values.
// Lowercase keys, exact match after .trim().toLowerCase().
const ALIASES = {
  // Tech
  'tech': 'technology',
  'technology': 'technology',
  'it': 'technology',
  'software': 'technology',
  'internet': 'technology',
  'media': 'technology',
  'information technology': 'technology',
  'information & technology': 'technology',
  'information technology and services': 'technology',
  'computer software': 'technology',
  'saas': 'technology',
  // Finance
  'finance': 'financial_services',
  'banking': 'financial_services',
  'investment': 'financial_services',
  'insurance': 'financial_services',
  'venture capital': 'financial_services',
  // Education
  'education': 'education',
  'university': 'education',
  'higher education': 'education',
  // Healthcare
  'health': 'healthcare',
  'healthcare': 'healthcare',
  'medical': 'healthcare',
  'pharma': 'healthcare',
  'pharmaceuticals': 'healthcare',
  'biotech': 'healthcare',
  // Real estate
  'real estate': 'real_estate',
  // Construction
  'construction': 'construction',
  'building': 'construction',
  // Retail
  'retail': 'retail',
  'ecommerce': 'retail',
  'e-commerce': 'retail',
  // Manufacturing
  'manufacturing': 'manufacturing',
  'factory': 'manufacturing',
  'industrial': 'manufacturing',
  // Transport
  'transportation': 'transportation',
  'transport': 'transportation',
  'logistics': 'transportation',
  'shipping': 'transportation',
  'aviation': 'transportation',
  // Hospitality (LinkedIn calls it Accommodation Services)
  'hospitality': 'accommodation',
  'hotel': 'accommodation',
  'tourism': 'accommodation',
  'travel': 'accommodation',
  'food service': 'accommodation',
  'restaurants': 'accommodation',
  // Energy
  'oil & gas': 'oil_gas_mining',
  'mining': 'oil_gas_mining',
  'energy': 'utilities',
  'utility': 'utilities',
  'power': 'utilities',
  // Entertainment
  'entertainment': 'entertainment',
  'music': 'entertainment',
  'film': 'entertainment',
  'gaming': 'entertainment',
  // Government
  'government': 'government',
  'public sector': 'government',
  // Professional services
  'consulting': 'professional_services',
  'professional services': 'professional_services',
  'legal': 'professional_services',
  'law': 'professional_services',
  'accounting': 'professional_services',
  'marketing': 'professional_services',
  'advertising': 'professional_services',
  'design': 'professional_services',
  // Farming / fisheries
  'agriculture': 'farming_forestry',
  'farming': 'farming_forestry',
  'forestry': 'farming_forestry',
  'fishing': 'fisheries',
  'fisheries': 'fisheries',
  'aquaculture': 'fisheries',
  'seafood': 'fisheries',
  // Wholesale
  'wholesale': 'wholesale',
  'distribution': 'wholesale',
  // Consumer services
  'consumer services': 'consumer_services',
  'consumer goods': 'consumer_services',
  // Administrative
  'admin': 'administrative',
  'administrative': 'administrative',
  'staffing': 'administrative',
  'recruiting': 'administrative'
};

// Values that mean "no real industry" — clear the field, don't create a tag.
const SKIP_AS_TAG = new Set(['other', 'misc', 'miscellaneous', 'unknown', 'n/a', 'na', '-', '—']);

function classify(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return { kind: 'empty' };
  const lower = v.toLowerCase();
  // Already canonical value (exact)
  if (VALUES.has(v)) return { kind: 'already', value: v };
  if (BY_VALUE.has(lower)) return { kind: 'already', value: BY_VALUE.get(lower) };
  // Stored as the human label
  if (BY_LABEL.has(lower)) return { kind: 'normalize', value: BY_LABEL.get(lower), original: v };
  // Alias
  if (ALIASES[lower]) return { kind: 'alias', value: ALIASES[lower], original: v };
  // Junk values — just clear, don't create a useless tag.
  if (SKIP_AS_TAG.has(lower)) return { kind: 'clear', original: v };
  return { kind: 'tag', original: v };
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────
async function get(path) {
  const r = await fetch(`${URL}${path}`, { headers: auth });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}
async function patch(path, body) {
  const r = await fetch(`${URL}${path}`, { method: 'PATCH', headers: auth, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PATCH ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}
async function post(path, body) {
  const r = await fetch(`${URL}${path}`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}

// Find or create a Tag with the given name. Cached in-memory for the run.
const tagCache = new Map();
async function ensureTag(name) {
  const key = name.toLowerCase();
  if (tagCache.has(key)) return tagCache.get(key);
  const found = await get(`/items/Tag?filter[name][_eq]=${encodeURIComponent(name)}&limit=1`);
  if (found.data?.length) {
    tagCache.set(key, found.data[0].id);
    return found.data[0].id;
  }
  if (!APPLY) {
    tagCache.set(key, '<new>');
    return '<new>';
  }
  const created = await post('/items/Tag', { name, scope: 'work', status: 'published' });
  tagCache.set(key, created.data.id);
  return created.data.id;
}

async function attachTag(orgId, tagId) {
  // Skip if already linked.
  const existing = await get(
    `/items/organization_tag?filter[organization_id][_eq]=${orgId}&filter[tag_id][_eq]=${tagId}&limit=1`
  );
  if (existing.data?.length) return 'already-linked';
  if (!APPLY) return 'would-link';
  await post('/items/organization_tag', { organization_id: orgId, tag_id: tagId });
  return 'linked';
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(APPLY ? '⚙  APPLY mode — writes will happen' : '🔍 DRY RUN — no writes (use --apply to commit)');

  // Pull every org with a non-null industry, paginated.
  const all = [];
  let page = 1;
  while (true) {
    const res = await get(
      `/items/organization?fields=id,name,industry&filter[industry][_nempty]=true&limit=200&page=${page}`
    );
    if (!res.data?.length) break;
    all.push(...res.data);
    if (res.data.length < 200) break;
    page++;
  }
  console.log(`Found ${all.length} orgs with an industry value.\n`);

  const tally = { already: 0, normalized: 0, aliased: 0, taggedAndCleared: 0, cleared: 0, errors: 0 };
  const moves = [];

  for (const org of all) {
    const c = classify(org.industry);
    try {
      if (c.kind === 'empty' || c.kind === 'already') {
        tally.already++;
        continue;
      }
      if (c.kind === 'normalize' || c.kind === 'alias') {
        moves.push({ id: org.id, name: org.name, from: org.industry, to: c.value, action: c.kind });
        if (APPLY) await patch(`/items/organization/${org.id}`, { industry: c.value });
        if (c.kind === 'normalize') tally.normalized++;
        else tally.aliased++;
        continue;
      }
      if (c.kind === 'clear') {
        moves.push({ id: org.id, name: org.name, from: org.industry, to: '(cleared)', action: 'clear' });
        if (APPLY) await patch(`/items/organization/${org.id}`, { industry: null });
        tally.cleared++;
        continue;
      }
      // c.kind === 'tag' — move to a Tag and clear the industry.
      const tagId = await ensureTag(c.original);
      const linkResult = APPLY ? await attachTag(org.id, tagId) : 'would-link';
      if (APPLY) await patch(`/items/organization/${org.id}`, { industry: null });
      moves.push({ id: org.id, name: org.name, from: org.industry, to: `tag:${c.original}`, action: 'tag', linkResult });
      tally.taggedAndCleared++;
    } catch (e) {
      tally.errors++;
      console.error(`  ✗ org ${org.id} (${org.name}): ${e.message}`);
    }
  }

  for (const m of moves) {
    const arrow = m.action === 'tag' ? '→ tag' : `→ ${m.to}`;
    console.log(`  [${m.action.padEnd(10)}] #${m.id} ${m.name}: "${m.from}" ${arrow}`);
  }

  console.log('\nTally:');
  console.log(`  already canonical: ${tally.already}`);
  console.log(`  normalized:        ${tally.normalized}`);
  console.log(`  aliased:           ${tally.aliased}`);
  console.log(`  moved to Tag:      ${tally.taggedAndCleared}`);
  console.log(`  cleared (junk):    ${tally.cleared}`);
  console.log(`  errors:            ${tally.errors}`);
  if (!APPLY) console.log('\nRe-run with --apply to commit these changes.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// ─── Field-metadata lockdown (run after migration) ──────────────────────────
// To turn the field into a select-dropdown in Directus admin so admins can't
// type free text, run:
//
//   curl -s -X PATCH "$PUBLIC_DIRECTUS_URL/fields/organization/industry" \
//     -H "Authorization: Bearer $PUBLIC_DIRECTUS_TOKEN" \
//     -H "Content-Type: application/json" \
//     -d '{
//       "meta": {
//         "interface": "select-dropdown",
//         "options": {
//           "choices": [
//             {"text":"Accommodation Services","value":"accommodation"},
//             {"text":"Administrative & Support Services","value":"administrative"},
//             {"text":"Construction","value":"construction"},
//             ... (full list)
//           ],
//           "allowOther": false
//         }
//       }
//     }'
//
// (See the companion script `scripts/lock-org-industry-field.sh`.)
