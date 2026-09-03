// Roles — the Person ⇄ organization junction
//
// Who works where, and since when. Kept separate from both people and orgs
// because it belongs to neither: a role is the edge, not either endpoint.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { Person, Role } from '$lib/data/types';

/**
 * Fetch current roles for a batch of people. Returns a Map<personId, Role[]>,
 * most-recent-first. Use to decorate list/grid rows with a primary affiliation.
 */
export async function getCurrentRolesFor(
  personIds: number[]
): Promise<Map<number, Role[]>> {
  const map = new Map<number, Role[]>();
  if (personIds.length === 0) return map;
  const rows = await repo.list<Role>('Person_organization', {
    where: {
      and: [
        { field: 'person_id', op: 'in', value: personIds },
        { field: 'is_current', op: 'eq', value: true }
      ]
    },
    fields: [
      'id',
      'person_id',
      'role',
      'start_date',
      'is_current',
      { organization_id: ['id', 'name', 'industry'] }
    ],
    sort: ['-start_date'],
    limit: personIds.length * 4
  });
  for (const r of rows) {
    const pid = typeof r.person_id === 'object' && r.person_id ? (r.person_id as Person).id : (r.person_id as number);
    if (!pid) continue;
    const arr = map.get(pid) ?? [];
    arr.push(r);
    map.set(pid, arr);
  }
  return map;
}

export async function getPersonRoles(personId: number) {
  return repo.list<Role>('Person_organization', {
    where: { field: 'person_id', op: 'eq', value: personId },
    fields: [
      '*',
      { organization_id: ['id', 'name', 'website', 'industry', 'city', 'country', 'logo', 'image_focal'] }
    ],
    sort: ['-is_current', '-start_date']
  });
}

export async function updateRole(id: number, patch: Partial<Role>) {
  return repo.update<Role>('Person_organization', id, patch as Record<string, unknown>);
}

export async function createRole(patch: Partial<Role> & { person_id: number; organization_id: number }) {
  return repo.create<Role>('Person_organization', patch as Record<string, unknown>);
}

export async function deleteRole(id: number): Promise<void> {
  await repo.remove('Person_organization', id);
}

/** Distinct role titles in use ("CEO", "Co-founder", …) — feeds the title
 *  datalist so the same title is spelled the same way everywhere and
 *  searches match across people. */
export async function listRoleTitles(): Promise<string[]> {
  const rows = await repo.list<{ role: string | null }>('Person_organization', {
    fields: ['role'],
    where: { field: 'role', op: 'nempty' }
  });
  const seen = new Map<string, string>(); // lowercase → first-seen casing
  for (const r of rows) {
    const t = (r.role ?? '').trim();
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
