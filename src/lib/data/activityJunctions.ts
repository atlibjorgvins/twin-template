// Activity junctions — orgs and tags on an interaction
//
// Two junction tables, both under the 40-line threshold section-deps.py
// reports on, which is how they nearly got stranded in a file whose other
// activity code had already left.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { Activity, ActivityTag, Organization } from '$lib/data/types';

// ─── Activity ↔ Organization (multiple orgs per interaction) ──────────────
// Mirrors Activity_Person. The legacy single Activity.organization_id is
// kept for back-compat; new linking goes through this junction.
export type ActivityOrg = {
  id: number;
  activity_id?: number | Activity | null;
  organization_id?: number | Organization | null;
};
export async function getActivityOrgs(activityId: number): Promise<ActivityOrg[]> {
  return repo.list<ActivityOrg>('Activity_organization', {
    where: { field: 'activity_id', op: 'eq', value: activityId },
    fields: ['id', 'activity_id', { organization_id: ['id', 'name', 'logo', 'image_focal'] }]
  });
}
export async function attachOrgToActivity(activityId: number, orgId: number): Promise<ActivityOrg> {
  return repo.create<ActivityOrg>('Activity_organization', {
    activity_id: activityId,
    organization_id: orgId
  } as Record<string, unknown>);
}
export async function detachOrgFromActivity(junctionId: number): Promise<void> {
  await repo.remove('Activity_organization', junctionId);
}

// ActivityKind — the user-managed catalogue of interaction kinds — moved to $lib/data/activityKind.ts and re-exported
// at the end of this file. See docs/opening-up-twin.md.
// ─── Activity_tag junction (shared Tag pool) ───────────────────────────

/** Tag rows attached to a single activity. */
export async function getActivityTags(activityId: number): Promise<ActivityTag[]> {
  return repo.list<ActivityTag>('Activity_tag', {
    where: { field: 'activity_id', op: 'eq', value: activityId },
    fields: ['id', 'activity_id', { tag_id: ['id', 'name', 'color', 'scope', 'status'] }]
  });
}

export async function attachTagToActivity(activityId: number, tagId: number): Promise<ActivityTag> {
  return repo.create<ActivityTag>('Activity_tag', { activity_id: activityId, tag_id: tagId } as Record<string, unknown>);
}

export async function detachTagFromActivity(junctionId: number): Promise<void> {
  await repo.remove('Activity_tag', junctionId);
}

// searchActivities — the interactions query — moved to $lib/data/activitySearch.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
