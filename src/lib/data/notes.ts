// Notes
//
// A leaf despite its imports: everything it needs comes from scope, offline
// and writeQueue, none of which live in directus.ts.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module, so every existing
// `from '$lib/directus'` import keeps working.

// Data access goes through the backend-neutral repository (phase 3 —
// docs/phase3-data-port.md), not the Directus SDK directly. This module is the
// first one ported; the `repo` it calls is a DirectusRepository today.
import { repo } from '$lib/data/repo';
import type { Filter } from '$lib/data/repo';
import { isNetworkError, markOffline, markOnline, nextTempId } from '$lib/offline';
import { scopeWhere } from '$lib/scope';
import type { Scope } from '$lib/scope';
import { enqueueWrite } from '$lib/writeQueue';
// Type-only: erased at compile time, so no runtime cycle back into
// the module this was split out of.
import type { Note } from '$lib/data/types';

// ── Notes ───────────────────────────────────────────────────────────────────
// First-class CRUD for the notes collection. Used by /notes and /notes/[id].
const NOTE_FIELDS = [
  'id', 'title', 'note_type', 'note_date', 'status', 'priority',
  'follow_up_date', 'is_done', 'is_pinned', 'visibility', 'scope',
  'agenda', 'action_items', 'next_steps', 'content',
  'date_created', 'date_updated',
] as const;

const NOTE_LIST_FIELDS = [
  'id', 'title', 'note_type', 'note_date', 'status', 'priority',
  'is_done', 'is_pinned', 'scope', 'date_created', 'date_updated',
] as const;

export async function searchNotes(opts: {
  q?: string;
  noteType?: string | null;     // filter by note_type; null = no filter
  includeArchived?: boolean;
  /**
   * Restrict to notes tagged with at least one of these tag ids. Uses
   * the shared `Tag` collection via the `notes_tag` junction, so a tag
   * like "investor" applied on a Person and a Note search alike.
   */
  tagIds?: number[];
  /** Order by created date (default) or last-updated date. Pinned notes
   *  always float to the top regardless. */
  sort?: 'created' | 'updated';
  /** Work/Private toggle. Un-tagged notes fall under 'work' (see scopeFilter). */
  scope?: Scope;
  limit?: number;
} = {}): Promise<Note[]> {
  const { q = '', noteType = null, includeArchived = false, tagIds = [], sort = 'created', scope, limit = 100 } = opts;
  const filters: Filter[] = [];
  if (!includeArchived) filters.push({ field: 'status', op: 'neq', value: 'archived' });
  if (noteType) filters.push({ field: 'note_type', op: 'eq', value: noteType });
  const nsf = scope ? scopeWhere(scope) : null;
  if (nsf) filters.push(nsf);
  if (q.trim()) {
    const term = q.trim();
    filters.push({
      or: [
        { field: 'title', op: 'icontains', value: term },
        { field: 'content', op: 'icontains', value: term },
      ],
    });
  }
  if (tagIds.length > 0) {
    // Resolve the tag-junction → note ids first so the main query stays
    // a single `in` filter. Empty result → short-circuit and return [].
    const junctions = await repo.list<{ notes_id: number | null }>('notes_tag', {
      where: { field: 'tag_id', op: 'in', value: tagIds },
      fields: ['notes_id'],
    });
    const ids = Array.from(
      new Set(junctions.map((j) => j.notes_id).filter((n): n is number => typeof n === 'number'))
    );
    if (ids.length === 0) return [];
    filters.push({ field: 'id', op: 'in', value: ids });
  }
  const where = filters.length === 0
    ? undefined
    : filters.length === 1 ? filters[0] : { and: filters };
  return await repo.list<Note>('notes', {
    fields: NOTE_LIST_FIELDS,
    where,
    sort: ['-is_pinned', sort === 'updated' ? '-date_updated' : '-date_created'],
    limit,
  });
}

/**
 * Notes whose `follow_up_date` is on or before `asOf`, excluding done/archived.
 * Used by the Today dashboard. Sorted earliest-due first so the most overdue
 * items rise to the top.
 */
export async function listFollowUpsDue(asOf: Date = new Date(), limit = 25): Promise<Note[]> {
  const cutoff = asOf.toISOString().slice(0, 10); // YYYY-MM-DD; follow_up_date is a date column
  return await repo.list<Note>('notes', {
    fields: NOTE_LIST_FIELDS,
    where: {
      and: [
        { field: 'status', op: 'neq', value: 'archived' },
        { field: 'follow_up_date', op: 'nnull' },
        { field: 'follow_up_date', op: 'lte', value: cutoff },
        {
          or: [
            { field: 'is_done', op: 'null' },
            { field: 'is_done', op: 'eq', value: false },
          ],
        },
      ],
    },
    sort: ['follow_up_date', '-is_pinned'],
    limit,
  });
}

export async function getNote(id: number): Promise<Note> {
  const n = await repo.get<Note>('notes', id, { fields: NOTE_FIELDS });
  // readItem used to throw on a missing row; preserve that contract.
  if (!n) throw new Error(`Note ${id} not found`);
  return n;
}

export async function updateNote(id: number, patch: Partial<Note>): Promise<Note> {
  return await repo.update<Note>('notes', id, patch as Record<string, unknown>);
}

export async function createNote(input: Partial<Note> = {}): Promise<Note> {
  const now = new Date().toISOString();
  const data = {
    title: input.title ?? '',
    content: input.content ?? '',
    note_type: input.note_type ?? 'general',
    note_date: input.note_date ?? now,
    status: input.status ?? 'published',
    ...input,
  } as Record<string, unknown>;
  try {
    const n = await repo.create<Note>('notes', data);
    markOnline();
    return n;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    markOffline();
    const id = await nextTempId();
    await enqueueWrite({
      collection: 'notes',
      action: 'create',
      recordId: id,
      data,
      refFields: [],
      label: `New note${input.title ? ` “${input.title}”` : ''}`
    });
    return { ...(data as Partial<Note>), id, date_created: now } as Note;
  }
}

export async function archiveNote(id: number): Promise<Note> {
  return updateNote(id, { status: 'archived' });
}

// Permanent delete — unlike archiveNote (a soft status flip), this removes
// the row. Junction rows (tags, M2A relations) cascade on the Directus side.
export async function deleteNote(id: number): Promise<void> {
  await repo.remove('notes', id);
}
