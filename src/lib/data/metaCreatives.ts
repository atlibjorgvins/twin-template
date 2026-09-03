// Meta ad creatives → previews
//
// Turns ad creatives into renderable previews. Unblocked once meta.ts moved.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import { metaGraph, metaQuery } from '$lib/data/meta';

// ── Ad creatives → previews (F1) ─────────────────────────────────────
// Pull an ad's creative image from Meta, import it into Directus, and
// keep it as a saved preview (rendered into formats via asset transforms
// in the UI). Reuses generated_image (item_collection 'meta_ad').

export type MetaAdCreative = { id: string; name: string; imageUrl: string | null; isThumb: boolean };

/** A campaign's ads with the best available creative image URL
 *  (read-only). Prefers the full-res `image_url`, then the post image,
 *  and only falls back to the small `thumbnail_url` (video ads often
 *  expose nothing better). */
export async function fetchCampaignAds(metaCampaignId: string): Promise<MetaAdCreative[]> {
  const resp = await metaGraph<{
    data?: {
      id: string;
      name?: string;
      creative?: { image_url?: string; thumbnail_url?: string; object_story_spec?: { link_data?: { picture?: string } } };
    }[];
  }>(
    'GET',
    metaQuery(`${metaCampaignId}/ads`, {
      fields: 'name,creative{image_url,thumbnail_url,object_story_spec{link_data{picture}}}',
      limit: 200
    })
  );
  return (resp.data ?? []).map((a) => {
    const cr = a.creative ?? {};
    const full = cr.image_url ?? cr.object_story_spec?.link_data?.picture ?? null;
    return {
      id: a.id,
      name: a.name ?? 'Ad',
      imageUrl: full ?? cr.thumbnail_url ?? null,
      isThumb: !full && !!cr.thumbnail_url // only a small thumbnail (often video ads)
    };
  });
}

/** Import an image into Directus by URL (server-side fetch — avoids the
 *  CORS wall on Meta's CDN), then verify it actually landed as an image
 *  (some Meta creative URLs are video/redirect assets that import as
 *  HTML). Deletes and returns null if it isn't a real image. */
export async function importImageFromUrl(url: string, title: string): Promise<string | null> {
  const res = await repo.importFileFromUrl<{
    id: string;
    type?: string | null;
    width?: number | null;
  }>(url, { title });
  const isImage = String(res.type ?? '').startsWith('image/') && (res.width ?? 1) > 0;
  if (!isImage) {
    await repo.removeFile(res.id).catch(() => {});
    return null;
  }
  return res.id;
}

export type AdPreview = {
  id: number;
  item_id?: string | null;
  item_label?: string | null;
  file_id?: string | null;
  variant?: string | null;
  date_created?: string | null;
};

/** Saved ad creatives (newest first). */
export async function listAdPreviews(): Promise<AdPreview[]> {
  return repo.list<AdPreview>('generated_image', {
    where: { field: 'item_collection', op: 'eq', value: 'meta_ad' },
    fields: ['id', 'item_id', 'item_label', 'file_id', 'variant', 'date_created'],
    sort: ['-date_created'],
    limit: -1
  });
}

export async function createAdPreview(p: {
  adMetaId: string;
  label: string;
  fileId: string;
  variant?: string;
}): Promise<AdPreview> {
  return repo.create<AdPreview>('generated_image', {
    item_collection: 'meta_ad',
    item_id: p.adMetaId,
    item_label: p.label,
    file_id: p.fileId,
    variant: p.variant ?? 'Creative'
  });
}

export async function deleteAdPreview(id: number): Promise<void> {
  await repo.remove('generated_image', id);
}
