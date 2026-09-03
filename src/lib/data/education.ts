// Education and spoken languages
//
// Per-person education history and languages.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { Note, Person } from '$lib/data/types';
import type { NoteTag, OrganizationTag, Tag } from '$lib/data/tags';
import { listTags } from '$lib/data/tags';

// ── Education & spoken languages ────────────────────────────────────────
// Two child collections hanging off Person (CASCADE), each a small,
// inline-editable list on the person page — same shape as roles.
export type PersonEducation = {
  id: number;
  person_id: number | Person;
  institution?: string | null;
  degree?: string | null;
  field?: string | null;
  start_year?: number | null;
  end_year?: number | null;
  notes?: string | null;
  sort?: number | null;
  date_created?: string | null;
  date_updated?: string | null;
};

export type LanguageProficiency = 'native' | 'fluent' | 'professional' | 'conversational' | 'basic';
export const LANGUAGE_PROFICIENCIES: Array<{ label: string; value: LanguageProficiency }> = [
  { label: 'Native', value: 'native' },
  { label: 'Fluent', value: 'fluent' },
  { label: 'Professional', value: 'professional' },
  { label: 'Conversational', value: 'conversational' },
  { label: 'Basic', value: 'basic' }
];

export type PersonLanguage = {
  id: number;
  person_id: number | Person;
  language?: string | null;
  proficiency?: LanguageProficiency | string | null;
  sort?: number | null;
  date_created?: string | null;
};

export async function getPersonEducation(personId: number): Promise<PersonEducation[]> {
  return await repo.list<PersonEducation>('Person_education', {
    where: { field: 'person_id', op: 'eq', value: personId },
    sort: ['-end_year', '-start_year', 'sort']
  });
}

export async function createPersonEducation(
  personId: number,
  patch: Partial<PersonEducation> = {}
): Promise<PersonEducation> {
  return await repo.create<PersonEducation>('Person_education', { person_id: personId, ...patch } as Record<string, unknown>);
}

export async function updatePersonEducation(id: number, patch: Partial<PersonEducation>): Promise<PersonEducation> {
  return await repo.update<PersonEducation>('Person_education', id, patch as Record<string, unknown>);
}

export async function deletePersonEducation(id: number): Promise<void> {
  await repo.remove('Person_education', id);
}

export async function getPersonLanguages(personId: number): Promise<PersonLanguage[]> {
  return await repo.list<PersonLanguage>('Person_language', {
    where: { field: 'person_id', op: 'eq', value: personId },
    sort: ['sort', 'language']
  });
}

export async function createPersonLanguage(
  personId: number,
  patch: Partial<PersonLanguage> = {}
): Promise<PersonLanguage> {
  return await repo.create<PersonLanguage>('Person_language', { person_id: personId, ...patch } as Record<string, unknown>);
}

export async function updatePersonLanguage(id: number, patch: Partial<PersonLanguage>): Promise<PersonLanguage> {
  return await repo.update<PersonLanguage>('Person_language', id, patch as Record<string, unknown>);
}

export async function deletePersonLanguage(id: number): Promise<void> {
  await repo.remove('Person_language', id);
}

/** Tags actually attached to at least one person, with usage counts —
 *  feeds the People view's tag filter chips ("mentor · 12"). */
export async function listPersonTagUsage(): Promise<Array<Tag & { count: number }>> {
  const [links, tags] = await Promise.all([
    repo.list<{ tag_id: number | { id: number } | null }>('Person_tag', { fields: ['tag_id'] }),
    listTags()
  ]);
  const counts = new Map<number, number>();
  for (const l of links) {
    const id = typeof l.tag_id === 'object' ? l.tag_id?.id : l.tag_id;
    if (id != null) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return tags.filter((t) => counts.has(t.id)).map((t) => ({ ...t, count: counts.get(t.id)! }));
}

/** Person ids carrying ALL of the given tags (AND semantics, so adding
 *  a second chip narrows the list). */
export async function personIdsWithTags(tagIds: number[]): Promise<number[]> {
  if (tagIds.length === 0) return [];
  const links = await repo.list<{ person_id: number | { id: number } | null; tag_id: number | { id: number } | null }>('Person_tag', {
    where: { field: 'tag_id', op: 'in', value: tagIds },
    fields: ['person_id', 'tag_id']
  });
  const per = new Map<number, Set<number>>();
  for (const l of links) {
    const pid = typeof l.person_id === 'object' ? l.person_id?.id : l.person_id;
    const tid = typeof l.tag_id === 'object' ? l.tag_id?.id : l.tag_id;
    if (pid == null || tid == null) continue;
    if (!per.has(pid)) per.set(pid, new Set());
    per.get(pid)!.add(tid);
  }
  return [...per.entries()].filter(([, s]) => tagIds.every((t) => s.has(t))).map(([p]) => p);
}

/** Tags currently attached to an org. */
export async function getOrganizationTags(orgId: number): Promise<OrganizationTag[]> {
  return await repo.list<OrganizationTag>('organization_tag', {
    where: { field: 'organization_id', op: 'eq', value: orgId },
    fields: ['id', 'organization_id', { tag_id: ['id', 'name', 'color', 'scope', 'status'] }]
  });
}

export async function attachTagToOrganization(orgId: number, tagId: number): Promise<OrganizationTag> {
  return await repo.create<OrganizationTag>('organization_tag', { organization_id: orgId, tag_id: tagId } as Record<string, unknown>);
}

export async function detachTagFromOrganization(junctionId: number): Promise<void> {
  await repo.remove('organization_tag', junctionId);
}

/** Tags currently attached to a note. */
export async function getNoteTags(noteId: number): Promise<NoteTag[]> {
  return await repo.list<NoteTag>('notes_tag', {
    where: { field: 'notes_id', op: 'eq', value: noteId },
    fields: ['id', 'notes_id', { tag_id: ['id', 'name', 'color', 'scope', 'status'] }]
  });
}

export async function attachTagToNote(noteId: number, tagId: number): Promise<NoteTag> {
  return await repo.create<NoteTag>('notes_tag', { notes_id: noteId, tag_id: tagId } as Record<string, unknown>);
}

export async function detachTagFromNote(junctionId: number): Promise<void> {
  await repo.remove('notes_tag', junctionId);
}

/**
 * Find notes carrying any of the given tag ids. Used by the Notes list
 * page to surface tag-search results that mirror Person/Org tag searches.
 */
export async function listNotesByTags(tagIds: number[]): Promise<Note[]> {
  if (tagIds.length === 0) return [];
  const junctions = await repo.list<{ notes_id: number | null }>('notes_tag', {
    where: { field: 'tag_id', op: 'in', value: tagIds },
    fields: ['notes_id']
  });
  const ids = Array.from(
    new Set(junctions.map((j) => j.notes_id).filter((n): n is number => typeof n === 'number'))
  );
  if (ids.length === 0) return [];
  return await repo.list<Note>('notes', {
    where: { and: [
      { field: 'id', op: 'in', value: ids },
      { field: 'status', op: 'neq', value: 'archived' }
    ] },
    fields: [
      'id', 'title', 'content', 'note_type', 'priority', 'is_pinned', 'is_done',
      'follow_up_date', 'status', 'date_created', 'date_updated'
    ],
    sort: ['-date_updated', '-date_created'],
    limit: 200
  });
}

// Activities — logged interactions — moved to $lib/data/activities.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
