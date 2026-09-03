// Image Studio renderer — composites a template's layers onto a Canvas
// 2D context at full output resolution. The SAME code path draws the
// live editor preview and the exported file, so what you see is what
// gets generated.
import { assetUrl, renderCampaignTemplate, type CampaignCandidate } from '$lib/directus';
import {
  getFileFocal,
  projectColorSlot,
  type FocalPoint,
  type StudioLayer,
  type TextLayer
} from './data';

// ── Image cache ─────────────────────────────────────────────────────
// Directus is a different origin than the app shell, so images must be
// fetched with CORS enabled or the canvas taints and toBlob() throws.

const imageCache = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => {
        imageCache.delete(url); // allow retry after transient failures
        reject(new Error(`Image failed to load: ${url}`));
      };
      img.src = url;
    });
    imageCache.set(url, p);
  }
  return p;
}

/** Asset URL for rendering — full size capped at 2048px so iOS Safari
 *  canvas memory limits stay out of reach. */
export function renderAssetUrl(fileId: string): string {
  return assetUrl(fileId, { width: 2048, height: 2048, fit: 'inside', withoutEnlargement: 'true' });
}

// ── Drawing helpers ─────────────────────────────────────────────────

/** Hex (#rgb or #rrggbb) → rgba() with the given alpha. Non-hex input
 *  is returned untouched so hand-written rgba() fills keep working. */
