// Per-photo metadata the carousel builder needs from Immich: where the faces
// are, how big the image is, and what you rated it.
//
// One getAssetFull() per asset covers all three, so this exists mainly to
// batch and cache — a 120-photo event would otherwise refetch the same asset
// each time a derived value re-runs.
import { getAssetFull } from '$lib/immich';
import type { Box } from '$lib/studio/faceCrop';

export type PoolMeta = {
  /** Face boxes as 0..1 fractions of the display-oriented image. */
  boxes: Box[];
  /** width / height. 0 when unknown — callers must treat that as "no idea". */
  aspect: number;
  /** 1–5, or null when unrated. 38% of the library is unrated. */
  rating: number | null;
};

const cache = new Map<string, PoolMeta>();
const inflight = new Map<string, Promise<PoolMeta>>();

const EMPTY: PoolMeta = { boxes: [], aspect: 0, rating: null };

/** Cached metadata for one asset. Never throws — a photo with no metadata is
 *  usable, it just gets a centre crop and no rating. */
export async function assetMeta(assetId: string): Promise<PoolMeta> {
  const hit = cache.get(assetId);
  if (hit) return hit;
  const running = inflight.get(assetId);
  if (running) return running;

  const p = (async () => {
    try {
      const full = await getAssetFull(assetId);
      const boxes: Box[] = [];
      let refW = 0;
      let refH = 0;
      for (const person of full.people ?? []) {
        // Hidden clusters are faces you told Immich to ignore; cropping to
        // them would resurrect a decision you already made.
        if ((person as { isHidden?: boolean }).isHidden) continue;
        for (const f of (person as { faces?: Array<Record<string, number>> }).faces ?? []) {
          const w = f.imageWidth;
          const h = f.imageHeight;
          if (!w || !h) continue;
          // Immich detects on a downscaled preview whose aspect matches the
          // original, so these fractions transfer — but they must be divided
          // by the FACE record's dimensions, not the EXIF ones.
          refW = w;
          refH = h;
          boxes.push({
            x1: f.boundingBoxX1 / w,
            y1: f.boundingBoxY1 / h,
            x2: f.boundingBoxX2 / w,
            y2: f.boundingBoxY2 / h
          });
        }
      }

      const ex = full.exifInfo ?? null;
      const exW = ex?.exifImageWidth ?? full.width ?? 0;
      const exH = ex?.exifImageHeight ?? full.height ?? 0;
      // Prefer the face reference dimensions when present: they are already
      // display-oriented, whereas EXIF width/height can be pre-rotation.
      const aspect = refW && refH ? refW / refH : exW && exH ? exW / exH : 0;

      const rating =
        typeof (full as { rating?: number }).rating === 'number'
          ? (full as { rating?: number }).rating!
          : typeof (ex as { rating?: number } | null)?.rating === 'number'
            ? (ex as { rating?: number }).rating!
            : null;

      const meta: PoolMeta = { boxes, aspect, rating: rating && rating > 0 ? rating : null };
      cache.set(assetId, meta);
      return meta;
    } catch {
      cache.set(assetId, EMPTY);
      return EMPTY;
    } finally {
      inflight.delete(assetId);
    }
  })();
  inflight.set(assetId, p);
  return p;
}

/** Warm the cache for a whole pool, a few at a time so a 120-photo event
 *  doesn't open 120 sockets at once. Resolves when every one is known. */
export async function warmPoolMeta(assetIds: string[], concurrency = 6): Promise<void> {
  const todo = [...new Set(assetIds.filter(Boolean))].filter((id) => !cache.has(id));
  for (let i = 0; i < todo.length; i += concurrency) {
    await Promise.all(todo.slice(i, i + concurrency).map((id) => assetMeta(id)));
  }
}

/** Synchronous read for render paths — null when not yet warmed. */
export function peekMeta(assetId: string): PoolMeta | null {
  return cache.get(assetId) ?? null;
}
