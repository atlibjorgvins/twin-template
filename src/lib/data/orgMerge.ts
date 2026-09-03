// Org merge — repoint history from one row into another
//
// Merging duplicate organizations, repointing every reference. Needed
// updateOrg and updatePerson, both of which moved with the core.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { Filter } from '$lib/data/repo';
import type { Organization, Person } from '$lib/data/types';
import { updateOrg } from '$lib/data/orgs';
import { updatePerson } from '$lib/data/people';

// ─── Org merge — repoint history from one row into another ─────────────────
//
// Use case: a rebrand kept the same legal entity (same kennitala). Instead of
// living with two rows that fight the unique constraint, you merge the source
// row's history into the target and archive the source.
//
// `mergePreview()` is read-only — counts what *would* move so the UI can show
// a confirmation. `mergeOrgInto()` then does the writes sequentially. There's
// no transaction; failures mid-way leave a partial state, but every step is
// independent and replayable, so re-running with the same source/target does
// nothing harmful (Directus updates are idempotent and the dedup logic for
// tags re-checks before linking).

export type MergePreview = {
  source: { id: number; name: string };
  target: { id: number; name: string };
  counts: {
    roles: number;
    activities: number;
    dates: number;
    projects: number;
    /** Project_organization links (sponsor / participant / cohort). */
    projectLinks: number;
    grants: number;
    photos: number;
    tags: number;
    notes: number;
  };
};

async function countItems(collection: string, where: Filter): Promise<number> {
  return repo.count(collection, where);
}

export async function mergePreview(sourceId: number, targetId: number): Promise<MergePreview> {
  if (sourceId === targetId) throw new Error('Source and target must be different orgs.');
  const [s, t] = await Promise.all([
    repo.get<{ id: number; name: string }>('organization', sourceId, { fields: ['id', 'name'] }),
    repo.get<{ id: number; name: string }>('organization', targetId, { fields: ['id', 'name'] })
  ]);
  if (!s || !t) throw new Error('Source or target organization not found.');
  const [roles, activities, dates, projects, projectLinks, grants, photos, tags] = await Promise.all([
    countItems('Person_organization', { field: 'organization_id', op: 'eq', value: sourceId }),
    countItems('Activity', { field: 'organization_id', op: 'eq', value: sourceId }),
    countItems('Dates', { field: 'organization', op: 'eq', value: sourceId }),
    countItems('Project', { field: 'owner_org_id', op: 'eq', value: sourceId }),
    countItems('Project_organization', { field: 'organization_id', op: 'eq', value: sourceId }),
    countItems('GrantAward', { field: 'organization_id', op: 'eq', value: sourceId }),
    countItems('organization_photo', { field: 'organization_id', op: 'eq', value: sourceId }),
    countItems('organization_tag', { field: 'organization_id', op: 'eq', value: sourceId })
  ]);
  // notes_related_to.collection is JSON-typed (no _eq); narrow on item, match in JS.
  const notes = (
    await repo.list<{ id: number; collection: string | null }>('notes_related_to', {
      where: { field: 'item', op: 'eq', value: String(sourceId) },
      fields: ['id', 'collection'],
      limit: -1
    })
  ).filter((n) => n.collection === 'organization').length;
  return { source: s, target: t, counts: { roles, activities, dates, projects, projectLinks, grants, photos, tags, notes } };
}

/**
 * Repoint everything that referenced `sourceId` so it now points at
 * `targetId`, then archive the source. Returns counts of what actually moved.
 *
 * What moves:
 *   - Person_organization rows (roles)
 *   - Activity rows (event_type events tied to the org)
 *   - Dates rows (calendar events tied to the org)
 *   - Project.owner_org_id (projects this org owned)
 *   - organization_tag links (de-duped — never double-attaches a tag the
 *     target already has)
 *
 * What changes on the rows themselves:
 *   - target.previous_names ← target.previous_names + ", " + source.name
 *   - source.successor_id ← target.id
 *   - source.is_active ← false
 *   - source.status ← 'archived'
 */
