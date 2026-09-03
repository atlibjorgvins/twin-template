// Vocabulary — the option lists, and the labels for them
//
// The closed sets a record can hold (lifecycle, industry, size bucket, grant
// category, sponsor tier, activity kind, project colours) together with the
// functions that turn a stored value into something readable.
//
// Separate from types.ts because these are runtime values, and separate from the
// domain modules because they are shared: orgSizeLabel is read by the org page,
// the people list and the insights dashboard alike.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import type { ActivityKind, ActivityKindKey, Note, OrgLifecycleStatus, OrgSizeBucket, Organization, Project, ProjectOrganization, ProjectPerson, ProjectRole, SponsorTier } from '$lib/data/types';

export const ORG_LIFECYCLE_OPTIONS: ReadonlyArray<{ value: OrgLifecycleStatus; label: string; color: string }> = [
  { value: 'active',     label: 'Active',     color: '#3F8A5F' },
  { value: 'pre_launch', label: 'Pre-launch', color: '#6B5ADB' },
  { value: 'pivoting',   label: 'Pivoting',   color: '#C6762A' },
  { value: 'dormant',    label: 'Dormant',    color: '#7A8593' },
  { value: 'acquired',   label: 'Acquired',   color: '#1D6BFE' },
  { value: 'merged',     label: 'Merged',     color: '#9C4DCC' },
  // Rebrand: same legal entity, new identity. Old row stays
  // around (we keep its historical relations); successor_id points
  // at the new identity. Distinct from `merged` where relations
  // move and the old row is archived.
  { value: 'rebranded',  label: 'Rebranded',  color: '#0EA5A5' },
  { value: 'dissolved',  label: 'Dissolved',  color: '#5C6B7A' },
  { value: 'bankrupt',   label: 'Bankrupt',   color: '#D44A6B' }
];

