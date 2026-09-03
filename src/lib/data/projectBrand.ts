// Project brand segment
//
// Per-project brand assets and colours.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { Project } from '$lib/data/types';

// ── Project brand segment ───────────────────────────────────────────
// Optional per-project brand identity: palette swatches, a logo file
// and a small asset gallery (wordmarks, banners, pattern tiles).
// Edited on the project page's Brand card; the image studio and
// Evergreen can pull a project's palette + assets from here.
export type ProjectBrandColor = { hex: string; label?: string | null };

export type ProjectBrandAsset = {
  id: number;
  project_id?: number | Project | null;
  file_id?: string | null;
  label?: string | null;
  sort?: number | null;
  date_created?: string | null;
};

export async function listProjectBrandAssets(projectId: number): Promise<ProjectBrandAsset[]> {
  return await repo.list<ProjectBrandAsset>('project_brand_asset', {
    where: { field: 'project_id', op: 'eq', value: projectId },
    sort: ['sort', 'date_created']
  });
}

export async function addProjectBrandAsset(patch: {
  project_id: number;
  file_id: string;
  label?: string | null;
}): Promise<ProjectBrandAsset> {
  return await repo.create<ProjectBrandAsset>('project_brand_asset', patch as Record<string, unknown>);
}

export async function updateProjectBrandAsset(
  id: number,
  patch: Partial<ProjectBrandAsset>
): Promise<ProjectBrandAsset> {
  return await repo.update<ProjectBrandAsset>('project_brand_asset', id, patch as Record<string, unknown>);
}

export async function deleteProjectBrandAsset(id: number): Promise<void> {
  await repo.remove('project_brand_asset', id);
}


/** A project's brand with parent-chain inheritance resolved per facet.
 *  Each facet (colors / logo / assets) comes from the nearest project
 *  up the parent chain that has it set; `from` carries that project's
 *  name when it isn't the project itself. */
export type ResolvedProjectBrand = {
  colors: ProjectBrandColor[];
  colorsFrom: { id: number; name: string } | null;
  logoId: string | null;
  logoFrom: { id: number; name: string } | null;
  assets: ProjectBrandAsset[];
  assetsFrom: { id: number; name: string } | null;
  /** Structured logo roles (Original = logoId above). */
  logoInvertedId: string | null;
  logoInvertedFrom: { id: number; name: string } | null;
  logoBlackId: string | null;
  logoBlackFrom: { id: number; name: string } | null;
  logoLandscapeId: string | null;
  logoLandscapeFrom: { id: number; name: string } | null;
  logoVerticalId: string | null;
  logoVerticalFrom: { id: number; name: string } | null;
  logoSimpleId: string | null;
  logoSimpleFrom: { id: number; name: string } | null;
  /** Structured colour roles. */
  primary: string | null;
  primaryFrom: { id: number; name: string } | null;
  bgLight: string | null;
  bgLightFrom: { id: number; name: string } | null;
  bgDark: string | null;
  bgDarkFrom: { id: number; name: string } | null;
  font: string | null;
  fontFrom: { id: number; name: string } | null;
};

/** The small-size avatar for a project: the Simple mark, falling back to
 *  the Original logo. Used wherever a project shows at avatar scale. */
export function projectMarkOf(p: { brand_logo_simple?: string | null; brand_logo?: string | null }): string | null {
  return p.brand_logo_simple ?? p.brand_logo ?? null;
}

/** Resolve each project's effective mark (own Simple/Original, else the
 *  nearest ancestor's) from a FLAT list that already contains the whole
 *  parent chain — e.g. listProjectsForTree(). Pure + in-memory: no extra
 *  requests. Returns id → fileId (or null). */
