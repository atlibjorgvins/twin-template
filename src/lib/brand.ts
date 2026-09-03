// Brand, independent of what owns it.
//
// The brand fields started on Project because that is where the need showed
// up — cohorts and programmes each have a look. But a brand belongs to
// whoever owns it, and usually that is a company: KLAK has a brand, and the
// project "KLAK - Icelandic Startups" borrows it.
//
// organization now carries the same field names as Project (see
// scripts/add-org-brand.sh), so everything here is written once and takes an
// owner rather than a project id. Both collections have a parent pointer, so
// inheritance is the same walk with a different column name.
//
// This module owns three things:
//   resolveBrand()    — the inheritance walk, for either kind
//   saveBrandField()  — write one field back to the right collection
//   listBrandOwners() — everything that has a brand, for the picker

import {
  listProjectBrandAssets,
  addProjectBrandAsset,
  type ProjectBrandAsset
} from '$lib/directus';
import { repo } from '$lib/data/repo';

export type BrandOwnerKind = 'project' | 'organization';

export type BrandOwner = {
  kind: BrandOwnerKind;
  id: number;
  name: string;
};

export type BrandLogoField =
  | 'brand_logo'
  | 'brand_logo_inverted'
  | 'brand_logo_black'
  | 'brand_logo_landscape'
  | 'brand_logo_vertical'
  | 'brand_logo_simple';

export type BrandColorField =
  | 'brand_primary'
  | 'brand_action'
  | 'brand_bg_light'
  | 'brand_bg_dark'
  | 'brand_text'
  | 'brand_text_muted'
  | 'brand_text_inverse'
  | 'brand_headline';

/** Where a resolved value came from — null when it is the owner's own. */
export type BrandSource = { kind: BrandOwnerKind; id: number; name: string } | null;

export type ResolvedBrand = {
  logos: Record<BrandLogoField, string | null>;
  logoFrom: Record<BrandLogoField, BrandSource>;
  colors: Record<BrandColorField, string | null>;
  colorFrom: Record<BrandColorField, BrandSource>;
  font: string | null;
  fontFrom: BrandSource;
  assets: ProjectBrandAsset[];
  assetsFrom: BrandSource;
};

export const BRAND_LOGO_ROLES: Array<{
  field: BrandLogoField;
  label: string;
  hint: string;
  /** Render this variant against the inverse background, not the main one. */
  onDark: boolean;
}> = [
  { field: 'brand_logo', label: 'Original', hint: 'Full colour — lives on the main background', onDark: false },
  { field: 'brand_logo_inverted', label: 'Inverted', hint: 'Lives on the inverse background', onDark: true },
  { field: 'brand_logo_black', label: 'Flat black', hint: 'Edge cases (print, stamps, faxes…)', onDark: false },
  { field: 'brand_logo_landscape', label: 'Landscape', hint: 'Wide lockup — headers, navbars', onDark: false },
  { field: 'brand_logo_vertical', label: 'Vertical', hint: 'Stacked lockup — square-ish placements', onDark: false },
  { field: 'brand_logo_simple', label: 'Simple', hint: 'Mark only — favicons, avatars, small sizes', onDark: false }
];

/**
 * Roles, grouped and each tied to the surface it is judged against.
 *
 * Grouping is not decoration. A flat list of eight makes eight equally
 * obligatory decisions; three groups of two or three makes it obvious that
 * you set the surfaces first and everything else is judged against them.
 *
 * `derive` marks the roles that have a safe automatic answer. Text on a
 * background can always be computed from luminance, so leaving it blank can
 * never produce something unreadable — it just produces #111111, which is
 * not a brand colour. Muted text has no such fallback: too light and it
 * vanishes, and only a person knows which grey was meant.
 */
export const BRAND_COLOR_ROLES: Array<{
  field: BrandColorField;
  label: string;
  hint: string;
  group: 'surface' | 'text' | 'brand';
  /** Which surface this is read against — null when it IS a surface. */
  on: 'light' | 'dark' | null;
  /** Luminance-derived when left blank. */
  derive?: boolean;
  /** Falls back to another role rather than to a derivation. */
  follows?: BrandColorField;
}> = [
  { field: 'brand_bg_light', label: 'Main background', group: 'surface', on: null,
    hint: 'The surface the brand normally sits on' },
  { field: 'brand_bg_dark', label: 'Inverse background', group: 'surface', on: null,
    hint: 'The contrast surface — dark sections, the inverted logo' },

  { field: 'brand_text', label: 'Text', group: 'text', on: 'light', derive: true,
    hint: 'Body copy on the main surface' },
  { field: 'brand_headline', label: 'Headline', group: 'text', on: 'light', follows: 'brand_text',
    hint: 'Only if headlines differ from body text' },
  { field: 'brand_text_muted', label: 'Muted text', group: 'text', on: 'light',
    hint: 'Captions, metadata — the one that cannot be guessed' },
  { field: 'brand_text_inverse', label: 'Text on inverse', group: 'text', on: 'dark', derive: true,
    hint: 'Body copy on the dark surface' },

  { field: 'brand_primary', label: 'Brand', group: 'brand', on: 'light',
    hint: 'The signature hue — what the brand is recognised by' },
  { field: 'brand_action', label: 'Action', group: 'brand', on: 'light',
    hint: 'Buttons and links. Needs 4.5:1 on the main surface' }
];

export const COLOR_ROLE_GROUPS: Array<{ value: 'surface' | 'text' | 'brand'; label: string; hint: string }> = [
  { value: 'surface', label: 'Surfaces', hint: 'Set these first — everything else is judged against them' },
  { value: 'text', label: 'Text', hint: 'Blank means derived from the background, which is safe but not on-brand' },
  { value: 'brand', label: 'Brand & action', hint: 'The identity colour, and the one buttons are made of' }
];

const LOGO_FIELDS = BRAND_LOGO_ROLES.map((r) => r.field);
const COLOR_FIELDS = BRAND_COLOR_ROLES.map((r) => r.field);
/** Colour columns added after the original three. Listed once, so the
 *  missing-column fallback keeps working as more roles arrive. */
const LATE_COLOR_FIELDS = [
  'brand_action', 'brand_text', 'brand_text_muted', 'brand_text_inverse', 'brand_headline'
];