export function orgLifecycleLabel(v: string | null | undefined): string {
  if (!v) return '';
  return ORG_LIFECYCLE_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

export function orgLifecycleColor(v: string | null | undefined): string | null {
  if (!v) return null;
  return ORG_LIFECYCLE_OPTIONS.find((o) => o.value === v)?.color ?? null;
}

export const ORG_SIZE_LABEL: Record<string, string> = {
  '1': 'Solo',
  '2-10': '2–10',
  '11-50': '11–50',
  '51-200': '51–200',
  '201-500': '201–500',
  '501-1000': '501–1,000',
  '1001-5000': '1,001–5,000',
  '5001-10000': '5,001–10,000',
  '10001+': '10,001+'
};

/**
 * Canonical industry list, based on LinkedIn's top-level industry groups
 * with one Iceland-specific split: Fisheries & Aquaculture is broken out
 * from Farming because it's a major Icelandic sector. Anything that doesn't
 * fit (e.g. "Nonprofit", "Startup accelerator") goes on the org as a Tag,
 * not as an industry.
 *
 * `value` is what's stored. `label` is what's displayed.
 */
export const ORG_INDUSTRY_OPTIONS = [
  { value: 'accommodation',       label: 'Accommodation Services' },
  { value: 'administrative',      label: 'Administrative & Support Services' },
  { value: 'construction',        label: 'Construction' },
  { value: 'consumer_services',   label: 'Consumer Services' },
  { value: 'education',           label: 'Education' },
  { value: 'entertainment',       label: 'Entertainment Providers' },
  { value: 'farming_forestry',    label: 'Farming & Forestry' },
  { value: 'financial_services',  label: 'Financial Services' },
  { value: 'fisheries',           label: 'Fisheries & Aquaculture' },
  { value: 'government',          label: 'Government Administration' },
  { value: 'healthcare',          label: 'Hospitals & Health Care' },
  { value: 'manufacturing',       label: 'Manufacturing' },
  { value: 'oil_gas_mining',      label: 'Oil, Gas & Mining' },
  { value: 'professional_services', label: 'Professional Services' },
  { value: 'real_estate',         label: 'Real Estate' },
  { value: 'retail',              label: 'Retail' },
  { value: 'technology',          label: 'Technology, Information & Media' },
  { value: 'transportation',      label: 'Transportation & Logistics' },
  { value: 'utilities',           label: 'Utilities' },
  { value: 'wholesale',           label: 'Wholesale' }
] as const;

/** Quick lookup of canonical values, for migration + filter. */
export const ORG_INDUSTRY_VALUES = new Set(ORG_INDUSTRY_OPTIONS.map((o) => o.value));

/** Display the friendly label for an industry value, falling back to the
 *  raw stored string if it's not in the canonical list (legacy data). */
export function industryLabel(value?: string | null): string | null {
  if (!value) return null;
  return ORG_INDUSTRY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export const ORG_SIZE_OPTIONS = [
  { label: 'Solo (1)', value: '1' },
  { label: '2–10', value: '2-10' },
  { label: '11–50', value: '11-50' },
  { label: '51–200', value: '51-200' },
  { label: '201–500', value: '201-500' },
  { label: '501–1,000', value: '501-1000' },
  { label: '1,001–5,000', value: '1001-5000' },
  { label: '5,001–10,000', value: '5001-10000' },
  { label: '10,001+', value: '10001+' }
];

/** Pick a size bucket from an exact employee_count. */
/** Curated colour palette for project accents. Picked to harmonise
 *  with the Helga ramp — muted-but-distinct so multiple project
 *  swatches can coexist in the same view without shouting. The UI
 *  exposes this list as a swatch grid; nothing else writes to the
 *  Project.color field, which keeps every project on-palette without
 *  needing a full-colour picker. Label is for the swatch tooltip. */
export const PROJECT_COLORS: Array<{ label: string; value: string }> = [
  { label: 'Teal',     value: '#2C8C99' },
  { label: 'Indigo',   value: '#6B5ADB' },
  { label: 'Plum',     value: '#9C4DCC' },
  { label: 'Rose',     value: '#D44A6B' },
  { label: 'Amber',    value: '#C6762A' },
  { label: 'Olive',    value: '#7A8C2E' },
  { label: 'Sea',      value: '#1D6BFE' },
  { label: 'Forest',   value: '#3F8A5F' },
  { label: 'Slate',    value: '#5C6B7A' }
];

export const PROJECT_COLOR_VALUES = new Set(PROJECT_COLORS.map((c) => c.value));

export function bucketForCount(n: number | null | undefined): OrgSizeBucket | null {
  if (n == null || !Number.isFinite(n) || n < 1) return null;
  if (n === 1) return '1';
  if (n <= 10) return '2-10';
  if (n <= 50) return '11-50';
  if (n <= 200) return '51-200';
  if (n <= 500) return '201-500';
  if (n <= 1000) return '501-1000';
  if (n <= 5000) return '1001-5000';
  if (n <= 10000) return '5001-10000';
  return '10001+';
}

/** Best label for an org's size: exact count if known, else bucket. */
export function orgSizeLabel(o: Organization): string | null {
  if (o.employee_count && Number.isFinite(o.employee_count)) {
    return `${o.employee_count.toLocaleString('en-US')} employees`;
  }
  const b = (o.size_bucket ?? null) as string | null;
  if (b && ORG_SIZE_LABEL[b]) return `${ORG_SIZE_LABEL[b]} employees`;
  return null;
}

/** Former membership = explicitly flagged not-current. Pre-tenure rows
 *  (is_current null) count as current. */
export function isCurrentMember(link: ProjectPerson): boolean {
  return link.is_current !== false;
}

export const GRANT_CATEGORY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'rnd',            label: 'R&D / Innovation' },
  { value: 'research',       label: 'Research' },
  { value: 'climate',        label: 'Climate / Sustainability' },
  { value: 'design',         label: 'Design' },
  { value: 'culture',        label: 'Culture / Film' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'student',        label: 'Student / Education' },
  { value: 'export',         label: 'Export / Internationalisation' },
  { value: 'equity',         label: 'Equity / Investment' },
  { value: 'other',          label: 'Other' }
];

