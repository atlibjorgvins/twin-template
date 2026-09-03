// Photos of one person, and where their face sits in them.
//
// The problem this solves: everyone photographed at the same event ends up
// with the same group photo as their avatar, cropped to the middle — so a row
// of twelve people is twelve identical thumbnails of a room. The photo is
// right; the crop is wrong, and it is wrong differently for each person.
//
// Immich already knows where each face is. Its asset DTO carries, per
// recognised person, a bounding box in the DISPLAY orientation of the image —
// verified against live assets: an exif-landscape file with orientation 6
// reports a portrait box space, and orientation-1 files report a box space
// matching their exif. So normalising by each face's OWN imageWidth/imageHeight
// yields display-space percentages, which is exactly the space CSS
// object-position works in. The exif dimensions are irrelevant and must not be
// used — that is the trap here.

import {
  searchImmichAssets,
  getAssetFull,
  type ImmichAsset
} from '$lib/immich';
import {
  photoPersonsForPerson,
  listPhotoLinks,
  type PhotoLink,
  type PhotoLinkCollection
} from '$lib/directus';

export type PersonPhoto = {
  assetId: string;
  filename: string;
  takenAt: string | null;
  /** How this photo came to be associated with the person. */
  via: 'face' | 'tag';
};

/**
 * Candidate photos for a person's avatar, newest first.
 *
 * Two independent sources, because they answer different questions:
 *   face — Immich recognised them in it (usually many, including the group
 *          shots we are trying to crop properly)
 *   tag  — somebody linked the photo to them in twin on purpose (usually few,
 *          and usually the better pick)
 *
 * Deliberately does NOT fetch face boxes here. That needs one asset request
 * each, and the picker only ever needs the box for the one photo actually
 * chosen — see faceFocalFor().
 */
/** Which Immich face clusters belong to this twin person. */
export async function clusterIdsFor(personId: number): Promise<string[]> {
  try {
    const rows = await photoPersonsForPerson(personId);
    return rows.map((r) => r.id).filter(Boolean);
  } catch {
    return [];
  }
}

export type PersonPhotoResult = {
  photos: PersonPhoto[];
  /**
   * Why a source came back empty, if it failed rather than simply having
   * nothing. Swallowing these was a mistake: an empty picker then told the
   * user to go and tag photos when the real answer might be "the photo library
   * is unreachable", which is pointless work aimed at the wrong problem.
   */
  problems: string[];
};

/**
 * Candidate photos for a person's avatar, newest first.
 *
 * Two independent sources, because they answer different questions:
 *   tag  — somebody linked the photo to them in twin on purpose (usually few,
 *          and usually the better pick, so these sort first)
 *   face — Immich recognised them in it (usually many, including the group
 *          shots we are trying to crop properly)
 *
 * One source failing is survivable and reported; both failing is reported too,
 * so the caller can say "could not look" instead of "nothing there".
 *
 * Deliberately does NOT fetch face boxes here — that costs one request per
 * asset, and only the photo actually chosen needs one. See faceSpotFor().
 */
