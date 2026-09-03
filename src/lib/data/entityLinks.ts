// Entity links — labelled links and dynamic info
//
// Arbitrary labelled links on any record. Unblocked by the core move.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { Note, Organization, Person } from '$lib/data/types';
import { enqueueWrite } from '$lib/writeQueue';
import { isNetworkError, markOffline, markOnline, nextTempId } from '$lib/offline';
import { personName } from '$lib/data/people';

// ─── Entity links (labelled links / dynamic info) ─────────────────────────
// A flat, polymorphic list of labelled values attached to any entity — a
// URL (auto-linkified in the UI) or plain text, with an optional note.
// Same `collection` + `item` addressing as notes_related_to, so one card
// works on Project / org / Person alike.
export type EntityLink = {
  id: number;
  collection?: string | null;
  item?: string | null;
  label?: string | null;
  value?: string | null;
  note?: string | null;
  sort?: number | null;
  date_created?: string | null;
  date_updated?: string | null;
};

export async function listEntityLinks(collection: string, itemId: number | string): Promise<EntityLink[]> {
  return repo.list<EntityLink>('entity_link', {
    where: {
      and: [
        { field: 'collection', op: 'eq', value: collection },
        { field: 'item', op: 'eq', value: String(itemId) }
      ]
    },
    fields: ['id', 'collection', 'item', 'label', 'value', 'note', 'sort', 'date_created'],
    sort: ['sort', 'date_created'],
    limit: 200
  });
}
export async function createEntityLink(
  collection: string,
  itemId: number | string,
  input: { label: string; value: string; note?: string | null; sort?: number }
): Promise<EntityLink> {
  return repo.create<EntityLink>('entity_link', {
    collection,
    item: String(itemId),
    label: input.label,
    value: input.value,
    note: input.note || null,
    sort: input.sort ?? null
  });
}
export async function updateEntityLink(id: number, patch: Partial<EntityLink>): Promise<EntityLink> {
  return repo.update<EntityLink>('entity_link', id, patch as Record<string, unknown>);
}
export async function deleteEntityLink(id: number): Promise<void> {
  await repo.remove('entity_link', id);
}

// `notes.related_to` is a polymorphic many-to-any junction. The bridge
// stores the target collection name in a JSON column (DB artifact from the
// A2 schema migration), so writes through the SDK need JSON.stringify on
// the `collection` value while reads come back as plain strings.

export type RelatedCollection = 'Person' | 'organization' | 'Dates' | 'Project';

export type NoteRelation = {
  id: number;          // junction row id
  collection: RelatedCollection;
  item: string;        // the FK id as a string (Directus stores M2A items as varchar)
  // Hydrated entity, looked up by the caller after fetch:
  entity?:
    | { type: 'Person'; data: Person }
    | { type: 'organization'; data: Organization }
    | { type: 'Dates'; data: { id: number; title?: string | null; start?: string | null } }
    | { type: 'Project'; data: { id: number; name?: string | null } };
};

export async function getNoteRelations(noteId: number): Promise<NoteRelation[]> {
  const res = await repo.list<{ id: number; collection: string; item: string }>('notes_related_to', {
    where: { field: 'notes_id', op: 'eq', value: noteId },
    fields: ['id', 'collection', 'item'],
    sort: ['id'],
    limit: 200
  });
  return res
    .filter((r) => r.collection && r.item)
    .map((r) => ({ id: r.id, collection: r.collection as RelatedCollection, item: r.item }));
}

export async function addNoteRelation(
  noteId: number,
  collection: RelatedCollection,
  itemId: number | string,
): Promise<NoteRelation> {
  // The `collection` column on `notes_related_to` is JSON-typed in
  // Postgres. JSON requires strings to be double-quoted, so we have to
  // `JSON.stringify` the value before sending — a bare `Person` would be
  // rejected with "invalid input syntax for type json". On read the SDK
  // parses it back into a plain `"Person"` string, so the rest of the
  // app sees a clean RelatedCollection value.
  const data = {
    notes_id: noteId,
    collection: JSON.stringify(collection) as unknown as string,
    item: String(itemId),
  } as Record<string, unknown>;
  try {
    const created = await repo.create<{ id: number; collection: string; item: string }>(
      'notes_related_to',
      data
    );
    markOnline();
    return { id: created.id, collection, item: String(itemId) };
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    markOffline();
    const id = await nextTempId();
    // notes_id may be a temp note id; item may be a temp person/org id —
    // both are remapped at flush time.
    await enqueueWrite({
      collection: 'notes_related_to',
      action: 'create',
      recordId: id,
      data,
      refFields: ['notes_id'],
      itemRefField: 'item',
      label: `Link note to ${collection} #${itemId}`
    });
    return { id, collection, item: String(itemId) };
  }
}

