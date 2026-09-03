// One brand, resolved, for either kind of owner.
//
// The route carries the kind in the path rather than sniffing it, because
// project 12 and organization 12 are different things and a brand book that
// guesses wrong is worse than one that 404s.
import { error } from '@sveltejs/kit';
import {
  resolveBrand,
  resolveFontFaces,
  resolveLogoAssets,
  resolveElements,
  type LogoCell,
  type BrandElement,
  type BrandOwnerKind,
  type ResolvedBrand,
  type BrandOwner,
  type BrandFontFace,
  type BrandSource
} from '$lib/brand';
import { repo } from '$lib/data/repo';

export const ssr = false;

export type BrandBookData = {
  owner: BrandOwner;
  brand: ResolvedBrand;
  fonts: BrandFontFace[];
  fontsFrom: BrandSource;
  /** The lockup × treatment grid, flattened. Every uploaded logo, not just the
   *  one-per-role legacy columns. */
  logoCells: LogoCell[];
  /** Patterns, gradients, graphic elements and photography direction. */
  elements: BrandElement[];
  elementsFrom: BrandSource;
  /** The owner's OWN row. The book renders the resolved brand, but the
   *  editor needs to know which values are this owner's and which are
   *  inherited — that distinction only exists in the raw row. */
  row: Record<string, unknown> & { id: number; name?: string | null };
};

export async function load({ params }): Promise<BrandBookData> {
  const kind = params.kind as BrandOwnerKind;
  if (kind !== 'project' && kind !== 'organization') throw error(404, 'Unknown brand owner');
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw error(404, 'Brand not found');

  try {
    const collection = kind === 'project' ? 'Project' : 'organization';
    // The whole row, not just id+name: edit mode mounts the same BrandCard
    // the project and org pages use, and that card distinguishes an owner's
    // own value from an inherited one by reading the raw columns.
    const row = (await repo.get(collection, id, {
      fields: ['*']
    })) as unknown as Record<string, unknown> & { id: number; name?: string | null };

    // Resolves from the owner itself, not its parent: the book shows the
    // brand as it applies here, inherited or not.
    // The cell grid, not just the legacy logo columns. The book used to read
    // BRAND_LOGO_ROLES, which has exactly one slot per role — so a brand with
    // an original AND an inverted landscape showed a single "Landscape", and
    // the book disagreed with the editor sitting directly above it.
    const [brand, fonts, cells, els] = await Promise.all([
      resolveBrand(kind, id),
      resolveFontFaces(kind, id),
      resolveLogoAssets(kind, id).catch(() => new Map<string, LogoCell>()),
      resolveElements(kind, id).catch(() => ({ elements: [] as BrandElement[], from: null as BrandSource }))
    ]);
    return {
      owner: { kind, id, name: row.name ?? `#${id}` },
      brand,
      // A Map does not survive serialization to the client; send entries.
      logoCells: [...cells.values()],
      elements: els.elements,
      elementsFrom: els.from,
      fonts: fonts.faces,
      fontsFrom: fonts.from,
      row
    };
  } catch {
    throw error(404, 'Brand not found');
  }
}