/** Collection name and parent column for a kind — the only thing that differs. */
function shape(kind: BrandOwnerKind): { collection: string; parent: string } {
  return kind === 'project'
    ? { collection: 'Project', parent: 'parent_id' }
    : { collection: 'organization', parent: 'parent_organization' };
}

function emptyBrand(): ResolvedBrand {
  const logos = {} as Record<BrandLogoField, string | null>;
  const logoFrom = {} as Record<BrandLogoField, BrandSource>;
  for (const f of LOGO_FIELDS) { logos[f] = null; logoFrom[f] = null; }
  const colors = {} as Record<BrandColorField, string | null>;
  const colorFrom = {} as Record<BrandColorField, BrandSource>;
  for (const f of COLOR_FIELDS) { colors[f] = null; colorFrom[f] = null; }
  return { logos, logoFrom, colors, colorFrom, font: null, fontFrom: null, assets: [], assetsFrom: null };
}

type BrandRow = Record<string, unknown> & { id: number; name?: string | null };

/**
 * Walk up the ownership chain, taking the first value found for each facet.
 *
 * `startsAtSelf` is the difference between the Brand card and the brand book:
 * the card resolves from the PARENT so it can label its own values as "own"
 * and everything else as inherited, while the book wants the effective brand
 * with no such distinction.
 *
 * Depth is capped at 8. A cycle in the parent chain would otherwise hang the
 * page, and nobody's org chart is eight deep on purpose.
 */
/**
 * Does this owner refuse to inherit?
 *
 * Inheritance is "first non-empty value walking up the parent chain", which
 * cannot express "we deliberately have nothing here yet" — an empty field and
 * an unset one look identical, so a brand cleared in order to start fresh just
 * re-inherits the parent's. `brand_standalone` stops the walk at depth 0.
 *
 * Read defensively and defaulting to false: the column is a late arrival, and
 * Directus rejects the WHOLE request for one unknown field, so a database
 * where scripts/add-brand-standalone.sh has not run must still resolve a brand
 * rather than throw.
 */
export async function isBrandStandalone(kind: BrandOwnerKind, id: number): Promise<boolean> {
  const { collection } = shape(kind);
  try {
    const row = (await repo.get(collection, id, {
      fields: ['brand_standalone']
    })) as unknown as { brand_standalone?: boolean | null };
    return row.brand_standalone === true;
  } catch {
    return false;
  }
}

export async function resolveBrand(
  kind: BrandOwnerKind,
  startId: number,
  opts: { includeAssets?: boolean } = {}
): Promise<ResolvedBrand> {
  const out = emptyBrand();
  const { collection, parent } = shape(kind);
  const wantAssets = opts.includeAssets !== false && kind === 'project';

  // Fields added after the original set: brand_font, then brand_action.
  // Directus rejects the WHOLE request for one unknown column, so a database
  // where a migration has not run would lose the entire brand rather than
  // one facet. LEAN drops every late arrival, not just the newest — dropping
  // only the last one added is how this breaks again on the next field.
  const LATE = new Set(['brand_font', 'brand_standalone', ...LATE_COLOR_FIELDS]);
  const FULL = ['id', 'name', parent, 'brand_colors', 'brand_standalone', ...LOGO_FIELDS, ...COLOR_FIELDS, 'brand_font'];
  const LEAN = FULL.filter((f) => !LATE.has(f));
  let fields = FULL;

  let currentId: number | null = startId;
  const seen = new Set<number>();

  for (let depth = 0; depth < 8 && currentId != null; depth++) {
    if (seen.has(currentId)) break;
    seen.add(currentId);

    let row: BrandRow;
    try {
      row = (await repo.get(collection, currentId, { fields })) as unknown as BrandRow;
    } catch (e) {
      if (fields === LEAN) throw e;
      fields = LEAN;
      row = (await repo.get(collection, currentId, { fields })) as unknown as BrandRow;
    }

    const from: BrandSource = { kind, id: row.id, name: row.name ?? `#${row.id}` };

    for (const f of LOGO_FIELDS) {
      const v = row[f] as string | null | undefined;
      if (!out.logos[f] && v) { out.logos[f] = v; out.logoFrom[f] = from; }
    }
    for (const f of COLOR_FIELDS) {
      const v = row[f] as string | null | undefined;
      if (!out.colors[f] && v) { out.colors[f] = v; out.colorFrom[f] = from; }
    }
    const fnt = row.brand_font as string | null | undefined;
    if (!out.font && fnt) { out.font = fnt; out.fontFrom = from; }

    if (wantAssets && out.assets.length === 0) {
      try {
        const assets = await listProjectBrandAssets(row.id);
        if (assets.length > 0) { out.assets = assets; out.assetsFrom = from; }
      } catch {
        // The gallery is a nice-to-have; a failure here must not cost the
        // colours and logos we already resolved.
      }
    }

    // A standalone owner is the end of the chain: whatever it has (or lacks)
    // IS the brand. Checked after its own values are read, so it keeps them.
    if (depth === 0 && (row as Record<string, unknown>).brand_standalone === true) break;

    const p = row[parent];
    currentId = typeof p === 'number' ? p : (p as { id?: number } | null)?.id ?? null;
  }

  return out;
}

/** Write one brand field back to whichever collection owns it. */
export async function saveBrandField(
  owner: BrandOwner,
  field: BrandLogoField | BrandColorField | 'brand_font',
  value: string | null
): Promise<void> {
  const { collection } = shape(owner.kind);
  await repo.update(collection, owner.id, { [field]: value });
}

/** Does this row carry any brand of its own? */
function hasOwnBrand(r: Record<string, unknown>): boolean {
  if (LOGO_FIELDS.some((f) => !!r[f])) return true;
  if (COLOR_FIELDS.some((f) => !!r[f])) return true;
  if (r.brand_font) return true;
  const colors = r.brand_colors as unknown[] | null | undefined;
  return Array.isArray(colors) && colors.length > 0;
}

export type BrandOwnerSummary = BrandOwner & {
  primary: string | null;
  logoId: string | null;
  /** Parent within the SAME kind, or null. Used to nest the picker. */
  parentId: number | null;
};

/**
 * Everything that has a brand worth opening, for the picker.
 *
 * Own values only — no inheritance. A cohort that merely inherits its
 * parent's palette is not a separate entry in a brand list; including it
 * would turn a list of brands into a list of projects.
 */
