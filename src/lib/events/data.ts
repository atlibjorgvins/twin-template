// Events (happenings) data layer. Kept in its own module — the
// feature is self-contained and this avoids piling onto directus.ts.
// An "event" is a real-world happening (demo day, hackathon, ceremony)
// connected to a project, people + orgs (with roles), a photo gallery
// and optionally calendar dates. Distinct from the calendar's `Dates`.
import { readItems, readItem, createItem, createItems, updateItem, updateItems, deleteItem, deleteItems } from '@directus/sdk';
import { directus, uploadFile, personName, type Person, type Organization, type Project, type DateEvent } from '$lib/directus';
import { fetchAssetFile } from '$lib/immich';
import { listEventPlatformLinks, type EventPlatformLink } from '$lib/wordpress';

// Generic per-event×platform id registry (event_platform_link). WordPress
// publishing owns its own upsert; these are the shared read/write used by
// any platform that twin only *tracks* a link for (e.g. native Facebook
// events, which can't be created via API — see AddToFacebook).
export { listEventPlatformLinks };
export type { EventPlatformLink };

/** Upsert the link row for (event, platform) — one row per platform. */
export async function saveEventPlatformLink(
  eventId: number,
  platform: string,
  patch: { url?: string | null; external_id?: string | null; status?: string | null }
): Promise<EventPlatformLink> {
  const existing = (await directus.request(
    readItems('event_platform_link', {
      filter: { _and: [{ event_id: { _eq: eventId } }, { platform: { _eq: platform } }] } as never,
      limit: 1
    } as never)
  )) as EventPlatformLink[];
  const row = { event_id: eventId, platform, ...patch, synced_at: new Date().toISOString() };
  if (existing[0]) {
    return directus.request(updateItem('event_platform_link', existing[0].id, row as never)) as Promise<EventPlatformLink>;
  }
  return directus.request(createItem('event_platform_link', row as never)) as Promise<EventPlatformLink>;
}

export async function removeEventPlatformLink(id: number): Promise<void> {
  await directus.request(deleteItem('event_platform_link', id));
}

export type EventKind =
  | 'demo_day' | 'hackathon' | 'conference' | 'ceremony' | 'workshop' | 'meetup' | 'other';
export type EventStatus = 'idea' | 'planning' | 'upcoming' | 'past' | 'archived';

export const EVENT_KIND_LABEL: Record<string, string> = {
  demo_day: 'Demo day',
  hackathon: 'Hackathon',
  conference: 'Conference',
  ceremony: 'Ceremony',
  workshop: 'Workshop',
  meetup: 'Meetup',
  other: 'Event'
};
export const EVENT_STATUS_LABEL: Record<string, string> = {
  idea: 'Idea',
  planning: 'Planning',
  upcoming: 'Upcoming',
  past: 'Past',
  archived: 'Archived'
};

// Upcoming/past derivation lives in ./eventTime.ts (pure, unit-tested).
export { eventEnd, isPastEvent, eventTimeStatus } from './eventTime';

// Suggested role vocabularies (free-text underneath, so not enforced).
export const EVENT_PERSON_ROLES = ['speaker', 'judge', 'mentor', 'organizer', 'attendee', 'winner'];
export const EVENT_ORG_ROLES = ['host', 'sponsor', 'partner', 'finalist', 'winner', 'exhibitor'];

export type EventRecord = {
  id: number;
  name?: string | null;
  kind?: EventKind | string | null;
  status?: EventStatus | string | null;
  start?: string | null;
  end?: string | null;
  location_name?: string | null;
  project_id?: number | Project | null;
  summary?: string | null;
  cover?: string | null;
  /** Import provenance: dedup key (e.g. "klak:226272") + source link. */
  external_ref?: string | null;
  source_url?: string | null;
  date_created?: string | null;
  date_updated?: string | null;
};

