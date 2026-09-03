// Calendar / Dates
//
// The calendar event store. 521 lines and the largest single section left.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { Filter } from '$lib/data/repo';
import type { CalendarEvent, DateEvent, DateEventKind, DatePerson, Organization, Person, Project } from '$lib/data/types';
import { personName } from '$lib/data/people';

// ─── Calendar / Dates ──────────────────────────────────────────────────────

const DATE_FIELDS = [
  'id', 'title', 'description', 'event_type',
  'start', 'end', 'all_day', 'color',
  'location', 'location_name', 'location_address',
  'is_recurring', 'recurrence_rule', 'recurrence_end_date',
  'source', 'source_ref', 'scope', 'status',
  'external_id', 'external_calendar',
  // Meeting metadata — captured by the Apple Calendar ingest and shown
  // in the calendar's view-mode dialog. Each is optional; the dialog
  // renders only the rows that have content.
  'organizer', 'virtual_link', 'is_virtual', 'external_links',
  // Pull the project's accent colour through the M2O so the calendar
  // can tint chips by project without a second fetch.
  { project_id: ['id', 'name', 'kind', 'color'] },
  { organization: ['id', 'name', 'logo', 'image_focal'] }
] as const;

/** Return all stored Dates rows whose [start, end] overlaps the given
 *  window. Recurring rows are returned **once** — callers that render
 *  occurrences should pass each through `expandRecurrence()` from
 *  `$lib/recurrence` to get the per-period instances. */
export async function listDatesInRange(rangeStart: Date, rangeEnd: Date): Promise<DateEvent[]> {
  // Two parallel filters joined client-side:
  //   - non-recurring rows that overlap the window directly
  //   - recurring rows whose anchor `start` is on or before the
  //     window end (we'll expand them later via expandRecurrence)
  const where: Filter = {
    and: [
      { field: 'status', op: 'neq', value: 'archived' },
      // Legacy auto-generated birthday rows are excluded here, once, for every
      // consumer of this query.
      //
      // A batch of them was written on 2026-05-02 titled "🎂 Person #232's
      // Birthday" — the person's id, not their name, because whatever created
      // them never resolved it. Birthdays are already DERIVED from
      // Person.birthday by listBirthdaysInRange(), with the real name, the age
      // and the avatar, so every one of these rows is a worse duplicate of an
      // entry the UI produces anyway. Today and the calendar both merge stored
      // rows with derived ones, so they showed up twice in both places.
      //
      // Matched on `external_id` rather than title or event_type so a birthday
      // event someone creates BY HAND still shows: only the machine-written
      // ones carry `birthday_person_<id>`.
      //
      // The rows are left in the database deliberately — this hides them, it
      // does not delete anything, and dropping this clause brings them back.
      //
      // The `or` with `null` is NOT redundant. `nstartswith` alone drops rows
      // whose external_id is NULL, because in SQL `NOT (NULL LIKE …)` is NULL
      // rather than true — measured against the live data: 1475 rows total,
      // 17 birthdays, but the bare filter returned 1412 instead of 1458. The
      // missing 46 were exactly the NULL-external_id rows, i.e. ordinary
      // events that would have vanished from Today and the calendar.
      {
        or: [
          { field: 'external_id', op: 'null' },
          { field: 'external_id', op: 'nstartswith', value: 'birthday_person_' }
        ]
      },
      {
        or: [
          // One-shot overlap
          {
            and: [
              { field: 'is_recurring', op: 'neq', value: true },
              { field: 'start', op: 'lt', value: rangeEnd.toISOString() },
              {
                or: [
                  { field: 'end', op: 'null' },
                  { field: 'end', op: 'gt', value: rangeStart.toISOString() }
                ]
              }
            ]
          },
          // Recurring anchors — pull them in and let the expander run.
          {
            and: [
              { field: 'is_recurring', op: 'eq', value: true },
              { field: 'start', op: 'lt', value: rangeEnd.toISOString() }
            ]
          }
        ]
      }
    ]
  };
  return repo.list<DateEvent>('Dates', {
    where,
    fields: DATE_FIELDS,
    sort: ['start'],
    limit: -1
  });
}

