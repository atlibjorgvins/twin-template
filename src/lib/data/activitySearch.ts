// searchActivities — the interactions query
//
// Powers /interactions and the dashboards. Unblocked once activities.ts and
// activityKind.ts moved.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { Filter } from '$lib/data/repo';
import { ACTIVITY_FIELDS } from '$lib/data/activities';
import type { Activity } from '$lib/data/types';
import type { Scope } from '$lib/scope';
import { scopeWhere } from '$lib/scope';

// ─── searchActivities — power /interactions, dashboards, future search ─

type ActivitySearchOpts = {
  q?: string;
  /** Filter by ActivityKind keys (slugs). */
  kindKeys?: string[];
  personId?: number;
  orgId?: number;
  projectId?: number;
  /** Filter by tags in the shared pool. */
  tagIds?: number[];
  /** ISO date strings (inclusive). */
  from?: string;
  to?: string;
  /** Work/Private toggle. Un-tagged rows fall under 'work' (see scopeFilter). */
  scope?: Scope;
  limit?: number;
};

/**
 * Powers `/interactions` and any cross-cutting activity search. Resolves
 * tag and person filters via their respective junctions first, then ANDs
 * the rest server-side.
 */
export async function searchActivities(opts: ActivitySearchOpts = {}): Promise<Activity[]> {
  const { q = '', kindKeys = [], personId, orgId, projectId, tagIds = [], from, to, scope, limit = 100 } = opts;
  const filters: Filter[] = [{ field: 'status', op: 'neq', value: 'archived' }];

  const sf = scope ? scopeWhere(scope) : null;
  if (sf) filters.push(sf);

  if (q.trim()) {
    const term = q.trim();
    filters.push({
      or: [
        { field: 'title', op: 'icontains', value: term },
        { field: 'summary', op: 'icontains', value: term },
        { field: 'location', op: 'icontains', value: term }
      ]
    });
  }
  if (kindKeys.length) filters.push({ field: 'kind', op: 'in', value: kindKeys });
  if (orgId) filters.push({ field: 'organization_id', op: 'eq', value: orgId });
  if (projectId) filters.push({ field: 'project_id', op: 'eq', value: projectId });
  if (from) filters.push({ field: 'occurred_at', op: 'gte', value: from });
  if (to) filters.push({ field: 'occurred_at', op: 'lte', value: to });

  if (personId) {
    const links = await repo.list<{ activity_id: number | { id: number } | null }>('Activity_Person', {
      where: { field: 'person_id', op: 'eq', value: personId },
      fields: ['activity_id']
    });
    const ids = links
      .map((l) => (typeof l.activity_id === 'object' ? l.activity_id?.id : l.activity_id))
      .filter((v): v is number => typeof v === 'number');
    if (ids.length === 0) return [];
    filters.push({ field: 'id', op: 'in', value: ids });
  }

  if (tagIds.length) {
    const junctions = await repo.list<{ activity_id: number | null }>('Activity_tag', {
      where: { field: 'tag_id', op: 'in', value: tagIds },
      fields: ['activity_id']
    });
    const ids = Array.from(
      new Set(junctions.map((j) => j.activity_id).filter((n): n is number => typeof n === 'number'))
    );
    if (ids.length === 0) return [];
    filters.push({ field: 'id', op: 'in', value: ids });
  }

  const where = filters.length === 1 ? filters[0] : { and: filters };
  return await repo.list<Activity>('Activity', {
    where,
    fields: ACTIVITY_FIELDS as unknown as string[],
    sort: ['-occurred_at'],
    limit
  });
}
