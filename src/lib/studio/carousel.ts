// Carousel / "summary post" support for the Image Studio. A carousel
// template is a sequence of slides, each a fixed COLLAGE layout (a set
// of fractional photo cells). An event's gallery fills the cells; each
// slide renders to one PNG via the existing layer renderer, producing a
// real Instagram-style carousel.
import type { CarouselSlide, CarouselOverlay, StudioLayer } from './data';
import { listEventPhotos, importEventTaggedPhotos } from '$lib/events/data';

// ── Collage layouts ─────────────────────────────────────────────────
// Cells are fractional (0–1 of the canvas), ordered top-left → bottom.
// A small gap is inset per cell at build time, so layouts butt edge to
// edge here.
export type Cell = { x: number; y: number; w: number; h: number };
export type CollageLayout = { key: string; label: string; cells: Cell[] };

const third = 1 / 3;
export const COLLAGE_LAYOUTS: CollageLayout[] = [
  { key: 'single', label: 'Single', cells: [{ x: 0, y: 0, w: 1, h: 1 }] },
  {
    key: 'pair-h', label: 'Pair (side by side)',
    cells: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }]
  },
  {
    key: 'pair-v', label: 'Pair (stacked)',
    cells: [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }]
  },
  {
    key: 'hero-2', label: 'Hero + 2',
    cells: [
      { x: 0, y: 0, w: 1, h: 0.62 },
      { x: 0, y: 0.62, w: 0.5, h: 0.38 },
      { x: 0.5, y: 0.62, w: 0.5, h: 0.38 }
    ]
  },
  {
    key: 'feature-3', label: 'Feature + 2',
    cells: [
      { x: 0, y: 0, w: 0.6, h: 1 },
      { x: 0.6, y: 0, w: 0.4, h: 0.5 },
      { x: 0.6, y: 0.5, w: 0.4, h: 0.5 }
    ]
  },
  {
    key: 'mosaic-4', label: 'Mosaic (2×2)',
    cells: [
      { x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
    ]
  },
  {
    key: 'hero-3', label: 'Hero + 3',
    cells: [
      { x: 0, y: 0, w: 0.62, h: 1 },
      { x: 0.62, y: 0, w: 0.38, h: third },
      { x: 0.62, y: third, w: 0.38, h: third },
      { x: 0.62, y: 2 * third, w: 0.38, h: third }
    ]
  },
  {
    key: 'grid-6', label: 'Grid (2×3)',
    cells: [
      { x: 0, y: 0, w: 0.5, h: third }, { x: 0.5, y: 0, w: 0.5, h: third },
      { x: 0, y: third, w: 0.5, h: third }, { x: 0.5, y: third, w: 0.5, h: third },
      { x: 0, y: 2 * third, w: 0.5, h: third }, { x: 0.5, y: 2 * third, w: 0.5, h: third }
    ]
  }
];

const BY_KEY = new Map(COLLAGE_LAYOUTS.map((l) => [l.key, l]));

export function layoutCells(key: string): Cell[] {
  return (BY_KEY.get(key) ?? COLLAGE_LAYOUTS[0]).cells;
}
export function layoutLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key;
}

/** Total placements across all slides. */
export function placementCount(slides: CarouselSlide[]): number {
  return slides.reduce((n, s) => n + layoutCells(s.layout).length, 0);
}

/** Global placement index where a slide's cells begin. */
export function slideOffset(slides: CarouselSlide[], slideIdx: number): number {
  let n = 0;
  for (let i = 0; i < slideIdx; i++) n += layoutCells(slides[i].layout).length;
  return n;
}

/** How many placements hold a photo. */
export function takenCount(assignments: (string | null)[] | null | undefined): number {
  return (assignments ?? []).filter(Boolean).length;
}

// ── Slide → layers ──────────────────────────────────────────────────
// Build the renderer's StudioLayer[] for one slide: a cover-fit image
// layer per cell (inset by a gap), plus an optional title text layer.

const GAP = 0.012; // fraction of the canvas, inset on every cell edge

export function buildSlideLayers(
  slide: CarouselSlide,
  cellFiles: (string | null)[]
): StudioLayer[] {
  const cells = layoutCells(slide.layout);
  const layers: StudioLayer[] = cells.map((c, i) => ({
    id: `cell${i}`,
    type: 'image',
    file: cellFiles[i] ?? null,
    fit: 'cover',
    x: c.x + GAP,
    y: c.y + GAP,
    w: Math.max(0, c.w - 2 * GAP),
    h: Math.max(0, c.h - 2 * GAP),
    opacity: 1,
    visible: true
  }));
  const title = (slide.title ?? '').trim();
  if (title) {
    // A bottom scrim + caption so the slide title reads over photos.
    layers.push({
      id: 'title-scrim', type: 'gradient',
      x: 0, y: 0.7, w: 1, h: 0.3,
      color: '#000000', from: 0, to: 0.7, direction: 'down',
      opacity: 1, visible: true
    });
    layers.push({
      id: 'title', type: 'text',
      template: title, font: 'Space Grotesk', weight: 700, size: 56,
      autoFit: true, color: '#ffffff', align: 'center', lineHeight: 1.15,
      x: 0.08, y: 0.82, w: 0.84, h: 0.14,
      opacity: 1, visible: true
    });
  }
  // Per-slide overlay elements (logo/image, text, partner logos, …)
  // drawn on top of the photo collage.
  for (const l of slide.layers ?? []) layers.push(l);
  return layers;
}

// ── Event photo pool ────────────────────────────────────────────────

export type PoolPhoto = {
  fileId: string;
  caption?: string | null;
  /** Immich uuid this file was materialized from. Present on every gallery
   *  row today; the gateway to the asset's face boxes and star rating. */
  assetId?: string | null;
};

/** The event's gallery photos as a fill pool (gallery order). Photos
 *  tagged to the event in the photo navigator (Immich) are materialized
 *  into the gallery first, so they're available here without anyone
 *  having to open the event page. Idempotent + cheap once done. */
export async function loadEventPool(eventId: number): Promise<PoolPhoto[]> {
  await importEventTaggedPhotos(eventId).catch(() => {});
  const photos = await listEventPhotos(eventId);
  return photos
    .filter((p) => p.file_id)
    .map((p) => ({
      fileId: p.file_id as string,
      caption: p.caption ?? null,
      assetId: p.source_asset_id ?? null
    }));
}

/** A fresh slide on a layout. */
export function newSlide(layout = 'mosaic-4'): CarouselSlide {
  return { layout, title: '' };
}
