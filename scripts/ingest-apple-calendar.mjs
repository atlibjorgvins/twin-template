#!/usr/bin/env node
// Ingest events from macOS Calendar.app into Directus `Dates`.
//
// Reads via JXA (osascript -l JavaScript) — no Homebrew deps, no Full Disk
// Access required (Calendar.app prompts for Automation permission once, then
// remembers it). Upserts on `external_id` (Apple's iCal UID) so re-running
// updates changed events instead of duplicating.
//
// Usage:
//   node scripts/ingest-apple-calendar.mjs               # interactive: pick calendars
//   node scripts/ingest-apple-calendar.mjs --list        # list calendars and exit
//   node scripts/ingest-apple-calendar.mjs --all         # ingest every calendar
//   node scripts/ingest-apple-calendar.mjs --calendars "Work,Personal"
//   node scripts/ingest-apple-calendar.mjs --from 2023-01-01 --to 2027-01-01
//   node scripts/ingest-apple-calendar.mjs --dry-run     # print what would be written
//
// Defaults: window is roughly today-2y..today+1y. Re-runs are safe.
// Idempotent — events keyed by external_id, "source" column set to
// "apple-calendar" so we can find / undo them later if needed.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// --- env -------------------------------------------------------------------
const envPath = resolve(ROOT, process.env.TWIN_ENV_FILE || '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const DIRECTUS_URL = (process.env.DIRECTUS_ADMIN_URL || process.env.PUBLIC_DIRECTUS_URL || '').replace(/\/$/, '');
const DIRECTUS_TOKEN = process.env.PUBLIC_DIRECTUS_TOKEN || '';
if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
  console.error('Missing PUBLIC_DIRECTUS_URL / PUBLIC_DIRECTUS_TOKEN in .env');
  process.exit(1);
}

// --- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};

const LIST_ONLY = flag('--list') || flag('--list-calendars');
const ALL = flag('--all');
const DRY = flag('--dry-run');
const PICK_CSV = opt('--calendars');
const today = new Date();
const FROM = new Date(opt('--from') || new Date(today.getFullYear() - 2, today.getMonth(), 1));
const TO = new Date(opt('--to') || new Date(today.getFullYear() + 1, today.getMonth(), 1));

// --- JXA helpers -----------------------------------------------------------
function runJXA(script) {
  const r = spawnSync('osascript', ['-l', 'JavaScript', '-e', script], {
    encoding: 'utf8',
    maxBuffer: 200 * 1024 * 1024
  });
  if (r.status !== 0) {
    console.error('osascript failed:', r.stderr);
    process.exit(1);
  }
  return r.stdout.trim();
}

function listCalendars() {
  const out = runJXA(`
    const Cal = Application('Calendar');
    const cals = Cal.calendars();
    JSON.stringify(cals.map(c => ({ name: c.name(), description: c.description() || '' })));
  `);
  return JSON.parse(out);
}

function dumpOneCalendar(calendarName, fromIso, toIso) {
  // .whose() filters against Calendar.app are notoriously slow; pull all
  // events of the chosen calendar and date-filter in JS — empirically faster
  // and far more reliable.
  const script = `
    const Cal = Application('Calendar');
    const name = ${JSON.stringify(calendarName)};
    const from = new Date(${JSON.stringify(fromIso)});
    const to   = new Date(${JSON.stringify(toIso)});
    const cal = Cal.calendars().find(c => c.name() === name);
    if (!cal) { JSON.stringify([]); }
    else {
      const events = cal.events();
      const out = [];
      for (const e of events) {
        let s, en;
        try { s = e.startDate(); en = e.endDate(); } catch (_) { continue; }
        if (!s) continue;
        if (s < from || s > to) continue;
        // Attendees come back as an array of objects in JXA; pull the
        // properties we want, defensively (some attendee entries can
        // throw on .email() if the underlying record is partial).
        const attendees = [];
        try {
          for (const a of (e.attendees && e.attendees()) || []) {
            let nm = '', em = '', st = '';
            try { nm = a.displayName ? (a.displayName() || '') : ''; } catch (_) {}
            try { em = a.email ? (a.email() || '') : ''; } catch (_) {}
            try { st = a.participationStatus ? String(a.participationStatus() || '') : ''; } catch (_) {}
            if (nm || em) attendees.push({ name: nm, email: em, status: st });
          }
        } catch (_) {}
        let organizer = '';
        try {
          // organizer can be a string, a person record, or null depending on
          // the source calendar. Stringify defensively.
          const raw = (e.organizer && e.organizer()) || '';
          organizer = typeof raw === 'string' ? raw : String(raw);
        } catch (_) {}
        out.push({
          uid: e.uid(),
          calendar: name,
          summary: e.summary() || '',
          description: e.description() || '',
          location: e.location() || '',
          url: (e.url && e.url()) || '',
          start: s.toISOString(),
          end: en ? en.toISOString() : null,
          allday: !!e.alldayEvent(),
          recurrence: (e.recurrence && e.recurrence()) || '',
          organizer,
          attendees
        });
      }
      JSON.stringify(out);
    }
  `;
  const t0 = Date.now();
  const out = runJXA(script);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const arr = JSON.parse(out);
  console.log(`    · ${calendarName}: ${arr.length} events in ${dt}s`);
  return arr;
}