/** Free-text search across stored events (Dates rows). Matches title,
 *  description, and location; newest first. Used by the calendar's
 *  mobile tools menu for an event-only autocomplete. Returns the full
 *  DATE_FIELDS shape so callers can hand a hit straight to
 *  dateRowToCalendarEvent(). */
export async function searchEvents(q: string, limit = 12): Promise<DateEvent[]> {
  const query = q.trim();
  if (!query) return [];
  return repo.list<DateEvent>('Dates', {
    where: {
      and: [
        { field: 'status', op: 'neq', value: 'archived' },
        {
          or: [
            { field: 'title', op: 'icontains', value: query },
            { field: 'description', op: 'icontains', value: query },
            { field: 'location_name', op: 'icontains', value: query },
            { field: 'location', op: 'icontains', value: query }
          ]
        }
      ]
    },
    fields: DATE_FIELDS,
    sort: ['-start'],
    limit
  });
}

/** Birthdays in window — derived from Person.birthday, projected to the year(s)
 *  covered by [rangeStart, rangeEnd]. Two emissions for ranges spanning a Dec→Jan
 *  flip. Stored as MM-DD; we render this year + next year as needed. */
export async function listBirthdaysInRange(rangeStart: Date, rangeEnd: Date): Promise<CalendarEvent[]> {
  const people = await repo.list<Person>('Person', {
    where: {
      and: [
        { field: 'status', op: 'neq', value: 'archived' },
        { field: 'birthday', op: 'nnull' }
      ]
    },
    fields: ['id', 'first_name', 'last_name', 'full_name', 'birthday', 'scope', 'person_picture', 'image_focal'],
    limit: -1
  });

  const startY = rangeStart.getFullYear();
  const endY = rangeEnd.getFullYear();
  const out: CalendarEvent[] = [];
  for (const p of people) {
    if (!p.birthday) continue;
    const d = new Date(p.birthday);
    if (Number.isNaN(d.getTime())) continue;
    const m = d.getMonth();
    const day = d.getDate();
    for (let y = startY; y <= endY; y++) {
      const occ = new Date(y, m, day, 0, 0, 0, 0);
      if (occ < rangeStart || occ >= rangeEnd) continue;
      out.push({
        key: `birthday:${p.id}:${y}`,
        title: `🎂 ${personName(p)}`,
        start: occ,
        end: new Date(y, m, day, 23, 59, 59, 999),
        allDay: true,
        kind: 'birthday',
        source: 'birthday_derived',
        color: '#C6762A',
        scope: p.scope ?? null,
        href: `/people/${p.id}`,
        meta: {
          personId: p.id,
          personName: personName(p),
          personPicture: p.person_picture ?? null,
          imageFocal: p.image_focal ?? null,
          age: y - d.getFullYear()
        }
      });
    }
  }
  return out;
}

/** Project spans — derived from Project.start_date/end_date. Renders as
 *  multi-day all-day bands across the calendar so you can see what's running. */
export async function listProjectSpansInRange(rangeStart: Date, rangeEnd: Date): Promise<CalendarEvent[]> {
  const projects = await repo.list<Project>('Project', {
    where: {
      and: [
        { field: 'status', op: 'neq', value: 'archived' },
        {
          or: [
            { field: 'start_date', op: 'nnull' },
            { field: 'end_date', op: 'nnull' }
          ]
        }
      ]
    },
    fields: ['id', 'name', 'kind', 'start_date', 'end_date', 'scope'],
    limit: -1
  });

  const out: CalendarEvent[] = [];
  for (const p of projects) {
    const s = p.start_date ? new Date(p.start_date) : null;
    const e = p.end_date ? new Date(p.end_date) : null;
    // Skip if neither dates set, or if span doesn't overlap window.
    if (!s && !e) continue;
    const start = s ?? e!;
    const end = e ?? s!;
    if (end < rangeStart || start >= rangeEnd) continue;
    out.push({
      key: `project:${p.id}`,
      title: p.name ?? 'Project',
      start,
      end: new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999),
      allDay: true,
      kind: 'project_span',
      source: 'project_derived',
      color: '#2C8C99',
      scope: p.scope ?? null,
      href: `/projects/${p.id}`,
      // Use `project_id` to match the key used by Dates rows so the calendar's
      // filter logic can check a single field for both event sources.
      meta: { projectId: p.id, project_id: p.id, project: p }
    });
  }
  return out;
}

