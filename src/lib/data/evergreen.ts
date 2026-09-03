// Evergreen machine
//
// Rotating social posts from teams, people and projects. Also home to
// platformService and isStoryPlatform, which is why Buffer could not move
// without it.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { Filter } from '$lib/data/repo';
import type { MkCampaign } from '$lib/data/marketing';
import type { Organization, Person, Project } from '$lib/data/types';
import type { PostingIdentity } from '$lib/data/postingIdentities';
import type { Tag } from '$lib/data/tags';
import { getOrgIdsForProjects } from '$lib/data/projectMembers';
import { listProjectDescendantIds } from '$lib/data/projects';
import { personName } from '$lib/data/people';

// ── Evergreen machine ───────────────────────────────────────────────
// Reusable "campaign" buckets that turn Directus records (orgs, people,
// projects) into social-post briefs: pick filters, write a template with
// {tokens}, generate posts per platform, copy the brief into a Claude
// session that has posting connectors. twin never posts directly.

// Stories are platform VARIANTS, not a campaign-wide switch. A story needs its
// own 9:16 image, and twin already gives each platform its own studio template,
// text override and image — so modelling instagram_story as a platform means
// "feed post + story from the same team batch" comes free, instead of forcing a
// campaign to be one or the other.
//
// LinkedIn has no story type at all (its metadata input has no `type` field —
// LinkedIn retired stories in 2021), which is why there is no linkedin_story.
export type CampaignPlatform =
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'general'
  | 'instagram_story'
  | 'facebook_story';

/** The Buffer service a platform posts through — a story goes to the same
 *  channel as its feed sibling, and only the metadata differs. */
export function platformService(platform: string): string {
  if (platform === 'instagram_story') return 'instagram';
  if (platform === 'facebook_story') return 'facebook';
  return platform;
}

export const isStoryPlatform = (platform: string): boolean => platform.endsWith('_story');
export type CampaignSource = 'organization' | 'Person' | 'Project' | 'event';

export const CAMPAIGN_PLATFORMS: CampaignPlatform[] = [
  'facebook',
  'instagram',
  'linkedin',
  'general',
  'instagram_story',
  'facebook_story'
];
export const CAMPAIGN_PLATFORM_LABEL: Record<CampaignPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  general: 'General',
  instagram_story: 'IG story',
  facebook_story: 'FB story'
};

export type CampaignFilters = {
  /** Project roots — expanded to descendants, then resolved to linked
   *  records (orgs via owner/junction, people via Project_people,
   *  projects via the subtree itself). */
  projectIds?: number[];
  /** Shared Tag pool ids (Person_tag / organization_tag / Project_tag). */
  tagIds?: number[];
  /** Role keys on the project link (Project_organization /
   *  Project_people.role_in_project) — e.g. participant, sponsor.
   *  Only meaningful when projectIds is set. */
  roles?: string[];
  search?: string;
  /** Requirements — "things that need to be in place" before a record
   *  qualifies for a post. */
  requireImage?: boolean;
  requireDescription?: boolean;
  /** Record date_created window (e.g. only this cohort's additions). */
  dateFrom?: string | null;
  dateTo?: string | null;
};

export type Campaign = {
  id: number;
  name?: string | null;
  status?: string;
  description?: string | null;
  source_collection?: CampaignSource | string | null;
  platforms?: CampaignPlatform[] | null;
  base_template?: string | null;
  platform_overrides?: Partial<Record<CampaignPlatform, string>> | null;
  filters?: CampaignFilters | null;
  /** Which language {description} resolves to ('is' default). Falls
   *  back to the other language when the preferred one is empty. */
  language?: 'is' | 'en' | string | null;
  /** Posting-identity preset for the previews. Empty = default preset. */
  identity_id?: number | PostingIdentity | null;
  /** Image Studio template used as the image source — each team's post
   *  image is rendered from it. Empty = record image / team photo. */
  image_template_id?: number | null;
  /** Per-platform Studio template overrides — image_template_id is the
   *  default when a platform has no entry. */
  image_templates?: Partial<Record<CampaignPlatform, number | null>> | null;
  /** Queue-all spread window: posts distributed from→to (dates). */
  schedule?: { from?: string | null; to?: string | null } | null;
  /** Legacy free-typed identity — superseded by identity_id presets. */
  brand_name?: string | null;
  brand_handle?: string | null;
  brand_avatar_url?: string | null;
  /** Marketing campaign this organic content belongs to (F5 link). */
  mk_campaign_id?: number | MkCampaign | null;
  date_created?: string | null;
  date_updated?: string | null;
};