/** Merge `source` person into `target`. Re-points the source's
 *  relations onto the target and archives the source. Mirrors
 *  mergeOrgInto's contract; counts match the per-collection moves.
 *
 *  Tables rewired:
 *    - Person_organization (person_id) — de-duped per org
 *    - Project_people (person_id) — de-duped vs target's existing links
 *    - Activity_Person (person_id) — de-duped per activity
 *    - Person_family   (person_id and relative_id)
 *    - Person_tag      (person_id) — de-duped per tag
 *    - Dates_Person    (Person_id) — de-duped per date
 *    - notes_related_to (item) for collection='Person' — bare repoint
 *
 *  After rewiring, source.status = 'archived'. */
export async function mergePersonInto(sourceId: number, targetId: number): Promise<{ orgs: number; projects: number; activities: number; family: number; tags: number; dates: number; notes: number }> {
  if (sourceId === targetId) throw new Error('Source and target must be different people.');

  // Project_people: de-dup per project, then move.
  const tgtProjLinks = await repo.list<{ id: number; project_id: number | { id: number } | null }>(
    'Project_people',
    { where: { field: 'person_id', op: 'eq', value: targetId }, fields: ['id', 'project_id'], limit: -1 }
  );
  const tgtProjectIds = new Set(
    tgtProjLinks.map((l) => (typeof l.project_id === 'object' ? l.project_id?.id : l.project_id)).filter((v): v is number => typeof v === 'number')
  );
  const srcProjLinks = await repo.list<{ id: number; project_id: number | { id: number } | null }>(
    'Project_people',
    { where: { field: 'person_id', op: 'eq', value: sourceId }, fields: ['id', 'project_id'], limit: -1 }
  );
  let projectMoves = 0;
  for (const l of srcProjLinks) {
    const pid = typeof l.project_id === 'object' ? l.project_id?.id : l.project_id;
    if (typeof pid !== 'number') continue;
    if (tgtProjectIds.has(pid)) {
      await repo.remove('Project_people', l.id);
    } else {
      await repo.update('Project_people', l.id, { person_id: targetId });
      tgtProjectIds.add(pid);
      projectMoves++;
    }
  }

  // Person_organization: de-dup per org, then move.
  //
  // This was missing until a merge left the source's employment history on
  // the archived record — invisible, because the org card now filters
  // archived people out. A person's roles are the most load-bearing thing
  // they own; leaving them behind makes the merge look like data loss.
  const tgtOrgLinks = await repo.list<{ id: number; organization_id: number | { id: number } | null }>(
    'Person_organization',
    { where: { field: 'person_id', op: 'eq', value: targetId }, fields: ['id', 'organization_id'], limit: -1 }
  );
  const tgtOrgIds = new Set(
    tgtOrgLinks.map((l) => (typeof l.organization_id === 'object' ? l.organization_id?.id : l.organization_id)).filter((v): v is number => typeof v === 'number')
  );
  const srcOrgLinks = await repo.list<{ id: number; organization_id: number | { id: number } | null }>(
    'Person_organization',
    { where: { field: 'person_id', op: 'eq', value: sourceId }, fields: ['id', 'organization_id'], limit: -1 }
  );
  let orgMoves = 0;
  for (const l of srcOrgLinks) {
    const oid = typeof l.organization_id === 'object' ? l.organization_id?.id : l.organization_id;
    if (typeof oid !== 'number') continue;
    // Already employed there on the target: the duplicate row carries no
    // information the target lacks, so drop it rather than stack two
    // identical rows on one org page.
    if (tgtOrgIds.has(oid)) await repo.remove('Person_organization', l.id);
    else {
      await repo.update('Person_organization', l.id, { person_id: targetId });
      tgtOrgIds.add(oid); orgMoves++;
    }
  }

  // Activity_Person: de-dup per activity, then move.
  const tgtAct = await repo.list<{ id: number; activity_id: number | { id: number } | null }>(
    'Activity_Person',
    { where: { field: 'person_id', op: 'eq', value: targetId }, fields: ['id', 'activity_id'], limit: -1 }
  );
  const tgtActIds = new Set(
    tgtAct.map((l) => (typeof l.activity_id === 'object' ? l.activity_id?.id : l.activity_id)).filter((v): v is number => typeof v === 'number')
  );
  const srcAct = await repo.list<{ id: number; activity_id: number | { id: number } | null }>(
    'Activity_Person',
    { where: { field: 'person_id', op: 'eq', value: sourceId }, fields: ['id', 'activity_id'], limit: -1 }
  );
  let activityMoves = 0;
  for (const l of srcAct) {
    const aid = typeof l.activity_id === 'object' ? l.activity_id?.id : l.activity_id;
    if (typeof aid !== 'number') continue;
    if (tgtActIds.has(aid)) await repo.remove('Activity_Person', l.id);
    else {
      await repo.update('Activity_Person', l.id, { person_id: targetId });
      tgtActIds.add(aid); activityMoves++;
    }
  }

  // Family edges: rewrite both directions. We don't dedupe — distinct
  // relations on opposite sides may both be valid; the UI already
  // de-duplicates derived edges at read time.
  const famAsSubject = await repo.list<{ id: number }>('Person_family', {
    where: { field: 'person_id', op: 'eq', value: sourceId }, fields: ['id'], limit: -1
  });
  for (const f of famAsSubject) await repo.update('Person_family', f.id, { person_id: targetId });
  const famAsObject = await repo.list<{ id: number }>('Person_family', {
    where: { field: 'relative_id', op: 'eq', value: sourceId }, fields: ['id'], limit: -1
  });
  for (const f of famAsObject) await repo.update('Person_family', f.id, { relative_id: targetId });
  const familyMoves = famAsSubject.length + famAsObject.length;

  // Person_tag: dedupe per tag.
  const tgtTags = await repo.list<{ id: number; tag_id: number | { id: number } | null }>('Person_tag', {
    where: { field: 'person_id', op: 'eq', value: targetId }, fields: ['id', 'tag_id'], limit: -1
  });
  const tgtTagIds = new Set(
    tgtTags.map((l) => (typeof l.tag_id === 'object' ? l.tag_id?.id : l.tag_id)).filter((v): v is number => typeof v === 'number')
  );
  const srcTags = await repo.list<{ id: number; tag_id: number | { id: number } | null }>('Person_tag', {
    where: { field: 'person_id', op: 'eq', value: sourceId }, fields: ['id', 'tag_id'], limit: -1
  });
  let tagMoves = 0;
  for (const l of srcTags) {
    const tid = typeof l.tag_id === 'object' ? l.tag_id?.id : l.tag_id;
    if (typeof tid !== 'number') continue;
    if (tgtTagIds.has(tid)) await repo.remove('Person_tag', l.id);
    else { await repo.update('Person_tag', l.id, { person_id: targetId }); tgtTagIds.add(tid); tagMoves++; }
  }

  // Dates_Person: dedupe per date.
  const tgtDates = await repo.list<{ id: number; Dates_id: number | { id: number } | null }>('Dates_Person', {
    where: { field: 'Person_id', op: 'eq', value: targetId }, fields: ['id', 'Dates_id'], limit: -1
  });
  const tgtDateIds = new Set(
    tgtDates.map((l) => (typeof l.Dates_id === 'object' ? l.Dates_id?.id : l.Dates_id)).filter((v): v is number => typeof v === 'number')
  );
  const srcDates = await repo.list<{ id: number; Dates_id: number | { id: number } | null }>('Dates_Person', {
    where: { field: 'Person_id', op: 'eq', value: sourceId }, fields: ['id', 'Dates_id'], limit: -1
  });
  let dateMoves = 0;
  for (const l of srcDates) {
    const did = typeof l.Dates_id === 'object' ? l.Dates_id?.id : l.Dates_id;
    if (typeof did !== 'number') continue;
    if (tgtDateIds.has(did)) await repo.remove('Dates_Person', l.id);
    else { await repo.update('Dates_Person', l.id, { Person_id: targetId }); tgtDateIds.add(did); dateMoves++; }
  }

  // Note relations (notes_related_to). Bare repoint — no dedupe since
  // a note may legitimately link both source and target.
  // `collection` is a JSON-typed column — Directus rejects `_eq` on it
  // ("json field type does not contain the _eq filter operator"), which
  // used to make the whole merge throw right before archiving. So we
  // narrow on `item` (a plain string column) server-side and match
  // `collection` client-side, mirroring listNotesForEntity.
  const noteLinks = (
    await repo.list<{ id: number; collection: string | null }>('notes_related_to', {
      where: { field: 'item', op: 'eq', value: String(sourceId) },
      fields: ['id', 'collection'],
      limit: -1
    })
  ).filter((n) => n.collection === 'Person');
  for (const n of noteLinks) await repo.update('notes_related_to', n.id, { item: String(targetId) });

  // Finally archive the source.
  await repo.update('Person', sourceId, { status: 'archived' });

  return { orgs: orgMoves, projects: projectMoves, activities: activityMoves, family: familyMoves, tags: tagMoves, dates: dateMoves, notes: noteLinks.length };
}

