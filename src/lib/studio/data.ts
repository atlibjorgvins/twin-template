// Image Studio data layer — templates, generated images and the layer
// model. Lives beside (not inside) directus.ts so the Studio stays a
// standalone tool; it reuses the shared client and the campaign
// candidate/token machinery for record selection and dynamic text.
import { PUBLIC_DIRECTUS_URL } from '$env/static/public';
import { resolveProjectBrand, textColorFor, type CampaignFilters, type CampaignSource } from '$lib/directus';
import { authHeader } from '$lib/data/credentials';
import { repo } from '$lib/data/repo';

// ── Layer model ─────────────────────────────────────────────────────
// Geometry is fractional (0–1 of the canvas) so a template re-renders
// cleanly at any output size. Layers are ordered bottom → top.

/** The literal color value meaning "use the template project's color". */
export const PROJECT_COLOR_TOKEN = '{project}';

// ── Project brand palette ───────────────────────────────────────────
// Named color slots a project may define ('color' is the classic
// Project.color; the brand_* fields come from the brand palette).
// A layer color slot stores `{project}` (default slot) or
// `{project.<slot>}` and resolves at render time.

export const PROJECT_BRAND_SLOTS = [
  { key: 'color', label: 'Project color' },
  { key: 'background', label: 'Main background' },
  { key: 'background_secondary', label: 'Secondary background' },
  { key: 'text', label: 'Text' },
  { key: 'accent', label: 'Accent' }
] as const;

export type BrandSlotKey = (typeof PROJECT_BRAND_SLOTS)[number]['key'];

const PROJECT_COLOR_RE = /^\{project(?:\.([\w-]+))?\}$/;

/** The brand slot a color value is bound to, or null for fixed colors. */
export function projectColorSlot(value: string): string | null {
  const m = PROJECT_COLOR_RE.exec(value.trim());
  return m ? (m[1] ?? 'color') : null;
}

/** Token literal for a brand slot ('color' uses the legacy bare form). */
export function projectColorToken(slot: string): string {
  return slot === 'color' ? PROJECT_COLOR_TOKEN : `{project.${slot}}`;
}

export type LayerBase = {
  id: string;
  type: 'base' | 'image' | 'text' | 'rect' | 'gradient' | 'logos';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees clockwise around the layer's centre. Older layers have no
   *  value — treat missing as 0. */
  rotation?: number;
  opacity: number;
  visible: boolean;
  /** Pinned in place: no dragging, resizing, rotating or nudging, and the
   *  geometry inputs go read-only. Once a logo is sized and positioned, the
   *  next drag on the canvas is far more likely to be an accident than an
   *  intention. Optional because every layer saved before this existed has
   *  no value — missing means unlocked. */
  locked?: boolean;
};

export type BaseLayer = LayerBase & {
  type: 'base';
  /** Dynamic photo slot, resolved per record: the record's own image,
   *  or the org's "Group photo" (then any gallery photo) with record
   *  image as fallback. */
  source: 'record' | 'gallery';
  fit: 'cover' | 'contain';
  radius: number; // px at output resolution
};

export type ImageLayer = LayerBase & {
  type: 'image';
  /** Directus file id of the (usually PNG) overlay. */
  file: string | null;
  fit: 'cover' | 'contain';
};

export type TextLayer = LayerBase & {
  type: 'text';
  /** Template with {tokens} — resolved per record like campaign text. */
  template: string;
  font: string;
  weight: number;
  size: number; // px at output resolution
  autoFit: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
};

export type RectLayer = LayerBase & {
  type: 'rect';
  fill: string;
  radius: number;
};

export type GradientLayer = LayerBase & {
  type: 'gradient';
  /** Gradient color (hex) — alpha comes from `from`/`to`. */
  color: string;
  /** Opacity at the start edge (0–1). */
  from: number;
  /** Opacity at the end edge (0–1). */
  to: number;
  /** Which way the gradient runs: 'down' starts at the top edge. */
  direction: 'down' | 'up' | 'left' | 'right';
};