export type CampaignPost = {
  id: number;
  campaign_id?: number | Campaign | null;
  item_collection?: string | null;
  item_id?: string | null;
  item_label?: string | null;
  platform?: CampaignPlatform | string | null;
  status?: 'draft' | 'used' | 'skipped' | string;
  rendered_text?: string | null;
  image_id?: string | null;
  used_at?: string | null;
  /** Buffer post id + timestamp once queued via the proxy flow. */
  buffer_post_id?: string | null;
  /** Slot computed by queue-all — sent to Buffer as dueAt. */
  scheduled_for?: string | null;
  buffered_at?: string | null;
  date_created?: string | null;
  date_updated?: string | null;
};

export type ProjectTag = {
  id: number;
  project_id: number | Project;
  tag_id: number | Tag;
};

// — campaign CRUD —

export async function listCampaigns(): Promise<Campaign[]> {
  return repo.list<Campaign>('campaign', {
    where: { field: 'status', op: 'neq', value: 'archived' },
    sort: ['-date_updated']
  });
}

export async function getCampaign(id: number): Promise<Campaign> {
  const c = await repo.get<Campaign>('campaign', id);
  if (!c) throw new Error(`campaign ${id} not found`);
  return c;
}

export async function createCampaign(patch: Partial<Campaign>): Promise<Campaign> {
  return repo.create<Campaign>('campaign', patch as Record<string, unknown>);
}

export async function updateCampaign(id: number, patch: Partial<Campaign>): Promise<Campaign> {
  return repo.update<Campaign>('campaign', id, patch as Record<string, unknown>);
}

/** Clone a campaign's config (not its generated posts). */
export async function duplicateCampaign(id: number): Promise<Campaign> {
  const src = await getCampaign(id);
  return createCampaign({
    name: `${src.name ?? 'Campaign'} (copy)`,
    status: 'draft',
    description: src.description,
    source_collection: src.source_collection,
    platforms: src.platforms,
    base_template: src.base_template,
    platform_overrides: src.platform_overrides,
    filters: src.filters,
    language: src.language,
    identity_id:
      typeof src.identity_id === 'object' ? src.identity_id?.id : src.identity_id,
    image_template_id: src.image_template_id,
    image_templates: src.image_templates,
    schedule: src.schedule,
    brand_name: src.brand_name,
    brand_handle: src.brand_handle,
    brand_avatar_url: src.brand_avatar_url
  });
}

// — generated posts —

export async function listCampaignPosts(campaignId: number): Promise<CampaignPost[]> {
  return repo.list<CampaignPost>('campaign_post', {
    where: { field: 'campaign_id', op: 'eq', value: campaignId },
    sort: ['-date_created']
  });
}

export async function createCampaignPost(patch: Partial<CampaignPost>): Promise<CampaignPost> {
  return repo.create<CampaignPost>('campaign_post', patch as Record<string, unknown>);
}

export async function updateCampaignPost(
  id: number,
  patch: Partial<CampaignPost>
): Promise<CampaignPost> {
  return repo.update<CampaignPost>('campaign_post', id, patch as Record<string, unknown>);
}

export async function deleteCampaignPost(id: number): Promise<void> {
  await repo.remove('campaign_post', id);
}

// — F5: organic content ↔ marketing campaign —

/** Evergreen content campaigns tied to a marketing campaign. */
export async function listEvergreenForMkCampaign(mkCampaignId: number): Promise<Campaign[]> {
  return repo.list<Campaign>('campaign', {
    where: { field: 'mk_campaign_id', op: 'eq', value: mkCampaignId },
    fields: ['id', 'name', 'status', 'platforms', 'mk_campaign_id'],
    sort: ['-date_updated']
  });
}