function withAlpha(color: string, alpha: number): string {
  const m = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return color;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const n = parseInt(hex, 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function roundedPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

function drawImageFitted(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  fit: 'cover' | 'contain',
  radius: number,
  focal?: FocalPoint | null
) {
  if (radius > 0 || fit === 'cover') {
    ctx.save();
    roundedPath(ctx, x, y, w, h, radius);
    ctx.clip();
  }
  const scale =
    fit === 'cover'
      ? Math.max(w / img.naturalWidth, h / img.naturalHeight)
      : Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  let ox = x + (w - dw) / 2;
  let oy = y + (h - dh) / 2;
  if (fit === 'cover' && focal) {
    // Put the marked centre point in the middle of the slot, clamped so
    // the image still covers the whole box.
    ox = Math.min(Math.max(x + w / 2 - focal.fx * dw, x + w - dw), x);
    oy = Math.min(Math.max(y + h / 2 - focal.fy * dh, y + h - dh), y);
  }
  ctx.drawImage(img, ox, oy, dw, dh);
  if (radius > 0 || fit === 'cover') ctx.restore();
}

/** Greedy word-wrap at a given font size. Falls back to per-character
 *  splitting only when a single word is wider than the box. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const probe = line ? `${line} ${word}` : word;
      if (ctx.measureText(probe).width <= maxWidth || !line) line = probe;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function fontString(layer: TextLayer, size: number): string {
  return `${layer.weight} ${size}px "${layer.font}", sans-serif`;
}

function drawText(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fillColor: string
) {
  if (!text.trim()) return;
  let size = layer.size;
  ctx.font = fontString(layer, size);
  let lines = wrapLines(ctx, text, w);
  if (layer.autoFit) {
    // Shrink until the block fits the box (height AND width).
    while (size > 10) {
      ctx.font = fontString(layer, size);
      lines = wrapLines(ctx, text, w);
      const blockH = lines.length * size * layer.lineHeight;
      const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
      if (blockH <= h && widest <= w) break;
      size = Math.floor(size * 0.92);
    }
  }
  ctx.font = fontString(layer, size);
  ctx.fillStyle = fillColor;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = layer.align;
  const lineH = size * layer.lineHeight;
  const blockH = lines.length * lineH;
  // Vertically centred block; first baseline sits ~0.8em into the line.
  let baseline = y + Math.max(0, (h - blockH) / 2) + size * 0.8;
  const anchorX = layer.align === 'left' ? x : layer.align === 'right' ? x + w : x + w / 2;
  for (const line of lines) {
    ctx.fillText(line, anchorX, baseline);
    baseline += lineH;
  }
}

// ── The renderer ────────────────────────────────────────────────────

export type RenderContext = {
  /** Record the dynamic layers resolve against. */
  candidate: CampaignCandidate | null;
  /** {project} token value. */
  projectName?: string | null;
  /** Resolved file id for the `base` photo slot (per-record policy is
   *  applied by the caller — record image vs team photo). */
  baseImageId?: string | null;
  /** The template project's brand palette — slot key → color. Fills
   *  {project} / {project.<slot>} color tokens. */
  projectColors?: Record<string, string | null> | null;
  /** role_in_project key → org logo file ids, for partner-logo layers. */
  roleLogos?: Record<string, string[]> | null;
};

/** A layer color slot may hold a project brand token. */
function resolveColor(color: string, rc: RenderContext): string {
  const slot = projectColorSlot(color);
  if (!slot) return color;
  return rc.projectColors?.[slot] ?? '#888888';
}

export function resolveText(template: string, rc: RenderContext): string {
  if (!rc.candidate) return template;
  return renderCampaignTemplate(template, rc.candidate, { projectName: rc.projectName });
}

/** Draw the full template onto `canvas` at width×height. Images are
 *  awaited (and cached) before drawing; missing images are skipped so
 *  a half-configured template still previews. */
export async function renderTemplate(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  opts: {
    width: number;
    height: number;
    background?: string | null;
    layers: StudioLayer[];
    rc: RenderContext;
  }
): Promise<void> {
  const { width, height, layers, rc } = opts;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Canvas 2D unavailable');

  // Fonts must be in before any measureText — first paint otherwise
  // falls back to system fonts and the export would differ.
  if (typeof document !== 'undefined') await document.fonts.ready;

  // Preload every image this render needs (and its optional focal
  // point), in parallel. Logo strips load by file id.
  const wanted = new Map<string, string>(); // layer id → file id
  const wantedLogos = new Set<string>(); // file ids
  for (const l of layers) {
    if (!l.visible) continue;
    if (l.type === 'base' && rc.baseImageId) wanted.set(l.id, rc.baseImageId);
    if (l.type === 'image' && l.file) wanted.set(l.id, l.file);
    if (l.type === 'logos') {
      for (const id of (rc.roleLogos?.[l.role] ?? []).slice(0, l.max)) wantedLogos.add(id);
    }
  }
  const loaded = new Map<string, { img: HTMLImageElement; focal: FocalPoint | null }>();
  const loadedLogos = new Map<string, HTMLImageElement>();
  await Promise.all([
    ...[...wanted].map(([id, fileId]) =>
      Promise.all([loadImage(renderAssetUrl(fileId)), getFileFocal(fileId)]).then(
        ([img, focal]) => loaded.set(id, { img, focal }),
        () => {} // skip broken images, keep rendering
      )
    ),
    ...[...wantedLogos].map((fileId) =>
      loadImage(renderAssetUrl(fileId)).then(
        (img) => loadedLogos.set(fileId, img),
        () => {}
      )
    )
  ]);

  ctx.clearRect(0, 0, width, height);
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, width, height);
  }

  for (const l of layers) {
    if (!l.visible || l.opacity <= 0) continue;
    let x = l.x * width;
    let y = l.y * height;
    const w = l.w * width;
    const h = l.h * height;
    ctx.globalAlpha = l.opacity;
    // Rotation spins the layer around its centre: shift the origin
    // there, rotate, then draw in centre-local coordinates.
    const rotated = !!l.rotation;
    if (rotated) {
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(((l.rotation ?? 0) * Math.PI) / 180);
      x = -w / 2;
      y = -h / 2;
    }
    if (l.type === 'rect') {
      ctx.fillStyle = resolveColor(l.fill, rc);
      roundedPath(ctx, x, y, w, h, l.radius);
      ctx.fill();
    } else if (l.type === 'logos') {
      // Partner strip: each linked org's logo contain-fit in an equal
      // cell across the box. Missing project/links → faint placeholder
      // so the slot stays visible while designing.
      const imgs = (rc.roleLogos?.[l.role] ?? [])
        .slice(0, l.max)
        .map((id) => loadedLogos.get(id))
        .filter((i): i is HTMLImageElement => !!i);
      if (imgs.length === 0) {
        ctx.fillStyle = 'rgba(127,127,127,0.18)';
        roundedPath(ctx, x, y, w, h, 0);
        ctx.fill();
      } else {
        const gap = w * 0.04;
        const cellW = (w - gap * (imgs.length - 1)) / imgs.length;
        imgs.forEach((img, i) => {
          drawImageFitted(ctx, img, x + i * (cellW + gap), y, cellW, h, 'contain', 0);
        });
      }
    } else if (l.type === 'gradient') {
      // Linear fade of one color between two alphas across the box —
      // the photo scrim that makes text pop.
      const [x0, y0, x1, y1] =
        l.direction === 'up' ? [x, y + h, x, y]
        : l.direction === 'left' ? [x + w, y, x, y]
        : l.direction === 'right' ? [x, y, x + w, y]
        : [x, y, x, y + h]; // 'down'
      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      const gcolor = resolveColor(l.color, rc);
      grad.addColorStop(0, withAlpha(gcolor, l.from));
      grad.addColorStop(1, withAlpha(gcolor, l.to));
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
    } else if (l.type === 'base' || l.type === 'image') {
      const entry = loaded.get(l.id);
      if (entry) {
        drawImageFitted(ctx, entry.img, x, y, w, h, l.fit, l.type === 'base' ? l.radius : 0, entry.focal);
      } else {
        // Placeholder so the slot is visible while unconfigured.
        ctx.fillStyle = 'rgba(127,127,127,0.18)';
        roundedPath(ctx, x, y, w, h, l.type === 'base' ? l.radius : 0);
        ctx.fill();
      }
    } else if (l.type === 'text') {
      drawText(ctx, l, resolveText(l.template, rc), x, y, w, h, resolveColor(l.color, rc));
    }
    if (rotated) ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/** Render at full resolution and return a PNG blob for upload. */
export async function renderToBlob(opts: {
  width: number;
  height: number;
  background?: string | null;
  layers: StudioLayer[];
  rc: RenderContext;
}): Promise<Blob> {
  const canvas = document.createElement('canvas');
  await renderTemplate(canvas, opts);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), 'image/png')
  );
}