/** Merge `source` project into `target`. Re-points relations onto the
 *  target and archives the source. */
export async function mergeProjectInto(sourceId: number, targetId: number): Promise<{ people: number; activities: number; dates: number; children: number }> {
  if (sourceId === targetId) throw new Error('Source and target must be different projects.');

  // Project_people: dedupe per person.
  const tgtPL = await repo.list<{ id: number; person_id: number | { id: number } | null }>('Project_people', {
    where: { field: 'project_id', op: 'eq', value: targetId }, fields: ['id', 'person_id'], limit: -1
  });
  const tgtPersonIds = new Set(
    tgtPL.map((l) => (typeof l.person_id === 'object' ? l.person_id?.id : l.person_id)).filter((v): v is number => typeof v === 'number')
  );
  const srcPL = await repo.list<{ id: number; person_id: number | { id: number } | null }>('Project_people', {
    where: { field: 'project_id', op: 'eq', value: sourceId }, fields: ['id', 'person_id'], limit: -1
  });
  let peopleMoves = 0;
  for (const l of srcPL) {
    const pid = typeof l.person_id === 'object' ? l.person_id?.id : l.person_id;
    if (typeof pid !== 'number') continue;
    if (tgtPersonIds.has(pid)) await repo.remove('Project_people', l.id);
    else { await repo.update('Project_people', l.id, { project_id: targetId }); tgtPersonIds.add(pid); peopleMoves++; }
  }

  // Activities pinned to the source project.
  const acts = await repo.list<{ id: number }>('Activity', {
    where: { field: 'project_id', op: 'eq', value: sourceId }, fields: ['id'], limit: -1
  });
  for (const a of acts) await repo.update('Activity', a.id, { project_id: targetId });

  // Dates pinned to the source project.
  const dates = await repo.list<{ id: number }>('Dates', {
    where: { field: 'project_id', op: 'eq', value: sourceId }, fields: ['id'], limit: -1
  });
  for (const d of dates) await repo.update('Dates', d.id, { project_id: targetId });

  // Child projects: re-parent them onto the target.
  const kids = await repo.list<{ id: number }>('Project', {
    where: { field: 'parent_id', op: 'eq', value: sourceId }, fields: ['id'], limit: -1
  });
  for (const k of kids) await repo.update('Project', k.id, { parent_id: targetId });

  // Archive source.
  await repo.update('Project', sourceId, { status: 'archived' });

  return { people: peopleMoves, activities: acts.length, dates: dates.length, children: kids.length };
}

