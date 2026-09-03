#!/usr/bin/env node
// Import the Rannís Úthlutanir feed (JSON dump from sjodir.rannis.is)
// into GrantAward rows. Idempotent — upserts on external_id (rannis_id).
//
// Steps per row:
//   1. Ensure a Grant (programme) exists for the row's app_type, linked
//      to the Rannís funder org.
//   2. Resolve Domain (top_category) — find-or-create.
//   3. Resolve Subdomain (sub_category) — find-or-create.
//   4. Try to match the applicant name to an existing org. The raw
//      label is always stored on the award so the user can review
//      unlinked ones in the UI later.
//   5. Classify the contact: org-shape suffix (ehf./hf./slf./…) → org,
//      otherwise → person. Tentatively match by name; the raw label
//      is always kept.
//   6. Upsert GrantAward by external_id.
//
// Usage:
//   node scripts/import-rannis-grants.mjs <path-to-json>            # dry-run report
//   node scripts/import-rannis-grants.mjs <path-to-json> --apply    # actually write
//   node scripts/import-rannis-grants.mjs <path-to-json> --apply --limit 50

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
const file = argv.find((a) => !a.startsWith('--'));
const flag = (n) => argv.includes(n);
const opt = (n, dflt) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : dflt; };
const APPLY = flag('--apply');
const LIMIT = parseInt(opt('--limit', '0'), 10) || 0;
const FUND = opt('--fund', 'Tækniþróunarsjóður'); // source `fund` column to import (skip rows from other funds)
const FUNDER_NAME = opt('--funder', 'Rannís');

if (!file) { console.error('Usage: node scripts/import-rannis-grants.mjs <path-to-json> [--apply] [--limit N]'); process.exit(1); }

async function api(path, init = {}) {
  const r = await fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? null : r.json();
}

// ─── name normalisation ─────────────────────────────────────────────
// Lowercase, strip diacritics-free legal suffixes, collapse whitespace.
// Used as a join key — never persisted.
const SUFFIX_RE = /\s+(ehf\.?|hf\.?|slf\.?|sf\.?|svf\.?|bs\.?|ses\.?|ohf\.?|sa\.?|sjf\.?)$/i;
const ORG_SUFFIX_RE = /\b(ehf|hf|slf|sf|svf|bs|ses|ohf|sa|sjf)\.?$/i;
const normalize = (s) => (s || '').trim().toLowerCase().replace(SUFFIX_RE, '').replace(/\s+/g, ' ').trim();
const looksLikeOrg = (s) => !!s && ORG_SUFFIX_RE.test(s.trim());

// ─── cache helpers ──────────────────────────────────────────────────
async function loadAll(collection, fields) {
  const out = [];
  let offset = 0;
  for (;;) {
    const data = await api(`/items/${collection}?fields=${fields}&limit=1000&offset=${offset}&sort=id`);
    out.push(...data.data);
    if (data.data.length < 1000) break;
    offset += 1000;
  }
  return out;
}

async function findOrCreate(collection, lookupField, value, createPayload) {
  const filter = encodeURIComponent(JSON.stringify({ [lookupField]: { _eq: value } }));
  const data = await api(`/items/${collection}?filter=${filter}&fields=id,${lookupField}&limit=1`);
  if (data.data.length) return data.data[0].id;
  if (!APPLY) {
    console.log(`    [dry] would create ${collection}.${lookupField}="${value}"`);
    return null;
  }
  const created = await api(`/items/${collection}`, { method: 'POST', body: JSON.stringify(createPayload) });
  return created.data.id;
}

