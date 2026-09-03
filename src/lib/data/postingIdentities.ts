// Posting identities
//
// Zero dependencies. Small, but it is a self-contained catalogue and there
// is no reason to leave it in an 11k-line file.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module, so every existing
// `from '$lib/directus'` import keeps working.

import { repo } from '$lib/data/repo';

// ── Posting identities ──────────────────────────────────────────────
// Reusable presets (page name / handle / avatar) for the Evergreen
// post previews. Managed in Settings → Posting identities; one row is
// the default and gets preselected in the campaign workbench.
export type PostingIdentity = {
  id: number;
  name?: string | null;
  handle?: string | null;
  avatar_url?: string | null;
  is_default?: boolean | null;
  sort?: number | null;
  /** Default Buffer channel id per platform for this identity. */
  channels?: Partial<Record<string, string>> | null;
  date_created?: string | null;
  date_updated?: string | null;
};

export async function listPostingIdentities(): Promise<PostingIdentity[]> {
  return repo.list<PostingIdentity>('posting_identity', {
    sort: ['sort', 'name'],
    limit: -1
  });
}

export async function createPostingIdentity(
  patch: Partial<PostingIdentity>
): Promise<PostingIdentity> {
  return repo.create<PostingIdentity>('posting_identity', patch as Record<string, unknown>);
}

export async function updatePostingIdentity(
  id: number,
  patch: Partial<PostingIdentity>
): Promise<PostingIdentity> {
  return repo.update<PostingIdentity>('posting_identity', id, patch as Record<string, unknown>);
}

export async function deletePostingIdentity(id: number): Promise<void> {
  await repo.remove('posting_identity', id);
}

/** Make one preset the default, clearing the flag everywhere else. */
export async function setDefaultPostingIdentity(id: number): Promise<void> {
  const all = await listPostingIdentities();
  const others = all.filter((i) => i.id !== id && i.is_default).map((i) => i.id);
  if (others.length > 0) {
    await repo.updateMany('posting_identity', others, { is_default: false });
  }
  await repo.update('posting_identity', id, { is_default: true });
}