export type LogosLayer = LayerBase & {
  type: 'logos';
  /** Role key on the project link (Project_organization.role_in_project)
   *  whose orgs' logos fill the strip — e.g. sponsor, partner. */
  role: string;
  /** Cap on how many logos render. */
  max: number;
};

export type StudioLayer =
  | BaseLayer
  | ImageLayer
  | TextLayer
  | RectLayer
  | GradientLayer
  | LogosLayer;

let layerSeq = 0;
export function newLayer(type: StudioLayer['type']): StudioLayer {
  const id = `l${Date.now().toString(36)}${(layerSeq++).toString(36)}`;
  const common = { id, opacity: 1, visible: true };
  switch (type) {
    case 'base':
      return { ...common, type, x: 0, y: 0, w: 1, h: 1, source: 'record', fit: 'cover', radius: 0 };
    case 'image':
      return { ...common, type, x: 0, y: 0, w: 1, h: 1, file: null, fit: 'contain' };
    case 'text':
      return {
        ...common, type, x: 0.08, y: 0.72, w: 0.84, h: 0.2,
        template: '{name}', font: 'Space Grotesk', weight: 700, size: 64,
        autoFit: true, color: '#ffffff', align: 'center', lineHeight: 1.15
      };
    case 'rect':
      return { ...common, type, x: 0, y: 0.7, w: 1, h: 0.3, fill: 'rgba(0,0,0,0.55)', radius: 0 };
    case 'gradient':
      // The classic photo scrim — transparent at the top, dark at the
      // bottom, sized to sit under a lower text block.
      return {
        ...common, type, x: 0, y: 0.5, w: 1, h: 0.5,
        color: '#000000', from: 0, to: 0.75, direction: 'down'
      };
    case 'logos':
      // A partner/sponsor strip along the bottom edge.
      return { ...common, type, x: 0.05, y: 0.88, w: 0.9, h: 0.08, role: 'sponsor', max: 6 };
  }
}

export const ASPECT_PRESETS: Array<{ label: string; width: number; height: number }> = [
  { label: 'Square 1:1 (1080)', width: 1080, height: 1080 },
  { label: 'Portrait 4:5 (1080×1350)', width: 1080, height: 1350 },
  { label: 'Story 9:16 (1080×1920)', width: 1080, height: 1920 },
  { label: 'Wide 16:9 (1920×1080)', width: 1920, height: 1080 }
];

// ── Placement variants ──────────────────────────────────────────────
// A template renders at its base size plus any number of extra
// placements (Story, Wide, …) in the same flow. A variant carries its
// own canvas size and optional per-layer geometry overrides — layers
// without an override just rescale via their fractional geometry.

export type VariantOverride = { x?: number; y?: number; w?: number; h?: number };

export type TemplateVariant = {
  key: string;
  label: string;
  width: number;
  height: number;
  overrides?: Record<string, VariantOverride>;
};

export const VARIANT_PRESETS: Array<{ label: string; width: number; height: number }> = [
  { label: 'Story', width: 1080, height: 1920 },
  { label: 'Feed square', width: 1080, height: 1080 },
  { label: 'Portrait', width: 1080, height: 1350 },
  { label: 'Wide', width: 1920, height: 1080 }
];

export function newVariant(preset: { label: string; width: number; height: number }): TemplateVariant {
  return {
    key: `v${Date.now().toString(36)}${(layerSeq++).toString(36)}`,
    label: preset.label,
    width: preset.width,
    height: preset.height,
    overrides: {}
  };
}

/** Layers with a variant's geometry overrides merged in (null/undefined
 *  variant = the base layout, returned as-is). */
export function applyVariant(layers: StudioLayer[], variant?: TemplateVariant | null): StudioLayer[] {
  if (!variant?.overrides) return layers;
  return layers.map((l) => {
    const o = variant.overrides?.[l.id];
    return o ? ({ ...l, ...o } as StudioLayer) : l;
  });
}