/** Rebrand `source` into `target`: the same legal entity took a new
 *  name. Like mergeOrgInto, this NOW transfers all relations (people,
 *  activities, events, project links, grants, photos, tags, notes)
 *  onto the new identity — so the live record follows the rename.
 *  Unlike a merge, the old row is NOT archived: it stays findable as a
 *  "previously known as" record, and the target's previous_names keeps
 *  the trail so contexts like projects can show "New (fka Old)".
 *   - relations → target (via repointOrgRelations)
 *   - target.previous_names appends source.name (deduped)
 *   - source.successor_id = targetId
 *   - source.lifecycle_status = 'rebranded'
 *   - source.is_active = false (old name no longer trades)
 *   - source.status stays as-is (not archived — still in history views)
 *
 *  Use mergeOrgInto for true duplicates (loser archived). Use
 *  rebrandOrgTo when the old name should stay visible as history. */
export async function rebrandOrgTo(sourceId: number, targetId: number): Promise<MergePreview['counts']> {
  if (sourceId === targetId) throw new Error('Source and target must be different orgs.');
  const counts = await repointOrgRelations(sourceId, targetId);
  const src = await repo.get<{ name: string | null }>('organization', sourceId, { fields: ['name'] });
  await appendPreviousName(targetId, src?.name ?? null);
  await repo.update('organization', sourceId, {
    successor_id: targetId,
    lifecycle_status: 'rebranded',
    is_active: false
  });
  return counts;
}

