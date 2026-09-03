/**
 * Transitive (upward) project membership.
 *
 * A person/org that is a *direct* member of a subproject is materialised as
 * an *inherited* member of every ancestor project up the `parent_id` chain.
 * Inherited rows carry `inherited_from_project_id` (a descendant subproject
 * that justifies them); direct rows leave it null.
 *
 * Rules (see the reconcile below):
 *   - Membership rolls UP only — a cohort member reaches every ancestor,
 *     never a sibling cohort (siblings aren't ancestors) and never a child.
 *   - Inherited rows are system-managed: reconcile creates/refreshes/deletes
 *     them; it never touches direct rows.
 *   - Idempotent: safe to run repeatedly (that's how the backfill works).
 *
 * Triggered from the membership mutators in `directus.ts` (add/remove/bulk).
 * Edits made directly in Directus admin bypass this — re-run
 * `backfillProjectInheritance()` to heal drift.
 */
import { readItems, createItem, deleteItem, updateItem } from '@directus/sdk';
import { directus } from '$lib/directus';

type Junction = 'Project_people' | 'Project_organization';
type Fk = 'person_id' | 'organization_id';

/** Directus M2O fields arrive as a number or an expanded object. */
const idOf = (v: unknown): number | null =>
  v == null ? null : typeof v === 'object' ? ((v as { id?: number }).id ?? null) : (v as number);

/** Walk `parent_id` → ancestor ids (nearest-first), memoised + cycle-guarded. */
function makeAncestorWalker() {
  const parentCache = new Map<number, number | null>();
  async function parentOf(id: number): Promise<number | null> {
    if (parentCache.has(id)) return parentCache.get(id)!;
    const rows = (await directus.request(
      readItems('Project', { filter: { id: { _eq: id } }, fields: ['id', 'parent_id'], limit: 1 } as never)
    )) as Array<{ id: number; parent_id: number | { id: number } | null }>;
    const parent = rows[0] ? idOf(rows[0].parent_id) : null;
    parentCache.set(id, parent);
    return parent;
  }
  return async function ancestorIds(id: number): Promise<number[]> {
    const out: number[] = [];
    const seen = new Set<number>([id]);
    let cur = id;
    for (let i = 0; i < 16; i++) {
      const par = await parentOf(cur);
      if (par == null || seen.has(par)) break;
      seen.add(par);
      out.push(par);
      cur = par;
    }
    return out;
  };
}

/**
 * Recompute the inherited rows for one entity so they exactly match its
 * current direct memberships. Diff-based: only writes what changed.
 */
async function reconcile(collection: Junction, fk: Fk, entityId: number): Promise<void> {
  const rows = (await directus.request(
    readItems(collection as never, {
      filter: { _and: [{ status: { _neq: 'archived' } }, { [fk]: { _eq: entityId } }] },
      fields: ['id', 'project_id', 'inherited_from_project_id'],
      limit: -1
    } as never)
  )) as Array<{
    id: number;
    project_id: number | { id: number } | null;
    inherited_from_project_id: number | { id: number } | null;
  }>;

  const directProjectIds: number[] = [];
  const inheritedRows: Array<{ id: number; project: number; source: number | null }> = [];
  for (const r of rows) {
    const proj = idOf(r.project_id);
    if (proj == null) continue;
    if (idOf(r.inherited_from_project_id) == null) directProjectIds.push(proj);
    else inheritedRows.push({ id: r.id, project: proj, source: idOf(r.inherited_from_project_id) });
  }
  const directSet = new Set(directProjectIds);

  // Target inherited set: every ancestor of a direct membership (minus any
  // project the entity is *already* a direct member of), mapped to one
  // justifying descendant for the "via …" label.
  const ancestorIds = makeAncestorWalker();
  const target = new Map<number, number>();
  for (const d of directProjectIds) {
    for (const a of await ancestorIds(d)) {
      if (directSet.has(a)) continue;
      if (!target.has(a)) target.set(a, d);
    }
  }

  // Index existing inherited rows by project; drop accidental duplicates.
  const existingByProject = new Map<number, { id: number; source: number | null }>();
  for (const ir of inheritedRows) {
    if (existingByProject.has(ir.project)) {
      await directus.request(deleteItem(collection as never, ir.id));
      continue;
    }
    existingByProject.set(ir.project, { id: ir.id, source: ir.source });
  }

  // Create missing inherited rows; refresh a stale/invalid source pointer.
  for (const [ancestor, src] of target) {
    const ex = existingByProject.get(ancestor);
    if (!ex) {
      await directus.request(
        createItem(collection as never, {
          [fk]: entityId,
          project_id: ancestor,
          inherited_from_project_id: src,
          status: 'published'
        } as never)
      );
    } else if ((ex.source == null || !directSet.has(ex.source)) && ex.source !== src) {
      await directus.request(
        updateItem(collection as never, ex.id, { inherited_from_project_id: src } as never)
      );
    }
  }

  // Delete inherited rows no longer justified by any direct membership.
  for (const [proj, ex] of existingByProject) {
    if (!target.has(proj)) await directus.request(deleteItem(collection as never, ex.id));
  }
}

export async function reconcilePersonProjectInheritance(personId: number): Promise<void> {
  if (!personId) return;
  try {
    await reconcile('Project_people', 'person_id', personId);
  } catch (e) {
    // Never let inheritance upkeep break the primary mutation.
    console.error('[project-inheritance] person reconcile failed', personId, e);
  }
}

export async function reconcileOrgProjectInheritance(orgId: number): Promise<void> {
  if (!orgId) return;
  try {
    await reconcile('Project_organization', 'organization_id', orgId);
  } catch (e) {
    console.error('[project-inheritance] org reconcile failed', orgId, e);
  }
}

/**
 * Reconcile every entity that currently has at least one direct membership.
 * Idempotent — run once after the migration, and any time to heal drift
 * (e.g. after direct-in-Directus edits). Returns how many entities ran.
 */
export async function backfillProjectInheritance(): Promise<{ people: number; orgs: number }> {
  const peopleRows = (await directus.request(
    readItems('Project_people', {
      filter: { _and: [{ status: { _neq: 'archived' } }, { inherited_from_project_id: { _null: true } }] },
      fields: ['person_id'],
      limit: -1
    } as never)
  )) as Array<{ person_id: number | { id: number } | null }>;
  const personIds = [...new Set(peopleRows.map((r) => idOf(r.person_id)).filter((v): v is number => v != null))];
  for (const id of personIds) await reconcilePersonProjectInheritance(id);

  const orgRows = (await directus.request(
    readItems('Project_organization', {
      filter: { _and: [{ status: { _neq: 'archived' } }, { inherited_from_project_id: { _null: true } }] },
      fields: ['organization_id'],
      limit: -1
    } as never)
  )) as Array<{ organization_id: number | { id: number } | null }>;
  const orgIds = [...new Set(orgRows.map((r) => idOf(r.organization_id)).filter((v): v is number => v != null))];
  for (const id of orgIds) await reconcileOrgProjectInheritance(id);

  return { people: personIds.length, orgs: orgIds.length };
}
