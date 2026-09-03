// Plugin template — data access.
//
// Rule: a plugin NEVER imports @directus/sdk. It talks to the backend through
// the neutral repo, so it works against any backend twin supports. See
// src/lib/data/repo/types.ts for the full contract.
import { repo } from '$lib/data/repo';

export type ExampleRow = {
  id: number;
  person_id: number | null;
  note: string | null;
  date_created?: string | null;
};

/** Rows attached to one person, newest first. */
export async function listExampleRows(personId: number): Promise<ExampleRow[]> {
  return repo.list<ExampleRow>('example_row', {
    where: { field: 'person_id', op: 'eq', value: personId },
    fields: ['id', 'person_id', 'note', 'date_created'],
    sort: ['-date_created'],
    limit: 200
  });
}

/** Create a row. Directus stamps user_created for ownership scoping. */
export async function addExampleRow(personId: number, note: string): Promise<ExampleRow> {
  return repo.create<ExampleRow>('example_row', {
    person_id: personId,
    note: note.trim()
  });
}

export async function updateExampleRow(id: number, patch: Partial<ExampleRow>): Promise<ExampleRow> {
  return repo.update<ExampleRow>('example_row', id, patch as Record<string, unknown>);
}

export async function deleteExampleRow(id: number): Promise<void> {
  await repo.remove('example_row', id);
}
