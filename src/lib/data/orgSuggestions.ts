// Org data suggestions
//
// Web-search recommendations for websites, handles and logos.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { Organization } from '$lib/data/types';
import { updateOrg } from '$lib/data/orgs';
import { uploadFromUrl } from '$lib/data/batch';

// ── Org data suggestions ────────────────────────────────────────────
// Web-search-sourced suggestions for an org field (website / social /
// logo), surfaced in the Tools → "Suggested data" review UI. Suggestions
// are never auto-applied; the user accepts or rejects each one.
export type OrgSuggestion = {
  id: number;
  review_status: 'pending' | 'accepted' | 'rejected';
  /** website | linkedin_url | facebook | instagram | twitter | logo */
  field_key: string;
  /** URL / handle, or image URL for logo */
  suggested_value: string;
  current_value?: string | null;
  source_url?: string | null;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | string | null;
  batch?: string | null;
  note?: string | null;
  organization?: number | Organization | null;
  date_created?: string | null;
  date_updated?: string | null;
};

/** A pending suggestion with its parent org expanded for display. */
export type SuggestionWithOrg = OrgSuggestion & {
  organization: Organization | null;
};

/** All pending suggestions, org expanded, grouped-friendly sort. */
export async function getPendingSuggestions(): Promise<SuggestionWithOrg[]> {
  const rows = await repo.list<SuggestionWithOrg>('org_suggestion', {
    where: { field: 'review_status', op: 'eq', value: 'pending' },
    fields: ['*', { organization: ['id', 'name', 'logo', 'website'] }],
    sort: ['organization', 'field_key'],
    limit: 500
  });
  return rows;
}

/** Group suggestions by org, preserving order. */
export function groupSuggestionsByOrg(
  rows: SuggestionWithOrg[]
): Array<{ org: Organization | null; orgId: number | null; items: SuggestionWithOrg[] }> {
  const map = new Map<
    number | null,
    { org: Organization | null; orgId: number | null; items: SuggestionWithOrg[] }
  >();
  for (const r of rows) {
    const org = (typeof r.organization === 'object' ? r.organization : null) as Organization | null;
    const orgId = org?.id ?? (typeof r.organization === 'number' ? r.organization : null);
    if (!map.has(orgId)) map.set(orgId, { org, orgId, items: [] });
    map.get(orgId)!.items.push(r);
  }
  return [...map.values()];
}

/** Mark a suggestion rejected (no write to the org). */
export async function rejectSuggestion(id: number): Promise<void> {
  await repo.update('org_suggestion', id, { review_status: 'rejected' });
}

/**
 * Accept a suggestion: write the value onto the organization, then mark the
 * suggestion accepted. For `logo`, the image URL is imported into Directus
 * files (browser-resize with server-side import fallback) and the resulting
 * file id is stored on `organization.logo`.
 */
/** Suggestion field_key -> social platform. The keys are the legacy column
 *  names the scraper still emits; the values are what organization_social
 *  stores. `twitter` maps to `x` because that is the network's name now. */
const SUGGESTION_SOCIAL_PLATFORM: Record<string, string> = {
  linkedin_url: 'linkedin',
  linkedin: 'linkedin',
  facebook: 'facebook',
  instagram: 'instagram',
  twitter: 'x'
};

export async function acceptSuggestion(s: SuggestionWithOrg): Promise<void> {
  const orgId = (typeof s.organization === 'object' ? s.organization?.id : s.organization) as number;
  if (!orgId) throw new Error('Suggestion has no organization');

  if (s.field_key === 'logo') {
    const { id } = await uploadFromUrl(s.suggested_value, {
      title: `${(typeof s.organization === 'object' && s.organization?.name) || 'org'} logo`,
      maxEdge: 512
    });
    await updateOrg(orgId, { logo: id });
  } else if (SUGGESTION_SOCIAL_PLATFORM[s.field_key]) {
    // Social suggestions become rows in organization_social. The legacy columns
    // they used to target are hidden and read-only now, so writing one would
    // accept the suggestion into a place nothing displays.
    const { upsertOrgSocial } = await import('$lib/orgSocial');
    await upsertOrgSocial(orgId, SUGGESTION_SOCIAL_PLATFORM[s.field_key], s.suggested_value);
  } else {
    await updateOrg(orgId, { [s.field_key]: s.suggested_value } as Partial<Organization>);
  }
  await repo.update('org_suggestion', s.id, { review_status: 'accepted' });
}