/** Convert a stored Dates row to the unified CalendarEvent shape. */
export function dateRowToCalendarEvent(d: DateEvent): CalendarEvent | null {
  if (!d.start) return null;
  const start = new Date(d.start);
  const end = d.end ? new Date(d.end) : new Date(start.getTime() + 30 * 60 * 1000);
  const project = d.project_id && typeof d.project_id === 'object' ? (d.project_id as Project) : null;
  const organization = d.organization && typeof d.organization === 'object' ? (d.organization as Organization) : null;
  return {
    key: `dates:${d.id}`,
    title: d.title ?? '(untitled event)',
    start,
    end,
    allDay: !!d.all_day,
    kind: (d.event_type as DateEventKind) ?? 'event',
    source: d.source ?? 'manual',
    color: d.color ?? null,
    scope: d.scope ?? null,
    datesId: d.id,
    meta: {
      description: d.description,
      location: d.location_name ?? d.location,
      project,
      organization,
      project_id: typeof d.project_id === 'number' ? d.project_id : project?.id ?? null,
      organization_id: typeof d.organization === 'number' ? d.organization : organization?.id ?? null,
      external_calendar: (d as DateEvent & { external_calendar?: string | null }).external_calendar ?? null,
      organizer: (d as DateEvent & { organizer?: unknown }).organizer ?? null,
      virtual_link: d.virtual_link ?? null,
      is_virtual: d.is_virtual ?? false,
      external_links_raw: (d as DateEvent & { external_links?: unknown }).external_links ?? null,
      // Keep a thin view of the source row so the edit form can read
      // recurrence + any field we don't promote to the top-level
      // CalendarEvent shape.
      row: {
        is_recurring: d.is_recurring ?? false,
        recurrence_rule: d.recurrence_rule ?? null,
        recurrence_end_date: d.recurrence_end_date ?? null
      }
    }
  };
}

/** Read a single Dates row with the full DATE_FIELDS expansion —
 *  project_id and organization come back as full objects, not raw
 *  ids. Used after create/update so the in-memory CalendarEvent's
 *  meta.project / meta.organization stays accurate. Directus's
 *  POST/PATCH responses don't expand relations, so without this
 *  callers see the FK id only and any relation-dependent UI
 *  (e.g. the picker re-seed in openEvent) appears empty. */
export async function getDateRow(id: number): Promise<DateEvent> {
  const row = await repo.get<DateEvent>('Dates', id, { fields: DATE_FIELDS });
  if (!row) throw new Error(`Dates ${id} not found`);
  return row;
}

// Look up an event by its upstream calendar UID (external_id). Used by the
// phone-import flow to dedup: re-importing the same Apple/Google event finds
// the existing row instead of creating a duplicate.
export async function findDateByExternalId(externalId: string): Promise<DateEvent | null> {
  const uid = externalId.trim();
  if (!uid) return null;
  const rows = await repo.list<DateEvent>('Dates', {
    where: { field: 'external_id', op: 'eq', value: uid },
    fields: ['id', 'title', 'start', 'external_id'],
    limit: 1
  });
  return rows[0] ?? null;
}
export async function createDateRow(patch: Partial<DateEvent> & { title: string; start: string }): Promise<DateEvent> {
  const created = await repo.create<DateEvent>('Dates', patch as Record<string, unknown>);
  // Re-read with relation expansion so callers get { id, name, kind, color }
  // for project_id and organization instead of bare FK integers.
  return getDateRow(created.id);
}
export async function updateDateRow(id: number, patch: Partial<DateEvent>): Promise<DateEvent> {
  await repo.update('Dates', id, patch as Record<string, unknown>);
  return getDateRow(id);
}
export async function deleteDateRow(id: number): Promise<void> {
  await repo.remove('Dates', id);
}

