// Projects
//
// Feature-independent: projects are core, but this section is a leaf by
// dependency.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { Filter } from '$lib/data/repo';
import type { Project, ProjectPerson } from '$lib/data/types';

// ── Projects ────────────────────────────────────────────────────────────────

export async function searchProjects(
  q: string,
  limit = 50,
  extraFilters: (Filter | null | undefined)[] = [],
  opts: { includeArchived?: boolean } = {}
) {
  const query = q.trim();
  const and: Filter[] = opts.includeArchived
    ? []
    : [{ field: 'status', op: 'neq', value: 'archived' }];
  if (query) {
    and.push({
      or: [
        { field: 'name', op: 'icontains', value: query },
        { field: 'summary', op: 'icontains', value: query },
        { field: 'kind', op: 'icontains', value: query }
      ]
    });
  }
  for (const f of extraFilters) if (f) and.push(f);
  return repo.list<Project>('Project', {
    where: { and },
    fields: ['*', { owner_org_id: ['id', 'name', 'industry'] }, { parent_id: ['id', 'name'] }],
    limit,
    sort: query ? ['name'] : ['-date_updated', '-date_created', 'name']
  });
}

export async function getProject(id: number) {
  const project = await repo.get<Project>('Project', id, {
    fields: ['*', { owner_org_id: ['id', 'name', 'industry', 'website'] }, { parent_id: ['id', 'name'] }]
  });
  if (!project) throw new Error(`Project ${id} not found`);
  return project;
}

/** Walk up the parent chain from a project so the UI can render a
 *  breadcrumb. Stops at a top-level project or a cycle (defensive —
 *  the Directus schema shouldn't allow cycles but the UI must never
 *  loop forever). Returns ancestors from root → immediate parent. */
export async function listProjectAncestors(project: Project, maxDepth = 8): Promise<Project[]> {
  const chain: Project[] = [];
  let current: Project | null = project;
  const seen = new Set<number>([project.id]);
  for (let i = 0; i < maxDepth; i++) {
    const parent: number | Project | null | undefined = current?.parent_id;
    let parentRow: Project | null = null;
    if (parent && typeof parent === 'object') parentRow = parent;
    else if (typeof parent === 'number' && !seen.has(parent)) {
      parentRow = await getProject(parent);
    }
    if (!parentRow || seen.has(parentRow.id)) break;
    seen.add(parentRow.id);
    chain.unshift(parentRow);
    current = parentRow;
  }
  return chain;
}

/** Direct children of a project (one level only). Use for the
 *  "Sub-projects" card on a detail page. */
/** Collect the ids of `rootId` and *every* descendant project. BFS
 *  via `parent_id` so cycles can't lock the loop (defensive — schema
 *  shouldn't allow them). Used by the project detail page to roll up
 *  grant awards from cohort/child-project member orgs. */
export async function listProjectDescendantIds(rootId: number, maxDepth = 8): Promise<number[]> {
  const out = new Set<number>([rootId]);
  let frontier: number[] = [rootId];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const children = await repo.list<{ id: number }>('Project', {
      where: {
        and: [
          { field: 'status', op: 'neq', value: 'archived' },
          { field: 'parent_id', op: 'in', value: frontier }
        ]
      },
      fields: ['id'],
      limit: -1
    });
    const next: number[] = [];
    for (const c of children) {
      if (!out.has(c.id)) { out.add(c.id); next.push(c.id); }
    }
    frontier = next;
  }
  return [...out];
}

export async function listProjectChildren(parentId: number): Promise<Project[]> {
  return repo.list<Project>('Project', {
    where: {
      and: [
        { field: 'status', op: 'neq', value: 'archived' },
        { field: 'parent_id', op: 'eq', value: parentId }
      ]
    },
    fields: ['id', 'name', 'kind', 'status', 'summary', 'start_date', 'end_date', 'color'],
    sort: ['-date_updated', 'name'],
    limit: -1
  });
}

export async function createProject(patch: Partial<Project>) {
  return repo.create<Project>('Project', { status: 'draft', ...patch } as Record<string, unknown>);
}

export async function updateProject(id: number, patch: Partial<Project>) {
  return repo.update<Project>('Project', id, patch as Record<string, unknown>);
}

export async function setProjectStatus(id: number, status: 'draft' | 'published' | 'archived') {
  return updateProject(id, { status });
}

/** People linked to a project. */
export async function getProjectPeople(projectId: number) {
  return repo.list<ProjectPerson>('Project_people', {
    where: {
      and: [
        { field: 'status', op: 'neq', value: 'archived' },
        { field: 'project_id', op: 'eq', value: projectId }
      ]
    },
    fields: [
      'id', 'role_in_project', 'notes', 'status', 'start_date', 'end_date', 'is_current',
      { person_id: ['id', 'full_name', 'first_name', 'last_name', 'email', 'person_picture', 'scope'] },
      { inherited_from_project_id: ['id', 'name'] }
    ],
    // Current members first, then most-recently-started.
    sort: ['-is_current', '-start_date', 'role_in_project'],
    limit: 200
  });
}