export type EventPerson = {
  id: number;
  event_id?: number | null;
  person_id?: number | Person | null;
  role?: string | null;
  sort?: number | null;
};
export type EventOrg = {
  id: number;
  event_id?: number | null;
  organization_id?: number | Organization | null;
  role?: string | null;
  sort?: number | null;
};
export type EventPhoto = {
  id: number;
  event_id?: number | null;
  file_id?: string | null;
  caption?: string | null;
  sort?: number | null;
  /** Set when this gallery photo was materialized from an Immich library
   *  tag (photo_link collection="event"); the asset's Immich uuid. */
  source_asset_id?: string | null;
};
export type EventDateLink = {
  id: number;
  event_id?: number | null;
  dates_id?: number | DateEvent | null;
};

const EVENT_FIELDS = [
  'id', 'name', 'kind', 'status', 'start', 'end', 'location_name',
  'summary', 'cover', 'external_ref', 'source_url', 'date_created', 'date_updated',
  { project_id: ['id', 'name', 'color', 'brand_logo'] }
];

export async function listEvents(opts: { includeArchived?: boolean } = {}): Promise<EventRecord[]> {
  // Omit `filter` entirely when including archived — passing
  // `filter: undefined` serializes to ?filter=undefined and Directus
  // rejects it.
  const query: Record<string, unknown> = {
    fields: EVENT_FIELDS,
    sort: ['-start', '-date_created'],
    limit: -1
  };
  if (!opts.includeArchived) query.filter = { status: { _neq: 'archived' } };
  return directus.request(readItems('event', query as never)) as Promise<EventRecord[]>;
}

export async function getEvent(id: number): Promise<EventRecord> {
  return directus.request(
    readItem('event', id, { fields: EVENT_FIELDS as never } as never)
  ) as Promise<EventRecord>;
}

export async function createEvent(patch: Partial<EventRecord>): Promise<EventRecord> {
  return directus.request(createItem('event', patch as never)) as Promise<EventRecord>;
}
export async function updateEvent(id: number, patch: Partial<EventRecord>): Promise<EventRecord> {
  return directus.request(updateItem('event', id, patch as never)) as Promise<EventRecord>;
}
export async function deleteEvent(id: number): Promise<void> {
  await directus.request(deleteItem('event', id));
}

// ── Batch edit ────────────────────────────────────────────────────────
// Apply one patch to many events in a single request — used by the
// multi-select bar on the list (assign a project, set status/kind, …).
export async function updateEventsBulk(
  ids: number[],
  patch: Partial<EventRecord>
): Promise<void> {
  if (ids.length === 0) return;
  await directus.request(updateItems('event', ids, patch as never));
}
export async function deleteEventsBulk(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await directus.request(deleteItems('event', ids));
}

// ── Duplicate ─────────────────────────────────────────────────────────
// Clone an event into a new one — give it fresh timings and pick which
// content carries over. Photos/cover reuse the same underlying file ids
// (the files are shared, no re-upload), people/orgs copy their roles, and
// "marketing material" rebinds the source's Studio templates (carousel /
// summary posts whose `event_id` points at the event) to the new copy.
// Calendar date links are never copied — the new event has new timings.
export type EventDuplicateContent = {
  summary: boolean;
  cover: boolean;
  photos: boolean;
  people: boolean;
  orgs: boolean;
  marketing: boolean;
};
export type EventDuplicateOptions = EventDuplicateContent & {
  name: string;
  start: string | null;
  end: string | null;
  status?: EventStatus | string;
};

/** Counts of each linkable content type, for the duplicate dialog so the
 *  user sees what's actually there ("12 photos", "3 partners") before
 *  choosing what to carry over. */