/** Bulk update — used by the calendar list view's batch panel. */
export async function bulkUpdateDateRows(ids: number[], patch: Partial<DateEvent>): Promise<void> {
  if (ids.length === 0) return;
  await repo.updateMany('Dates', ids, patch as Record<string, unknown>);
}
/** Bulk archive — sets status='archived' on every id. */
export async function bulkArchiveDateRows(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await repo.updateMany('Dates', ids, { status: 'archived' });
}

/** People linked to a Date event via the Dates_Person junction. */
export async function getDatePeople(dateId: number): Promise<DatePerson[]> {
  return repo.list<DatePerson>('Dates_Person', {
    where: { field: 'Dates_id', op: 'eq', value: dateId },
    fields: [
      'id',
      'Dates_id',
      { Person_id: ['id', 'full_name', 'first_name', 'last_name', 'person_picture', 'image_focal'] }
    ],
    limit: -1
  });
}

/** Look up Person rows whose email matches any of the given addresses.
 *  Case-insensitive — fetched once and matched in JS rather than
 *  trying for an _iequals operator that isn't actually in Directus's
 *  filter vocabulary (using _icontains would risk substring false-
 *  positives like "a@b.com" matching "lots-of-text-a@b.com"). At our
 *  scale (~hundreds of people) the single round-trip is cheaper than
 *  N filter queries anyway. Returns a Map keyed by the *lowercased*
 *  email; addresses with multiple matches surface all of them — the
 *  caller decides how to disambiguate. */
export async function findPeopleByEmails(
  emails: string[]
): Promise<Map<string, Person[]>> {
  const out = new Map<string, Person[]>();
  const wanted = new Set(
    emails.map((e) => (e ?? '').trim().toLowerCase()).filter(Boolean)
  );
  if (wanted.size === 0) return out;

  // Three parallel sweeps, because one person's addresses live in three
  // places: the primary on Person, a work address per
  // Person_organization role, and any number of extras in Person_email.
  // Before that third table an attendee on a third address resolved to
  // nobody and got "created" as a duplicate of somebody already here.
  const [personRows, roleRows, extraRows] = await Promise.all([
    repo.list<Person>('Person', {
      where: {
        and: [
          { field: 'status', op: 'neq', value: 'archived' },
          { field: 'email', op: 'nnull' }
        ]
      },
      fields: ['id', 'full_name', 'first_name', 'last_name', 'email', 'person_picture', 'image_focal'],
      limit: -1
    }),
    repo.list<{ id: number; work_email: string | null; person_id: Person | number | null }>(
      'Person_organization',
      {
        // Person_organization has no `status` column — only filter on
        // what exists, or the whole sweep 400s and the dialog shows
        // "Couldn't resolve attendees" instead of the matched list.
        // The push() loop below still excludes archived *people* via
        // the nested person_id.status, so the result is archive-aware.
        where: { field: 'work_email', op: 'nnull' },
        fields: [
          'id', 'work_email',
          { person_id: ['id', 'full_name', 'first_name', 'last_name', 'email', 'person_picture', 'image_focal', 'status'] }
        ],
        limit: -1
      }
    ),
    repo.list<{ email: string | null; person_id: Person | number | null }>('Person_email', {
      // Archived addresses still match on purpose: an old address is
      // exactly what an old invitation will have been sent to. It's
      // archived so it stays out of the UI, not out of the index.
      fields: [
        'email',
        { person_id: ['id', 'full_name', 'first_name', 'last_name', 'email', 'person_picture', 'image_focal', 'status'] }
      ],
      limit: -1
    })
  ]);

  // De-dupe by Person.id per email so a person with the same work_email
  // listed on multiple roles only appears once per attendee row.
  const seenPerEmail = new Map<string, Set<number>>();
  const push = (email: string, p: Person) => {
    const key = email.trim().toLowerCase();
    if (!key || !wanted.has(key)) return;
    const seen = seenPerEmail.get(key) ?? new Set<number>();
    if (seen.has(p.id)) return;
    seen.add(p.id);
    seenPerEmail.set(key, seen);
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(p);
  };

  for (const p of personRows) {
    if (p.email) push(p.email, p);
  }
  for (const r of roleRows) {
    const p = r.person_id && typeof r.person_id === 'object' ? (r.person_id as Person) : null;
    if (!p || !r.work_email) continue;
    // Skip archived people whose role rows aren't archived — the
    // person filter already excluded them above; mirror that here.
    if ((p as Person & { status?: string }).status === 'archived') continue;
    push(r.work_email, p);
  }
  for (const r of extraRows) {
    const p = r.person_id && typeof r.person_id === 'object' ? (r.person_id as Person) : null;
    if (!p || !r.email) continue;
    if ((p as Person & { status?: string }).status === 'archived') continue;
    push(r.email, p);
  }

  return out;
}