export function grantCategoryLabel(v: string | null | undefined): string {
  if (!v) return '';
  return GRANT_CATEGORY_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

export const GRANT_RECURRENCE_OPTIONS = [
  { value: 'annual',    label: 'Annual' },
  { value: 'biannual',  label: 'Biannual' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'ad_hoc',    label: 'Ad-hoc' }
] as const;

export const GRANT_CURRENCY_OPTIONS = ['ISK', 'EUR', 'USD', 'GBP'] as const;

/** Tier order for display. Not alphabetical, and not `sort` — gold outranks
 *  silver outranks bronze, and anything untiered comes last. */
export const SPONSOR_TIER_ORDER: Record<string, number> = {
  gold: 0,
  silver: 1,
  bronze: 2
};

export const SPONSOR_TIER_LABEL: Record<SponsorTier, string> = {
  gold: 'Gold',
  silver: 'Silver',
  bronze: 'Bronze'
};

/**
 * The sentence that credits one organisation on one project.
 *
 * Resolution order, most specific first:
 *   1. the link's own phrase — someone wrote the exact words for this pairing
 *   2. the role's template, with the name substituted
 *   3. null — this role has no wording, so nothing is claimed on its behalf
 *
 * `{org_dative}` exists because Icelandic declines the name inside the phrase:
 * "Með stuðningi frá Grósku", not "frá Gróska". The declined form lives on the
 * organisation (`name_dative_is`) so it is written once and reused by every
 * project, and falls back to the plain name when nobody has filled it in —
 * wrong grammar being better than an empty credit line.
 */
export function sponsorPhrase(
  link: Pick<ProjectOrganization, 'phrase_is' | 'phrase_en' | 'organization_id'>,
  role: Pick<ProjectRole, 'phrase_is' | 'phrase_en'> | null | undefined,
  lang: 'is' | 'en'
): string | null {
  const override = lang === 'is' ? link.phrase_is : link.phrase_en;
  if (override && override.trim()) return override.trim();

  const template = lang === 'is' ? role?.phrase_is : role?.phrase_en;
  if (!template || !template.trim()) return null;

  const org = typeof link.organization_id === 'object' ? link.organization_id : null;
  const name = (org?.name ?? '').trim();
  if (!name) return null;
  const dative = ((org as { name_dative_is?: string | null } | null)?.name_dative_is ?? '').trim() || name;

  return template
    .replaceAll('{org_dative}', dative)
    .replaceAll('{org}', name)
    .trim();
}

/**
 * @deprecated The source of truth is the `ActivityKind` Directus
 * collection — load via `listActivityKinds()`. This array is kept as a
 * fallback for code paths that need a synchronous list (e.g. when the
 * collection hasn't been seeded yet in a fresh dev environment).
 */
export const ACTIVITY_KINDS: { label: string; value: ActivityKindKey }[] = [
  { label: 'Meeting', value: 'meeting' },
  { label: 'Call', value: 'call' },
  { label: 'Email', value: 'email' },
  { label: 'Message', value: 'message' },
  { label: 'Mentoring', value: 'mentoring' },
  { label: 'Teaching', value: 'teaching' },
  { label: 'Talk / Presentation', value: 'talk' },
  { label: 'Event', value: 'event' },
  { label: 'Intro', value: 'intro' },
  { label: 'Milestone', value: 'milestone' },
  { label: 'Note', value: 'note' },
  { label: 'Other', value: 'other' }
];

export const ACTIVITY_KIND_ICON: Record<string, string> = {
  meeting: 'users',
  call: 'phone',
  email: 'mail',
  message: 'mail',
  mentoring: 'sparkles',
  teaching: 'sparkles',
  talk: 'bolt',
  event: 'calendar',
  intro: 'users',
  milestone: 'bolt',
  note: 'tag',
  other: 'tag'
};