export async function getEventContentCounts(eventId: number): Promise<{
  photos: number;
  people: number;
  orgs: number;
  marketing: number;
  hasCover: boolean;
  hasSummary: boolean;
}> {
  const ids = async (collection: string) =>
    (
      (await directus.request(
        readItems(collection as never, {
          filter: { event_id: { _eq: eventId } } as never,
          fields: ['id'] as never,
          limit: -1
        } as never)
      )) as { id: number }[]
    ).length;

  const [event, photos, people, orgs, marketing] = await Promise.all([
    getEvent(eventId),
    ids('event_photo'),
    ids('event_person'),
    ids('event_org'),
    (
      (await directus.request(
        readItems('image_template', {
          filter: { event_id: { _eq: eventId }, status: { _neq: 'archived' } } as never,
          fields: ['id'] as never,
          limit: -1
        } as never)
      )) as { id: number }[]
    ).length
  ]);

  return {
    photos,
    people,
    orgs,
    marketing,
    hasCover: !!event.cover,
    hasSummary: !!(event.summary && event.summary.trim())
  };
}

export async function duplicateEvent(
  sourceId: number,
  opts: EventDuplicateOptions
): Promise<EventRecord> {
  const src = await getEvent(sourceId);
  const projectId =
    typeof src.project_id === 'object' ? (src.project_id?.id ?? null) : (src.project_id ?? null);

  const created = await createEvent({
    name: opts.name,
    kind: src.kind ?? 'other',
    status: opts.status ?? 'planning',
    start: opts.start,
    end: opts.end,
    location_name: src.location_name ?? null,
    summary: opts.summary ? (src.summary ?? null) : null,
    cover: opts.cover ? (src.cover ?? null) : null,
    project_id: projectId
    // external_ref / source_url deliberately not copied — the copy is its
    // own record, not the same imported happening.
  });
  const newId = created.id;

  if (opts.people) {
    const rows = (await directus.request(
      readItems('event_person', {
        filter: { event_id: { _eq: sourceId } } as never,
        fields: ['person_id', 'role', 'sort'] as never,
        limit: -1
      } as never)
    )) as Array<{ person_id: number | { id: number } | null; role?: string | null; sort?: number | null }>;
    const toAdd = rows
      .map((r) => ({
        event_id: newId,
        person_id: typeof r.person_id === 'object' ? r.person_id?.id : r.person_id,
        role: r.role ?? null,
        sort: r.sort ?? null
      }))
      .filter((r) => r.person_id != null);
    if (toAdd.length) await directus.request(createItems('event_person', toAdd as never));
  }

  if (opts.orgs) {
    const rows = (await directus.request(
      readItems('event_org', {
        filter: { event_id: { _eq: sourceId } } as never,
        fields: ['organization_id', 'role', 'sort'] as never,
        limit: -1
      } as never)
    )) as Array<{ organization_id: number | { id: number } | null; role?: string | null; sort?: number | null }>;
    const toAdd = rows
      .map((r) => ({
        event_id: newId,
        organization_id: typeof r.organization_id === 'object' ? r.organization_id?.id : r.organization_id,
        role: r.role ?? null,
        sort: r.sort ?? null
      }))
      .filter((r) => r.organization_id != null);
    if (toAdd.length) await directus.request(createItems('event_org', toAdd as never));
  }

  if (opts.photos) {
    const rows = (await directus.request(
      readItems('event_photo', {
        filter: { event_id: { _eq: sourceId } } as never,
        fields: ['file_id', 'caption', 'sort', 'source_asset_id'] as never,
        sort: ['sort', 'date_created'] as never,
        limit: -1
      } as never)
    )) as Array<Pick<EventPhoto, 'file_id' | 'caption' | 'sort' | 'source_asset_id'>>;
    const toAdd = rows
      .filter((r) => r.file_id)
      .map((r) => ({
        event_id: newId,
        file_id: r.file_id,
        caption: r.caption ?? null,
        sort: r.sort ?? null,
        source_asset_id: r.source_asset_id ?? null
      }));
    if (toAdd.length) await directus.request(createItems('event_photo', toAdd as never));
  }

  if (opts.marketing) {
    const templates = (await directus.request(
      readItems('image_template', {
        filter: { event_id: { _eq: sourceId }, status: { _neq: 'archived' } } as never,
        limit: -1
      } as never)
    )) as Array<Record<string, unknown> & { id: number; name?: string | null }>;
    for (const t of templates) {
      const { id, date_created, date_updated, ...rest } = t as never as {
        id: number;
        date_created?: unknown;
        date_updated?: unknown;
      } & Record<string, unknown>;
      void id;
      void date_created;
      void date_updated;
      await directus.request(
        createItem('image_template', {
          ...rest,
          name: `${(t.name ?? 'Template')} (copy)`,
          event_id: newId
        } as never)
      );
    }
  }

  return created;
}

