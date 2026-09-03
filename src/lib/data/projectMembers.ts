// Project members — direct vs inherited
//
// Membership splits direct from inherited so a big parent project does not
// swamp the list.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { Filter } from '$lib/data/repo';
import type { Project, ProjectOrganization, ProjectPerson } from '$lib/data/types';
import { reconcileOrgProjectInheritance, reconcilePersonProjectInheritance } from '$lib/project-inheritance';

// ── Project members split direct vs inherited, so big parent projects
//    (a theme rolling up hundreds of cohort members) load the editable
//    direct rows in full but page the read-only inherited roll-ups. ──

/** Page size for the inherited-members "Show more" pager. */
export const INHERITED_PAGE = 25;

/** Direct (non-inherited) people on a project — the editable memberships. */
export async function getProjectDirectPeople(projectId: number) {
  return repo.list<ProjectPerson>('Project_people', {
    where: {
      and: [
        { field: 'status', op: 'neq', value: 'archived' },
        { field: 'project_id', op: 'eq', value: projectId },
        { field: 'inherited_from_project_id', op: 'null' }
      ]
    },
    fields: [
      'id', 'role_in_project', 'notes', 'status', 'start_date', 'end_date', 'is_current',
      { person_id: ['id', 'full_name', 'first_name', 'last_name', 'email', 'person_picture', 'scope'] }
    ],
    sort: ['-is_current', '-start_date', 'role_in_project'],
    limit: 200
  });
}

/**
 * Which of the PROJECT's own organizations each person belongs to — their
 * "team" on this project.
 *
 * Scoped to the project's orgs on purpose. A person's employer is not their
 * team here: on an accelerator project the useful answer for Kristján is
 * "LOVE Synthesizers", not whatever unrelated company also employs him. So
 * this intersects Person_organization with Project_organization rather than
 * reading a person's roles outright.
 *
 * Measured before building: on live data 84-100% of a project's direct
 * members resolve to exactly one of its orgs, and NO person mapped to two —
 * so one team per person is the real shape, not a simplification.
 *
 * Returns an empty map rather than throwing. The team is an extra column;
 * a failure here must not cost you the people list.
 */
export async function getProjectTeams(
  projectId: number,
  personIds: number[]
): Promise<Map<number, { id: number; name: string }>> {
  const out = new Map<number, { id: number; name: string }>();
  if (personIds.length === 0) return out;
  try {
    const links = await repo.list<{ organization_id?: number | { id?: number } | null }>(
      'Project_organization',
      {
        where: { field: 'project_id', op: 'eq', value: projectId },
        fields: ['organization_id'],
        limit: -1
      }
    );
    const orgIds = links
      .map((l) => (typeof l.organization_id === 'object' ? l.organization_id?.id : l.organization_id))
      .filter((v): v is number => typeof v === 'number');
    if (orgIds.length === 0) return out;

    // Chunked: `_in` with a few hundred ids goes into the URL, and a request
    // long enough to be rejected would look identical to "nobody has a team".
    for (let i = 0; i < personIds.length; i += 100) {
      const chunk = personIds.slice(i, i + 100);
      const rows = await repo.list<{
        person_id?: number | { id?: number } | null;
        is_current?: boolean | null;
        organization_id?: { id?: number; name?: string | null } | null;
      }>('Person_organization', {
        where: {
          and: [
            { field: 'person_id', op: 'in', value: chunk },
            { field: 'organization_id', op: 'in', value: orgIds }
          ]
        },
        fields: ['person_id', 'is_current', { organization_id: ['id', 'name'] }],
        limit: -1
      });
      for (const r of rows) {
        const pid = typeof r.person_id === 'object' ? r.person_id?.id : r.person_id;
        const org = r.organization_id;
        if (typeof pid !== 'number' || !org?.id || !org.name) continue;
        // A current role wins over a former one; otherwise first seen.
        if (out.has(pid) && r.is_current === false) continue;
        out.set(pid, { id: org.id, name: org.name });
      }
    }
  } catch {
    return out;
  }
  return out;
}