export async function listBrandOwners(): Promise<BrandOwnerSummary[]> {
  const LATE = new Set(['brand_font', ...LATE_COLOR_FIELDS]);
  const base = ['id', 'name', 'brand_colors', ...LOGO_FIELDS, ...COLOR_FIELDS, 'brand_font'];

  async function grab(kind: BrandOwnerKind): Promise<BrandOwnerSummary[]> {
    const { collection, parent } = shape(kind);
    const fields = [...base, parent];
    const read = (f: string[]) => repo.list(collection, { fields: f });

    let rows: Array<Record<string, unknown>>;
    try {
      rows = (await read(fields)) as unknown as Array<Record<string, unknown>>;
    } catch {
      // Same trap as resolveBrand: Directus rejects the whole request for
      // one unknown column, so asking for brand_font against a database
      // where the migration has not run returned an EMPTY BRAND LIST rather
      // than a list without typefaces. Retry without it before giving up.
      try {
        rows = (await read(fields.filter((f) => !LATE.has(f)))) as unknown as Array<
          Record<string, unknown>
        >;
      } catch {
        // A collection with no brand columns at all contributes nothing,
        // rather than taking the whole picker down.
        return [];
      }
    }
    return rows.filter(hasOwnBrand).map((r) => {
      const p = r[parent];
      return {
        kind,
        id: r.id as number,
        name: (r.name as string) ?? `#${r.id}`,
        primary: (r.brand_primary as string) ?? null,
        logoId: (r.brand_logo as string) ?? (r.brand_logo_simple as string) ?? null,
        parentId: typeof p === 'number' ? p : ((p as { id?: number } | null)?.id ?? null)
      };
    });
  }

  const [projects, orgs] = await Promise.all([grab('project'), grab('organization')]);
  return [...orgs, ...projects].sort((a, b) => a.name.localeCompare(b.name));
}

/** Route to a brand book. One place, so the links cannot drift. */
export function brandBookHref(kind: BrandOwnerKind, id: number): string {
  return `/brand-book/${kind}/${id}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Font faces
//
// brand_font holds the NAME of a typeface, which is enough to say "we use
// Inter" and not enough to do anything with. brand_font_face holds the
// faces: an uploaded file, a stylesheet URL, or both — so the brand book can
// render a real specimen instead of approximating one in the system font.
//
// Same inheritance rule as the colour roles: a cohort with no faces of its
// own shows its parent's. Unlike the colour roles it is all-or-nothing — the
// nearest ancestor WITH faces wins outright, because a half-inherited type
// system (our display font, their body font) is not a thing anybody means.
// ─────────────────────────────────────────────────────────────────────────

export type BrandFontRole = 'display' | 'body' | 'mono' | 'accent';

export type BrandFontFace = {
  id: number;
  owner_kind: BrandOwnerKind;
  owner_id: number;
  family: string;
  role?: BrandFontRole | null;
  weight?: number | null;
  style?: 'normal' | 'italic' | null;
  file_id?: string | null;
  css_url?: string | null;
  source_url?: string | null;
  license?: string | null;
  notes?: string | null;
  sort?: number | null;
};

export const BRAND_FONT_ROLES: Array<{ value: BrandFontRole; label: string; hint: string }> = [
  { value: 'display', label: 'Display', hint: 'Headlines and large type' },
  { value: 'body', label: 'Body', hint: 'Paragraphs and UI text' },
  { value: 'mono', label: 'Mono', hint: 'Code, numbers, tabular data' },
  { value: 'accent', label: 'Accent', hint: 'Quotes, callouts, one-off moments' }
];

/** Role order for display; unroled faces sort last. */
const ROLE_ORDER: Record<string, number> = { display: 0, body: 1, accent: 2, mono: 3 };

function sortFaces(faces: BrandFontFace[]): BrandFontFace[] {
  return [...faces].sort((a, b) => {
    const ra = ROLE_ORDER[a.role ?? ''] ?? 9;
    const rb = ROLE_ORDER[b.role ?? ''] ?? 9;
    if (ra !== rb) return ra - rb;
    if ((a.sort ?? 0) !== (b.sort ?? 0)) return (a.sort ?? 0) - (b.sort ?? 0);
    return (a.weight ?? 400) - (b.weight ?? 400);
  });
}

/** Faces owned directly by one owner — no inheritance. */
export async function listOwnFontFaces(
  kind: BrandOwnerKind,
  id: number
): Promise<BrandFontFace[]> {
  try {
    const rows = await repo.list<BrandFontFace>('brand_font_face', {
      where: {
        and: [
          { field: 'owner_kind', op: 'eq', value: kind },
          { field: 'owner_id', op: 'eq', value: id }
        ]
      },
      sort: ['sort', 'id']
    });
    return sortFaces(rows);
  } catch {
    // The collection may not exist yet (migration not run). A brand with no
    // faces is a normal state; a page that explodes over it is not.
    return [];
  }
}

/**
 * Faces for an owner, falling back up the parent chain.
 *
 * Returns the source too, so the brand book can say "from KLAK" the same way
 * it does for an inherited colour.
 */
export async function resolveFontFaces(
  kind: BrandOwnerKind,
  startId: number
): Promise<{ faces: BrandFontFace[]; from: BrandSource }> {
  const { collection, parent } = shape(kind);
  let currentId: number | null = startId;
  const seen = new Set<number>();

  for (let depth = 0; depth < 8 && currentId != null; depth++) {
    if (seen.has(currentId)) break;
    seen.add(currentId);

    const faces = await listOwnFontFaces(kind, currentId);
    if (faces.length > 0) {
      let name = `#${currentId}`;
      try {
        const row = (await repo.get(collection, currentId, {
          fields: ['id', 'name']
        })) as unknown as { name?: string | null };
        name = row.name ?? name;
      } catch {
        // Name is a label, not the payload.
      }
      return { faces, from: { kind, id: currentId, name } };
    }

    try {
      const row = (await repo.get(collection, currentId, {
        fields: ['id', parent, 'brand_standalone']
      })) as unknown as Record<string, unknown>;
      // Standalone: no faces here means no faces, not the parent's.
      if (depth === 0 && row.brand_standalone === true) break;
      const p = row[parent];
      currentId = typeof p === 'number' ? p : ((p as { id?: number } | null)?.id ?? null);
    } catch {
      break;
    }
  }
  return { faces: [], from: null };
}