// ── Collections ─────────────────────────────────────────────────────

export type ImageTemplate = {
  id: number;
  name?: string | null;
  status?: string;
  width?: number | null;
  height?: number | null;
  /** Canvas background color; empty = transparent (PNG output). */
  background?: string | null;
  source_collection?: CampaignSource | string | null;
  filters?: CampaignFilters | null;
  /** Project context — feeds the {project} token, the dynamic project
   *  color and partner-logo layers. */
  project_id?: number | null;
  layers?: StudioLayer[] | null;
  /** 'oneoff' batches keep their config + outputs but are not offered
   *  as reusable templates (hidden from Evergreen and the main list). */
  kind?: 'template' | 'oneoff' | string | null;
  /** Extra placement sizes rendered alongside the base. */
  variants?: TemplateVariant[] | null;
  notes?: string | null;
  // ── Carousel ("summary post") kind ────────────────────────────────
  // A multi-slide collage built from an event's photo gallery. Reuses
  // the layer renderer; these hold the structure + fill state.
  /** Ordered slides, each a collage layout key. */
  slides?: CarouselSlide[] | null;
  /** File id (or null) per placement, in global slide order. */
  assignments?: (string | null)[] | null;
  /** Brand overlay config applied to every slide. */
  overlay?: CarouselOverlay | null;
  /** The bound event whose gallery fills the placements. */
  event_id?: number | null;
  date_created?: string | null;
  date_updated?: string | null;
};

export type CarouselSlide = {
  layout: string;
  title?: string | null;
  /** Per-slide overlay elements (logo/image, text, partner-logo strip,
   *  box, scrim) drawn on top of the photo collage. */
  layers?: StudioLayer[] | null;
};
export type CarouselOverlay = { logoRole?: string | null };

export type GeneratedImage = {
  id: number;
  template_id?: number | ImageTemplate | null;
  item_collection?: string | null;
  item_id?: string | null;
  item_label?: string | null;
  file_id?: string | null;
  /** Placement size label (Story, …). Empty = the base size. */
  variant?: string | null;
  tokens?: Record<string, string> | null;
  date_created?: string | null;
};

export async function listImageTemplates(): Promise<ImageTemplate[]> {
  return repo.list<ImageTemplate>('image_template', {
    where: { field: 'status', op: 'neq', value: 'archived' },
    sort: ['-date_updated']
  });
}

export async function getImageTemplate(id: number): Promise<ImageTemplate> {
  const t = await repo.get<ImageTemplate>('image_template', id);
  if (!t) throw new Error(`image_template ${id} not found`);
  return t;
}

export async function createImageTemplate(patch: Partial<ImageTemplate>): Promise<ImageTemplate> {
  return repo.create<ImageTemplate>('image_template', patch as Record<string, unknown>);
}

export async function updateImageTemplate(
  id: number,
  patch: Partial<ImageTemplate>
): Promise<ImageTemplate> {
  return repo.update<ImageTemplate>('image_template', id, patch as Record<string, unknown>);
}

export async function duplicateImageTemplate(id: number): Promise<ImageTemplate> {
  const src = await getImageTemplate(id);
  return createImageTemplate({
    name: `${src.name ?? 'Template'} (copy)`,
    status: 'draft',
    width: src.width,
    height: src.height,
    background: src.background,
    source_collection: src.source_collection,
    filters: src.filters,
    project_id: src.project_id,
    layers: src.layers,
    kind: src.kind,
    variants: src.variants,
    notes: src.notes,
    // Carousel: reuse the slide structure + brand overlay, but reset the
    // fill (a copy is for a different event).
    slides: src.slides,
    overlay: src.overlay,
    assignments: null,
    event_id: null
  });
}

export async function listGeneratedImages(templateId: number): Promise<GeneratedImage[]> {
  return repo.list<GeneratedImage>('generated_image', {
    where: { field: 'template_id', op: 'eq', value: templateId },
    sort: ['-date_created']
  });
}