export function resolveProjectMarksFromFlat(
  rows: Array<{ id: number; parent_id?: number | { id: number } | null; brand_logo_simple?: string | null; brand_logo?: string | null }>
): Map<number, string | null> {
  const byId = new Map<number, { parent: number | null; mark: string | null }>();
  for (const r of rows) {
    const parent = r.parent_id == null ? null : typeof r.parent_id === 'object' ? (r.parent_id.id ?? null) : r.parent_id;
    byId.set(r.id, { parent, mark: projectMarkOf(r) });
  }
  const out = new Map<number, string | null>();
  for (const r of rows) {
    let cur: number | null = r.id;
    const seen = new Set<number>();
    let mark: string | null = null;
    for (let i = 0; i < 16 && cur != null && !seen.has(cur); i++) {
      seen.add(cur);
      const node = byId.get(cur);
      if (!node) break;
      if (node.mark) { mark = node.mark; break; }
      cur = node.parent;
    }
    out.set(r.id, mark);
  }
  return out;
}

/** Batch-resolve effective marks for an arbitrary set of project ids
 *  (e.g. search results), fetching the ids plus any missing ancestors,
 *  then resolving in-memory. A couple of `_in` queries, no per-row walk. */
export async function resolveProjectMarks(projectIds: number[]): Promise<Map<number, string | null>> {
  const wanted = [...new Set(projectIds)].filter((v) => v != null);
  if (wanted.length === 0) return new Map();
  const known = new Map<number, { id: number; parent_id: number | { id: number } | null; brand_logo_simple: string | null; brand_logo: string | null }>();
  let frontier = wanted;
  for (let depth = 0; depth < 16 && frontier.length > 0; depth++) {
    const rows = await repo.list<{ id: number; parent_id: number | { id: number } | null; brand_logo_simple: string | null; brand_logo: string | null }>('Project', {
      where: { field: 'id', op: 'in', value: frontier },
      fields: ['id', 'brand_logo_simple', 'brand_logo', { parent_id: ['id'] }]
    });
    const next: number[] = [];
    for (const r of rows) {
      if (known.has(r.id)) continue;
      known.set(r.id, r);
      const par = r.parent_id == null ? null : typeof r.parent_id === 'object' ? (r.parent_id.id ?? null) : r.parent_id;
      if (par != null && !known.has(par)) next.push(par);
    }
    frontier = next;
  }
  const full = resolveProjectMarksFromFlat([...known.values()]);
  const out = new Map<number, string | null>();
  for (const id of wanted) out.set(id, full.get(id) ?? null);
  return out;
}

/** Pick a readable text colour (near-black / near-white) for a hex
 *  background via WCAG relative luminance. Used wherever the structured
 *  brand roles are applied so text contrast never has to be entered. */
export function textColorFor(bgHex: string | null | undefined): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((bgHex ?? '').trim());
  if (!m) return '#111111';
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? '#111111' : '#FFFFFF';
}