/**
 * @font-face rules for the faces that carry an actual file.
 *
 * No format() hint: it exists so a browser can skip a source it cannot
 * read, and with exactly one src there is nothing to skip. Omitting it means
 * this never has to know the filename, which would otherwise cost a second
 * request to Directus just to read an extension.
 *
 * Faces that only have a css_url are not included — those load through a
 * <link>, because we do not know what the remote stylesheet declares.
 *
 * The asset URL keeps its access token here, unlike the links we hand out:
 * this one is fetched by the page that already has it, and never travels.
 */
export function fontFaceCss(faces: BrandFontFace[], urlFor: (id: string) => string): string {
  return faces
    .filter((f) => !!f.file_id)
    .map((f) =>
      [
        '@font-face {',
        `  font-family: "${f.family}";`,
        `  src: url("${urlFor(f.file_id!)}");`,
        // No weight means a variable font — claim the whole range so the
        // browser does not synthesise bold on top of a real bold axis.
        f.weight ? `  font-weight: ${f.weight};` : '  font-weight: 100 900;',
        `  font-style: ${f.style ?? 'normal'};`,
        '  font-display: swap;',
        '}'
      ].join('\n')
    )
    .join('\n');
}

/** Distinct stylesheet URLs to <link> in, deduped. */
export function fontStylesheets(faces: BrandFontFace[]): string[] {
  return [...new Set(faces.map((f) => f.css_url).filter((u): u is string => !!u?.trim()))];
}

/** A CSS font stack for a role, falling back through the other faces. */
export function fontStackFor(faces: BrandFontFace[], role: BrandFontRole): string | null {
  const hit = faces.find((f) => f.role === role) ?? faces.find((f) => !f.role) ?? faces[0];
  if (!hit) return null;
  const generic = role === 'mono' ? 'ui-monospace, monospace' : 'system-ui, sans-serif';
  return `"${hit.family}", ${generic}`;
}

export async function createFontFace(patch: Partial<BrandFontFace>): Promise<BrandFontFace> {
  return repo.create<BrandFontFace>('brand_font_face', patch as Record<string, unknown>);
}

export async function updateFontFace(id: number, patch: Partial<BrandFontFace>): Promise<void> {
  await repo.update('brand_font_face', id, patch as Record<string, unknown>);
}

export async function deleteFontFace(id: number): Promise<void> {
  await repo.remove('brand_font_face', id);
}

// ─────────────────────────────────────────────────────────────────────────
// Logos as a matrix
//
// The six brand_logo* columns conflate two independent axes: the TREATMENT
// (original / inverted / flat — a colour decision, driven by what is behind
// the logo) and the LOCKUP (primary / landscape / vertical / mark — a shape
// decision, driven by the space available). Every lockup needs every
// treatment; the columns only ever gave the primary lockup all three, and
// left landscape, vertical and mark with original alone.
//
// brand_logo_asset holds the full grid. The columns are still read, mapped
// into their cell, so thirteen projects' worth of existing logos keep
// working untouched and a row simply wins over the column beneath it.
// ─────────────────────────────────────────────────────────────────────────

export type LogoLockup = 'primary' | 'landscape' | 'vertical' | 'mark';
export type LogoTreatment = 'original' | 'inverted' | 'flat' | 'white';

export type BrandLogoAsset = {
  id: number;
  owner_kind: BrandOwnerKind;
  owner_id: number;
  lockup: LogoLockup;
  treatment: LogoTreatment;
  file_id?: string | null;
  notes?: string | null;
  sort?: number | null;
};

export const LOGO_LOCKUPS: Array<{ value: LogoLockup; label: string; hint: string }> = [
  { value: 'primary', label: 'Primary', hint: 'The default lockup — use unless the space says otherwise' },
  { value: 'landscape', label: 'Landscape', hint: 'Wide — headers, navbars, email signatures' },
  { value: 'vertical', label: 'Vertical', hint: 'Stacked — square-ish placements, posters' },
  { value: 'mark', label: 'Mark', hint: 'Symbol only — favicons, avatars, below ~32px' }
];

export const LOGO_TREATMENTS: Array<{
  value: LogoTreatment;
  label: string;
  hint: string;
  /** Preview this treatment against the inverse background. */
  onDark: boolean;
}> = [
  { value: 'original', label: 'Original', hint: 'Full colour, on the main background', onDark: false },
  { value: 'inverted', label: 'Inverted', hint: 'For the inverse background', onDark: true },
  { value: 'flat', label: 'Flat black', hint: 'One colour — print, stamps, fax', onDark: false },
  { value: 'white', label: 'Flat white', hint: 'One colour on anything dark or busy', onDark: true }
];

/** Which cell each legacy column occupies. */
const LEGACY_CELLS: Array<{ field: BrandLogoField; lockup: LogoLockup; treatment: LogoTreatment }> = [
  { field: 'brand_logo', lockup: 'primary', treatment: 'original' },
  { field: 'brand_logo_inverted', lockup: 'primary', treatment: 'inverted' },
  { field: 'brand_logo_black', lockup: 'primary', treatment: 'flat' },
  { field: 'brand_logo_landscape', lockup: 'landscape', treatment: 'original' },
  { field: 'brand_logo_vertical', lockup: 'vertical', treatment: 'original' },
  { field: 'brand_logo_simple', lockup: 'mark', treatment: 'original' }
];

export const cellKey = (l: LogoLockup, t: LogoTreatment) => `${l}/${t}`;

/** One resolved cell of the grid. */
export type LogoCell = {
  lockup: LogoLockup;
  treatment: LogoTreatment;
  fileId: string;
  from: BrandSource;
  /** True when this came from a brand_logo* column rather than a row —
   *  which is what "Remove" has to know to clear the right thing. */
  legacy: boolean;
  /** Row id, when it is a row. */
  rowId?: number;
  notes?: string | null;
};

export async function listOwnLogoAssets(
  kind: BrandOwnerKind,
  id: number
): Promise<BrandLogoAsset[]> {
  try {
    return await repo.list<BrandLogoAsset>('brand_logo_asset', {
      where: {
        and: [
          { field: 'owner_kind', op: 'eq', value: kind },
          { field: 'owner_id', op: 'eq', value: id }
        ]
      },
      sort: ['sort', 'id']
    });
  } catch {
    // Collection may not exist yet; the legacy columns still carry the brand.
    return [];
  }
}