/** Post counts (total + published) per Evergreen campaign, for the
 *  marketing workbench's organic-content summary. */
export async function evergreenPostCounts(
  campaignIds: number[]
): Promise<Map<number, { total: number; used: number }>> {
  const map = new Map<number, { total: number; used: number }>();
  if (!campaignIds.length) return map;
  const rows = await repo.aggregate<{
    campaign_id: number;
    status: string | null;
    count: { id: number };
  }>('campaign_post', {
    aggregate: { count: ['id'] },
    groupBy: ['campaign_id', 'status'],
    where: { field: 'campaign_id', op: 'in', value: campaignIds },
    limit: -1
  });
  for (const r of rows) {
    const id = Number(r.campaign_id);
    const cur = map.get(id) ?? { total: 0, used: 0 };
    const n = Number(r.count?.id ?? 0);
    cur.total += n;
    if (r.status === 'used') cur.used += n;
    map.set(id, cur);
  }
  return map;
}

// — candidates —

/** A featured-record candidate, normalized across the three sources so
 *  the template renderer and the picker UI don't care which collection
 *  it came from. */
export type CampaignCandidate = {
  collection: CampaignSource;
  id: number;
  name: string;
  nickname?: string | null;
  /** Description in the campaign's language ('is' default). */
  description: string | null;
  /** The other language's text — {description} falls back to it when
   *  the preferred one is empty. */
  descriptionAlt?: string | null;
  /** Directus file id for the visual (org logo / person picture). */
  imageId: string | null;
  website?: string | null;
  dateCreated?: string | null;
};

async function tagItemIds(
  junction: 'Person_tag' | 'organization_tag' | 'Project_tag',
  fkField: 'person_id' | 'organization_id' | 'project_id',
  tagIds: number[]
): Promise<Set<number>> {
  const rows = await repo.list<Record<string, number | { id: number } | null>>(junction, {
    where: { field: 'tag_id', op: 'in', value: tagIds },
    fields: [fkField]
  });
  const out = new Set<number>();
  for (const r of rows) {
    const v = r[fkField];
    const id = typeof v === 'object' ? v?.id : v;
    if (typeof id === 'number') out.add(id);
  }
  return out;
}

/** People linked to any of the given projects via Project_people,
 *  optionally restricted to specific role_in_project keys. */
async function personIdsForProjects(projectIds: number[], roles?: string[]): Promise<Set<number>> {
  const and: Filter[] = [
    { field: 'status', op: 'neq', value: 'archived' },
    { field: 'project_id', op: 'in', value: projectIds }
  ];
  if (roles && roles.length > 0) and.push({ field: 'role_in_project', op: 'in', value: roles });
  const rows = await repo.list<{ person_id: number | { id: number } | null }>('Project_people', {
    where: { and },
    fields: ['person_id']
  });
  const out = new Set<number>();
  for (const r of rows) {
    const id = typeof r.person_id === 'object' ? r.person_id?.id : r.person_id;
    if (typeof id === 'number') out.add(id);
  }
  return out;
}

/** Orgs linked to the given projects with one of the given roles.
 *  Junction-only — the project's owner org carries no role, so it is
 *  deliberately excluded when filtering by role. */
async function orgIdsForProjectsWithRoles(
  projectIds: number[],
  roles: string[]
): Promise<Set<number>> {
  const rows = await repo.list<{ organization_id: number | { id: number } | null }>(
    'Project_organization',
    {
      where: {
        and: [
          { field: 'status', op: 'neq', value: 'archived' },
          { field: 'project_id', op: 'in', value: projectIds },
          { field: 'role_in_project', op: 'in', value: roles }
        ]
      },
      fields: ['organization_id']
    }
  );
  const out = new Set<number>();
  for (const r of rows) {
    const id = typeof r.organization_id === 'object' ? r.organization_id?.id : r.organization_id;
    if (typeof id === 'number') out.add(id);
  }
  return out;
}

/** Resolve a campaign's source + filters to candidate records. Server
 *  narrows by status/search; project links, tags, requirements and the
 *  date window finish in JS (datasets are small — same approach as the
 *  email-match sweep). */
