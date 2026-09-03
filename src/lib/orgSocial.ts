// The social-network catalogue, shared by the org header strip and the Social
// card so the two cannot disagree about what a platform is called or which
// glyph it gets.
//
// `platform` is stored as free text, so this is a lookup table and never a
// constraint: a network that is not listed still renders, with its raw key as
// the label and no branded glyph. That is the point — adding Snapchat is one
// line here, not a schema migration.
import { repo } from '$lib/data/repo';
import type { IconName } from './icon-types';

/** Which record a profile hangs off. The two tables are identical apart from
 *  the owner column, so every helper below takes this and nothing else changes. */
export type SocialTarget = 'organization' | 'Person';

type TargetSpec = { collection: string; owner: string };
const TARGET: Record<SocialTarget, TargetSpec> = {
  organization: { collection: 'organization_social', owner: 'organization_id' },
  Person: { collection: 'person_social', owner: 'person_id' }
};

export type OrgSocial = {
  id: number;
  platform: string;
  url: string | null;
  handle: string | null;
  sort?: number | null;
};

export type SocialMeta = {
  key: string;
  label: string;
  /** Only where twin actually has a brand glyph — a wrong-but-present icon is
   *  worse than none, so the rest fall back to a generic globe. */
  icon?: IconName;
  /** Used to build a URL when a bare handle is pasted. */
  prefix?: string;
};

export const SOCIAL_CATALOGUE: SocialMeta[] = [
  { key: 'linkedin', label: 'LinkedIn', icon: 'linkedin', prefix: 'https://www.linkedin.com/company/' },
  { key: 'instagram', label: 'Instagram', icon: 'instagram', prefix: 'https://www.instagram.com/' },
  { key: 'facebook', label: 'Facebook', icon: 'facebook', prefix: 'https://www.facebook.com/' },
  { key: 'x', label: 'X', icon: 'x-twitter', prefix: 'https://x.com/' },
  { key: 'youtube', label: 'YouTube', prefix: 'https://www.youtube.com/@' },
  { key: 'tiktok', label: 'TikTok', prefix: 'https://www.tiktok.com/@' },
  { key: 'bluesky', label: 'Bluesky', prefix: 'https://bsky.app/profile/' },
  { key: 'threads', label: 'Threads', prefix: 'https://www.threads.net/@' },
  { key: 'mastodon', label: 'Mastodon' },
  { key: 'github', label: 'GitHub', prefix: 'https://github.com/' },
  { key: 'vimeo', label: 'Vimeo', prefix: 'https://vimeo.com/' },
  { key: 'other', label: 'Other' }
];

export const socialMeta = (key: string): SocialMeta | undefined =>
  SOCIAL_CATALOGUE.find((c) => c.key === key);
export const socialLabel = (key: string): string => socialMeta(key)?.label ?? key;
/** Falls back to a globe so an unknown network still gets a clickable glyph. */
export const socialIcon = (key: string): IconName => socialMeta(key)?.icon ?? 'globe';

/** Accepts a full URL or a bare @handle — both are how people carry these. */
export function toSocialUrl(platform: string, raw: string): string {
  const v = raw.trim().replace(/^@/, '');
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(v)) return `https://${v}`;
  const p = socialMeta(platform)?.prefix;
  return p ? p + v : v;
}

/**
 * Display name, derived from the URL rather than the stored handle.
 *
 * Imported LinkedIn URLs carry a tab suffix (/company/verna_iceland/mycompany/),
 * so taking the last path segment showed every one of them as "mycompany".
 * The segment after company/in/profile is the name; anything after it is a tab.
 */
export function socialDisplay(s: Pick<OrgSocial, 'platform' | 'url' | 'handle'>): string {
  const raw = (s.url ?? '').trim();
  if (!raw) return s.handle ?? '';
  const path = raw.replace(/^https?:\/\/(www\.)?[^/]+/i, '').replace(/\/+$/, '');
  const seg = path.split('/').filter(Boolean);
  const anchored = seg.findIndex((x) => x === 'company' || x === 'in' || x === 'profile');
  const name = anchored >= 0 ? seg[anchored + 1] : seg[0];
  if (!name) return raw.replace(/^https?:\/\/(www\.)?/i, '');
  return ['instagram', 'x', 'tiktok', 'threads'].includes(s.platform) ? `@${name}` : name;
}

export async function listSocials(target: SocialTarget, ownerId: number): Promise<OrgSocial[]> {
  const t = TARGET[target];
  return repo.list<OrgSocial>(t.collection, {
    where: { field: t.owner, op: 'eq', value: ownerId },
    fields: ['id', 'platform', 'url', 'handle', 'sort'],
    sort: ['sort', 'id']
  });
}

/**
 * Set one platform's profile for an org, creating or updating the row.
 *
 * Used by the paths that used to write the legacy columns — the new-org form
 * and the suggested-data reviewer. Upsert rather than insert, because both can
 * run twice for the same org and a second LinkedIn row would be a duplicate
 * nobody asked for.
 *
 * A blank value is a no-op, not a delete: these callers mean "here is a value
 * if I have one", never "remove what is there".
 */
export async function upsertSocial(
  target: SocialTarget,
  ownerId: number,
  platform: string,
  raw: string | null | undefined
): Promise<OrgSocial | null> {
  const t = TARGET[target];
  const url = toSocialUrl(platform, raw ?? '');
  if (!url) return null;
  const existing = await repo.list<{ id: number }>(t.collection, {
    where: {
      and: [
        { field: t.owner, op: 'eq', value: ownerId },
        { field: 'platform', op: 'eq', value: platform }
      ]
    },
    fields: ['id'],
    limit: 1
  });
  if (existing[0]) {
    return repo.update<OrgSocial>(t.collection, existing[0].id, { url });
  }
  return repo.create<OrgSocial>(t.collection, { [t.owner]: ownerId, platform, url });
}

/** Create/update/delete for the card, so it does not need to know the table. */
export async function createSocial(
  target: SocialTarget,
  ownerId: number,
  platform: string,
  url: string,
  sort: number
): Promise<OrgSocial> {
  const t = TARGET[target];
  return repo.create<OrgSocial>(t.collection, { [t.owner]: ownerId, platform, url, sort });
}
export async function updateSocialUrl(target: SocialTarget, id: number, url: string) {
  await repo.update(TARGET[target].collection, id, { url });
}
export async function deleteSocial(target: SocialTarget, id: number) {
  await repo.remove(TARGET[target].collection, id);
}

/** Back-compat wrappers — the org callers read better naming their target. */
export const listOrgSocials = (orgId: number) => listSocials('organization', orgId);
export const upsertOrgSocial = (
  orgId: number,
  platform: string,
  raw: string | null | undefined
) => upsertSocial('organization', orgId, platform, raw);