/**
 * The whole grid for an owner, inherited like everything else.
 *
 * Resolution order per cell, first hit wins:
 *   1. a brand_logo_asset row on this owner
 *   2. a legacy column on this owner
 *   3. the same, one step up the parent chain
 *
 * Row-beats-column is per CELL, not per owner: adding an inverted landscape
 * here must not shadow the primary logo you are still inheriting.
 */
export async function resolveLogoAssets(
  kind: BrandOwnerKind,
  startId: number
): Promise<Map<string, LogoCell>> {
  const out = new Map<string, LogoCell>();
  const { collection, parent } = shape(kind);

  let currentId: number | null = startId;
  const seen = new Set<number>();

  for (let depth = 0; depth < 8 && currentId != null; depth++) {
    if (seen.has(currentId)) break;
    seen.add(currentId);

    let row: Record<string, unknown> & { id: number; name?: string | null };
    try {
      row = (await repo.get(collection, currentId, {
        fields: ['id', 'name', parent, 'brand_standalone', ...LOGO_FIELDS]
      })) as unknown as typeof row;
    } catch {
      break;
    }
    const from: BrandSource = { kind, id: row.id, name: row.name ?? `#${row.id}` };

    for (const a of await listOwnLogoAssets(kind, currentId)) {
      if (!a.file_id) continue;
      const k = cellKey(a.lockup, a.treatment);
      if (!out.has(k)) {
        out.set(k, {
          lockup: a.lockup, treatment: a.treatment, fileId: a.file_id,
          from, legacy: false, rowId: a.id, notes: a.notes
        });
      }
    }
    for (const c of LEGACY_CELLS) {
      const v = row[c.field] as string | null | undefined;
      if (!v) continue;
      const k = cellKey(c.lockup, c.treatment);
      if (!out.has(k)) {
        out.set(k, { lockup: c.lockup, treatment: c.treatment, fileId: v, from, legacy: true });
      }
    }

    // Standalone: the cells this owner has are all the cells there are.
    if (depth === 0 && row.brand_standalone === true) break;

    const p = row[parent];
    currentId = typeof p === 'number' ? p : ((p as { id?: number } | null)?.id ?? null);
  }

  return out;
}

export async function createLogoAsset(patch: Partial<BrandLogoAsset>): Promise<BrandLogoAsset> {
  return repo.create<BrandLogoAsset>('brand_logo_asset', patch as Record<string, unknown>);
}

export async function deleteLogoAsset(id: number): Promise<void> {
  await repo.remove('brand_logo_asset', id);
}

/** The legacy column for a cell, when one exists — so clearing an inherited
 *  legacy value writes to the right place instead of orphaning it. */
