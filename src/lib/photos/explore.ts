// Photo explore + per-photo tagging data layer. Kept in its own module
// (like events/data.ts) so it can add the `event` link type without
// piling onto the heavily-shared directus.ts. Mirrors the photo_link
// helpers there, generalized to four collections — organization,
// Project, Person and event — so a photo can be tagged to a happening
// and the navigator can browse photos by any of them.
//
// Photos never enter Directus; photo_link only stores Immich asset ids.
import { repo } from '$lib/data/repo';

export type ExploreCollection = 'organization' | 'Project' | 'Person' | 'event';

export type PhotoLinkRow = {
  id: number;
  asset_id: string;
  collection: ExploreCollection;
  item_id: number;
  date_created?: string | null;
};

export type NamedLink = PhotoLinkRow & { name: string };

/** An entity that has tagged photos — one row in the explore lists. */
export type TaggedEntity = {
  collection: ExploreCollection;
  item_id: number;
  name: string;
  count: number;
  sampleAssetId: string;
};

/** Display order for the entity-type sub-filters. */
export const EXPLORE_ORDER: ExploreCollection[] = ['Project', 'organization', 'Person', 'event'];

export const EXPLORE_META: Record<
  ExploreCollection,
  { label: string; plural: string; icon: 'building' | 'sparkles' | 'users' | 'flag'; href: (id: number) => string }
> = {
  Project: { label: 'Project', plural: 'Projects', icon: 'sparkles', href: (id) => `/projects/${id}` },
  organization: { label: 'Org', plural: 'Orgs', icon: 'building', href: (id) => `/orgs/${id}` },
  Person: { label: 'Person', plural: 'People', icon: 'users', href: (id) => `/people/${id}` },
  event: { label: 'Event', plural: 'Events', icon: 'flag', href: (id) => `/events/${id}` }
};

const NAME_FIELDS = (coll: ExploreCollection): string[] =>
  coll === 'Person' ? ['id', 'full_name', 'first_name', 'last_name'] : ['id', 'name'];

function resolveName(r: {
  id: number;
  name?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
}): string {
  return (
    r.name?.trim() ||
    r.full_name?.trim() ||
    [r.first_name, r.last_name].filter(Boolean).join(' ').trim() ||
    `#${r.id}`
  );
}

/** Bulk-resolve display names for a set of ids in one collection. */
async function namesFor(coll: ExploreCollection, ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (ids.length === 0) return out;
  const rows = await repo.list<Parameters<typeof resolveName>[0]>(coll, {
    where: { field: 'id', op: 'in', value: ids },
    fields: NAME_FIELDS(coll)
  });
  for (const r of rows) out.set(r.id, resolveName(r));
  return out;
}

async function allLinks(): Promise<PhotoLinkRow[]> {
  return repo.list<PhotoLinkRow>('photo_link', {
    fields: ['id', 'asset_id', 'collection', 'item_id']
  });
}

/** Every entity that has at least one tagged photo, grouped by collection
 *  and sorted by photo count (busiest first), with names resolved. */
export async function listTaggedEntities(): Promise<Record<ExploreCollection, TaggedEntity[]>> {
  const links = await allLinks();
  const groups: Record<string, { count: number; sample: string }> = {};
  const idsByColl: Record<string, Set<number>> = {};
  for (const l of links) {
    const key = `${l.collection}:${l.item_id}`;
    (groups[key] ??= { count: 0, sample: l.asset_id }).count++;
    (idsByColl[l.collection] ??= new Set()).add(l.item_id);
  }
  const colls = Object.keys(idsByColl) as ExploreCollection[];
  const nameMaps = new Map<ExploreCollection, Map<number, string>>();
  await Promise.all(
    colls.map(async (c) => nameMaps.set(c, await namesFor(c, [...idsByColl[c]])))
  );

  const out: Record<ExploreCollection, TaggedEntity[]> = {
    Project: [],
    organization: [],
    Person: [],
    event: []
  };
  for (const [key, g] of Object.entries(groups)) {
    const [coll, idStr] = key.split(':');
    const collection = coll as ExploreCollection;
    if (!out[collection]) continue;
    const item_id = Number(idStr);
    out[collection].push({
      collection,
      item_id,
      name: nameMaps.get(collection)?.get(item_id) ?? `#${item_id}`,
      count: g.count,
      sampleAssetId: g.sample
    });
  }
  for (const c of Object.keys(out) as ExploreCollection[]) out[c].sort((a, b) => b.count - a.count);
  return out;
}

/** Every photo_link row, one query. The folder browser aggregates whole
 *  project subtrees (child projects + their events) client-side from this. */