/** Display name that surfaces a rebrand trail inline, e.g.
 *  "Sveppa (fka Svepparíkið)". Falls back to the plain name. */
export function orgDisplayName(
  org: { name?: string | null; previous_names?: string | null } | null | undefined
): string {
  const name = (org?.name ?? '').trim() || '(unnamed)';
  const prev = (org?.previous_names ?? '').trim();
  return prev ? `${name} (fka ${prev})` : name;
}

/** List every org whose successor_id points at this org — i.e. all
 *  previous identities (merged or rebranded). Used by the survivor's
 *  detail page to surface "Previous identities" in one block. */
export async function listPreviousIdentities(orgId: number): Promise<Array<Pick<Organization, 'id' | 'name' | 'lifecycle_status' | 'logo' | 'image_focal'>>> {
  return repo.list<Pick<Organization, 'id' | 'name' | 'lifecycle_status' | 'logo' | 'image_focal'>>(
    'organization',
    {
      where: { field: 'successor_id', op: 'eq', value: orgId },
      fields: ['id', 'name', 'lifecycle_status', 'logo', 'image_focal'],
      sort: ['name'],
      limit: 100
    }
  );
}

/** Apply a winner patch first, then run the merge. This is the
 *  field-aware variant used by the MergeReview UI: the user resolves
 *  conflicts on a per-field basis, we PATCH the winner with the
 *  resolved values, and then re-point all the loser's relations onto
 *  the winner via the regular merge. Order matters — patch first so
 *  the relation-move step sees the final field state. */
export async function mergeOrgIntoWithPatch(
  sourceId: number,
  targetId: number,
  targetPatch: Partial<Organization>
): Promise<MergePreview['counts']> {
  if (targetPatch && Object.keys(targetPatch).length > 0) {
    await updateOrg(targetId, targetPatch);
  }
  return mergeOrgInto(sourceId, targetId);
}

export async function mergePersonIntoWithPatch(
  sourceId: number,
  targetId: number,
  targetPatch: Partial<Person>
): Promise<{ orgs: number; projects: number; activities: number; family: number; tags: number; dates: number; notes: number }> {
  if (targetPatch && Object.keys(targetPatch).length > 0) {
    await updatePerson(targetId, targetPatch);
  }
  return mergePersonInto(sourceId, targetId);
}

/** Repoint everything that references `sourceId` so it points at
 *  `targetId`. Shared by mergeOrgInto (then archives the source) and
 *  rebrandOrgTo (then keeps the source as a "previously known as"
 *  record). Idempotent and replayable — junction moves de-dupe so a
 *  re-run never double-attaches. Does NOT touch the org rows
 *  themselves (name trail / lifecycle) — callers do that. */
