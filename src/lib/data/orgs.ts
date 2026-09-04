// Organizations — search, counts and CRUD
//
// The core organization operations. buildOrgSearchFilter is the largest piece
// at 84 lines and is shared by both countOrgs and searchOrgs.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { Filter } from '$lib/data/repo';
import type { Organization, Role } from '$lib/data/types';
import { enqueueWrite } from '$lib/writeQueue';
import { filterOrgsLocal, getMirrorRecord, isNetworkError, isTempId, loadMirrorOrgs, markOffline, markOnline, nextTempId, patchMirror, upsertMirror } from '$lib/offline';

type OrgSearchOpts = {
  includeArchived?: boolean;
  includeInactive?: boolean;
  sort?: string[];
  /** When true (default), also search Tag.name and surface orgs linked to matching tags. */
  searchTags?: boolean;
};

/** Build the AND-array of filters used by both searchOrgs and countOrgs. */
async function buildOrgSearchFilter(
  q: string,
  extraFilters: (Filter | null | undefined)[],
  opts: OrgSearchOpts
): Promise<Filter[]> {
  const query = q.trim();
  const and: Filter[] = opts.includeArchived ? [] : [{ field: 'status', op: 'neq', value: 'archived' }];
  if (!opts.includeInactive) and.push({ field: 'is_active', op: 'neq', value: false });
  if (query) {
    const orParts: Filter[] = [
      { field: 'name', op: 'icontains', value: query },
      { field: 'legal_name', op: 'icontains', value: query },
      { field: 'previous_names', op: 'icontains', value: query },
      { field: 'email', op: 'icontains', value: query },
      { field: 'website', op: 'icontains', value: query },
      { field: 'industry', op: 'icontains', value: query },
      { field: 'phone', op: 'icontains', value: query },
      { field: 'address_line1', op: 'icontains', value: query },
      { field: 'address_line2', op: 'icontains', value: query },
      { field: 'postal_code', op: 'icontains', value: query },
      { field: 'city', op: 'icontains', value: query },
      { field: 'state_province', op: 'icontains', value: query },
      { field: 'country', op: 'icontains', value: query },
      { field: 'kennitala', op: 'icontains', value: query.replace(/[-\s]/g, '') }
    ];
    if (opts.searchTags !== false) {
      try {
        const tags = await repo.list<{ id: number }>('Tag', {
          where: { field: 'name', op: 'icontains', value: query },
          fields: ['id'],
          limit: 20
        });
        if (tags.length > 0) {
          const tagIds = tags.map((t) => t.id);
          const links = await repo.list<{ organization_id: number | { id: number } }>('organization_tag', {
            where: { field: 'tag_id', op: 'in', value: tagIds },
            fields: ['organization_id']
          });
          const orgIds = [
            ...new Set(
              links
                .map((l) => (typeof l.organization_id === 'object' ? l.organization_id?.id : l.organization_id))
                .filter((v): v is number => typeof v === 'number')
            )
          ];
          if (orgIds.length > 0) orParts.push({ field: 'id', op: 'in', value: orgIds });
        }
      } catch {
        /* tag search best-effort */
      }
    }

    // Social profiles are rows now, so a handle cannot be matched by a column
    // filter. Same two-step as tags above: find the matching profiles, then
    // widen the OR by their org ids. Best-effort — a failure here must never
    // narrow the search, it just means handles do not match this time.
    try {
      const socialRows = await repo.list<{ organization_id: number | { id: number } | null }>(
        'organization_social',
        {
          where: {
            or: [
              { field: 'url', op: 'icontains', value: query },
              { field: 'handle', op: 'icontains', value: query }
            ]
          },
          fields: ['organization_id']
        }
      );
      const socialOrgIds = [
        ...new Set(
          socialRows
            .map((l) => (typeof l.organization_id === 'object' ? l.organization_id?.id : l.organization_id))
            .filter((v): v is number => typeof v === 'number')
        )
      ];
      if (socialOrgIds.length > 0) orParts.push({ field: 'id', op: 'in', value: socialOrgIds });
    } catch {
      /* social search best-effort */
    }

    and.push({ or: orParts });
  }
  for (const f of extraFilters) if (f) and.push(f);
  return and;
}

