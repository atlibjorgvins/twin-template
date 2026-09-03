// Photo navigator — photo_link CRUD
//
// The Immich photo↔record links. Photos never enter Directus; only the
// mapping does.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module, so every existing
// `from '$lib/directus'` import keeps working.

import { repo } from '$lib/data/repo';
// Type-only: erased at compile time, so no runtime cycle back into
// the module this was split out of.
import type { PhotoLink, PhotoLinkCollection } from '$lib/data/types';

// ── Photo navigator: photo_link CRUD ─────────────────────────────────

/** All asset tags for one record — feeds the org/project Photos cards. */
export async function listPhotoLinks(
  collection: PhotoLinkCollection,
  itemId: number
): Promise<PhotoLink[]> {
  return repo.list<PhotoLink>('photo_link', {
    where: {
      and: [
        { field: 'collection', op: 'eq', value: collection },
        { field: 'item_id', op: 'eq', value: itemId }
      ]
    },
    sort: ['-date_created']
  });
}

/** Tags on one asset, with the linked record's display name resolved —
 *  feeds the lightbox tag panel. */
export async function listPhotoLinksForAsset(
  assetId: string
): Promise<(PhotoLink & { name: string })[]> {
  const links = await repo.list<PhotoLink>('photo_link', {
    where: { field: 'asset_id', op: 'eq', value: assetId }
  });
  if (links.length === 0) return [];
  const byColl: Record<string, number[]> = {};
  for (const l of links) (byColl[l.collection] ??= []).push(l.item_id);
  const names = new Map<string, string>();
  await Promise.all(
    Object.entries(byColl).map(async ([coll, ids]) => {
      // Directus rejects unknown fields, so pick name fields per collection.
      const fields = coll === 'Person' ? ['id', 'full_name', 'first_name', 'last_name'] : ['id', 'name'];
      const rows = await repo.list<{ id: number; name?: string; full_name?: string; first_name?: string; last_name?: string }>(
        coll,
        { where: { field: 'id', op: 'in', value: ids }, fields }
      );
      for (const r of rows) {
        const nm =
          r.name?.trim() ||
          r.full_name?.trim() ||
          [r.first_name, r.last_name].filter(Boolean).join(' ').trim() ||
          `#${r.id}`;
        names.set(`${coll}:${r.id}`, nm);
      }
    })
  );
  return links.map((l) => ({ ...l, name: names.get(`${l.collection}:${l.item_id}`) ?? `#${l.item_id}` }));
}

export async function createPhotoLink(
  assetId: string,
  collection: PhotoLinkCollection,
  itemId: number
): Promise<PhotoLink> {
  return repo.create<PhotoLink>('photo_link', { asset_id: assetId, collection, item_id: itemId } as Record<string, unknown>);
}

export async function deletePhotoLink(id: number): Promise<void> {
  await repo.remove('photo_link', id);
}