export async function listOwnerPhotos(
  owner: PhotoOwner,
  opts: { limit?: number } = {}
): Promise<PersonPhotoResult> {
  const limit = opts.limit ?? 60;
  const byId = new Map<string, PersonPhoto>();
  const problems: string[] = [];

  try {
    const links = (await listPhotoLinks(owner.collection, owner.id)) as PhotoLink[];
    for (const l of links) {
      if (!l.asset_id) continue;
      byId.set(l.asset_id, {
        assetId: l.asset_id,
        filename: '',
        takenAt: l.date_created ?? null,
        via: 'tag'
      });
    }
  } catch (e) {
    problems.push(`Tagged photos: ${msg(e)}`);
  }

  // Faces only exist for people. An organization has no face cluster, so its
  // picker is tags only — which is why this is a branch and not a silent empty
  // result.
  if (owner.collection !== 'Person') {
    return { photos: finish(byId, limit), problems };
  }

  try {
    const personIds = await clusterIdsFor(owner.id);
    // ONE CLUSTER PER QUERY, unioned.
    //
    // Immich's `personIds` is an AND — it returns assets containing ALL the
    // listed people. Two face clusters of the SAME person never co-occur in
    // one photo, so passing both asked for the empty set and got it: 5 assets
    // for cluster A, 5 for cluster B, 0 for [A, B]. Measured, because the
    // failure is silent — no error, just nothing, which reads as "this person
    // has no photos".
    for (const cluster of personIds) {
      const res = await searchImmichAssets({
        personIds: [cluster],
        size: limit,
        type: 'IMAGE'
      });
      for (const a of res.items) {
        const existing = byId.get(a.id);
        if (existing) {
          // Already tagged — keep that label, but take the filename.
          if (!existing.filename) existing.filename = a.originalFileName ?? '';
          continue;
        }
        byId.set(a.id, {
          assetId: a.id,
          filename: a.originalFileName ?? '',
          takenAt: a.localDateTime ?? a.fileCreatedAt ?? null,
          via: 'face'
        });
      }
    }
  } catch (e) {
    problems.push(`Face matches: ${msg(e)}`);
  }

  return { photos: finish(byId, limit), problems };
}

function finish(byId: Map<string, PersonPhoto>, limit: number): PersonPhoto[] {
  return [...byId.values()]
    .sort((a, b) => (b.takenAt ?? '').localeCompare(a.takenAt ?? ''))
    .slice(0, limit);
}

/** Anything a photo can be tagged to. Only 'Person' has faces. */
export type PhotoOwner = { collection: PhotoLinkCollection; id: number };

function msg(e: unknown): string {
  if (e instanceof Error) return e.message;
  // Directus SDK errors are plain objects with an errors[] array.
  const o = e as { errors?: Array<{ message?: string }> } | null;
  const first = o?.errors?.[0]?.message;
  return first ?? String(e);
}


/**
 * Where a face sits in an image, as fractions (0..1) of the DISPLAY-oriented
 * image — so the numbers survive whatever size the caller actually downloads.
 *
 * The BOX matters, not just the centre. object-position can only pan, and only
 * along the axis that overflows: a portrait group photo in a square avatar has
 * no horizontal freedom at all, so five people in one such photo all resolve to
 * `50%` across and end up with near-identical thumbnails. Measured on a real
 * KLAK group shot — which is exactly the complaint this feature answers. A face
 * needs a real crop, and a crop needs the box.
 */