// ── People links ────────────────────────────────────────────────────
export async function listEventPeople(eventId: number): Promise<EventPerson[]> {
  return directus.request(
    readItems('event_person', {
      filter: { event_id: { _eq: eventId } } as never,
      fields: ['id', 'role', 'sort', { person_id: ['id', 'full_name', 'first_name', 'last_name', 'person_picture'] }] as never,
      sort: ['sort', 'role'] as never,
      limit: -1
    } as never)
  ) as Promise<EventPerson[]>;
}
export async function addEventPerson(eventId: number, personId: number, role: string): Promise<EventPerson> {
  return directus.request(
    createItem('event_person', { event_id: eventId, person_id: personId, role } as never)
  ) as Promise<EventPerson>;
}
export async function updateEventPerson(id: number, patch: Partial<EventPerson>): Promise<void> {
  await directus.request(updateItem('event_person', id, patch as never));
}
export async function removeEventPerson(id: number): Promise<void> {
  await directus.request(deleteItem('event_person', id));
}

// ── Org links ─────────────────────────────────────────────────────────
export async function listEventOrgs(eventId: number): Promise<EventOrg[]> {
  return directus.request(
    readItems('event_org', {
      filter: { event_id: { _eq: eventId } } as never,
      fields: ['id', 'role', 'sort', { organization_id: ['id', 'name', 'logo'] }] as never,
      sort: ['sort', 'role'] as never,
      limit: -1
    } as never)
  ) as Promise<EventOrg[]>;
}
export async function addEventOrg(eventId: number, orgId: number, role: string): Promise<EventOrg> {
  return directus.request(
    createItem('event_org', { event_id: eventId, organization_id: orgId, role } as never)
  ) as Promise<EventOrg>;
}
export async function updateEventOrg(id: number, patch: Partial<EventOrg>): Promise<void> {
  await directus.request(updateItem('event_org', id, patch as never));
}
export async function removeEventOrg(id: number): Promise<void> {
  await directus.request(deleteItem('event_org', id));
}

// ── Photo gallery ─────────────────────────────────────────────────────
export async function listEventPhotos(eventId: number): Promise<EventPhoto[]> {
  return directus.request(
    readItems('event_photo', {
      filter: { event_id: { _eq: eventId } } as never,
      // source_asset_id carries the Immich uuid through to callers that need
      // the asset's own metadata — face boxes and star rating for the
      // carousel builder. All 382 gallery rows have one.
      fields: ['id', 'file_id', 'caption', 'sort', 'source_asset_id'] as never,
      sort: ['sort', 'date_created'] as never,
      limit: -1
    } as never)
  ) as Promise<EventPhoto[]>;
}
export async function addEventPhoto(eventId: number, fileId: string, caption?: string | null): Promise<EventPhoto> {
  return directus.request(
    createItem('event_photo', { event_id: eventId, file_id: fileId, caption: caption ?? null } as never)
  ) as Promise<EventPhoto>;
}
export async function updateEventPhoto(id: number, patch: Partial<EventPhoto>): Promise<void> {
  await directus.request(updateItem('event_photo', id, patch as never));
}
export async function removeEventPhoto(id: number): Promise<void> {
  await directus.request(deleteItem('event_photo', id));
}