export async function createGeneratedImage(
  patch: Partial<GeneratedImage>
): Promise<GeneratedImage> {
  return repo.create<GeneratedImage>('generated_image', patch as Record<string, unknown>);
}

export async function deleteGeneratedImage(id: number): Promise<void> {
  await repo.remove('generated_image', id);
}

// ── Studio files folder ─────────────────────────────────────────────
// Rendered outputs land in Files → Studio (created by the migration
// script). Looked up once per session.

// ── Project context ─────────────────────────────────────────────────
// A template bound to a project gets dynamic fields from it: the
// project's name ({project} token), its color (PROJECT_COLOR_TOKEN in
// any color slot) and the logos of orgs linked with a given role
// (partner-logo layers). Resolved once per project per session.

export type ProjectContext = {
  name: string | null;
  color: string | null;
  /** Brand slot key → color (null when the project leaves it unset). */
  colors: Record<string, string | null>;
  /** role_in_project key → org logo file ids (link order). */
  roleLogos: Record<string, string[]>;
};

const projectContextCache = new Map<number, Promise<ProjectContext>>();

export function getProjectContext(projectId: number): Promise<ProjectContext> {
  let p = projectContextCache.get(projectId);
  if (!p) {
    p = (async () => {
      // Brand comes from the structured roles (inheritance-resolved up the
      // parent chain), with the old brand_* fields + proj.color as fallbacks.
      const [proj, links, brand] = await Promise.all([
        repo.get<{
          name?: string | null;
          color?: string | null;
          brand_background?: string | null;
          brand_background_secondary?: string | null;
          brand_text?: string | null;
          brand_accent?: string | null;
        }>('Project', projectId, {
          fields: [
            'name', 'color', 'brand_background', 'brand_background_secondary',
            'brand_text', 'brand_accent'
          ]
        }),
        repo.list<{ role_in_project?: string | null; organization_id?: { logo?: string | null } | null }>(
          'Project_organization',
          {
            where: {
              and: [
                { field: 'project_id', op: 'eq', value: projectId },
                { field: 'status', op: 'neq', value: 'archived' }
              ]
            },
            fields: ['role_in_project', { organization_id: ['logo'] }]
          }
        ),
        resolveProjectBrand(projectId).catch(() => null)
      ]);
      const roleLogos: Record<string, string[]> = {};
      for (const l of links) {
        const role = l.role_in_project ?? '';
        const logo = l.organization_id?.logo;
        if (!role || !logo) continue;
        (roleLogos[role] ??= []).push(logo);
      }
      // Project's own brand logo variants (resolved) — templates target a
      // placement by role: logo_original / _inverted / _black / _landscape /
      // _vertical / _simple.
      const addLogo = (key: string, id: string | null | undefined) => { if (id) roleLogos[key] = [id]; };
      addLogo('logo_original', brand?.logoId);
      addLogo('logo_inverted', brand?.logoInvertedId);
      addLogo('logo_black', brand?.logoBlackId);
      addLogo('logo_landscape', brand?.logoLandscapeId);
      addLogo('logo_vertical', brand?.logoVerticalId);
      addLogo('logo_simple', brand?.logoSimpleId);

      const primary = brand?.primary ?? proj?.brand_accent ?? proj?.color ?? null;
      const bgMain = brand?.bgLight ?? proj?.brand_background ?? null;
      const bgInverse = brand?.bgDark ?? proj?.brand_background_secondary ?? null;
      const text = proj?.brand_text ?? (bgMain ? textColorFor(bgMain) : null);
      return {
        name: proj?.name ?? null,
        color: proj?.color ?? null,
        colors: {
          // Role names (the system of record).
          primary,
          bg_light: bgMain,
          bg_dark: bgInverse,
          text,
          // Legacy slot aliases so existing templates keep resolving.
          color: proj?.color ?? primary,
          accent: primary,
          background: bgMain,
          background_secondary: bgInverse
        },
        roleLogos
      };
    })().catch(() => ({ name: null, color: null, colors: {}, roleLogos: {} }));
    projectContextCache.set(projectId, p);
  }
  return p;
}