/** One page of inherited (rolled-up-from-subproject) people on a project. */
export async function getProjectInheritedPeople(projectId: number, opts: { limit: number; offset: number }) {
  return repo.list<ProjectPerson>('Project_people', {
    where: {
      and: [
        { field: 'status', op: 'neq', value: 'archived' },
        { field: 'project_id', op: 'eq', value: projectId },
        { field: 'inherited_from_project_id', op: 'nnull' }
      ]
    },
    fields: [
      'id', 'role_in_project', 'status',
      { person_id: ['id', 'full_name', 'first_name', 'last_name', 'email', 'person_picture', 'scope'] },
      { inherited_from_project_id: ['id', 'name'] }
    ],
    sort: ['inherited_from_project_id', 'id'],
    limit: opts.limit,
    offset: opts.offset
  });
}

/** Direct (non-inherited) orgs on a project.
 *
 *  Asked for twice when needed: Directus rejects the WHOLE request for one
 *  unknown field, so on an instance where add-sponsor-roles.sh has not run the
 *  sponsor columns would cost you every organisation on the project, not just
 *  the wording. Same guard as brand.ts's LATE_COLOR_FIELDS, for the same
 *  reason — that one took down an entire card before it was added. */
export async function getProjectDirectOrganizations(projectId: number) {
  const where: Filter = {
    and: [
      { field: 'status', op: 'neq', value: 'archived' },
      { field: 'project_id', op: 'eq', value: projectId },
      { field: 'inherited_from_project_id', op: 'null' }
    ]
  };
  const orgFieldsFull = ['id', 'name', 'name_dative_is', 'previous_names', 'website', 'industry', 'logo', 'image_focal'];
  const orgFieldsLean = orgFieldsFull.filter((f) => f !== 'name_dative_is');
  const ask = (withSponsorFields: boolean) =>
    repo.list<ProjectOrganization>('Project_organization', {
      where,
      fields: [
        'id', 'role_in_project', 'notes', 'status',
        ...(withSponsorFields ? ['phrase_is', 'phrase_en'] : []),
        { organization_id: withSponsorFields ? orgFieldsFull : orgFieldsLean }
      ],
      sort: ['role_in_project'],
      limit: 200
    });
  try {
    return await ask(true);
  } catch {
    return await ask(false);
  }
}

/** One page of inherited orgs on a project. */
export async function getProjectInheritedOrganizations(projectId: number, opts: { limit: number; offset: number }) {
  return repo.list<ProjectOrganization>('Project_organization', {
    where: {
      and: [
        { field: 'status', op: 'neq', value: 'archived' },
        { field: 'project_id', op: 'eq', value: projectId },
        { field: 'inherited_from_project_id', op: 'nnull' }
      ]
    },
    fields: [
      'id', 'role_in_project', 'status',
      { organization_id: ['id', 'name', 'previous_names', 'website', 'industry', 'logo', 'image_focal'] },
      { inherited_from_project_id: ['id', 'name'] }
    ],
    sort: ['inherited_from_project_id', 'id'],
    limit: opts.limit,
    offset: opts.offset
  });
}

/** Count of inherited (rolled-up) members on a project, per junction.
 *  Ids-only fetch — a few KB even for a large theme — so the detail page
 *  can show an accurate total without loading every nested row. */
export async function countProjectInheritedMembers(
  collection: 'Project_people' | 'Project_organization',
  projectId: number
): Promise<number> {
  return repo.count(collection, {
    and: [
      { field: 'status', op: 'neq', value: 'archived' },
      { field: 'project_id', op: 'eq', value: projectId },
      { field: 'inherited_from_project_id', op: 'nnull' }
    ]
  });
}