/** Materialize an event's Immich library tags (photo_link collection=
 *  "event") into its gallery — download each tagged asset's web-size
 *  preview, store it as a Directus file, and add an event_photo row. This
 *  is the bridge from the (tailnet-only) Immich library to the publicly
 *  servable gallery the event page + studio render. Lazy + idempotent:
 *  call it before fetching an event's photos; assets already materialized
 *  (matched by source_asset_id) are skipped, so it's cheap to re-run. */
export async function importEventTaggedPhotos(
  eventId: number
): Promise<{ imported: number; total: number }> {
  const links = (await directus.request(
    readItems('photo_link', {
      filter: { collection: { _eq: 'event' }, item_id: { _eq: eventId } } as never,
      fields: ['asset_id'] as never,
      limit: -1
    } as never)
  )) as { asset_id: string }[];
  const assetIds = [...new Set(links.map((l) => l.asset_id))];
  if (assetIds.length === 0) return { imported: 0, total: 0 };

  const existing = (await directus.request(
    readItems('event_photo', {
      filter: { event_id: { _eq: eventId }, source_asset_id: { _in: assetIds } } as never,
      fields: ['source_asset_id'] as never,
      limit: -1
    } as never)
  )) as { source_asset_id: string | null }[];
  const have = new Set(existing.map((r) => r.source_asset_id));
  const todo = assetIds.filter((id) => !have.has(id));

  let imported = 0;
  for (const id of todo) {
    try {
      const file = await fetchAssetFile(id, `event-${eventId}`, 'preview');
      const fileId = await uploadFile(file, { title: `event ${eventId} — library photo` });
      await directus.request(
        createItem('event_photo', { event_id: eventId, file_id: fileId, source_asset_id: id } as never)
      );
      imported++;
    } catch {
      // Offline / missing asset — leave it; a later fetch will retry.
    }
  }
  return { imported, total: assetIds.length };
}

// ── Calendar date links ──────────────────────────────────────────────
export async function listEventDates(eventId: number): Promise<EventDateLink[]> {
  return directus.request(
    readItems('event_date', {
      filter: { event_id: { _eq: eventId } } as never,
      fields: ['id', { dates_id: ['id', 'title', 'start', 'end', 'all_day', 'location_name'] }] as never,
      limit: -1
    } as never)
  ) as Promise<EventDateLink[]>;
}
export async function linkEventDate(eventId: number, datesId: number): Promise<EventDateLink> {
  return directus.request(
    createItem('event_date', { event_id: eventId, dates_id: datesId } as never)
  ) as Promise<EventDateLink>;
}
export async function unlinkEventDate(id: number): Promise<void> {
  await directus.request(deleteItem('event_date', id));
}

/** Attendees of a calendar Dates row → bulk-add as event people.
 *  Skips people already linked to the event. Returns count added. */
export async function importDateAttendees(
  eventId: number,
  datesId: number,
  role = 'attendee'
): Promise<number> {
  const links = (await directus.request(
    readItems('Dates_Person', {
      filter: { Dates_id: { _eq: datesId } } as never,
      fields: ['Person_id'] as never,
      limit: -1
    } as never)
  )) as Array<{ Person_id: number | { id: number } | null }>;
  const personIds = links
    .map((l) => (typeof l.Person_id === 'object' ? l.Person_id?.id : l.Person_id))
    .filter((v): v is number => typeof v === 'number');
  if (personIds.length === 0) return 0;

  const existing = await listEventPeople(eventId);
  const have = new Set(
    existing.map((e) => (typeof e.person_id === 'object' ? e.person_id?.id : e.person_id))
  );
  const toAdd = [...new Set(personIds)].filter((id) => !have.has(id));
  if (toAdd.length === 0) return 0;
  await directus.request(
    createItems('event_person', toAdd.map((pid) => ({ event_id: eventId, person_id: pid, role })) as never)
  );
  return toAdd.length;
}

