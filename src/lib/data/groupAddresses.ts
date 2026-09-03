// Group addresses — one email that tags a whole team
//
// Backs `team@klak.is` resolving to every member. Type-only dependencies on
// Person and Organization.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module, so every existing
// `from '$lib/directus'` import keeps working.

import { repo } from '$lib/data/repo';
// Type-only: erased at compile time, so no runtime cycle back into
// the module this was split out of.
import type { DatePerson, Organization, Person } from '$lib/data/types';

// ── Group addresses ───────────────────────────────────────────────────
//
// A shared address stands for several people. Person_email can't express
// that — an address there belongs to one person — so "team@klak.is"
// resolved to nobody and the only offer was to create a contact called
// "team". An EmailGroup names who the address means, either as an org's
// live roster or as an explicit list, or both.

export type EmailGroup = {
  id: number;
  email: string;
  label?: string | null;
  note?: string | null;
  current_only?: boolean | null;
  status?: string | null;
  organization_id?: Organization | number | null;
};

/** Group rules keyed by lowercased address. */
export async function listEmailGroups(): Promise<Map<string, EmailGroup>> {
  const rows = await repo.list<EmailGroup>('EmailGroup', {
    where: { field: 'status', op: 'neq', value: 'archived' },
    fields: ['id', 'email', 'label', 'note', 'current_only', 'organization_id.id', 'organization_id.name']
  });
  const out = new Map<string, EmailGroup>();
  for (const g of rows) {
    const key = (g.email ?? '').trim().toLowerCase();
    if (key) out.set(key, g);
  }
  return out;
}

export type ResolvedGroup = {
  group: EmailGroup;
  people: Person[];
  /** Where each person came from, for the UI to explain itself. */
  viaRoster: number;
  viaExplicit: number;
};

/**
 * Expand a group to its people: the org's roster (live, so joiners and
 * leavers need no maintenance) plus any explicit members, de-duplicated.
 *
 * `current_only` gates the roster on Person_organization.is_current. Turning
 * it off is what you want for an old invitation — the people who were there
 * then, not the people there now.
 */
export async function resolveEmailGroup(group: EmailGroup): Promise<ResolvedGroup> {
  const orgId =
    group.organization_id && typeof group.organization_id === 'object'
      ? group.organization_id.id
      : (group.organization_id ?? null);

  const personFields = [
    'id', 'full_name', 'first_name', 'last_name', 'email', 'person_picture', 'image_focal', 'status'
  ];

  const [roleRows, memberRows] = await Promise.all([
    orgId != null
      ? repo.list<{ is_current?: boolean | null; person_id?: Person | number | null }>('Person_organization', {
          where: { field: 'organization_id', op: 'eq', value: orgId },
          fields: ['is_current', { person_id: personFields }]
        })
      : Promise.resolve([] as Array<{ is_current?: boolean | null; person_id?: Person | number | null }>),
    repo.list<{ Person_id?: Person | number | null }>('EmailGroup_Person', {
      where: { field: 'EmailGroup_id', op: 'eq', value: group.id },
      fields: [{ Person_id: personFields }]
    })
  ]);

  const byId = new Map<number, Person>();
  let viaRoster = 0;
  let viaExplicit = 0;
  const take = (p: Person | number | null | undefined, kind: 'roster' | 'explicit') => {
    if (!p || typeof p !== 'object') return;
    if ((p as Person & { status?: string }).status === 'archived') return;
    if (byId.has(p.id)) return;
    byId.set(p.id, p);
    if (kind === 'roster') viaRoster += 1;
    else viaExplicit += 1;
  };

  for (const r of roleRows) {
    // A missing is_current is treated as current: the column is sparse on
    // imported rows, and excluding them would silently shrink the roster.
    const current = r.is_current !== false;
    if (group.current_only !== false && !current) continue;
    take(r.person_id, 'roster');
  }
  for (const m of memberRows) take(m.Person_id, 'explicit');

  return { group, people: [...byId.values()], viaRoster, viaExplicit };
}

export async function attachPersonToDate(dateId: number, personId: number): Promise<DatePerson> {
  return repo.create<DatePerson>('Dates_Person', { Dates_id: dateId, Person_id: personId } as Record<string, unknown>);
}

export async function detachPersonFromDate(junctionId: number): Promise<void> {
  await repo.remove('Dates_Person', junctionId);
}