/** Given the project ids an entity is *directly* linked to, return the ids
 *  to hide on the entity's own card: any project that is an ancestor of
 *  another project in the set. Keeps only the most-specific memberships, so
 *  a cohort member tagged to both "Startup SuperNova" and its "2020" cohort
 *  shows just the cohort. Parent context stays a project-level view. */
async function ancestorsWithinProjectSet(projectIds: number[]): Promise<Set<number>> {
  const set = new Set(projectIds);
  if (set.size < 2) return new Set();

  // Resolve parents a LEVEL at a time, not a project at a time.
  //
  // This used to call parentOf() per id while walking each chain upward,
  // which is one HTTP round trip per step. Measured on /orgs/2: 47 requests
  // shaped `Project?filter={"id":{"_eq":N}}&limit=1`, out of 91 API calls for
  // the whole page. Latency-bound and serial, so on a Tailscale link it is
  // most of the page's load — and this function is only deciding which
  // memberships to hide.
  //
  // One query per depth instead. Real hierarchies here are 2–3 deep
  // (programme → cohort → sub-project), so that is 2–4 requests regardless
  // of how many projects an org has. The 16-level cap and the `seen` guard
  // stay: the schema should not permit a cycle, but this must not hang if
  // one appears.
  const parentOf = new Map<number, number | null>();
  let frontier = [...set];
  for (let depth = 0; depth < 16 && frontier.length > 0; depth++) {
    const unknown = frontier.filter((id) => !parentOf.has(id));
    if (unknown.length === 0) break;
    const rows = await repo.list<{ id: number; parent_id: number | { id: number } | null }>('Project', {
      where: { field: 'id', op: 'in', value: unknown },
      fields: ['id', 'parent_id'],
      limit: -1
    });
    const next: number[] = [];
    for (const id of unknown) parentOf.set(id, null); // ids the query didn't return
    for (const r of rows) {
      const raw = r.parent_id ?? null;
      const par = raw == null ? null : typeof raw === 'object' ? (raw.id ?? null) : raw;
      parentOf.set(r.id, par);
      if (par != null && !parentOf.has(par)) next.push(par);
    }
    frontier = next;
  }

  // Now walk each chain in memory.
  const drop = new Set<number>();
  for (const start of set) {
    let cur: number | null = start;
    const seen = new Set<number>([start]);
    for (let i = 0; i < 16; i++) {
      const par: number | null = parentOf.get(cur) ?? null;
      if (par == null || seen.has(par)) break;
      seen.add(par);
      if (set.has(par)) drop.add(par); // an ancestor that's also a direct membership
      cur = par;
    }
  }
  return drop;
}

/** Projects a given person is linked to (direct memberships, most-specific only). */
export async function getPersonProjects(personId: number) {
  const links = await repo.list<ProjectPerson>('Project_people', {
    // Direct memberships only — inherited (rolled-up ancestor) projects
    // are a project-level view, not shown on a person's own card.
    where: {
      and: [
        { field: 'status', op: 'neq', value: 'archived' },
        { field: 'person_id', op: 'eq', value: personId },
        { field: 'inherited_from_project_id', op: 'null' }
      ]
    },
    fields: [
      'id', 'role_in_project', 'status', 'start_date', 'end_date', 'is_current',
      { project_id: ['id', 'name', 'kind', 'status', 'year', 'parent_id', { owner_org_id: ['id', 'name'] }] }
    ],
    // Current memberships first, then newest.
    sort: ['-is_current', '-id'],
    limit: 200
  });
  const pid = (l: ProjectPerson) => (l.project_id && typeof l.project_id === 'object' ? l.project_id.id : (l.project_id as number | null));
  const ids = links.map(pid).filter((v): v is number => v != null);
  const drop = await ancestorsWithinProjectSet(ids);
  return drop.size ? links.filter((l) => { const id = pid(l); return id == null || !drop.has(id); }) : links;
}