// Display helpers re-exported for the UI.
export { personName };
export function eventPersonName(e: EventPerson): string {
  return typeof e.person_id === 'object' && e.person_id ? personName(e.person_id) : '(unknown)';
}
export function eventOrgName(e: EventOrg): string {
  return (typeof e.organization_id === 'object' ? e.organization_id?.name : null) ?? '(unknown)';
}

// ── Reverse lookups (for project / person / org detail pages) ────────
export type LinkedEvent = {
  id: number;
  name: string;
  kind?: string | null;
  status?: string | null;
  start?: string | null;
  location_name?: string | null;
  cover?: string | null;
  /** Roles this entity held at the event (people/orgs only). */
  roles?: string[];
};

const LINKED_FIELDS = ['id', 'name', 'kind', 'status', 'start', 'location_name', 'cover'];

function toLinked(rows: EventRecord[]): LinkedEvent[] {
  return rows.map((e) => ({
    id: e.id,
    name: e.name ?? '(untitled)',
    kind: e.kind ?? null,
    status: e.status ?? null,
    start: e.start ?? null,
    location_name: e.location_name ?? null,
    cover: e.cover ?? null
  }));
}

/** Events whose project is this project. */
export async function listEventsForProject(projectId: number): Promise<LinkedEvent[]> {
  const rows = (await directus.request(
    readItems('event', {
      filter: { _and: [{ project_id: { _eq: projectId } }, { status: { _neq: 'archived' } }] } as never,
      fields: LINKED_FIELDS as never,
      sort: ['-start', '-date_created'] as never,
      limit: -1
    } as never)
  )) as EventRecord[];
  return toLinked(rows);
}

/** event id → project id for every event that has one. One query; used by
 *  the photo folder browser to roll event photos up into project folders. */
export async function listEventProjectMap(): Promise<Record<number, number>> {
  const rows = (await directus.request(
    readItems('event', {
      filter: { project_id: { _nnull: true } } as never,
      fields: ['id', { project_id: ['id'] }] as never,
      limit: -1
    } as never)
  )) as Array<{ id: number; project_id: { id: number } | number | null }>;
  const map: Record<number, number> = {};
  for (const r of rows) {
    const pid = typeof r.project_id === 'object' ? r.project_id?.id : r.project_id;
    if (pid != null) map[r.id] = pid;
  }
  return map;
}

/** Events a person is linked to (any role), with their role(s). */
export async function listEventsForPerson(personId: number): Promise<LinkedEvent[]> {
  const links = (await directus.request(
    readItems('event_person', {
      filter: { person_id: { _eq: personId } } as never,
      fields: ['role', { event_id: LINKED_FIELDS }] as never,
      limit: -1
    } as never)
  )) as Array<{ role?: string | null; event_id: EventRecord | number | null }>;
  return foldLinks(links);
}

/** Events an org is linked to (any role), with its role(s). */
export async function listEventsForOrg(orgId: number): Promise<LinkedEvent[]> {
  const links = (await directus.request(
    readItems('event_org', {
      filter: { organization_id: { _eq: orgId } } as never,
      fields: ['role', { event_id: LINKED_FIELDS }] as never,
      limit: -1
    } as never)
  )) as Array<{ role?: string | null; event_id: EventRecord | number | null }>;
  return foldLinks(links);
}

/** Collapse junction rows into one LinkedEvent per event, gathering
 *  roles and dropping archived events. */
function foldLinks(
  links: Array<{ role?: string | null; event_id: EventRecord | number | null }>
): LinkedEvent[] {
  const map = new Map<number, LinkedEvent>();
  for (const l of links) {
    const e = typeof l.event_id === 'object' ? l.event_id : null;
    if (!e || e.status === 'archived') continue;
    const existing = map.get(e.id);
    if (existing) {
      if (l.role && !existing.roles!.includes(l.role)) existing.roles!.push(l.role);
    } else {
      map.set(e.id, { ...toLinked([e])[0], roles: l.role ? [l.role] : [] });
    }
  }
  return [...map.values()].sort((a, b) => (b.start ?? '').localeCompare(a.start ?? ''));
}
