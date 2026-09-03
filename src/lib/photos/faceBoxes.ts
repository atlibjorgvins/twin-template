// Where the faces are in a photo, for drawing on top of it.
//
// Immich's asset DTO carries a bounding box per recognised face. Two things
// about that data decided this module's shape:
//
//  1. The boxes are in the image's DISPLAY orientation, not the raw file's.
//     An orientation-6 asset reports exif 5712x4284 but a 1440x1920 box
//     space. Normalising by each face's OWN imageWidth/imageHeight gives
//     fractions that line up with what the browser renders; using the exif
//     dimensions would put every rotated photo's boxes in the wrong place.
//     Verified against live orientation-1 and orientation-6 assets.
//
//  2. One asset request serves both the info panel's face LIST and the
//     overlay's face BOXES. The lightbox opens both at once, so without a
//     cache every photo you open costs two identical requests over the
//     tailnet. The cache is per-session and unbounded on purpose — it holds
//     a few hundred bytes per photo you actually looked at.

import { getAssetFull } from '$lib/immich';

/** One face, as fractions (0..1) of the display-oriented image. */
export type FaceBox = {
  /** Immich face id. */
  id: string;
  /** Immich person (cluster) id — what twin's photo_person maps. */
  clusterId: string;
  /** Immich's own name for the cluster, if it has one. */
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

const cache = new Map<string, FaceBox[]>();

/** Drop one asset from the cache — call after renaming or reassigning a face
 *  so the overlay picks up the new name. */
export function forgetFaceBoxes(assetId: string): void {
  cache.delete(assetId);
}

/**
 * Face boxes for one asset. Returns [] when Immich has none, and also when it
 * cannot be reached — an overlay is decoration, and a failed fetch must not
 * take the lightbox down with it.
 */
export async function listFaceBoxes(assetId: string): Promise<FaceBox[]> {
  const hit = cache.get(assetId);
  if (hit) return hit;

  let full;
  try {
    full = await getAssetFull(assetId);
  } catch {
    return [];
  }

  const people = (full.people ?? []) as Array<{
    id?: string;
    name?: string;
    isHidden?: boolean;
    faces?: Array<{
      id?: string;
      boundingBoxX1: number;
      boundingBoxY1: number;
      boundingBoxX2: number;
      boundingBoxY2: number;
      imageWidth: number;
      imageHeight: number;
    }>;
  }>;

  const out: FaceBox[] = [];
  for (const p of people) {
    // Hidden clusters are ones you told Immich to ignore; drawing them would
    // put boxes back on faces you deliberately dismissed.
    if (!p.id || p.isHidden) continue;
    for (const f of p.faces ?? []) {
      if (!f.imageWidth || !f.imageHeight) continue;
      out.push({
        id: f.id ?? `${p.id}-${out.length}`,
        clusterId: p.id,
        name: p.name ?? '',
        x1: clamp01(f.boundingBoxX1 / f.imageWidth),
        y1: clamp01(f.boundingBoxY1 / f.imageHeight),
        x2: clamp01(f.boundingBoxX2 / f.imageWidth),
        y2: clamp01(f.boundingBoxY2 / f.imageHeight)
      });
    }
  }
  cache.set(assetId, out);
  return out;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