export async function removeNoteRelation(junctionId: number): Promise<void> {
  await repo.remove('notes_related_to', junctionId);
}

// Universal search across the four M2A target collections. Returns a
// flat list of typed candidates the picker can display together so the
// user doesn't have to pre-decide which kind of entity they're linking.
export type RelatedCandidate = {
  collection: RelatedCollection;
  id: number;
  label: string;
  sublabel?: string;
};

export async function searchRelatedCandidates(query: string, limit = 8): Promise<RelatedCandidate[]> {
  const q = query.trim();
  if (!q) return [];

  const [persons, orgs, projects, dates] = await Promise.all([
    repo.list<Pick<Person, 'id' | 'first_name' | 'last_name' | 'full_name' | 'email'>>('Person', {
      // Include `full_name` so people stored only with that field
      // (a common shape — Person.full_name set, first/last null)
      // are searchable from the relations picker.
      where: {
        or: [
          { field: 'full_name', op: 'icontains', value: q },
          { field: 'first_name', op: 'icontains', value: q },
          { field: 'last_name', op: 'icontains', value: q },
          { field: 'email', op: 'icontains', value: q }
        ]
      },
      fields: ['id', 'first_name', 'last_name', 'full_name', 'email'],
      limit
    }),

    repo.list<Pick<Organization, 'id' | 'name' | 'legal_name'>>('organization', {
      where: {
        or: [
          { field: 'name', op: 'icontains', value: q },
          { field: 'legal_name', op: 'icontains', value: q }
        ]
      },
      fields: ['id', 'name', 'legal_name'],
      limit
    }),

    repo.list<{ id: number; name?: string | null }>('Project', {
      where: { field: 'name', op: 'icontains', value: q },
      fields: ['id', 'name'],
      limit
    }),

    repo.list<{ id: number; title?: string | null; start?: string | null }>('Dates', {
      where: { field: 'title', op: 'icontains', value: q },
      fields: ['id', 'title', 'start'],
      limit
    })
  ]);

  const out: RelatedCandidate[] = [];
  for (const p of persons) {
    out.push({
      collection: 'Person',
      // Prefer the canonical `personName` ordering so the picker label
      // matches what every other surface shows.
      id: p.id,
      label: personName(p as never) || `Person ${p.id}`,
      sublabel: p.email ?? undefined,
    });
  }
  for (const o of orgs) {
    out.push({
      collection: 'organization',
      id: o.id,
      label: o.name || o.legal_name || `Org ${o.id}`,
    });
  }
  for (const pr of projects) {
    out.push({ collection: 'Project', id: pr.id, label: pr.name || `Project ${pr.id}` });
  }
  for (const d of dates) {
    out.push({
      collection: 'Dates',
      id: d.id,
      label: d.title || `Event ${d.id}`,
      sublabel: d.start ? new Date(d.start).toLocaleDateString() : undefined,
    });
  }
  return out;
}

