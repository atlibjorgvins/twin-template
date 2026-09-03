// Reverse lookups — events linked to a Person, Org or Project
//
// Three read-only queries over Dates. One type dependency, no runtime ones.
//
// Ported to the backend-neutral repository (docs/phase3-data-port.md) — no
// direct Directus SDK use. Public surface unchanged; directus.ts re-exports it.

import { repo } from '$lib/data/repo';
// Type-only: erased at compile time, so no runtime cycle back into
// the module this was split out of.
import type { DateEvent } from '$lib/data/types';

// ── Reverse lookups: events linked to a Person / Org / Project ─────────
// Used by the detail pages so navigation reads both ways — open a
// person and you see the events you've attached them to; open the
// event and the people / org / project chips link back.

/** Events linked to a given Person via the Dates_Person junction. */
export async function listDatesForPerson(personId: number, limit = 50): Promise<DateEvent[]> {
  const junctions = await repo.list<{ Dates_id: number | { id: number } | null }>('Dates_Person', {
    where: { field: 'Person_id', op: 'eq', value: personId },
    fields: ['Dates_id']
  });
  const ids = Array.from(
    new Set(
      junctions
        .map((j) => (typeof j.Dates_id === 'object' ? j.Dates_id?.id : j.Dates_id))
        .filter((n): n is number => typeof n === 'number')
    )
  );
  if (ids.length === 0) return [];
  return await repo.list<DateEvent>('Dates', {
    where: {
      and: [
        { field: 'id', op: 'in', value: ids },
        { field: 'status', op: 'neq', value: 'archived' }
      ]
    },
    sort: ['-start'],
    limit
  });
}

/** Events whose `organization` FK points at this org. */
export async function listDatesForOrg(orgId: number, limit = 50): Promise<DateEvent[]> {
  return await repo.list<DateEvent>('Dates', {
    where: {
      and: [
        { field: 'organization', op: 'eq', value: orgId },
        { field: 'status', op: 'neq', value: 'archived' }
      ]
    },
    sort: ['-start'],
    limit
  });
}

/** Events whose `project_id` FK points at this project. */
export async function listDatesForProject(projectId: number, limit = 50): Promise<DateEvent[]> {
  return await repo.list<DateEvent>('Dates', {
    where: {
      and: [
        { field: 'project_id', op: 'eq', value: projectId },
        { field: 'status', op: 'neq', value: 'archived' }
      ]
    },
    sort: ['-start'],
    limit
  });
}