export async function listPhotoLinks(): Promise<PhotoLinkRow[]> {
  return allLinks();
}

/** Asset ids tagged to one entity (newest links first). */
export async function assetIdsForEntity(collection: ExploreCollection, itemId: number): Promise<string[]> {
  const rows = await repo.list<{ asset_id: string }>('photo_link', {
    where: {
      and: [
        { field: 'collection', op: 'eq', value: collection },
        { field: 'item_id', op: 'eq', value: itemId }
      ]
    },
    fields: ['asset_id'],
    sort: ['-date_created']
  });
  return rows.map((r) => r.asset_id);
}

// ── per-photo tagging (lightbox panel) ───────────────────────────────
/** Tags on one asset, with the linked record's display name resolved. */
export async function listLinksForAsset(assetId: string): Promise<NamedLink[]> {
  const links = await repo.list<PhotoLinkRow>('photo_link', {
    where: { field: 'asset_id', op: 'eq', value: assetId }
  });
  if (links.length === 0) return [];
  const idsByColl: Record<string, number[]> = {};
  for (const l of links) (idsByColl[l.collection] ??= []).push(l.item_id);
  const maps = new Map<ExploreCollection, Map<number, string>>();
  await Promise.all(
    (Object.keys(idsByColl) as ExploreCollection[]).map(async (c) =>
      maps.set(c, await namesFor(c, idsByColl[c]))
    )
  );
  return links.map((l) => ({ ...l, name: maps.get(l.collection)?.get(l.item_id) ?? `#${l.item_id}` }));
}

export async function createLink(
  assetId: string,
  collection: ExploreCollection,
  itemId: number
): Promise<PhotoLinkRow> {
  return repo.create<PhotoLinkRow>('photo_link', { asset_id: assetId, collection, item_id: itemId });
}

export async function removeLink(id: number): Promise<void> {
  await repo.remove('photo_link', id);
}

/** Tag many assets to one entity at once (batch tagging from the grid).
 *  Skips assets already linked to that entity, so re-tagging is safe and
 *  doesn't create duplicate photo_link rows. Returns how many were added. */
export async function tagAssetsToEntity(
  assetIds: string[],
  collection: ExploreCollection,
  itemId: number
): Promise<{ added: number; skipped: number }> {
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return { added: 0, skipped: 0 };
  const existing = await repo.list<{ asset_id: string }>('photo_link', {
    where: {
      and: [
        { field: 'collection', op: 'eq', value: collection },
        { field: 'item_id', op: 'eq', value: itemId },
        { field: 'asset_id', op: 'in', value: ids }
      ]
    },
    fields: ['asset_id']
  });
  const have = new Set(existing.map((r) => r.asset_id));
  const todo = ids.filter((id) => !have.has(id));
  if (todo.length > 0) {
    await repo.createMany('photo_link', todo.map((id) => ({ asset_id: id, collection, item_id: itemId })));
  }
  return { added: todo.length, skipped: ids.length - todo.length };
}

/** Resolve Immich face-cluster ids to mapped twin People (photo_person).
 *  Keyed by cluster id; unmapped clusters are simply absent. */
export async function facePeople(
  clusterIds: string[]
): Promise<Record<string, { personId: number | null; name: string | null }>> {
  const out: Record<string, { personId: number | null; name: string | null }> = {};
  if (clusterIds.length === 0) return out;
  const rows = await repo.list<{
    id: string;
    person_id: { id: number; full_name?: string; first_name?: string; last_name?: string } | null;
  }>('photo_person', {
    where: { field: 'id', op: 'in', value: clusterIds },
    fields: ['id', { person_id: ['id', 'full_name', 'first_name', 'last_name'] }]
  });
  for (const r of rows) {
    const p = r.person_id;
    const name = p
      ? p.full_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || null
      : null;
    out[r.id] = { personId: p?.id ?? null, name };
  }
  return out;
}

/** Immich face-cluster ids mapped to a twin Person (reverse of
 *  facePeople) — so a photo search can pull every photo that person
 *  appears in via Immich's personIds search. */
export async function clustersForPerson(personId: number): Promise<string[]> {
  const rows = await repo.list<{ id: string }>('photo_person', {
    where: { field: 'person_id', op: 'eq', value: personId },
    fields: ['id']
  });
  return rows.map((r) => r.id);
}

/** Name search over happenings, for the tag panel's Event picker. */
export async function searchEvents(q: string, limit = 8): Promise<{ id: number; name: string }[]> {
  return repo.list<{ id: number; name: string }>('event', {
    where: { field: 'name', op: 'icontains', value: q },
    fields: ['id', 'name'],
    sort: ['-date_created'],
    limit
  });
}
