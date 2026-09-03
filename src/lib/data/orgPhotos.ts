// Organization photos
//
// Org-scoped photo links; the Immich assets stay in Immich.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { Organization } from '$lib/data/types';

// ── Organization photos ─────────────────────────────────────────────
// Multiple typed photos per org: file + PhotoType (the fixed-but-
// editable catalogue managed in Settings → Photo types) + caption.

export type PhotoType = {
  id: number;
  name?: string | null;
  status?: string;
  sort?: number | null;
  date_created?: string | null;
  date_updated?: string | null;
};

export type OrganizationPhoto = {
  id: number;
  organization_id?: number | Organization | null;
  file_id?: string | null;
  type_id?: number | PhotoType | null;
  caption?: string | null;
  sort?: number | null;
  date_created?: string | null;
  date_updated?: string | null;
};

export async function listPhotoTypes(
  opts: { includeArchived?: boolean } = {}
): Promise<PhotoType[]> {
  return await repo.list<PhotoType>('PhotoType', {
    where: opts.includeArchived ? undefined : { field: 'status', op: 'eq', value: 'published' },
    sort: ['sort', 'name']
  });
}

export async function createPhotoType(patch: Partial<PhotoType>): Promise<PhotoType> {
  return await repo.create<PhotoType>('PhotoType', patch as Record<string, unknown>);
}

export async function updatePhotoType(id: number, patch: Partial<PhotoType>): Promise<PhotoType> {
  return await repo.update<PhotoType>('PhotoType', id, patch as Record<string, unknown>);
}

/** All photos on one org, type expanded, gallery order. */
export async function listOrgPhotos(orgId: number): Promise<OrganizationPhoto[]> {
  return await repo.list<OrganizationPhoto>('organization_photo', {
    where: { field: 'organization_id', op: 'eq', value: orgId },
    fields: ['*', { type_id: ['id', 'name'] }],
    sort: ['sort', '-date_created']
  });
}

export async function addOrgPhoto(patch: {
  organization_id: number;
  file_id: string;
  type_id?: number | null;
  caption?: string | null;
}): Promise<OrganizationPhoto> {
  const created = await repo.create<OrganizationPhoto>('organization_photo', patch as Record<string, unknown>);
  // Re-read with the type expanded so the gallery can render the badge
  // without a refresh.
  const full = await repo.get<OrganizationPhoto>('organization_photo', created.id, {
    fields: ['*', { type_id: ['id', 'name'] }]
  });
  return full ?? created;
}

export async function updateOrgPhoto(
  id: number,
  patch: Partial<OrganizationPhoto>
): Promise<OrganizationPhoto> {
  const updated = await repo.update<OrganizationPhoto>('organization_photo', id, patch as Record<string, unknown>);
  const full = await repo.get<OrganizationPhoto>('organization_photo', id, {
    fields: ['*', { type_id: ['id', 'name'] }]
  });
  return full ?? updated;
}

export async function deleteOrgPhoto(id: number): Promise<void> {
  await repo.remove('organization_photo', id);
}


// Posting identities — moved to $lib/data/postingIdentities.ts, re-exported at the end of
// this file. See docs/opening-up-twin.md.