/** Combine an AND-array into a single neutral filter (or undefined if empty). */
function andToWhere(and: Filter[]): Filter | undefined {
  if (and.length === 0) return undefined;
  return and.length === 1 ? and[0] : { and };
}

/** True total of orgs matching the same filters as searchOrgs() — useful so
 *  the heading can show "100 of 4,127" instead of just the page-cap "100". */
export async function countOrgs(
  q: string = '',
  extraFilters: (Filter | null | undefined)[] = [],
  opts: OrgSearchOpts = {}
): Promise<number> {
  const and = await buildOrgSearchFilter(q, extraFilters, opts);
  try {
    const n = await repo.count('organization', andToWhere(and));
    markOnline();
    return n;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    markOffline();
    const all = await loadMirrorOrgs();
    if (all.length === 0) throw e;
    return filterOrgsLocal(all, q.trim(), opts.includeArchived, opts.includeInactive).length;
  }
}

export async function searchOrgs(
  q: string,
  limit = 25,
  extraFilters: (Filter | null | undefined)[] = [],
  opts: OrgSearchOpts = {}
) {
  const query = q.trim();
  const and = await buildOrgSearchFilter(q, extraFilters, opts);
  // Caller-supplied sort wins; otherwise we default by name when there's a
  // text query (relevance-ish) and by recency when browsing.
  const sort =
    opts.sort && opts.sort.length
      ? opts.sort
      : query
        ? ['name']
        : ['-date_updated', '-date_created', 'name'];
  try {
    const rows = await repo.list<Organization>('organization', {
      where: andToWhere(and),
      limit,
      sort
    });
    markOnline();
    return rows;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    markOffline();
    const all = await loadMirrorOrgs();
    if (all.length === 0) throw e;
    return filterOrgsLocal(all, query, opts.includeArchived, opts.includeInactive).slice(0, limit);
  }
}

/** Organization search across the OTHER readable vaults — the unified "All
 *  vaults" listing. Scalar columns only (no tag junction), same reason as
 *  searchPeopleForeign: cross-vault ids would collide. */
export async function searchOrgsForeign(
  q: string,
  limit = 25,
  scope: 'all' | 'work' | 'private' = 'all',
  opts: OrgSearchOpts = {}
): Promise<Array<Organization & { __vault: { id: string; name: string } }>> {
  const query = q.trim();
  const [{ listForeign, foreignVaultsInScope }, { scopeWhere }, { vaultWorld }] = await Promise.all([
    import('$lib/data/repo/crossVault'),
    import('$lib/scope'),
    import('$lib/data/repo/vaults')
  ]);
  const sort = opts.sort && opts.sort.length ? opts.sort : query ? ['name'] : ['-date_created', '-id'];
  // Scalar-only base filter (no tag junction — cross-vault ids collide).
  const base = await buildOrgSearchFilter(q, [], { ...opts, searchTags: false });

  const inScope = foreignVaultsInScope(scope);
  const whole = inScope.filter((v) => scope !== 'all' && vaultWorld(v) === scope);
  const mixed = inScope.filter((v) => !whole.includes(v));
  const rowFilter = scope === 'all' ? null : scopeWhere(scope);

  const [a, b] = await Promise.all([
    whole.length
      ? listForeign<Organization>('organization', { where: andToWhere(base), limit, sort }, whole)
      : Promise.resolve([]),
    mixed.length
      ? listForeign<Organization>(
          'organization',
          { where: andToWhere(rowFilter ? [...base, rowFilter] : base), limit, sort },
          mixed
        )
      : Promise.resolve([])
  ]);
  return [...a, ...b];
}

