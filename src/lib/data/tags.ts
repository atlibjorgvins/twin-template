// Tags — the shared label pool
//
// Six things left in directus.ts still read it, which is why the prompt
// library could not move earlier.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { Filter } from '$lib/data/repo';
import type { Organization, Person } from '$lib/data/types';

// ── Tags ────────────────────────────────────────────────────────────────────
// `Tag` is a shared label collection. Person ↔ Tag and organization ↔ Tag
// each use a thin junction table so the same tag can decorate either entity.
export type Tag = {
  id: number;
  name: string;
  color?: string | null;
  scope?: 'work' | 'private' | 'both' | null;
  description?: string | null;
  status?: string;
  date_created?: string | null;
  date_updated?: string | null;
};

export type PersonTag = {
  id: number;
  person_id: number | Person;
  tag_id: number | Tag;
};

export type OrganizationTag = {
  id: number;
  organization_id: number | Organization;
  tag_id: number | Tag;
};

// Junction notes ↔ Tag — same Tag pool as Person/Organization so a tag
// like "investor" or "kennsla" can decorate any record kind and search
// cuts across all of them.
export type NoteTag = {
  id: number;
  notes_id: number | { id: number };
  tag_id: number | Tag;
};

/** List tags, optionally including archived rows (admin surfaces want them). */
export async function listTags(opts: { includeArchived?: boolean } = {}): Promise<Tag[]> {
  return repo.list<Tag>('Tag', {
    where: opts.includeArchived ? undefined : { field: 'status', op: 'neq', value: 'archived' },
    sort: ['name']
  });
}

/** Search tags by name fragment, used for the tag picker. */
export async function searchTags(q: string, limit = 10): Promise<Tag[]> {
  const query = q.trim();
  const conds: Filter[] = [{ field: 'status', op: 'neq', value: 'archived' }];
  if (query) conds.push({ field: 'name', op: 'icontains', value: query });
  return repo.list<Tag>('Tag', {
    where: conds.length === 1 ? conds[0] : { and: conds },
    sort: ['name'],
    limit
  });
}

export async function createTag(patch: Partial<Tag> & { name: string }): Promise<Tag> {
  return repo.create<Tag>('Tag', { status: 'published', ...patch } as Record<string, unknown>);
}

export async function updateTag(id: number, patch: Partial<Tag>): Promise<Tag> {
  return repo.update<Tag>('Tag', id, patch as Record<string, unknown>);
}

/** Tags currently attached to a person, with the junction id needed to detach. */
export async function getPersonTags(personId: number): Promise<PersonTag[]> {
  return repo.list<PersonTag>('Person_tag', {
    where: { field: 'person_id', op: 'eq', value: personId },
    fields: ['id', 'person_id', { tag_id: ['id', 'name', 'color', 'scope', 'status'] }]
  });
}

export async function attachTagToPerson(personId: number, tagId: number): Promise<PersonTag> {
  return repo.create<PersonTag>('Person_tag', { person_id: personId, tag_id: tagId } as Record<string, unknown>);
}

export async function detachTagFromPerson(junctionId: number): Promise<void> {
  await repo.remove('Person_tag', junctionId);
}