// Hydrate a list of NoteRelations with full entity records so the UI can
// render names + avatars instead of `Person #8`. Batches one request per
// collection; missing rows are dropped silently (item was deleted at
// source) so the chip list stays clean.
export async function hydrateNoteRelations(
  rels: NoteRelation[],
): Promise<NoteRelation[]> {
  const byCollection = new Map<RelatedCollection, string[]>();
  for (const r of rels) {
    if (!byCollection.has(r.collection)) byCollection.set(r.collection, []);
    byCollection.get(r.collection)!.push(r.item);
  }

  const lookups = await Promise.all(
    Array.from(byCollection.entries()).map(async ([collection, ids]) => {
      const numIds = ids.map((i) => Number(i)).filter((n) => !Number.isNaN(n));
      if (numIds.length === 0) return [collection, new Map<string, unknown>()] as const;
      try {
        if (collection === 'Person') {
          const rows = await repo.list<Person>('Person', {
            where: { field: 'id', op: 'in', value: numIds },
            fields: ['id', 'first_name', 'last_name', 'full_name', 'person_picture', 'image_focal'],
            limit: -1
          });
          return [collection, new Map(rows.map((r) => [String(r.id), r]))] as const;
        }
        if (collection === 'organization') {
          const rows = await repo.list<Organization>('organization', {
            where: { field: 'id', op: 'in', value: numIds },
            fields: ['id', 'name', 'legal_name', 'logo', 'image_focal'],
            limit: -1
          });
          return [collection, new Map(rows.map((r) => [String(r.id), r]))] as const;
        }
        if (collection === 'Project') {
          const rows = await repo.list<{ id: number; name?: string | null }>('Project', {
            where: { field: 'id', op: 'in', value: numIds },
            fields: ['id', 'name'],
            limit: -1
          });
          return [collection, new Map(rows.map((r) => [String(r.id), r]))] as const;
        }
        // Dates
        const rows = await repo.list<{ id: number; title?: string | null; start?: string | null }>(
          'Dates',
          {
            where: { field: 'id', op: 'in', value: numIds },
            fields: ['id', 'title', 'start'],
            limit: -1
          }
        );
        return [collection, new Map(rows.map((r) => [String(r.id), r]))] as const;
      } catch {
        return [collection, new Map<string, unknown>()] as const;
      }
    }),
  );
  const cache = new Map<RelatedCollection, Map<string, unknown>>();
  for (const [c, m] of lookups) cache.set(c as RelatedCollection, m as Map<string, unknown>);

  return rels.map((r) => {
    const row = cache.get(r.collection)?.get(r.item);
    if (!row) return r;
    if (r.collection === 'Person') {
      return { ...r, entity: { type: 'Person', data: row as Person } };
    }
    if (r.collection === 'organization') {
      return { ...r, entity: { type: 'organization', data: row as Organization } };
    }
    if (r.collection === 'Project') {
      return { ...r, entity: { type: 'Project', data: row as { id: number; name?: string | null } } };
    }
    return {
      ...r,
      entity: { type: 'Dates', data: row as { id: number; title?: string | null; start?: string | null } },
    };
  });
}

/**
 * Reverse lookup: return all notes that have been related to a given
 * entity via the `notes_related_to` M2A junction. Used by the People /
 * Org / Project / Event detail pages so the relationship reads both
 * ways — link a note → it shows up on both surfaces.
 */
export async function listNotesForEntity(
  collection: RelatedCollection,
  itemId: number | string,
): Promise<Note[]> {
  // The `collection` column on `notes_related_to` is JSON-typed, and
  // Directus rejects `_eq` on JSON ("json field type does not contain
  // the _eq filter operator"). So we narrow on `item` (a plain string
  // column) at the server, then filter by collection client-side. The
  // result set is tiny — one entity rarely has more than a handful of
  // junction rows across all kinds.
  const junctions = await repo.list<{ notes_id: number | null; collection: string | null }>(
    'notes_related_to',
    {
      where: { field: 'item', op: 'eq', value: String(itemId) },
      fields: ['notes_id', 'collection'],
      limit: 200
    }
  );
  const noteIds = Array.from(
    new Set(
      junctions
        .filter((j) => j.collection === collection)
        .map((j) => j.notes_id)
        .filter((n): n is number => typeof n === 'number'),
    ),
  );
  if (noteIds.length === 0) return [];
  const notes = await repo.list<Note>('notes', {
    where: {
      and: [
        { field: 'id', op: 'in', value: noteIds },
        { field: 'status', op: 'neq', value: 'archived' }
      ]
    },
    fields: [
      'id', 'title', 'content', 'note_type', 'priority', 'is_pinned', 'is_done',
      'follow_up_date', 'status', 'date_created', 'date_updated'
    ],
    sort: ['-date_updated', '-date_created'],
    limit: 200
  });
  return notes;
}

// Tags — the shared label pool — moved to $lib/data/tags.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
// Education and spoken languages — moved to $lib/data/education.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
