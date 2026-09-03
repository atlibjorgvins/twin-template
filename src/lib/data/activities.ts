// Activities — logged interactions
//
// The interaction log itself; ActivityKind already moved.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { Filter } from '$lib/data/repo';
import type { Activity, ActivityPerson } from '$lib/data/types';

// ─── Activities ─────────────────────────────────────────────────────────────

// Exported because code still in directus.ts reads it.
export const ACTIVITY_FIELDS = [
  'id',
  'title',
  'kind',
  'significance',
  'occurred_at',
  'end_at',
  'scope',
  'location',
  'summary',
  'status',
  'date_created',
  'date_updated',
  { kind_id: ['id', 'key', 'label', 'emoji', 'icon', 'color', 'default_significance', 'scope', 'sort'] },
  { organization_id: ['id', 'name', 'logo', 'image_focal'] },
  { project_id: ['id', 'name', 'kind'] }
] as const;

type ActivityFilter = {
  personId?: number;
  orgId?: number;
  projectId?: number;
  /** Legacy string keys (matches `Activity.kind`). */
  kinds?: string[];
  /** New: filter by `ActivityKind.id` via `Activity.kind_id`. */
  kindIds?: number[];
  limit?: number;
};

/**
 * List activities, optionally filtered by person / org / project / kinds.
 * Newest first.
 */
export async function listActivities(filter: ActivityFilter = {}): Promise<Activity[]> {
  const conds: Filter[] = [];
  if (filter.orgId) conds.push({ field: 'organization_id', op: 'eq', value: filter.orgId });
  if (filter.projectId) conds.push({ field: 'project_id', op: 'eq', value: filter.projectId });
  if (filter.kinds && filter.kinds.length) conds.push({ field: 'kind', op: 'in', value: filter.kinds });
  if (filter.kindIds && filter.kindIds.length) conds.push({ field: 'kind_id', op: 'in', value: filter.kindIds });

  if (filter.personId) {
    // Find activity ids that involve this person, then fetch them.
    const links = await repo.list<{ activity_id: number | { id: number } | null }>('Activity_Person', {
      where: { field: 'person_id', op: 'eq', value: filter.personId },
      fields: ['activity_id']
    });
    const ids = links
      .map((l) => (typeof l.activity_id === 'object' ? l.activity_id?.id : l.activity_id))
      .filter((v): v is number => typeof v === 'number');
    if (ids.length === 0) return [];
    conds.push({ field: 'id', op: 'in', value: ids });
  }

  const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : { and: conds };
  return await repo.list<Activity>('Activity', {
    where,
    fields: ACTIVITY_FIELDS as unknown as string[],
    sort: ['-occurred_at'],
    limit: filter.limit ?? 200
  });
}

export async function getActivity(id: number): Promise<Activity> {
  const a = await repo.get<Activity>('Activity', id, { fields: ACTIVITY_FIELDS as unknown as string[] });
  if (!a) throw new Error(`Activity ${id} not found`);
  return a;
}

export async function createActivity(
  patch: Partial<Activity> & { title: string; occurred_at: string }
): Promise<Activity> {
  return await repo.create<Activity>('Activity', patch as Record<string, unknown>);
}

export async function updateActivity(id: number, patch: Partial<Activity>): Promise<Activity> {
  return await repo.update<Activity>('Activity', id, patch as Record<string, unknown>);
}

export async function deleteActivity(id: number): Promise<void> {
  await repo.remove('Activity', id);
}

/** People involved in an activity (with role and expanded person). */
export async function getActivityPeople(activityId: number): Promise<ActivityPerson[]> {
  return await repo.list<ActivityPerson>('Activity_Person', {
    where: { field: 'activity_id', op: 'eq', value: activityId },
    fields: [
      'id',
      'role',
      'activity_id',
      { person_id: ['id', 'full_name', 'first_name', 'last_name', 'person_picture', 'image_focal'] }
    ]
  });
}

export async function attachPersonToActivity(
  activityId: number,
  personId: number,
  role?: string | null
): Promise<ActivityPerson> {
  return await repo.create<ActivityPerson>('Activity_Person', {
    activity_id: activityId,
    person_id: personId,
    role: role ?? null
  } as Record<string, unknown>);
}

export async function detachPersonFromActivity(junctionId: number): Promise<void> {
  await repo.remove('Activity_Person', junctionId);
}
