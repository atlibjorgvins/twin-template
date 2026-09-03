// Where an organization sits, geographically.
//
// TWO LISTS, deliberately. The eight Icelandic landshlutar are the Rannís
// feed's own acronyms and are matched against it, so that list must stay
// exactly what Rannís emits — a grant award can only be in one of those.
// Organizations, though, are not all Icelandic, and a foreign one had no
// value it could honestly take.
//
// So foreign buckets live in a separate list, joined only where an
// organization is being edited. Every foreign code is prefixed `X-`: partly to
// mark it as not-from-Rannís, and partly because the obvious short codes
// collide — "North America" wants NA, which is already Norðurland eystra.
// Silently overwriting that would move real orgs to the wrong side of the
// Atlantic.
//
// No imports on purpose — this is what the tests need (npm run test:regions).

export type RegionChoice = { value: string; label: string; group?: string };

/** Landshluti — the 8 Icelandic regions. Acronyms match the Rannís feed. */
export const REGION_CHOICES: ReadonlyArray<RegionChoice> = [
  { value: 'HB', label: 'Höfuðborgarsvæðið' },
  { value: 'RN', label: 'Suðurnes' },
  { value: 'VL', label: 'Vesturland' },
  { value: 'VF', label: 'Vestfirðir' },
  { value: 'NV', label: 'Norðurland vestra' },
  { value: 'NA', label: 'Norðurland eystra' },
  { value: 'AL', label: 'Austurland' },
  { value: 'SL', label: 'Suðurland' }
];

/**
 * Coarse buckets for organizations outside Iceland.
 *
 * Deliberately few and deliberately coarse: the precise answer already has a
 * home in `organization.country`, and a long-tailed region list makes "orgs by
 * region" unreadable. This axis exists to group, not to pinpoint.
 */
export const FOREIGN_REGION_CHOICES: ReadonlyArray<RegionChoice> = [
  { value: 'X-NORDIC', label: 'Norðurlönd' },
  { value: 'X-EUROPE', label: 'Evrópa' },
  { value: 'X-UK', label: 'Bretland' },
  { value: 'X-NAM', label: 'Norður-Amerika' },
  { value: 'X-ASIA', label: 'Asía' },
  { value: 'X-GLOBAL', label: 'Annað / alþjóðlegt' }
];

/** Everything an organization may be set to, grouped for the picker. */
export const ALL_REGION_CHOICES: ReadonlyArray<RegionChoice> = [
  ...REGION_CHOICES.map((r) => ({ ...r, group: 'Ísland' })),
  ...FOREIGN_REGION_CHOICES.map((r) => ({ ...r, group: 'Erlent' }))
];

/** True for a code outside Iceland — the `X-` prefix is the whole test. */
export const isForeignRegion = (code?: string | null): boolean =>
  typeof code === 'string' && code.startsWith('X-');

/**
 * Human label for a stored code.
 *
 * An unknown code is returned as-is rather than blanked: a value that arrived
 * from an import is data, and hiding it would make the row look empty while
 * the database says otherwise.
 */
export function regionLabel(acronym?: string | null): string | null {
  if (!acronym) return null;
  const c = ALL_REGION_CHOICES.find((r) => r.value === acronym);
  return c ? `${c.label} (${c.value})` : acronym;
}