/** An additional email address for a Person. The primary one stays on
 *  Person.email; these are the extras, and attendee matching sweeps both. */
export type PersonEmail = {
  id: number;
  person_id?: Person | number | null;
  email: string;
  label?: string | null;
  source?: string | null;
  status?: string | null;
  date_created?: string | null;
};

export const PERSON_EMAIL_LABELS = ['personal', 'work', 'old', 'other'] as const;

/** Addresses on one person, published first, oldest first within that. */
export async function listPersonEmails(personId: number): Promise<PersonEmail[]> {
  return repo.list<PersonEmail>('Person_email', {
    where: { field: 'person_id', op: 'eq', value: personId },
    fields: ['id', 'email', 'label', 'source', 'status', 'date_created'],
    sort: ['status', 'id'],
    limit: -1
  });
}

/** Record another address. Refuses a duplicate of one this person already
 *  holds — including their primary — because the point of this table is to
 *  stop duplicate identities, not to create duplicate rows inside one. */
export async function addPersonEmail(
  personId: number,
  email: string,
  opts: { label?: string; source?: string } = {}
): Promise<PersonEmail | null> {
  const clean = (email ?? '').trim();
  if (!clean) return null;
  const key = clean.toLowerCase();

  const [person, existing] = await Promise.all([
    repo.get<Person>('Person', personId, { fields: ['id', 'email'] }),
    listPersonEmails(personId)
  ]);
  if ((person?.email ?? '').trim().toLowerCase() === key) return null;
  if (existing.some((r) => (r.email ?? '').trim().toLowerCase() === key)) return null;

  // `as never` on both the collection and the payload: Person_email isn't in
  // the generated Schema type, which is how every other collection added by a
  // scripts/add-*.sh is handled in this file.
  return repo.create<PersonEmail>('Person_email', {
    person_id: personId,
    email: clean,
    label: opts.label ?? 'other',
    source: opts.source ?? 'manual',
    status: 'published'
  });
}

/** Archive rather than delete — see the note in scripts/add-person-emails.sh. */
export async function archivePersonEmail(id: number): Promise<void> {
  await repo.update('Person_email', id, { status: 'archived' });
}

export async function restorePersonEmail(id: number): Promise<void> {
  await repo.update('Person_email', id, { status: 'published' });
}

export async function deletePersonEmail(id: number): Promise<void> {
  await repo.remove('Person_email', id);
}

// Group addresses — one email that tags a whole team — moved to $lib/data/groupAddresses.ts and re-exported
// at the end of this file. See docs/opening-up-twin.md.
// Reverse lookups — events linked to a Person, Org or Project — moved to $lib/data/eventLookups.ts and re-exported
// at the end of this file. See docs/opening-up-twin.md.