// ─── main ───────────────────────────────────────────────────────────
async function main() {
  const raw = readFileSync(file, 'utf8');
  let rows = JSON.parse(raw);
  if (!Array.isArray(rows)) { console.error('JSON root must be an array.'); process.exit(1); }
  rows = rows.filter((r) => !FUND || r.fund === FUND);
  if (LIMIT) rows = rows.slice(0, LIMIT);
  console.log(`▶ ${rows.length} rows after fund filter "${FUND}"${LIMIT ? ` (limit ${LIMIT})` : ''}.`);

  // Pre-load reference data.
  console.log('▶ Loading existing orgs, people, grants, domains, subdomains, awards…');
  const [orgs, people, grants, domains, subdomains, awards] = await Promise.all([
    loadAll('organization', 'id,name'),
    loadAll('Person', 'id,full_name,first_name,last_name'),
    loadAll('Grant', 'id,name,short_name,funder_org_id'),
    loadAll('Domain', 'id,name'),
    loadAll('Subdomain', 'id,name'),
    loadAll('GrantAward', 'id,external_id,external_source')
  ]);
  const orgByName = new Map();
  for (const o of orgs) orgByName.set(normalize(o.name), o.id);
  const personByName = new Map();
  for (const p of people) {
    const full = (p.full_name && p.full_name.trim()) || [p.first_name, p.last_name].filter(Boolean).join(' ');
    if (full) personByName.set(normalize(full), p.id);
  }
  const grantByName = new Map();
  for (const g of grants) grantByName.set(g.name, g.id);
  const domainByName = new Map();
  for (const d of domains) domainByName.set(d.name, d.id);
  const subdomainByName = new Map();
  for (const s of subdomains) subdomainByName.set(s.name, s.id);
  const awardByExt = new Map();
  for (const a of awards) if (a.external_id) awardByExt.set(`${a.external_source || ''}:${a.external_id}`, a.id);

  // Funder org (Rannís) — ensure it exists.
  let funderId = orgByName.get(normalize(FUNDER_NAME)) ?? null;
  if (!funderId) {
    console.log(`▶ Funder org "${FUNDER_NAME}" not found.${APPLY ? ' Creating…' : ' (dry-run — would create)'}`);
    if (APPLY) {
      const r = await api('/items/organization', { method: 'POST', body: JSON.stringify({ name: FUNDER_NAME, status: 'published' }) });
      funderId = r.data.id;
      orgByName.set(normalize(FUNDER_NAME), funderId);
    }
  }

  // Stats
  let created = 0, updated = 0, skipped = 0, unlinkedApplicants = 0, unlinkedContacts = 0;
  const newGrants = new Set(), newDomains = new Set(), newSubdomains = new Set();

  for (const row of rows) {
    try {
      // ── Grant programme (per app_type) ──────────────────────────
      const programmeName = row.app_type || row.title || 'Annað';
      let grantId = grantByName.get(programmeName);
      if (!grantId) {
        newGrants.add(programmeName);
        if (APPLY) {
          const r = await api('/items/Grant', { method: 'POST', body: JSON.stringify({
            name: programmeName,
            funder_org_id: funderId,
            funder_label: FUNDER_NAME,
            country: 'Iceland',
            currency: 'ISK',
            is_recurring: true,
            status: 'published'
          }) });
          grantId = r.data.id;
          grantByName.set(programmeName, grantId);
        }
      }

      // ── Domain / Subdomain ─────────────────────────────────────
      let domainId = null;
      const tc = (row.top_category || '').trim();
      if (tc && tc !== '-- Ekkert valið --') {
        domainId = domainByName.get(tc);
        if (!domainId) {
          newDomains.add(tc);
          if (APPLY) {
            const r = await api('/items/Domain', { method: 'POST', body: JSON.stringify({ name: tc, status: 'published' }) });
            domainId = r.data.id;
            domainByName.set(tc, domainId);
          }
        }
      }
      let subdomainId = null;
      const sc = (row.sub_category || '').trim();
      if (sc && sc !== '-- Ekkert valið --') {
        subdomainId = subdomainByName.get(sc);
        if (!subdomainId) {
          newSubdomains.add(sc);
          if (APPLY) {
            const r = await api('/items/Subdomain', { method: 'POST', body: JSON.stringify({ name: sc, status: 'published' }) });
            subdomainId = r.data.id;
            subdomainByName.set(sc, subdomainId);
          }
        }
      }

      // ── Applicant (Umsækjandi) — try match, always keep label ───
      const applicantLabel = row.applicant ?? null;
      const applicantId = applicantLabel ? (orgByName.get(normalize(applicantLabel)) ?? null) : null;
      if (applicantLabel && !applicantId) unlinkedApplicants++;

      // ── Contact (Verkefnisstjóri) — classify person vs org ──────
      const contactLabel = row.contact ?? null;
      let contactPersonId = null, contactOrgId = null;
      if (contactLabel) {
        if (looksLikeOrg(contactLabel)) {
          contactOrgId = orgByName.get(normalize(contactLabel)) ?? null;
        } else {
          contactPersonId = personByName.get(normalize(contactLabel)) ?? null;
        }
        if (!contactPersonId && !contactOrgId) unlinkedContacts++;
      }

      // ── Build payload ───────────────────────────────────────────
      const payload = {
        grant_id: grantId ?? null,
        organization_id: applicantId,
        applicant_label: applicantLabel,
        contact_label: contactLabel,
        contact_person_id: contactPersonId,
        contact_org_id: contactOrgId,
        domain_id: domainId,
        subdomain_id: subdomainId,
        region_acronym: row.area_acronym || null,
        award_name: row.title || null,
        description: row.description || null,
        total_amount: row.amount ? Number(row.amount) : null,
        currency: 'ISK',
        awarded_year: row.fund_year ? Number(row.fund_year) : null,
        fund_year: row.fund_year ? Number(row.fund_year) : null,
        booking_year: row.booking_year ? Number(row.booking_year) : null,
        external_id: row.rannis_id || null,
        external_source: 'rannis',
        award_status: 'awarded',
        status: 'published'
      };

      // ── Upsert ──────────────────────────────────────────────────
      const key = `rannis:${row.rannis_id}`;
      const existingId = awardByExt.get(key);
      if (existingId) {
        if (APPLY) {
          await api(`/items/GrantAward/${existingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        }
        updated++;
      } else {
        if (APPLY) {
          await api('/items/GrantAward', { method: 'POST', body: JSON.stringify(payload) });
        }
        created++;
      }
    } catch (err) {
      skipped++;
      console.error(`  ✗ row rannis_id=${row.rannis_id}: ${err.message}`);
    }
  }

  console.log('');
  console.log('────────── summary ──────────');
  console.log(`  ${APPLY ? 'Created' : 'Would create'}:        ${created}`);
  console.log(`  ${APPLY ? 'Updated' : 'Would update'}:        ${updated}`);
  console.log(`  Skipped (errors):    ${skipped}`);
  console.log(`  New programmes:      ${newGrants.size}${newGrants.size ? ` — ${[...newGrants].slice(0, 8).join(', ')}${newGrants.size > 8 ? '…' : ''}` : ''}`);
  console.log(`  New domains:         ${newDomains.size}`);
  console.log(`  New subdomains:      ${newSubdomains.size}`);
  console.log(`  Unlinked applicants: ${unlinkedApplicants}  (label kept; link from /grants UI)`);
  console.log(`  Unlinked contacts:   ${unlinkedContacts}  (label kept)`);
  if (!APPLY) console.log('\n(dry-run — pass --apply to actually write.)');
}

main().catch((e) => { console.error(e); process.exit(1); });