/** Projects offered as template context — only those that actually
 *  carry brand elements (a project color or any brand palette slot). */
export type BrandedProject = { id: number; name: string | null; color: string | null };

export async function listBrandedProjects(): Promise<BrandedProject[]> {
  return repo.list<BrandedProject>('Project', {
    where: {
      and: [
        { field: 'status', op: 'neq', value: 'archived' },
        {
          or: [
            { field: 'color', op: 'nnull' },
            { field: 'brand_background', op: 'nnull' },
            { field: 'brand_background_secondary', op: 'nnull' },
            { field: 'brand_text', op: 'nnull' },
            { field: 'brand_accent', op: 'nnull' }
          ]
        }
      ]
    },
    fields: ['id', 'name', 'color'],
    sort: ['name']
  });
}

// ── Image focal points ──────────────────────────────────────────────
// Optional per-file centre marker, stored in Directus's native
// focal_point_x/y (source pixels). When set, the renderer's cover-crop
// centres on it instead of the geometric middle — so a 16:9 photo lands
// right in a 16:9 (or any other) slot. Absence simply means "centre".

export type FocalPoint = { fx: number; fy: number };

const focalCache = new Map<string, Promise<FocalPoint | null>>();

const fileHeaders = {
  ...authHeader(),
  'Content-Type': 'application/json'
};

/** The file's focal point as fractions of its dimensions, or null. */
export function getFileFocal(fileId: string): Promise<FocalPoint | null> {
  let p = focalCache.get(fileId);
  if (!p) {
    p = fetch(
      `${PUBLIC_DIRECTUS_URL}/files/${fileId}?fields=focal_point_x,focal_point_y,width,height`,
      { headers: fileHeaders }
    )
      .then((r) => r.json())
      .then(({ data }) => {
        const x = data?.focal_point_x;
        const y = data?.focal_point_y;
        if (x == null || y == null || !data?.width || !data?.height) return null;
        return { fx: x / data.width, fy: y / data.height };
      })
      .catch(() => null);
    focalCache.set(fileId, p);
  }
  return p;
}

/** Set (fractions 0–1) or clear (nulls) a file's focal point. */
export async function setFileFocal(
  fileId: string,
  fx: number | null,
  fy: number | null
): Promise<void> {
  let patch: Record<string, number | null>;
  if (fx == null || fy == null) {
    patch = { focal_point_x: null, focal_point_y: null };
  } else {
    const meta = await fetch(`${PUBLIC_DIRECTUS_URL}/files/${fileId}?fields=width,height`, {
      headers: fileHeaders,
      credentials: 'include'
    }).then((r) => r.json());
    const w = meta?.data?.width;
    const h = meta?.data?.height;
    if (!w || !h) throw new Error('Image dimensions unavailable — cannot set the centre point.');
    patch = {
      focal_point_x: Math.round(Math.max(0, Math.min(1, fx)) * w),
      focal_point_y: Math.round(Math.max(0, Math.min(1, fy)) * h)
    };
  }
  const res = await fetch(`${PUBLIC_DIRECTUS_URL}/files/${fileId}`, {
    method: 'PATCH',
    headers: fileHeaders,
    credentials: 'include',
    body: JSON.stringify(patch)
  });
  if (!res.ok) throw new Error(`Saving the centre point failed (${res.status}).`);
  focalCache.delete(fileId);
}

let studioFolderCache: string | null | undefined;

export async function studioFolderId(): Promise<string | null> {
  if (studioFolderCache !== undefined) return studioFolderCache;
  try {
    const res = await fetch(
      `${PUBLIC_DIRECTUS_URL}/folders?filter[name][_eq]=Studio&limit=1&fields=id`,
      { headers: authHeader() }
    );
    const json = await res.json();
    studioFolderCache = (json?.data?.[0]?.id as string | undefined) ?? null;
  } catch {
    studioFolderCache = null;
  }
  return studioFolderCache;
}
