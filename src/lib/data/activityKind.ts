// ActivityKind — the user-managed catalogue of interaction kinds
//
// Small, self-contained catalogue.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module, so every existing
// `from '$lib/directus'` import keeps working.

import { repo } from '$lib/data/repo';
// Type-only: erased at compile time, so no runtime cycle back into
// the module this was split out of.
import type { Activity, ActivityKind } from '$lib/data/types';

// ─── ActivityKind — dynamic, user-managed catalogue ────────────────────

/** In-memory cache so the dropdown / chip-row don't refetch on every mount. */
let activityKindCache: ActivityKind[] | null = null;
let activityKindCacheAt = 0;
const ACTIVITY_KIND_TTL_MS = 60_000;

/** List kinds (defaults to published-only). Pass `{ includeArchived: true }`
 * for the admin surface, which needs to show and restore archived rows. */
export async function listActivityKinds(
  arg: boolean | { includeArchived?: boolean; force?: boolean } = false
): Promise<ActivityKind[]> {
  // Back-compat: the first overload was `listActivityKinds(force?: boolean)`.
  const opts = typeof arg === 'boolean' ? { force: arg, includeArchived: false } : arg;
  const includeArchived = !!opts.includeArchived;
  const force = !!opts.force || includeArchived; // archived view is uncached
  if (!force && activityKindCache && Date.now() - activityKindCacheAt < ACTIVITY_KIND_TTL_MS) {
    return activityKindCache;
  }
  const rows = await repo.list<ActivityKind>('ActivityKind', {
    where: includeArchived ? undefined : { field: 'status', op: 'neq', value: 'archived' },
    fields: ['id', 'key', 'label', 'emoji', 'icon', 'color', 'default_significance', 'scope', 'sort', 'status'],
    sort: ['sort', 'label']
  });
  if (!includeArchived) {
    activityKindCache = rows;
    activityKindCacheAt = Date.now();
  }
  return rows;
}

/** Resolve an ActivityKind by `key`; useful when migrating from a legacy string. */
export async function activityKindByKey(key: string): Promise<ActivityKind | null> {
  const all = await listActivityKinds();
  return all.find((k) => k.key === key) ?? null;
}

/** Convenience: pull the hydrated kind off an Activity, regardless of whether it's expanded. */
export function activityKindOf(a: Activity): ActivityKind | null {
  if (a.kind_id && typeof a.kind_id === 'object') return a.kind_id as ActivityKind;
  return null;
}

export async function createActivityKind(
  patch: Partial<ActivityKind> & { key: string; label: string }
): Promise<ActivityKind> {
  const created = await repo.create<ActivityKind>('ActivityKind', { status: 'published', ...patch } as Record<string, unknown>);
  activityKindCache = null; // invalidate
  return created;
}

export async function updateActivityKind(id: number, patch: Partial<ActivityKind>): Promise<ActivityKind> {
  const updated = await repo.update<ActivityKind>('ActivityKind', id, patch as Record<string, unknown>);
  activityKindCache = null;
  return updated;
}