async function repointOrgRelations(sourceId: number, targetId: number): Promise<MergePreview['counts']> {
  // Bare repoints (no dedup needed — these point AT the org).
  const repoint = async (collection: string, field: string): Promise<number> => {
    const rows = await repo.list<{ id: number }>(collection, {
      where: { field, op: 'eq', value: sourceId },
      fields: ['id'],
      limit: -1
    });
    for (const r of rows) {
      await repo.update(collection, r.id, { [field]: targetId });
    }
    return rows.length;
  };

  const roles = await repoint('Person_organization', 'organization_id');
  const activities = await repoint('Activity', 'organization_id');
  const dates = await repoint('Dates', 'organization');
  const projects = await repoint('Project', 'owner_org_id');
  const grants = await repoint('GrantAward', 'organization_id');
  const photos = await repoint('organization_photo', 'organization_id');

  // Project_organization (sponsor / participant / cohort) — dedupe per
  // (project, role) so a project linked to both identities doesn't end
  // up with a duplicate row.
  const tgtProjLinks = await repo.list<{ id: number; project_id: number | { id: number } | null; role_in_project: string | null }>(
    'Project_organization',
    {
      where: { field: 'organization_id', op: 'eq', value: targetId },
      fields: ['id', 'project_id', 'role_in_project'],
      limit: -1
    }
  );
  const projKey = (pid: number | { id: number } | null, role: string | null) =>
    `${typeof pid === 'object' ? pid?.id : pid}:${role ?? ''}`;
  const tgtProjKeys = new Set(tgtProjLinks.map((l) => projKey(l.project_id, l.role_in_project)));
  const srcProjLinks = await repo.list<{ id: number; project_id: number | { id: number } | null; role_in_project: string | null }>(
    'Project_organization',
    {
      where: { field: 'organization_id', op: 'eq', value: sourceId },
      fields: ['id', 'project_id', 'role_in_project'],
      limit: -1
    }
  );
  let projectLinks = 0;
  for (const l of srcProjLinks) {
    const key = projKey(l.project_id, l.role_in_project);
    if (tgtProjKeys.has(key)) {
      await repo.remove('Project_organization', l.id);
    } else {
      await repo.update('Project_organization', l.id, { organization_id: targetId });
      tgtProjKeys.add(key);
    }
    projectLinks++;
  }

  // organization_tag — dedupe per tag.
  const targetTagLinks = await repo.list<{ id: number; tag_id: number | { id: number } }>('organization_tag', {
    where: { field: 'organization_id', op: 'eq', value: targetId },
    fields: ['id', 'tag_id'],
    limit: -1
  });
  const targetTagIds = new Set(
    targetTagLinks.map((l) => (typeof l.tag_id === 'object' ? l.tag_id?.id : l.tag_id)).filter((v): v is number => typeof v === 'number')
  );
  const sourceTagLinks = await repo.list<{ id: number; tag_id: number | { id: number } }>('organization_tag', {
    where: { field: 'organization_id', op: 'eq', value: sourceId },
    fields: ['id', 'tag_id'],
    limit: -1
  });
  for (const l of sourceTagLinks) {
    const tagId = typeof l.tag_id === 'object' ? l.tag_id?.id : l.tag_id;
    if (typeof tagId !== 'number') continue;
    if (targetTagIds.has(tagId)) {
      await repo.remove('organization_tag', l.id);
    } else {
      await repo.update('organization_tag', l.id, { organization_id: targetId });
      targetTagIds.add(tagId);
    }
  }

  // Note relations (notes_related_to, collection='organization'). The
  // `collection` column is JSON-typed (no _eq) — narrow on `item`
  // server-side, match collection in JS. Bare repoint.
  const noteLinks = (
    await repo.list<{ id: number; collection: string | null }>('notes_related_to', {
      where: { field: 'item', op: 'eq', value: String(sourceId) },
      fields: ['id', 'collection'],
      limit: -1
    })
  ).filter((n) => n.collection === 'organization');
  for (const n of noteLinks) {
    await repo.update('notes_related_to', n.id, { item: String(targetId) });
  }

  return {
    roles,
    activities,
    dates,
    projects,
    projectLinks,
    grants,
    photos,
    tags: sourceTagLinks.length,
    notes: noteLinks.length
  };
}

/** Append `sourceName` to the target's comma-separated previous_names
 *  (deduped), so the survivor records its former identities. */
async function appendPreviousName(targetId: number, sourceName: string | null): Promise<void> {
  const name = (sourceName ?? '').trim();
  if (!name) return;
  const tgt = await repo.get<{ previous_names: string | null }>('organization', targetId, {
    fields: ['previous_names']
  });
  const existing = (tgt?.previous_names ?? '').trim();
  if (existing && existing.split(/\s*,\s*/).includes(name)) return;
  const merged = existing ? `${existing}, ${name}` : name;
  await repo.update('organization', targetId, { previous_names: merged });
}

export async function mergeOrgInto(sourceId: number, targetId: number): Promise<MergePreview['counts']> {
  if (sourceId === targetId) throw new Error('Source and target must be different orgs.');
  const counts = await repointOrgRelations(sourceId, targetId);
  const src = await repo.get<{ name: string | null }>('organization', sourceId, { fields: ['name'] });
  await appendPreviousName(targetId, src?.name ?? null);
  // Duplicate of the same entity — the loser is archived outright.
  await repo.update('organization', sourceId, {
    successor_id: targetId,
    is_active: false,
    status: 'archived'
  });
  return counts;
}
