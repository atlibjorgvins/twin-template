// Choose a focal point that keeps faces inside a cropped frame.
//
// A carousel cell shows the photo with `object-fit: cover`, so a window of
// the image is visible and the focal point decides which window. Centre is
// the default, and centre is wrong for the common case: a group shot where
// everyone stands in the upper third loses their heads to a square crop.
//
// Immich already knows where the faces are. It reports them as fractions of
// a downscaled preview whose ASPECT MATCHES the original (measured: 1440x2160
// against 4000x6000 EXIF), which is why the fractions transfer directly and
// why the original's pixel dimensions are not needed here.
//
// Pure — no $lib imports — so it can be unit tested with
// `node --test --experimental-strip-types`.

export type Box = { x1: number; y1: number; x2: number; y2: number };

/** The visible window of the image, as fractions, for a cover-fit crop. */
export function coverWindow(imageAspect: number, targetAspect: number): { w: number; h: number } {
  if (!(imageAspect > 0) || !(targetAspect > 0)) return { w: 1, h: 1 };
  // Target narrower than the image → full height, part of the width.
  if (targetAspect < imageAspect) return { w: targetAspect / imageAspect, h: 1 };
  // Target wider → full width, part of the height.
  return { w: 1, h: imageAspect / targetAspect };
}

/** Smallest box containing all of them. Returns null for an empty list. */
export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  return boxes.reduce(
    (a, b) => ({
      x1: Math.min(a.x1, b.x1),
      y1: Math.min(a.y1, b.y1),
      x2: Math.max(a.x2, b.x2),
      y2: Math.max(a.y2, b.y2)
    }),
    { x1: 1, y1: 1, x2: 0, y2: 0 }
  );
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export type FaceFocal = {
  fx: number;
  fy: number;
  /** false when there were no faces to work with — caller may prefer centre. */
  fromFaces: boolean;
  /** true when the faces cannot all fit in the window at this aspect. */
  clipped: boolean;
};

/**
 * Focal point (0..1) that fits the faces in a cover-fit crop.
 *
 * `headroom` pads the union before fitting, because a crop that grazes the
 * top of a forehead reads as a mistake even though the face is technically
 * inside. Expressed as a multiple of the union's height.
 */
export function faceFocal(
  boxes: Box[],
  imageAspect: number,
  targetAspect: number,
  headroom = 0.35
): FaceFocal {
  const u = unionBox(boxes);
  if (!u) return { fx: 0.5, fy: 0.5, fromFaces: false, clipped: false };

  const win = coverWindow(imageAspect, targetAspect);

  // Pad, weighted upward: hair and forehead sit above the detected box, and
  // chins matter less than crowns for a portrait reading as complete.
  const uh = Math.max(0, u.y2 - u.y1);
  const padTop = uh * headroom;
  const padBottom = uh * headroom * 0.4;
  const padX = Math.max(0, u.x2 - u.x1) * headroom * 0.4;
  const want = {
    x1: clamp(u.x1 - padX, 0, 1),
    y1: clamp(u.y1 - padTop, 0, 1),
    x2: clamp(u.x2 + padX, 0, 1),
    y2: clamp(u.y2 + padBottom, 0, 1)
  };

  // Centre of what we want to keep.
  const cx = (want.x1 + want.x2) / 2;
  const cy = (want.y1 + want.y2) / 2;

  // The focal point is the window's centre, so it can only travel within
  // [win/2, 1 - win/2] before the window leaves the image.
  const fx = clamp(cx, win.w / 2, 1 - win.w / 2);
  const fy = clamp(cy, win.h / 2, 1 - win.h / 2);

  const clipped = want.x2 - want.x1 > win.w + 1e-6 || want.y2 - want.y1 > win.h + 1e-6;
  return { fx, fy, fromFaces: true, clipped };
}
