// People — search, counts and CRUD
//
// The core Person operations, and personName, which is a pure formatter used
// in 31 files. Moved late on purpose: Person was referenced 116 times inside
// directus.ts, so everything else had to leave first.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';

export function personName(p: Person): string {
  return (
    p.full_name?.trim() ||
    [p.first_name, p.last_name].filter(Boolean).join(' ').trim() ||
    '(no name)'
  );
}

import type { Filter } from '$lib/data/repo';
import type { Person } from '$lib/data/types';
import { enqueueWrite } from '$lib/writeQueue';
import { filterPeopleLocal, getMirrorRecord, isNetworkError, isTempId, loadMirrorPeople, markOffline, markOnline, nextTempId, patchMirror, upsertMirror } from '$lib/offline';

type PeopleSearchOpts = { includeArchived?: boolean; sort?: string[] };

async function buildPeopleSearchFilter(
  q: string,
  extraFilters: (Filter | null | undefined)[],
  opts: PeopleSearchOpts
): Promise<Filter[]> {
  const query = q.trim();
  const and: Filter[] = opts.includeArchived ? [] : [{ field: 'status', op: 'neq', value: 'archived' }];
  if (query) {
    const or: Filter[] = [
      { field: 'full_name', op: 'icontains', value: query },
      { field: 'first_name', op: 'icontains', value: query },
      { field: 'last_name', op: 'icontains', value: query },
      { field: 'nickname', op: 'icontains', value: query },
      { field: 'email', op: 'icontains', value: query },
      { field: 'phone', op: 'icontains', value: query }
    ];
    // Also match role titles ("CEO", "Co-founder", …) — each role is its own
    // Person_organization row, so a person tagged both Co-founder and CEO
    // matches either term. Resolved as ids first (mirrors the org-tag path);
    // best-effort so a junction hiccup never breaks name search.
    try {
      const roleRows = await repo.list<{ person_id: number | { id: number } | null }>('Person_organization', {
        where: { field: 'role', op: 'icontains', value: query },
        fields: ['person_id']
      });
      const ids = [...new Set(
        roleRows
          .map((r) => (typeof r.person_id === 'object' ? r.person_id?.id : r.person_id))
          .filter((v): v is number => typeof v === 'number')
      )];
      if (ids.length > 0) or.push({ field: 'id', op: 'in', value: ids });
    } catch { /* offline / junction error → name-only search */ }
    and.push({ or });
  }
  for (const f of extraFilters) if (f) and.push(f);
  return and;
}

/** Combine an AND-array into a single neutral filter (or undefined if empty). */
function andToWhere(and: Filter[]): Filter | undefined {
  if (and.length === 0) return undefined;
  return and.length === 1 ? and[0] : { and };
}

/** True total of people matching the same filters as searchPeople(). */
export async function countPeople(
  q: string = '',
  extraFilters: (Filter | null | undefined)[] = [],
  opts: PeopleSearchOpts = {}
): Promise<number> {
  const and = await buildPeopleSearchFilter(q, extraFilters, opts);
  try {
    const n = await repo.count('Person', andToWhere(and));
    markOnline();
    return n;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    markOffline();
    const all = await loadMirrorPeople();
    if (all.length === 0) throw e;
    return filterPeopleLocal(all, q.trim(), opts.includeArchived).length;
  }
}

export async function searchPeople(
  q: string,
  limit = 25,
  extraFilters: (Filter | null | undefined)[] = [],
  opts: PeopleSearchOpts = {}
) {
  const query = q.trim();
  const and = await buildPeopleSearchFilter(q, extraFilters, opts);
  try {
    const rows = await repo.list<Person>('Person', {
      where: andToWhere(and),
      limit,
      // Most-recently-touched first; fall back to created, then name.
      sort: opts.sort ?? (query ? ['full_name', 'first_name'] : ['-date_updated', '-date_created', 'full_name'])
    });
    markOnline();
    return rows;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    // Server unreachable — serve from the local mirror (read-only index).
    markOffline();
    const all = await loadMirrorPeople();
    if (all.length === 0) throw e; // never synced → nothing to fall back to
    return filterPeopleLocal(all, query, opts.includeArchived).slice(0, limit);
  }
}

export async function createPerson(patch: Partial<Person>) {
  const data = { status: 'published', ...patch } as Record<string, unknown>;
  try {
    const p = await repo.create<Person>('Person', data);
    markOnline();
    return p;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    markOffline();
    const id = await nextTempId();
    const record = { ...data, id, date_updated: new Date().toISOString(), _pending: 'create' } as unknown as Person;
    await upsertMirror('people', record as unknown as Record<string, unknown>);
    await enqueueWrite({
      collection: 'Person',
      action: 'create',
      recordId: id,
      data,
      refFields: [],
      mirror: 'people',
      label: `Create person “${patch.full_name || patch.first_name || 'new'}”`
    });
    return record;
  }
}

export async function updatePerson(id: number, patch: Partial<Person>) {
  try {
    const p = await repo.update<Person>('Person', id, patch as Record<string, unknown>);
    markOnline();
    return p;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    markOffline();
    await patchMirror('people', id, { ...patch, date_updated: new Date().toISOString() } as Record<string, unknown>);
    await enqueueWrite({
      collection: 'Person',
      action: 'update',
      recordId: id,
      data: patch as Record<string, unknown>,
      refFields: [],
      label: isTempId(id) ? `Edit new person` : `Edit person #${id}`
    });
    const rec = await getMirrorRecord<Person>('people', id);
    return (rec ?? ({ id, ...patch } as unknown as Person)) as Person;
  }
}

export async function setPersonStatus(id: number, status: 'draft' | 'published' | 'archived' | 'active') {
  return updatePerson(id, { status } as Partial<Person>);
}