export async function listCampaignCandidates(
  source: CampaignSource,
  filters: CampaignFilters = {},
  language: 'is' | 'en' = 'is'
): Promise<CampaignCandidate[]> {
  // Expand project roots to their full subtrees once, shared by all paths.
  let projectScope: number[] | null = null;
  if (filters.projectIds && filters.projectIds.length > 0) {
    const all = new Set<number>();
    for (const rootId of filters.projectIds) {
      for (const id of await listProjectDescendantIds(rootId)) all.add(id);
    }
    projectScope = [...all];
  }

  const search = filters.search?.trim();
  let rows: CampaignCandidate[] = [];

  const roleKeys = filters.roles?.filter(Boolean) ?? [];

  if (source === 'organization') {
    let idScope: Set<number> | null = null;
    if (projectScope) {
      idScope =
        roleKeys.length > 0
          ? await orgIdsForProjectsWithRoles(projectScope, roleKeys)
          : new Set(await getOrgIdsForProjects(projectScope));
    }
    if (filters.tagIds && filters.tagIds.length > 0) {
      const tagged = await tagItemIds('organization_tag', 'organization_id', filters.tagIds);
      idScope = idScope ? new Set([...idScope].filter((id) => tagged.has(id))) : tagged;
    }
    if (idScope && idScope.size === 0) return [];
    const and: Filter[] = [{ field: 'status', op: 'neq', value: 'archived' }];
    if (idScope) and.push({ field: 'id', op: 'in', value: [...idScope] });
    if (search) and.push({ field: 'name', op: 'icontains', value: search });
    const orgs = await repo.list<Organization>('organization', {
      where: { and },
      fields: ['id', 'name', 'description', 'description_en', 'logo', 'website', 'date_created'],
      sort: ['name']
    });
    rows = orgs.map((o) => ({
      collection: 'organization' as const,
      id: o.id,
      name: o.name ?? '(unnamed)',
      description: (language === 'en' ? o.description_en : o.description) ?? null,
      descriptionAlt: (language === 'en' ? o.description : o.description_en) ?? null,
      imageId: o.logo ?? null,
      website: o.website ?? null,
      dateCreated: o.date_created ?? null
    }));
  } else if (source === 'Person') {
    let idScope: Set<number> | null = null;
    if (projectScope) idScope = await personIdsForProjects(projectScope, roleKeys);
    if (filters.tagIds && filters.tagIds.length > 0) {
      const tagged = await tagItemIds('Person_tag', 'person_id', filters.tagIds);
      idScope = idScope ? new Set([...idScope].filter((id) => tagged.has(id))) : tagged;
    }
    if (idScope && idScope.size === 0) return [];
    const and: Filter[] = [{ field: 'status', op: 'neq', value: 'archived' }];
    if (idScope) and.push({ field: 'id', op: 'in', value: [...idScope] });
    if (search) and.push({ field: 'full_name', op: 'icontains', value: search });
    const people = await repo.list<Person>('Person', {
      where: { and },
      fields: [
        'id', 'full_name', 'first_name', 'last_name', 'nickname',
        'person_picture', 'website', 'date_created'
      ],
      sort: ['full_name']
    });
    rows = people.map((p) => ({
      collection: 'Person' as const,
      id: p.id,
      name: personName(p),
      nickname: p.nickname ?? null,
      description: null, // Person has no bio column today
      imageId: p.person_picture ?? null,
      website: p.website ?? null,
      dateCreated: p.date_created ?? null
    }));
  } else if (source === 'Project') {
    let idScope: Set<number> | null = projectScope ? new Set(projectScope) : null;
    if (filters.tagIds && filters.tagIds.length > 0) {
      const tagged = await tagItemIds('Project_tag', 'project_id', filters.tagIds);
      idScope = idScope ? new Set([...idScope].filter((id) => tagged.has(id))) : tagged;
    }
    if (idScope && idScope.size === 0) return [];
    const and: Filter[] = [{ field: 'status', op: 'neq', value: 'archived' }];
    if (idScope) and.push({ field: 'id', op: 'in', value: [...idScope] });
    if (search) and.push({ field: 'name', op: 'icontains', value: search });
    const projects = await repo.list<Project>('Project', {
      where: { and },
      fields: [
        'id', 'name', 'summary', 'summary_en', 'date_created',
        'brand_logo', 'brand_logo_landscape', 'brand_logo_simple'
      ],
      sort: ['name']
    });
    rows = projects.map((p) => ({
      collection: 'Project' as const,
      id: p.id,
      name: p.name ?? '(unnamed)',
      description: (language === 'en' ? p.summary_en : p.summary) ?? null,
      descriptionAlt: (language === 'en' ? p.summary : p.summary_en) ?? null,
      // The brand logo IS the project's image. This said "Project has no image
      // column today" long after brand_logo landed, so "needs an image" could
      // only ever return nothing for a Project campaign.
      imageId: p.brand_logo ?? p.brand_logo_landscape ?? p.brand_logo_simple ?? null,
      dateCreated: p.date_created ?? null
    }));
  } else {
    // Events (happenings). Project filter narrows by event.project_id;
    // the cover is the candidate image; `start` drives the date window
    // (so a "throwback" campaign can target last year's events).
    const and: Filter[] = [{ field: 'status', op: 'neq', value: 'archived' }];
    if (projectScope) and.push({ field: 'project_id', op: 'in', value: projectScope });
    if (search) and.push({ field: 'name', op: 'icontains', value: search });
    const events = await repo.list<{
      id: number;
      name?: string | null;
      summary?: string | null;
      cover?: string | null;
      start?: string | null;
      location_name?: string | null;
    }>('event', {
      where: { and },
      fields: ['id', 'name', 'summary', 'cover', 'start', 'location_name'],
      sort: ['-start']
    });
    rows = events.map((e) => ({
      collection: 'event' as const,
      id: e.id,
      name: e.name ?? '(untitled)',
      description: e.summary ?? null,
      imageId: e.cover ?? null,
      // Date window filters on the event date, not when the row was made.
      dateCreated: e.start ?? null
    }));
  }

  // Requirements + date window.
  if (filters.requireImage) rows = rows.filter((r) => !!r.imageId);
  // Strict in the campaign's language — an EN campaign requiring a
  // description means an ENGLISH description, not the IS fallback.
  if (filters.requireDescription) rows = rows.filter((r) => !!r.description?.trim());
  // A date window EXCLUDES rows with no date. `!r.dateCreated ||` let every
  // undated row satisfy both bounds at once, so narrowing to a window kept
  // exactly the records the window cannot speak for — the filter looked
  // applied and had no effect. A record with no date is not in the window.
  if (filters.dateFrom) {
    const d = filters.dateFrom.slice(0, 10);
    rows = rows.filter((r) => !!r.dateCreated && r.dateCreated.slice(0, 10) >= d);
  }
  if (filters.dateTo) {
    const d = filters.dateTo.slice(0, 10);
    rows = rows.filter((r) => !!r.dateCreated && r.dateCreated.slice(0, 10) <= d);
  }
  return rows;
}

// — template rendering —

/** Tokens available in campaign templates. Unknown {tokens} are left
 *  intact so a typo is visible in the preview instead of vanishing. */
export const CAMPAIGN_TOKENS = ['name', 'nickname', 'description', 'website', 'project'] as const;

export function renderCampaignTemplate(
  template: string,
  candidate: CampaignCandidate,
  ctx: { projectName?: string | null } = {}
): string {
  const tokens: Record<string, string> = {
    name: candidate.name,
    nickname: candidate.nickname ?? candidate.name,
    description: candidate.description?.trim() || candidate.descriptionAlt || '',
    website: candidate.website ?? '',
    project: ctx.projectName ?? ''
  };
  return template.replace(/\{(\w+)\}/g, (m, key: string) =>
    key in tokens ? tokens[key] : m
  );
}

/** Pick the template for a platform: override if present, else base. */
export function campaignTemplateFor(c: Campaign, platform: CampaignPlatform): string {
  return c.platform_overrides?.[platform]?.trim() || c.base_template || '';
}

// Organization photos — moved to $lib/data/orgPhotos.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