export function legacyFieldFor(l: LogoLockup, t: LogoTreatment): BrandLogoField | null {
  return LEGACY_CELLS.find((c) => c.lockup === l && c.treatment === t)?.field ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
// Palette
//
// Two tiers, which is what every mature token system converges on and what
// the KLAK sheet already does on paper:
//
//   palette   what colours the brand OWNS — "Stoðlitur 1", "KLAK Pink"
//   roles     what each colour is FOR — surface, brand, action
//
// Roles store a hex rather than a reference to a palette row. The UI makes
// you pick from the palette, which is where coherence actually comes from,
// but the stored value stays a plain colour so every existing reader keeps
// working without learning about palettes.
//
// A palette entry is a PAIR. The designer's "(+)" variants are not separate
// colours; they are the usable version of the same one, and they exist
// because the base fails on a light surface — #FF5E72 is 2.90:1 on #FDFDFA.
// Splitting them into two swatches loses exactly the relationship that makes
// the darker one meaningful.
// ─────────────────────────────────────────────────────────────────────────

export type PaletteGroup = 'foundation' | 'support' | 'neutral';

export type PaletteColor = {
  id: number;
  owner_kind: BrandOwnerKind;
  owner_id: number;
  name: string;
  group?: PaletteGroup | null;
  hex: string;
  hex_strong?: string | null;
  notes?: string | null;
  sort?: number | null;
};

export const PALETTE_GROUPS: Array<{ value: PaletteGroup; label: string; hint: string }> = [
  { value: 'foundation', label: 'Foundation', hint: 'The surfaces everything else sits on' },
  { value: 'support', label: 'Support', hint: 'The identity colours — what the brand is recognised by' },
  { value: 'neutral', label: 'Neutral', hint: 'Greys: dividers, muted text, disabled states' }
];

const GROUP_ORDER: Record<string, number> = { foundation: 0, support: 1, neutral: 2 };

function sortPalette(rows: PaletteColor[]): PaletteColor[] {
  return [...rows].sort((a, b) => {
    const ga = GROUP_ORDER[a.group ?? 'support'] ?? 1;
    const gb = GROUP_ORDER[b.group ?? 'support'] ?? 1;
    if (ga !== gb) return ga - gb;
    return (a.sort ?? 0) - (b.sort ?? 0) || a.id - b.id;
  });
}

export async function listOwnPalette(
  kind: BrandOwnerKind,
  id: number
): Promise<PaletteColor[]> {
  try {
    const rows = await repo.list<PaletteColor>('brand_palette_color', {
      where: {
        and: [
          { field: 'owner_kind', op: 'eq', value: kind },
          { field: 'owner_id', op: 'eq', value: id }
        ]
      },
      sort: ['sort', 'id']
    });
    return sortPalette(rows);
  } catch {
    return [];
  }
}

/**
 * The palette for an owner, falling back up the parent chain, and falling
 * back again to the legacy brand_colors JSON.
 *
 * All-or-nothing per owner, like the font faces: a half-inherited palette
 * (our pink, their yellow) is not something anyone means.
 *
 * The legacy brand_colors JSON is no longer read. It was a third store for the
 * same concept, which is why the editor had to label one section "older list"
 * and nobody could say where a colour actually lived. Its 13 values were moved
 * into brand_palette_color by scripts/migrate-brand-colors.mjs and the column
 * cleared; `legacy` stays in the return type only so callers keep compiling,
 * and is always false.
 */
export async function resolvePalette(
  kind: BrandOwnerKind,
  startId: number
): Promise<{ colors: PaletteColor[]; from: BrandSource; legacy: boolean }> {
  const { collection, parent } = shape(kind);
  let currentId: number | null = startId;
  const seen = new Set<number>();

  for (let depth = 0; depth < 8 && currentId != null; depth++) {
    if (seen.has(currentId)) break;
    seen.add(currentId);

    const own = await listOwnPalette(kind, currentId);

    let row: Record<string, unknown> & { id: number; name?: string | null };
    try {
      row = (await repo.get(collection, currentId, {
        fields: ['id', 'name', parent, 'brand_standalone']
      })) as unknown as typeof row;
    } catch {
      break;
    }
    const from: BrandSource = { kind, id: row.id, name: row.name ?? `#${row.id}` };

    if (own.length > 0) return { colors: own, from, legacy: false };

    // Standalone: an empty palette here is a real answer, not a reason to go
    // looking at the parent's.
    if (depth === 0 && row.brand_standalone === true) break;

    const p = row[parent];
    currentId = typeof p === 'number' ? p : ((p as { id?: number } | null)?.id ?? null);
  }
  return { colors: [], from: null, legacy: false };
}

export async function createPaletteColor(patch: Partial<PaletteColor>): Promise<PaletteColor> {
  return repo.create<PaletteColor>('brand_palette_color', patch as Record<string, unknown>);
}
export async function updatePaletteColor(id: number, patch: Partial<PaletteColor>): Promise<void> {
  await repo.update('brand_palette_color', id, patch as Record<string, unknown>);
}
export async function deletePaletteColor(id: number): Promise<void> {
  await repo.remove('brand_palette_color', id);
}


// ── Brand elements ───────────────────────────────────────────────────────
// The parts of a brand that are neither a logo nor a colour: background
// patterns, gradients, graphic elements, and photography direction.
//
// One type with four kinds, because they differ in how they are RENDERED, not
// in what they are — a pattern needs a tile width, a gradient needs stops, and
// the columns a kind does not use stay null. Four collections would mean four
// resolvers and four editors to keep in step, which is exactly how the colour
// model ended up with three stores saying different things.

export type BrandElementKind = 'pattern' | 'gradient' | 'graphic' | 'photography';

export type GradientStop = { hex: string; pos: number };

export type BrandElement = {
  id: number;
  owner_kind: BrandOwnerKind;
  owner_id: number;
  kind: BrandElementKind;
  name: string;
  notes?: string | null;
  file_id?: string | null;
  /** Source of truth for a gradient; the CSS is derived, never stored. */
  gradient_stops?: GradientStop[] | null;
  gradient_angle?: number | null;
  /** Intended tile width in px, so a pattern previews at its real scale. */
  tile_width?: number | null;
  on_dark?: boolean | null;
  sort?: number | null;
};

export const BRAND_ELEMENT_KINDS: Array<{
  value: BrandElementKind;
  label: string;
  plural: string;
  hint: string;
}> = [
  { value: 'pattern', label: 'Pattern', plural: 'Patterns',
    hint: 'Tiling backgrounds — shown repeating, so you can see whether the tile seams' },
  { value: 'gradient', label: 'Gradient', plural: 'Gradients',
    hint: 'Authored from stops and an angle, so the CSS stays copyable' },
  { value: 'graphic', label: 'Graphic element', plural: 'Graphic elements',
    hint: 'Shapes, textures, dividers and decorative marks' },
  { value: 'photography', label: 'Photography', plural: 'Photography',
    hint: 'Reference shots and the direction that goes with them' }
];

const ELEMENT_ORDER: Record<string, number> = {
  pattern: 0, gradient: 1, graphic: 2, photography: 3
};

function sortElements(rows: BrandElement[]): BrandElement[] {
  return [...rows].sort((a, b) => {
    const ka = ELEMENT_ORDER[a.kind] ?? 9;
    const kb = ELEMENT_ORDER[b.kind] ?? 9;
    if (ka !== kb) return ka - kb;
    return (a.sort ?? 0) - (b.sort ?? 0) || a.id - b.id;
  });
}

/**
 * The CSS for an authored gradient.
 *
 * Derived, never stored: a stored string would go stale the moment a stop was
 * edited, and the whole reason gradients are authored rather than uploaded is
 * that they stay recolourable.
 */
export function gradientCss(el: Pick<BrandElement, 'gradient_stops' | 'gradient_angle'>): string | null {
  const stops = el.gradient_stops;
  if (!Array.isArray(stops) || stops.length < 2) return null;
  const ordered = [...stops].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
  const parts = ordered
    .filter((s) => typeof s?.hex === 'string' && /^#[0-9a-f]{3,8}$/i.test(s.hex.trim()))
    .map((s) => `${s.hex.trim()} ${Math.max(0, Math.min(100, Math.round(s.pos ?? 0)))}%`);
  if (parts.length < 2) return null;
  return `linear-gradient(${Math.round(el.gradient_angle ?? 180)}deg, ${parts.join(', ')})`;
}

/** Elements owned directly by one owner — no inheritance. */
export async function listOwnElements(
  kind: BrandOwnerKind,
  id: number
): Promise<BrandElement[]> {
  try {
    const rows = await repo.list<BrandElement>('brand_element', {
      where: {
        and: [
          { field: 'owner_kind', op: 'eq', value: kind },
          { field: 'owner_id', op: 'eq', value: id }
        ]
      },
      sort: ['sort', 'id']
    });
    return sortElements(rows);
  } catch {
    return [];
  }
}

/**
 * Elements for an owner, falling back up the parent chain.
 *
 * All-or-nothing per owner, exactly like the palette and the font faces: a
 * half-inherited set (our pattern, their gradient) is not something anyone
 * means, and it would make "where is this from" unanswerable per row.
 */
export async function resolveElements(
  kind: BrandOwnerKind,
  startId: number
): Promise<{ elements: BrandElement[]; from: BrandSource }> {
  const { collection, parent } = shape(kind);
  let currentId: number | null = startId;
  const seen = new Set<number>();

  for (let depth = 0; depth < 8 && currentId != null; depth++) {
    if (seen.has(currentId)) break;
    seen.add(currentId);

    const own = await listOwnElements(kind, currentId);

    let row: Record<string, unknown> & { id: number; name?: string | null };
    try {
      row = (await repo.get(collection, currentId, {
        fields: ['id', 'name', parent, 'brand_standalone']
      })) as unknown as typeof row;
    } catch {
      break;
    }
    const from: BrandSource = { kind, id: row.id, name: row.name ?? `#${row.id}` };
    if (own.length > 0) return { elements: own, from };

    // Standalone: having no elements is a real answer here.
    if (depth === 0 && row.brand_standalone === true) break;

    const p = row[parent];
    currentId = typeof p === 'number' ? p : ((p as { id?: number } | null)?.id ?? null);
  }
  return { elements: [], from: null };
}

export async function createBrandElement(patch: Partial<BrandElement>): Promise<BrandElement> {
  return repo.create<BrandElement>('brand_element', patch as Record<string, unknown>);
}
export async function updateBrandElement(id: number, patch: Partial<BrandElement>): Promise<void> {
  await repo.update('brand_element', id, patch as Record<string, unknown>);
}
export async function deleteBrandElement(id: number): Promise<void> {
  await repo.remove('brand_element', id);
}

// ── Adoption ─────────────────────────────────────────────────────────────
// Take a copy of an inherited brand so it can be edited here without
// touching the ancestor it came from.
//
// This exists because "inherited" and "editable" were the same screen. The
// palette, logo-asset and brand-asset lists all render the ANCESTOR's rows,
// complete with the ancestor's row ids, and their remove buttons deleted by
// id — so clearing a swatch on a sub-project deleted it from the parent and
// from every other project inheriting it. Adoption makes the fork explicit
// and gives those controls rows they actually own.
//
// Only what is still inherited gets copied; anything already set here is
// left alone, so adopting twice is harmless and never clobbers local edits.

export type AdoptionSummary = {
  colors: number;
  logoFields: number;
  font: number;
  paletteRows: number;
  logoRows: number;
  fontFaces: number;
  assets: number;
  elements: number;
};

/** Is anything here still coming from an ancestor? */
export async function brandInheritance(
  kind: BrandOwnerKind,
  id: number
): Promise<{ inherited: boolean; from: string | null }> {
  const [resolved, palette, cells, faces, elements] = await Promise.all([
    resolveBrand(kind, id),
    resolvePalette(kind, id),
    resolveLogoAssets(kind, id),
    resolveFontFaces(kind, id).catch(() => ({ faces: [], from: null as BrandSource | null })),
    resolveElements(kind, id).catch(() => ({ elements: [] as BrandElement[], from: null as BrandSource | null }))
  ]);
  // Every distinct ancestor contributing something, not just the first one.
  // Dafna 10 takes its colours from KLAK but its palette from Dafna, and
  // naming only the first made the banner state something untrue.
  const sources = new Set<string>();
  const foreign = (s: BrandSource | null | undefined) => {
    if (!s || s.id === id) return false;
    sources.add(s.name);
    return true;
  };

  let inherited = false;
  for (const r of BRAND_COLOR_ROLES) {
    if (resolved.colors[r.field] && foreign(resolved.colorFrom[r.field])) inherited = true;
  }
  for (const r of BRAND_LOGO_ROLES) {
    if (resolved.logos[r.field] && foreign(resolved.logoFrom[r.field])) inherited = true;
  }
  if (resolved.font && foreign(resolved.fontFrom)) inherited = true;
  if (palette.colors.length > 0 && foreign(palette.from)) inherited = true;
  if ([...cells.values()].some((c) => foreign(c.from))) inherited = true;
  if ((faces.faces?.length ?? 0) > 0 && foreign(faces.from)) inherited = true;
  if (resolved.assets.length > 0 && foreign(resolved.assetsFrom)) inherited = true;
  // Elements count too, or a brand whose only inherited thing is a pattern
  // would never be offered the fork — and its Remove buttons would stay
  // hidden with no way to explain why.
  if (elements.elements.length > 0 && foreign(elements.from)) inherited = true;

  const names = [...sources];
  const from =
    names.length === 0 ? null
    : names.length === 1 ? names[0]
    : names.length === 2 ? `${names[0]} and ${names[1]}`
    : `${names[0]} and ${names.length - 1} others`;
  return { inherited, from };
}

/**
 * Copy every inherited part of the brand onto this owner.
 *
 * Files are referenced, not duplicated — a copied logo row points at the same
 * Directus file id. So adoption is cheap and cannot orphan or double-store an
 * upload; deleting the copy later leaves the ancestor's file intact.
 */
/** Mark the brand as its own, so nothing resolves past it. */
export async function setBrandStandalone(
  kind: BrandOwnerKind,
  id: number,
  standalone: boolean
): Promise<void> {
  const { collection } = shape(kind);
  await repo.update(collection, id, { brand_standalone: standalone });
}

/**
 * Detach with nothing carried over — the "start from scratch" half of the fork.
 *
 * Only the flag is written. The owner's OWN values are left exactly as they
 * are (usually none, which is the point); what stops is the walk into the
 * parent. Deliberately not a "clear everything" — if you had set a colour of
 * your own before choosing this, losing it would be a surprise, and the
 * inherited values were never yours to delete.
 */
export async function startBrandFromScratch(kind: BrandOwnerKind, id: number): Promise<void> {
  await setBrandStandalone(kind, id, true);
}

/**
 * Detach WITH the parent's values copied in — "start from <parent>'s".
 *
 * Order matters: copy first, then set the flag. Flag-first would make
 * adoptBrand resolve against a brand that no longer inherits anything, so it
 * would find nothing to copy.
 */
export async function forkBrandFromParent(
  kind: BrandOwnerKind,
  id: number
): Promise<AdoptionSummary> {
  const summary = await adoptBrand(kind, id);
  await setBrandStandalone(kind, id, true);
  return summary;
}

export async function adoptBrand(kind: BrandOwnerKind, id: number): Promise<AdoptionSummary> {
  const out: AdoptionSummary = {
    colors: 0, logoFields: 0, font: 0,
    paletteRows: 0, logoRows: 0, fontFaces: 0, assets: 0, elements: 0
  };
  const owner: BrandOwner = { kind, id, name: '' };

  const [resolved, ownPalette, palette, cells, ownFaces, faces, ownElements, elements] = await Promise.all([
    resolveBrand(kind, id),
    listOwnPalette(kind, id),
    resolvePalette(kind, id),
    resolveLogoAssets(kind, id),
    listOwnFontFaces(kind, id),
    resolveFontFaces(kind, id).catch(() => ({ faces: [] as BrandFontFace[], from: null as BrandSource | null })),
    listOwnElements(kind, id),
    resolveElements(kind, id).catch(() => ({ elements: [] as BrandElement[], from: null as BrandSource | null }))
  ]);

  const foreign = (s: BrandSource | null | undefined) => !!s && s.id !== id;

  // 1. Scalar colour roles. Written one at a time through saveBrandField so
  //    the late-field retry it already carries still applies — a single
  //    combined patch would be rejected wholesale for one unknown column.
  for (const r of BRAND_COLOR_ROLES) {
    const v = resolved.colors[r.field];
    if (v && foreign(resolved.colorFrom[r.field])) {
      await saveBrandField(owner, r.field, v);
      out.colors++;
    }
  }

  // 2. Scalar logo columns (the legacy single-file-per-role shape).
  for (const r of BRAND_LOGO_ROLES) {
    const v = resolved.logos[r.field];
    if (v && foreign(resolved.logoFrom[r.field])) {
      await saveBrandField(owner, r.field, v);
      out.logoFields++;
    }
  }

  // 3. Font family name.
  if (resolved.font && foreign(resolved.fontFrom)) {
    await saveBrandField(owner, 'brand_font', resolved.font);
    out.font++;
  }

  // 4. Palette rows — only when the whole palette is inherited. A project with
  //    its own rows has already forked; topping it up with the ancestor's
  //    would silently re-introduce colours that were deliberately dropped.
  if (ownPalette.length === 0 && foreign(palette.from)) {
    for (const c of palette.colors) {
      // Negative ids are entries read out of an ancestor's legacy
      // `brand_colors` JSON rather than real rows. They are still copied —
      // MATERIALISED into real rows owned here. Skipping them was wrong twice
      // over: the palette silently failed to adopt, and because
      // brandInheritance still counted it as inherited the banner could never
      // clear, so Adopt looked broken. Verified on Dafna 10, whose whole
      // palette is one legacy entry inherited from Dafna.
      await createPaletteColor({
        owner_kind: kind, owner_id: id,
        name: c.name, group: c.group ?? 'support',
        hex: c.hex, hex_strong: c.hex_strong ?? null,
        notes: c.notes ?? null, sort: c.sort ?? null
      });
      out.paletteRows++;
    }
  }

  // 4b. Brand elements. Same all-or-nothing rule as the palette: if this owner
  //     already has any of its own, the inherited set was never showing, so
  //     there is nothing to take a copy of.
  if (ownElements.length === 0 && elements.from && elements.from.id !== id) {
    for (const el of elements.elements) {
      await createBrandElement({
        owner_kind: kind, owner_id: id,
        kind: el.kind, name: el.name, notes: el.notes ?? null,
        file_id: el.file_id ?? null,
        gradient_stops: el.gradient_stops ?? null,
        gradient_angle: el.gradient_angle ?? null,
        tile_width: el.tile_width ?? null,
        on_dark: el.on_dark ?? false,
        sort: el.sort ?? null
      });
      out.elements++;
    }
  }

  // 5. Logo rows, per cell — these are keyed by lockup+treatment, so copying
  //    only the foreign ones cannot collide with a cell already set here.
  // resolveLogoAssets returns a Map keyed by lockup+treatment, not an array.
  for (const cell of cells.values()) {
    if (!foreign(cell.from) || cell.legacy || !cell.fileId) continue;
    await createLogoAsset({
      owner_kind: kind, owner_id: id,
      lockup: cell.lockup, treatment: cell.treatment,
      file_id: cell.fileId, notes: cell.notes ?? null
    });
    out.logoRows++;
  }

  // 6. Font faces, same all-or-nothing rule as the palette.
  if (ownFaces.length === 0 && foreign(faces.from)) {
    for (const f of faces.faces ?? []) {
      await createFontFace({
        owner_kind: kind, owner_id: id,
        family: f.family, role: f.role ?? null,
        weight: f.weight ?? null, style: f.style ?? null,
        file_id: f.file_id ?? null, css_url: f.css_url ?? null,
        source_url: f.source_url ?? null, license: f.license ?? null,
        notes: f.notes ?? null, sort: f.sort ?? null
      });
      out.fontFaces++;
    }
  }

  // 7. Extra brand assets. Projects only — organizations have no such list.
  if (kind === 'project' && resolved.assets.length > 0 && foreign(resolved.assetsFrom)) {
    const own = await listProjectBrandAssets(id);
    if (own.length === 0) {
      for (const a of resolved.assets) {
        if (!a.file_id) continue;
        // addProjectBrandAsset takes no `sort` — the gallery orders by
        // sort then date_created, so copies land in creation order.
        await addProjectBrandAsset({
          project_id: id, file_id: a.file_id, label: a.label ?? null
        });
        out.assets++;
      }
    }
  }

  return out;
}

// ── Contrast, shared ─────────────────────────────────────────────────────
// The brand book computes this for its table; the editor needs the same
// answer at the point of choosing. One implementation, so the two can never
// disagree about whether a colour passes.

export function relativeLuminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la == null || lb == null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export type ContrastVerdict = {
  ratio: number | null;
  /** AAA | AA | large | fail */
  level: 'AAA' | 'AA' | 'large' | 'fail';
  label: string;
  /** What it may be used for at this ratio — the useful half of the answer. */
  usable: string;
  ok: boolean;
};

/**
 * A verdict scoped to the USE, not a pass/fail stamp.
 *
 * A colour under 3:1 is still a legitimate brand colour — Stoðlitur 3 is
 * 1.07:1 on white and is unmistakably part of KLAK. It just cannot hold
 * text. Blocking it would be wrong; saying nothing would be worse.
 */
export function judgeContrast(fg: string, bg: string): ContrastVerdict {
  const ratio = contrastRatio(fg, bg);
  if (ratio == null) return { ratio: null, level: 'fail', label: '—', usable: '', ok: false };
  if (ratio >= 7) return { ratio, level: 'AAA', label: 'AAA', usable: 'Any text, any size', ok: true };
  if (ratio >= 4.5) return { ratio, level: 'AA', label: 'AA', usable: 'Body text and up', ok: true };
  if (ratio >= 3)
    return { ratio, level: 'large', label: 'AA large', usable: 'Large text, icons, borders — not body text', ok: false };
  return { ratio, level: 'fail', label: 'Fails', usable: 'Fills and decoration only — never text', ok: false };
}
