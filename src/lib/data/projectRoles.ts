// ProjectRole catalogue
//
// The fixed vocabulary of roles a person or org can hold on a project.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { ProjectRole } from '$lib/data/types';

// ── ProjectRole catalogue ──────────────────────────────────────────────
// Cached, like ActivityKind. Callers can pass `force` to bust the cache
// after a write from the settings page.
let projectRoleCache: { rows: ProjectRole[]; loadedAt: number } | null = null;
const PROJECT_ROLE_TTL_MS = 60_000;
export async function listProjectRoles(opts?: { includeArchived?: boolean; force?: boolean }): Promise<ProjectRole[]> {
  const includeArchived = !!opts?.includeArchived;
  const force = !!opts?.force;
  const fresh = projectRoleCache && Date.now() - projectRoleCache.loadedAt < PROJECT_ROLE_TTL_MS;
  if (!force && fresh && projectRoleCache) {
    return includeArchived ? projectRoleCache.rows : projectRoleCache.rows.filter((r) => r.status !== 'archived');
  }
  const BASE = ['id', 'key', 'label', 'applies_to', 'color', 'sort', 'status'];
  const SPONSOR = ['tier', 'is_sponsor', 'phrase_is', 'phrase_en'];
  const ask = (fields: string[]) =>
    repo.list<ProjectRole>('ProjectRole', { fields, sort: ['sort', 'label'] });
  // Falling back to BASE keeps every role picker working on an instance where
  // add-sponsor-roles.sh has not run — the tiers are absent, not the roles.
  let rows: ProjectRole[];
  try {
    rows = await ask([...BASE, ...SPONSOR]);
  } catch {
    rows = await ask(BASE);
  }
  projectRoleCache = { rows, loadedAt: Date.now() };
  return includeArchived ? rows : rows.filter((r) => r.status !== 'archived');
}

export async function createProjectRole(patch: Partial<ProjectRole> & { key: string; label: string }): Promise<ProjectRole> {
  projectRoleCache = null;
  return repo.create<ProjectRole>('ProjectRole', patch as Record<string, unknown>);
}
export async function updateProjectRole(id: number, patch: Partial<ProjectRole>): Promise<ProjectRole> {
  projectRoleCache = null;
  return repo.update<ProjectRole>('ProjectRole', id, patch as Record<string, unknown>);
}

// Calendar source → Project mapping — moved to $lib/data/calendarMapping.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