export async function resolveProjectBrand(projectId: number): Promise<ResolvedProjectBrand> {
  const out: ResolvedProjectBrand = {
    colors: [],
    colorsFrom: null,
    logoId: null,
    logoFrom: null,
    assets: [],
    assetsFrom: null,
    logoInvertedId: null,
    logoInvertedFrom: null,
    logoBlackId: null,
    logoBlackFrom: null,
    logoLandscapeId: null,
    logoLandscapeFrom: null,
    logoVerticalId: null,
    logoVerticalFrom: null,
    logoSimpleId: null,
    logoSimpleFrom: null,
    primary: null,
    primaryFrom: null,
    bgLight: null,
    bgLightFrom: null,
    bgDark: null,
    bgDarkFrom: null,
    font: null,
    fontFrom: null
  };
  const BASE_FIELDS = [
    'id', 'name', 'parent_id', 'brand_colors', 'brand_logo',
    'brand_logo_inverted', 'brand_logo_black',
    'brand_logo_landscape', 'brand_logo_vertical', 'brand_logo_simple',
    'brand_primary', 'brand_bg_light', 'brand_bg_dark'
  ];
  // brand_font arrived after the rest of the brand fields. Directus rejects
  // the WHOLE request for one unknown field, so asking for it against a
  // database where the migration has not run yet would take the entire
  // Brand card down — not just the typeface. One retry without it makes the
  // code safe to deploy in either order.
  let askFont = true;

  let currentId: number | null = projectId;
  for (let depth = 0; depth < 8 && currentId != null; depth++) {
    const read = (withFont: boolean) =>
      repo.get<typeof row>('Project', currentId as number, {
        fields: withFont ? [...BASE_FIELDS, 'brand_font'] : BASE_FIELDS
      });
    let row: Pick<Project, 'id' | 'name' | 'parent_id' | 'brand_colors' | 'brand_logo' | 'brand_logo_inverted' | 'brand_logo_black' | 'brand_logo_landscape' | 'brand_logo_vertical' | 'brand_logo_simple' | 'brand_primary' | 'brand_bg_light' | 'brand_bg_dark' | 'brand_font'>;
    let fetched: typeof row | null;
    try {
      fetched = await read(askFont);
    } catch (e) {
      if (!askFont) throw e;
      askFont = false;
      fetched = await read(false);
    }
    if (!fetched) break; // project id not found — stop the parent-chain walk
    row = fetched;
    // Always record the source — callers decide whether "self" counts
    // as inherited (the Brand card resolves starting at the parent).
    const from = { id: row.id, name: row.name ?? `#${row.id}` };

    if (out.colors.length === 0 && (row.brand_colors?.length ?? 0) > 0) {
      out.colors = row.brand_colors!;
      out.colorsFrom = from;
    }
    if (!out.logoId && row.brand_logo) {
      out.logoId = row.brand_logo;
      out.logoFrom = from;
    }
    if (!out.logoInvertedId && row.brand_logo_inverted) {
      out.logoInvertedId = row.brand_logo_inverted;
      out.logoInvertedFrom = from;
    }
    if (!out.logoBlackId && row.brand_logo_black) {
      out.logoBlackId = row.brand_logo_black;
      out.logoBlackFrom = from;
    }
    if (!out.logoLandscapeId && row.brand_logo_landscape) {
      out.logoLandscapeId = row.brand_logo_landscape;
      out.logoLandscapeFrom = from;
    }
    if (!out.logoVerticalId && row.brand_logo_vertical) {
      out.logoVerticalId = row.brand_logo_vertical;
      out.logoVerticalFrom = from;
    }
    if (!out.logoSimpleId && row.brand_logo_simple) {
      out.logoSimpleId = row.brand_logo_simple;
      out.logoSimpleFrom = from;
    }
    if (!out.primary && row.brand_primary) {
      out.primary = row.brand_primary;
      out.primaryFrom = from;
    }
    if (!out.bgLight && row.brand_bg_light) {
      out.bgLight = row.brand_bg_light;
      out.bgLightFrom = from;
    }
    if (!out.bgDark && row.brand_bg_dark) {
      out.bgDark = row.brand_bg_dark;
      out.bgDarkFrom = from;
    }
    if (!out.font && row.brand_font) {
      out.font = row.brand_font;
      out.fontFrom = from;
    }
    if (out.assets.length === 0) {
      const assets = await listProjectBrandAssets(row.id);
      if (assets.length > 0) {
        out.assets = assets;
        out.assetsFrom = from;
      }
    }
    const done =
      out.colors.length > 0 && out.logoId && out.assets.length > 0 &&
      out.logoInvertedId && out.logoBlackId &&
      out.logoLandscapeId && out.logoVerticalId && out.logoSimpleId &&
      out.primary && out.bgLight && out.bgDark;
    if (done) break;
    currentId = typeof row.parent_id === 'object' ? (row.parent_id?.id ?? null) : (row.parent_id ?? null);
  }
  return out;
}

// Personal finances — moved to $lib/data/finances.ts, re-exported at the end of
// this file. See docs/opening-up-twin.md.