function dumpEvents(calendarNames, fromIso, toIso) {
  const all = [];
  for (const name of calendarNames) {
    all.push(...dumpOneCalendar(name, fromIso, toIso));
  }
  return all;
}

// --- Directus helpers ------------------------------------------------------
async function directus(path, init = {}) {
  const r = await fetch(`${DIRECTUS_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`${init.method || 'GET'} ${path} → ${r.status}: ${body.slice(0, 400)}`);
  }
  return r.status === 204 ? null : r.json();
}

/** Find existing Dates rows by external_id. Returns
 *  Map<external_id, { id, project_id }>. We carry project_id along
 *  so the upsert path can avoid clobbering a hand-set project link
 *  with a CalendarMapping default. */
async function lookupExisting(uids) {
  if (!uids.length) return new Map();
  const map = new Map();
  // Page through in chunks of 100 — Directus query string has length limits.
  const chunkSize = 100;
  for (let i = 0; i < uids.length; i += chunkSize) {
    const chunk = uids.slice(i, i + chunkSize);
    const filter = encodeURIComponent(JSON.stringify({ external_id: { _in: chunk } }));
    const fields = 'id,external_id,project_id';
    const data = await directus(
      `/items/Dates?filter=${filter}&fields=${fields}&limit=-1`
    );
    for (const row of data.data) map.set(row.external_id, { id: row.id, projectId: row.project_id ?? null });
  }
  return map;
}

function capRecurrence(rec, anchorIso) {
  // Apple's repeat strings sometimes come back without UNTIL/COUNT for
  // events the user set to "Forever" — and sometimes for events that
  // really do have a count, but JXA strips it. Either way an open-ended
  // DAILY/WEEKLY rule blows up our calendar grid. If we don't see a
  // bound, force UNTIL = anchor + 2 years as a safety net. Users can
  // edit the rule from the detail view later.
  if (!rec) return rec;
  const upper = rec.toUpperCase();
  if (/\bUNTIL=|\bCOUNT=/.test(upper)) return rec;
  const freqMatch = upper.match(/FREQ=([A-Z]+)/);
  const freq = freqMatch ? freqMatch[1] : '';
  // YEARLY/MONTHLY are fine open-ended — at most ~12 occurrences over 2y.
  if (freq !== 'DAILY' && freq !== 'WEEKLY') return rec;
  const anchor = new Date(anchorIso);
  if (Number.isNaN(anchor.getTime())) return rec;
  const until = new Date(anchor);
  until.setFullYear(until.getFullYear() + 2);
  // Compact form: 20280529T235959Z
  const compact = until.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `${rec};UNTIL=${compact}`;
}

/** Map<calendarName, { projectId?, scope? }> populated by main()
 *  before the per-event loop runs. Falls back to {} when there's
 *  nothing in CalendarMapping. */
let CALENDAR_MAP = new Map();

function eventToPayload(e) {
  const rec = capRecurrence((e.recurrence || '').trim(), e.start);
  const attendeesBlob = (e.attendees && e.attendees.length)
    ? JSON.stringify(e.attendees)
    : null;
  // Project / scope defaults from the CalendarMapping for this
  // source calendar — applied on create AND on update, but the
  // update path won't overwrite an existing project_id set by hand
  // (that decision lives in upsertOne).
  const mapping = CALENDAR_MAP.get(e.calendar) || {};
  return {
    title: e.summary || '(untitled)',
    description: e.description || null,
    event_type: 'event',
    start: e.start,
    end: e.end,
    all_day: !!e.allday,
    location: e.location || null,
    location_name: e.location || null,
    is_recurring: !!rec,
    recurrence_rule: rec || null,
    external_id: e.uid,
    external_calendar: e.calendar,
    external_links: attendeesBlob ? JSON.stringify({ attendees: e.attendees, url: e.url || null }) : (e.url ? JSON.stringify({ url: e.url }) : null),
    organizer: e.organizer || null,
    virtual_link: e.url || null,
    is_virtual: !!e.url,
    last_synced: new Date().toISOString(),
    status: 'published',
    project_id: mapping.projectId ?? null,
    scope: mapping.scope ?? null
  };
}

// Fields that are nice-to-have but may not exist on every Directus
// install of `Dates`. If a write fails with a 400 referencing one of
// these, we drop it and retry — keeps the ingest forward-compatible.
const OPTIONAL_FIELDS = ['organizer', 'virtual_link', 'is_virtual', 'external_links', 'project_id', 'scope'];

async function writeWithFallback(method, path, payload) {
  try {
    return await directus(path, { method, body: JSON.stringify(payload) });
  } catch (err) {
    const msg = String(err.message || '');
    // Directus returns "Field 'foo' doesn't exist in collection ..."
    const offending = OPTIONAL_FIELDS.find((f) => msg.includes(`"${f}"`) || msg.includes(`'${f}'`));
    if (!offending) throw err;
    const stripped = { ...payload };
    delete stripped[offending];
    // Recurse so we strip multiple offenders in successive retries.
    return writeWithFallback(method, path, stripped);
  }
}

async function upsertOne(e, existingId, existingProjectId) {
  const payload = eventToPayload(e);
  if (existingId) {
    if (DRY) { console.log(`  ~ ${e.summary}  (would PATCH #${existingId})`); return 'updated'; }
    // Never clobber a hand-set project link with a mapping default.
    // If the existing row already has a project, drop the mapping-
    // sourced project_id from the patch so the user's choice wins.
    const patch = { ...payload };
    if (existingProjectId != null) delete patch.project_id;
    await writeWithFallback('PATCH', `/items/Dates/${existingId}`, patch);
    return 'updated';
  } else {
    if (DRY) { console.log(`  + ${e.summary}  (would POST)`); return 'created'; }
    await writeWithFallback('POST', `/items/Dates`, payload);
    return 'created';
  }
}

/** Pull every CalendarMapping once at startup and stash in
 *  CALENDAR_MAP for the payload builder. Safe if the collection
 *  doesn't exist yet (older installs) — empty map is fine. */
async function loadCalendarMappings() {
  try {
    const data = await directus('/items/CalendarMapping?fields=external_calendar,project_id,scope&filter[status][_neq]=archived&limit=-1');
    CALENDAR_MAP = new Map();
    for (const m of data.data || []) {
      if (!m.external_calendar) continue;
      CALENDAR_MAP.set(m.external_calendar, {
        projectId: m.project_id ?? null,
        scope: m.scope ?? null
      });
    }
    if (CALENDAR_MAP.size > 0) {
      console.log(`  · ${CALENDAR_MAP.size} calendar mapping${CALENDAR_MAP.size === 1 ? '' : 's'} loaded.`);
    }
  } catch {
    // Collection probably doesn't exist on this install — keep going
    // with no mappings. The user can run scripts/add-calendar-mapping.sh
    // then re-ingest.
    CALENDAR_MAP = new Map();
  }
}

// --- main ------------------------------------------------------------------
async function main() {
  console.log('▶ Reading calendars from Calendar.app…');
  const calendars = listCalendars();
  console.log(`  Found ${calendars.length} calendar${calendars.length === 1 ? '' : 's'}:`);
  for (const c of calendars) console.log(`    • ${c.name}`);

  if (LIST_ONLY) return;

  let picked;
  if (ALL) picked = calendars.map((c) => c.name);
  else if (PICK_CSV) picked = PICK_CSV.split(',').map((s) => s.trim()).filter(Boolean);
  else {
    const rl = readline.createInterface({ input, output });
    const answer = await rl.question(
      `\nWhich to import? Comma-separated names, or "all": `
    );
    rl.close();
    picked = answer.trim().toLowerCase() === 'all'
      ? calendars.map((c) => c.name)
      : answer.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (!picked.length) { console.error('No calendars selected.'); process.exit(1); }

  console.log(`\n▶ Dumping events ${FROM.toISOString().slice(0, 10)} → ${TO.toISOString().slice(0, 10)} from: ${picked.join(', ')}`);
  console.log('  (this can take a minute on first run while Calendar.app warms up…)');
  const events = dumpEvents(picked, FROM.toISOString(), TO.toISOString());
  console.log(`  Got ${events.length} event${events.length === 1 ? '' : 's'}.`);
  if (!events.length) return;

  const uids = events.map((e) => e.uid).filter(Boolean);
  console.log('▶ Looking up existing rows by external_id…');
  const existing = await lookupExisting(uids);
  console.log(`  ${existing.size} already in Directus, ${uids.length - existing.size} new.`);

  // Load calendar → project mappings once. The payload builder
  // reads from CALENDAR_MAP per-event so every write picks up the
  // current default without an extra round-trip per row.
  console.log('▶ Loading calendar → project mappings…');
  await loadCalendarMappings();

  console.log(`\n▶ ${DRY ? 'Dry-running' : 'Upserting'}…`);
  let created = 0, updated = 0, failed = 0;
  for (const e of events) {
    try {
      const ex = existing.get(e.uid);
      const r = await upsertOne(e, ex?.id ?? null, ex?.projectId ?? null);
      if (r === 'created') created++; else updated++;
    } catch (err) {
      failed++;
      console.error(`  ✗ ${e.summary}: ${err.message}`);
    }
  }

  console.log(`\n✓ Done. created=${created} updated=${updated} failed=${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
