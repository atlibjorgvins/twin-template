// Photo navigator — photo_person CRUD
//
// The face-cluster to Person mapping. The last true leaf in the file.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { PhotoPerson } from '$lib/data/types';

// ── Photo navigator: photo_person CRUD ───────────────────────────────

/** All cluster mappings, joined Person name included for display. */
export async function listPhotoPersons(): Promise<
  (PhotoPerson & { person?: { id: number; full_name: string | null; first_name: string | null; last_name: string | null } | null })[]
> {
  return repo.list('photo_person', {
    fields: ['*', { person_id: ['id', 'full_name', 'first_name', 'last_name'] }]
  }) as never;
}

/** Cluster ids mapped to one Person — feeds the Photos tab. */
export async function photoPersonsForPerson(personId: number): Promise<PhotoPerson[]> {
  return repo.list<PhotoPerson>('photo_person', {
    where: {
      and: [
        { field: 'person_id', op: 'eq', value: personId },
        { field: 'hidden', op: 'eq', value: false }
      ]
    }
  });
}

/** Create-or-update a mapping row (id = Immich person uuid). */
export async function upsertPhotoPerson(
  id: string,
  patch: Partial<Omit<PhotoPerson, 'id'>>
): Promise<void> {
  const existing = await repo.list<PhotoPerson>('photo_person', {
    where: { field: 'id', op: 'eq', value: id },
    limit: 1
  });
  if (existing.length > 0) {
    await repo.update('photo_person', id, patch as Record<string, unknown>);
  } else {
    await repo.create('photo_person', { id, ...patch });
  }
}

// Photo navigator — photo_link CRUD — moved to $lib/data/photoLinks.ts and re-exported
// at the end of this file. See docs/opening-up-twin.md.