/** Output shape for getOrgProjects — a Project plus the relationship
 *  type so the UI can tag "owner" rows differently from junction-only
 *  partners/sponsors/etc., and surface the role_in_project label. */
export type OrgProject = Project & {
  relation: 'owner' | 'partner';
  role_in_project?: string | null;
  /** Set when this org reaches the project only as an *inherited* member
   *  rolled up from a descendant subproject — points at that subproject. */
  inherited_from?: { id: number; name?: string | null } | null;
};

/** Projects linked to an org via either path:
 *    1. Project.owner_org_id (single-pick owner)
 *    2. Project_organization junction (partners, sponsors, hosts, …)
 *  Returns a merged + deduped list. If an org appears as both owner
 *  and partner, the "owner" relation wins. */
export async function getOrgProjects(orgId: number): Promise<OrgProject[]> {
  const [owned, junctions] = await Promise.all([
    repo.list<Project>('Project', {
      where: {
        and: [
          { field: 'status', op: 'neq', value: 'archived' },
          { field: 'owner_org_id', op: 'eq', value: orgId }
        ]
      },
      fields: ['id', 'name', 'kind', 'status', 'summary', 'color', { owner_org_id: ['id', 'name'] }],
      sort: ['-date_updated', 'name'],
      limit: 200
    }),
    repo.list<{
      id: number;
      role_in_project: string | null;
      project_id: Project | number | null;
      inherited_from_project_id: { id: number; name?: string | null } | number | null;
    }>('Project_organization', {
      // Direct memberships only — inherited (rolled-up ancestor) projects
      // are a project-level view, not shown on an org's own card.
      where: {
        and: [
          { field: 'status', op: 'neq', value: 'archived' },
          { field: 'organization_id', op: 'eq', value: orgId },
          { field: 'inherited_from_project_id', op: 'null' }
        ]
      },
      fields: [
        'id', 'role_in_project',
        { project_id: ['id', 'name', 'kind', 'status', 'summary', 'color', { owner_org_id: ['id', 'name'] }] },
        { inherited_from_project_id: ['id', 'name'] }
      ],
      sort: ['-id'],
      limit: 200
    })
  ]);

  const byId = new Map<number, OrgProject>();
  for (const p of owned) {
    byId.set(p.id, { ...p, relation: 'owner', inherited_from: null });
  }
  for (const link of junctions) {
    const proj = link.project_id;
    if (!proj || typeof proj !== 'object' || !proj.id) continue;
    if (proj.status === 'archived') continue;
    if (byId.has(proj.id)) continue; // owner relation already wins
    const src = link.inherited_from_project_id;
    byId.set(proj.id, {
      ...(proj as Project),
      relation: 'partner',
      role_in_project: link.role_in_project ?? null,
      inherited_from: src && typeof src === 'object' ? src : null
    });
  }
  // Collapse redundant ancestor memberships to the most-specific ones, but
  // never hide an ownership relationship.
  const drop = await ancestorsWithinProjectSet([...byId.keys()]);
  return [...byId.values()]
    .filter((p) => p.relation === 'owner' || !drop.has(p.id))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

/** Minimal-payload listing used by the org filter sidebar tree.
 *  Returns every published project with the fields the tree needs
 *  to build its hierarchy and labels. */
export async function listProjectsForTree(): Promise<Array<Pick<Project, 'id' | 'name' | 'parent_id' | 'kind' | 'color' | 'status' | 'start_date' | 'end_date'>>> {
  return repo.list<Pick<Project, 'id' | 'name' | 'parent_id' | 'kind' | 'color' | 'status' | 'start_date' | 'end_date'>>(
    'Project',
    {
      where: { field: 'status', op: 'neq', value: 'archived' },
      fields: ['id', 'name', 'kind', 'color', 'status', 'start_date', 'end_date', { parent_id: ['id'] }],
      sort: ['name'],
      limit: -1
    }
  );
}

/** Resolve a set of project ids to the orgs linked to any of them
 *  via either path (owner_org_id or the Project_organization junction).
 *  Used by the /orgs filter sidebar — once the user picks a project
 *  the index narrows to its linked orgs. */
export async function getOrgIdsForProjects(projectIds: number[]): Promise<number[]> {
  if (projectIds.length === 0) return [];
  const orgIds = new Set<number>();
  const [owners, junctions] = await Promise.all([
    repo.list<{ owner_org_id: number | { id: number } | null }>('Project', {
      where: { field: 'id', op: 'in', value: projectIds },
      fields: ['owner_org_id'],
      limit: -1
    }),
    repo.list<{ organization_id: number | { id: number } | null }>('Project_organization', {
      where: {
        and: [
          { field: 'status', op: 'neq', value: 'archived' },
          { field: 'project_id', op: 'in', value: projectIds }
        ]
      },
      fields: ['organization_id'],
      limit: -1
    })
  ]);
  for (const o of owners) {
    const id = typeof o.owner_org_id === 'object' ? o.owner_org_id?.id : o.owner_org_id;
    if (typeof id === 'number') orgIds.add(id);
  }
  for (const j of junctions) {
    const id = typeof j.organization_id === 'object' ? j.organization_id?.id : j.organization_id;
    if (typeof id === 'number') orgIds.add(id);
  }
  return [...orgIds];
}

export async function addPersonToProject(patch: {
  project_id: number;
  person_id: number;
  role_in_project?: string | null;
  notes?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean | null;
}) {
  // New links are active members by default.
  const body = { is_current: true, ...patch };
  const created = await repo.create<ProjectPerson>('Project_people', body as Record<string, unknown>);
  await reconcilePersonProjectInheritance(patch.person_id);
  return created;
}

export async function updateProjectPerson(id: number, patch: Partial<ProjectPerson>) {
  return repo.update<ProjectPerson>('Project_people', id, patch as Record<string, unknown>);
}

/** Orgs linked to a project via the Project_organization junction.
 *  Excludes the project's owner org — that's a single-pick on the
 *  Project row itself, surfaced separately in the UI. */
export async function getProjectOrganizations(projectId: number) {
  return repo.list<ProjectOrganization>('Project_organization', {
    where: {
      and: [
        { field: 'status', op: 'neq', value: 'archived' },
        { field: 'project_id', op: 'eq', value: projectId }
      ]
    },
    fields: [
      'id', 'role_in_project', 'notes', 'status',
      { organization_id: ['id', 'name', 'previous_names', 'website', 'industry', 'logo', 'image_focal'] },
      { inherited_from_project_id: ['id', 'name'] }
    ],
    sort: ['role_in_project'],
    limit: 200
  });
}

export async function addOrgToProject(patch: {
  project_id: number;
  organization_id: number;
  role_in_project?: string | null;
  notes?: string | null;
}) {
  const created = await repo.create<ProjectOrganization>('Project_organization', patch as Record<string, unknown>);
  await reconcileOrgProjectInheritance(patch.organization_id);
  return created;
}

export async function updateProjectOrganization(id: number, patch: Partial<ProjectOrganization>) {
  return repo.update<ProjectOrganization>('Project_organization', id, patch as Record<string, unknown>);
}

export async function removeProjectOrganization(id: number) {
  const row = await repo.list<{ organization_id: number | { id: number } | null }>('Project_organization', {
    where: { field: 'id', op: 'eq', value: id },
    fields: ['organization_id'],
    limit: 1
  });
  const orgId = typeof row[0]?.organization_id === 'object'
    ? row[0]?.organization_id?.id
    : row[0]?.organization_id;
  const res = await updateProjectOrganization(id, { status: 'archived' });
  if (orgId) await reconcileOrgProjectInheritance(orgId);
  return res;
}

// Grants — programmes, awards and payout schedules — moved to $lib/data/grants.ts and re-exported
// at the end of this file. See docs/opening-up-twin.md.