export type FaceSpot = {
  /** Face centre. */
  fx: number;
  fy: number;
  /** Face bounds. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

/**
 * Where this person's face is in one asset, or null if Immich has no box for
 * them there — in which case the caller leaves the crop centred, because a
 * wrong crop is worse than a neutral one.
 *
 * Returns FRACTIONS of the display-oriented image, so they stay valid whatever
 * resolution the caller downloads.
 *
 * `clusterIds` is the set of Immich person ids mapped to this twin person: a
 * person can own more than one face cluster, and a group photo contains
 * several people, so matching on cluster is the only way to pick the right
 * face rather than the first one.
 */
export async function faceSpotFor(
  assetId: string,
  clusterIds: string[]
): Promise<FaceSpot | null> {
  if (clusterIds.length === 0) return null;
  let full;
  try {
    full = await getAssetFull(assetId);
  } catch {
    return null;
  }
  const wanted = new Set(clusterIds);
  const people = (full.people ?? []) as Array<{
    id?: string;
    faces?: Array<{
      boundingBoxX1: number;
      boundingBoxY1: number;
      boundingBoxX2: number;
      boundingBoxY2: number;
      imageWidth: number;
      imageHeight: number;
    }>;
  }>;

  for (const p of people) {
    if (!p.id || !wanted.has(p.id)) continue;
    const f = (p.faces ?? [])[0];
    if (!f?.imageWidth || !f?.imageHeight) continue;
    // Normalise by the FACE's own imageWidth/imageHeight. That space is the
    // display orientation; exifImageWidth/Height is the raw file and is
    // transposed for rotated images (verified: an orientation-6 asset reports
    // exif 5712x4284 but a 1440x1920 box space). Using exif here would put
    // every rotated photo's crop in the wrong place.
    const x1 = clamp01(f.boundingBoxX1 / f.imageWidth);
    const x2 = clamp01(f.boundingBoxX2 / f.imageWidth);
    const y1 = clamp01(f.boundingBoxY1 / f.imageHeight);
    const y2 = clamp01(f.boundingBoxY2 / f.imageHeight);
    return { fx: (x1 + x2) / 2, fy: (y1 + y2) / 2, x1, y1, x2, y2 };
  }
  return null;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export type { ImmichAsset };

/**
 * Cut a square portrait around a face.
 *
 * This is the part that actually solves the problem. Panning cannot separate
 * faces in a portrait group photo (see FaceSpot), so twin crops the pixels
 * instead: one shared group shot becomes a different real portrait per person.
 *
 * `padding` is how much of the surrounding scene to keep, as a multiple of the
 * face box. Immich's boxes are tight — roughly eyebrows to chin — so 1.0 would
 * be a disconcerting close-up of a face with no head. 2.6 lands at about
 * head-and-shoulders, which is what a portrait wants.
 *
 * The square is clamped to the image, and the clamp moves the centre rather
 * than shrinking the square: a face near an edge should still yield a
 * full-size crop, just an off-centre one.
 */
/**
 * The square this face will be cropped to, in image pixels.
 *
 * Shared by the crop and by the preview that shows you what you are about to
 * get. Two copies of this arithmetic would drift, and the failure mode is the
 * worst kind: a preview that confidently shows the wrong thing.
 */
export function faceCropRect(
  spot: FaceSpot,
  imgW: number,
  imgH: number,
  padding = 2.6
): { left: number; top: number; side: number } {
  const faceW = (spot.x2 - spot.x1) * imgW;
  const faceH = (spot.y2 - spot.y1) * imgH;
  // From the LONGER edge, so a tall narrow box (a profile) is not cropped
  // through the head.
  let side = Math.max(faceW, faceH) * padding;
  side = Math.min(side, Math.min(imgW, imgH));
  if (!Number.isFinite(side) || side < 16) side = Math.min(imgW, imgH);

  // Immich centres on the face; a portrait reads better with a little more
  // room below the chin than above the hair.
  const cy = spot.fy * imgH - side * 0.06;
  const cx = spot.fx * imgW;

  return {
    left: Math.round(Math.max(0, Math.min(imgW - side, cx - side / 2))),
    top: Math.round(Math.max(0, Math.min(imgH - side, cy - side / 2))),
    side: Math.round(side)
  };
}

export async function cropFaceSquare(
  file: File,
  spot: FaceSpot,
  opts: { padding?: number; maxEdge?: number; quality?: number } = {}
): Promise<File> {
  const padding = opts.padding ?? 2.6;
  const maxEdge = opts.maxEdge ?? 800;
  const quality = opts.quality ?? 0.9;

  const bitmap = await loadBitmap(file);
  const W = bitmap.width;
  const H = bitmap.height;

  const { left, top, side: s } = faceCropRect(spot, W, H, padding);

  const out = Math.min(maxEdge, s);
  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable — cannot crop the face.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, left, top, s, s, 0, 0, out, out);
  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
  );
  if (!blob) throw new Error('Could not encode the cropped portrait.');
  const base = file.name.replace(/\.[^.]+$/, '') || 'portrait';
  return new File([blob], `${base}-face.jpg`, { type: 'image/jpeg' });
}

/** createImageBitmap where available (it honours EXIF orientation via the
 *  option), falling back to an <img> decode for older Safari. */
async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    } catch {
      /* fall through */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // Revoked after decode; the bitmap data is already in memory.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