/** Return the distinct set of non-empty industry values — for filter dropdowns. */
export async function listOrgIndustries(limit = 200): Promise<string[]> {
  const rows = await repo.list<{ industry?: string | null }>('organization', {
    fields: ['industry'],
    where: {
      and: [
        { field: 'status', op: 'neq', value: 'archived' },
        { field: 'industry', op: 'nnull' }
      ]
    },
    limit
  });
  const set = new Set<string>();
  for (const r of rows) if (r.industry) set.add(r.industry);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export async function getOrg(id: number) {
  if (isTempId(id)) {
    const rec = await getMirrorRecord<Organization>('orgs', id);
    if (rec) return rec;
    throw new Error(`Unknown pending record ${id}`);
  }
  try {
    // Expand successor_id so the "rebranded as" / "merged into" banner can
    // render the linked org's name without a second fetch.
    const o = await repo.get<Organization>('organization', id, {
      fields: ['*', { successor_id: ['id', 'name'] }]
    });
    markOnline();
    if (!o) throw new Error(`Organization ${id} not found`);
    return o;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    markOffline();
    const rec = await getMirrorRecord<Organization>('orgs', id);
    if (rec) return rec;
    throw e;
  }
}

export async function getOrgPeople(orgId: number) {
  // People currently working at, or formerly tied to, this org via the rich junction.
  //
  // Archived PEOPLE are excluded, not just archived links. A person is archived
  // when they turn out to be a duplicate of someone already in the database —
  // the losing record of a merge that never got finished. Their junction row
  // survives, so without this filter the org page lists the same human twice:
  // Ásta Sóllilja showed up as #25 (asta@klak.is) and #357 (personal address,
  // archived) on KLAK. 16 links across the database point at an archived
  // person, so this was never a one-off.
  return repo.list<Role>('Person_organization', {
    where: {
      and: [
        { field: 'organization_id', op: 'eq', value: orgId },
        // Relational filter: exclude links whose Person is archived. The
        // dot-path expands to { person_id: { status: { _neq } } }.
        { field: 'person_id.status', op: 'neq', value: 'archived' }
      ]
    },
    fields: [
      '*',
      {
        person_id: [
          'id', 'full_name', 'first_name', 'last_name', 'email', 'phone',
          // image_focal: the card passes it to Avatar as the crop position;
          // it was never fetched, so every avatar here has been centre-cropped
          // regardless of where the face actually is.
          'person_picture', 'image_focal', 'scope', 'status'
        ]
      }
    ],
    sort: ['-is_current', '-start_date'],
    limit: 200
  });
}

export async function updateOrg(id: number, patch: Partial<Organization>) {
  try {
    const o = await repo.update<Organization>('organization', id, patch as Record<string, unknown>);
    markOnline();
    return o;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    markOffline();
    await patchMirror('orgs', id, { ...patch, date_updated: new Date().toISOString() } as Record<string, unknown>);
    await enqueueWrite({
      collection: 'organization',
      action: 'update',
      recordId: id,
      data: patch as Record<string, unknown>,
      refFields: [],
      label: isTempId(id) ? `Edit new organization` : `Edit organization #${id}`
    });
    const rec = await getMirrorRecord<Organization>('orgs', id);
    return (rec ?? ({ id, ...patch } as unknown as Organization)) as Organization;
  }
}

export async function createOrg(patch: Partial<Organization>) {
  const data = { status: 'published', ...patch } as Record<string, unknown>;
  try {
    const o = await repo.create<Organization>('organization', data);
    markOnline();
    return o;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    markOffline();
    const id = await nextTempId();
    const record = { ...data, id, date_updated: new Date().toISOString(), _pending: 'create' } as unknown as Organization;
    await upsertMirror('orgs', record as unknown as Record<string, unknown>);
    await enqueueWrite({
      collection: 'organization',
      action: 'create',
      recordId: id,
      data,
      refFields: [],
      mirror: 'orgs',
      label: `Create organization “${patch.name || 'new'}”`
    });
    return record;
  }
}

export async function setOrgStatus(id: number, status: 'draft' | 'published' | 'archived' | 'active') {
  return updateOrg(id, { status } as Partial<Organization>);
}
