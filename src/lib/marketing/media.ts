// The medium vocabulary, as types and pure helpers.
//
// NO $lib imports, deliberately — same constraint as insights/metrics.ts, so
// bare `node --test` can run the test files. data.ts is the side of the wall
// that talks to Directus.
//
// A medium is how the money was spent, not who ran it: `meta_instagram` and
// `ooh` sit in one list so a split by medium can cross paid and manual. The
// list lives in mk_medium, seeded by scripts/add-marketing-media.sh, because a
// new medium should be a row rather than a deploy.

export type MediumKind =
  | 'paid_social'
  | 'search'
  | 'display'
  | 'video'
  | 'ooh'
  | 'broadcast'
  | 'print'
  | 'sponsorship'
  | 'owned'
  | 'other';

export type Medium = {
  code: string;
  label: string;
  kind: MediumKind | string;
  sort: number;
  /** Offer it when entering spend by hand — false for the Meta platforms,
   *  which only ever arrive from the sync. */
  manualEntry: boolean;
  /** Meta `publisher_platform` this medium mirrors, when it mirrors one. */
  metaPlatform: string | null;
  isEnabled: boolean;
};

/** Meta spend on days no platform breakdown covers. Not a real platform —
 *  a visible admission that the split isn't known for those days, which is
 *  the whole reason Meta rows carry no medium column of their own. */
export const MEDIUM_UNSPLIT = 'meta_unsplit';

/** A publisher_platform the vocabulary doesn't know yet. Meta invents these
 *  faster than anyone reseeds a list; landing them here keeps the arithmetic
 *  whole instead of dropping the spend. */
export const MEDIUM_META_FALLBACK = 'meta_other';

export const KIND_LABELS: Record<string, string> = {
  paid_social: 'Paid social',
  search: 'Search',
  display: 'Display',
  video: 'Video',
  ooh: 'Out of home',
  broadcast: 'Broadcast',
  print: 'Print',
  sponsorship: 'Sponsorship',
  owned: 'Owned',
  other: 'Other'
};

/** publisher_platform → medium code, from the vocabulary itself. */
export function mediumForPlatform(mediums: Medium[], platform: string | null | undefined): string {
  if (!platform) return MEDIUM_META_FALLBACK;
  const want = platform.trim().toLowerCase();
  const hit = mediums.find((m) => (m.metaPlatform ?? '').trim().toLowerCase() === want);
  return hit?.code ?? MEDIUM_META_FALLBACK;
}

/** Never returns an empty string: an unknown code reads as itself, so a
 *  report shows `meta_threads` rather than a blank row you can't chase. */
export function mediumLabel(mediums: Medium[], code: string | null | undefined): string {
  if (!code) return 'Unassigned';
  return mediums.find((m) => m.code === code)?.label ?? code;
}

export function mediumKind(mediums: Medium[], code: string | null | undefined): string | null {
  if (!code) return null;
  return mediums.find((m) => m.code === code)?.kind ?? null;
}

export function sortMediums(mediums: Medium[]): Medium[] {
  return [...mediums].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label, 'is'));
}

/** The list a spend form should offer. */
export function manualMediums(mediums: Medium[]): Medium[] {
  return sortMediums(mediums.filter((m) => m.isEnabled && m.manualEntry));
}

/** Group a long vocabulary for a picker, in vocabulary order. */
export function mediumsByKind(mediums: Medium[]): Array<{ kind: string; label: string; mediums: Medium[] }> {
  const groups = new Map<string, Medium[]>();
  for (const m of sortMediums(mediums)) {
    if (!groups.has(m.kind)) groups.set(m.kind, []);
    groups.get(m.kind)!.push(m);
  }
  return [...groups.entries()].map(([kind, list]) => ({
    kind,
    label: KIND_LABELS[kind] ?? kind,
    mediums: list
  }));
}
