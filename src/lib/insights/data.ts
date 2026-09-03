// Fetch everything the /insights dashboard needs for one project, in as few
// round-trips as the schema allows. Types and all arithmetic live in
// metrics.ts (no $lib imports there, so it is unit-testable); this file is the
// only part that talks to Directus.
//
// The unit of analysis is a PROGRAMME, not a project row. "Startup SuperNova"
// is a parent project whose nine children are the yearly cohorts, and every
// membership lives on a cohort — so a dashboard that read only the parent
// would report zero of everything. We resolve the descendant set first
// (`listProjectDescendantIds`, already used by the project detail page) and
// query the junctions with `_in` over that set.
import { readItems } from '@directus/sdk';
import {
  directus,
  listProjectDescendantIds,
  getProject,
  sexOf,
  type Project
} from '$lib/directus';
import type {
  InsightsAward,
  InsightsBundle,
  InsightsCohort,
  InsightsOrgLink,
  InsightsPersonLink
} from './metrics';

/** The bundle plus the Project row itself, which the page header needs. */
export type LoadedInsights = InsightsBundle & { root: Project };

/** Unwrap a Directus relational field that may arrive as an id or an object. */
function idOf(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'id' in v) {
    const id = (v as { id?: unknown }).id;
    return typeof id === 'number' ? id : null;
  }
  return null;
}

function relName(v: unknown, fallback: string): string {
  if (v && typeof v === 'object') {
    const o = v as { name?: string | null; short_name?: string | null };
    return (o.short_name || o.name || fallback) as string;
  }
  return fallback;
}

function personDisplayName(p: Record<string, unknown>): string {
  const full = typeof p.full_name === 'string' ? p.full_name.trim() : '';
  if (full) return full;
  const parts = [p.first_name, p.last_name].filter((x): x is string => typeof x === 'string' && !!x.trim());
  return parts.join(' ').trim() || `Person ${p.id}`;
}

/** bigInteger comes back as a string from Postgres via Directus. */
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Load the whole bundle for a programme. Every secondary query degrades to
 *  an empty list rather than throwing: a missing grants permission must cost
 *  you the grants cards, not the dashboard. */
export async function loadInsights(rootId: number): Promise<LoadedInsights> {
  const root = await getProject(rootId);
  const treeIds = await listProjectDescendantIds(rootId).catch(() => [rootId]);

  const [cohortRows, personRows, orgRows] = await Promise.all([
    directus.request(
      readItems('Project', {
        filter: { id: { _in: treeIds } } as never,
        fields: [
          'id', 'name', 'year', 'start_date', 'end_date',
          'participant_count', 'application_count'
        ] as never,
        limit: -1
      } as never)
    ) as Promise<Array<Record<string, unknown>>>,
    (
      directus.request(
        readItems('Project_people', {
          filter: {
            _and: [
              { status: { _neq: 'archived' } },
              { project_id: { _in: treeIds } },
              // We walk the subtree ourselves, so Directus's rolled-up
              // inherited rows would double-count every membership.
              { inherited_from_project_id: { _null: true } }
            ]
          } as never,
          fields: [
            'project_id', 'role_in_project', 'is_current',
            {
              person_id: [
                'id', 'full_name', 'first_name', 'last_name', 'gender',
                'person_picture', 'image_focal', 'email', 'city', 'country'
              ]
            }
          ] as never,
          limit: -1
        } as never)
      ) as Promise<Array<Record<string, unknown>>>
    ).catch(() => [] as Array<Record<string, unknown>>),
    (
      directus.request(
        readItems('Project_organization', {
          filter: {
            _and: [
              { status: { _neq: 'archived' } },
              { project_id: { _in: treeIds } },
              { inherited_from_project_id: { _null: true } }
            ]
          } as never,
          fields: [
            'project_id', 'role_in_project',
            {
              organization_id: [
                'id', 'name', 'logo', 'image_focal', 'website', 'industry',
                'org_type', 'is_active', 'founded_year'
              ]
            }
          ] as never,
          limit: -1
        } as never)
      ) as Promise<Array<Record<string, unknown>>>
    ).catch(() => [] as Array<Record<string, unknown>>)
  ]);

  const cohorts: InsightsCohort[] = cohortRows
    .map((r) => ({
      id: Number(r.id),
      name: String(r.name ?? `Project ${r.id}`),
      year: typeof r.year === 'number' ? r.year : null,
      startDate: (r.start_date as string | null) ?? null,
      endDate: (r.end_date as string | null) ?? null,
      participantCount: typeof r.participant_count === 'number' ? r.participant_count : null,
      applicationCount: typeof r.application_count === 'number' ? r.application_count : null,
      isRoot: Number(r.id) === rootId
    }))
    // Newest cohort first; the programme row (usually yearless) sorts last.
    .sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity) || a.name.localeCompare(b.name));

  const personLinks: InsightsPersonLink[] = [];
  for (const r of personRows) {
    const p = r.person_id;
    if (!p || typeof p !== 'object') continue; // orphaned junction row
    const row = p as Record<string, unknown>;
    const projectId = idOf(r.project_id);
    if (projectId == null) continue;
    const gender = (row.gender as string | null) ?? null;
    personLinks.push({
      projectId,
      role: (r.role_in_project as string | null) ?? null,
      // Pre-tenure rows (null) count as current, matching isCurrentMember().
      isCurrent: r.is_current !== false,
      person: {
        id: Number(row.id),
        name: personDisplayName(row),
        sex: sexOf(gender),
        genderRaw: gender,
        picture: (row.person_picture as string | null) ?? null,
        focal: (row.image_focal as string | null) ?? null,
        email: (row.email as string | null) ?? null,
        city: (row.city as string | null) ?? null,
        country: (row.country as string | null) ?? null
      }
    });
  }

  const orgLinks: InsightsOrgLink[] = [];
  for (const r of orgRows) {
    const o = r.organization_id;
    if (!o || typeof o !== 'object') continue;
    const row = o as Record<string, unknown>;
    const projectId = idOf(r.project_id);
    if (projectId == null) continue;
    orgLinks.push({
      projectId,
      role: (r.role_in_project as string | null) ?? null,
      org: {
        id: Number(row.id),
        name: String(row.name ?? `Org ${row.id}`),
        logo: (row.logo as string | null) ?? null,
        focal: (row.image_focal as string | null) ?? null,
        website: (row.website as string | null) ?? null,
        industry: (row.industry as string | null) ?? null,
        orgType: (row.org_type as string | null) ?? null,
        // Only an explicit false means "gone"; null is "we never checked".
        isActive: row.is_active !== false,
        foundedYear: typeof row.founded_year === 'number' ? row.founded_year : null
      }
    });
  }

  const memberOrgIds = [...new Set(orgLinks.map((l) => l.org.id))];
  const awardRows = memberOrgIds.length
    ? await (
        directus.request(
          readItems('GrantAward', {
            filter: {
              _and: [
                { status: { _neq: 'archived' } },
                { organization_id: { _in: memberOrgIds } }
              ]
            } as never,
            fields: [
              'id', 'awarded_year', 'fund_year', 'award_date', 'total_amount',
              'currency', 'award_status', 'award_name',
              { grant_id: ['id', 'name', 'short_name'] },
              { organization_id: ['id', 'name'] }
            ] as never,
            sort: ['-awarded_year'] as never,
            limit: -1
          } as never)
        ) as Promise<Array<Record<string, unknown>>>
      ).catch(() => [] as Array<Record<string, unknown>>)
    : [];

  const awards: InsightsAward[] = awardRows.map((a) => {
    let year: number | null = null;
    if (typeof a.awarded_year === 'number') year = a.awarded_year;
    else if (typeof a.fund_year === 'number') year = a.fund_year;
    else if (typeof a.award_date === 'string') {
      const y = Number(a.award_date.slice(0, 4));
      if (Number.isFinite(y)) year = y;
    }
    const orgId = idOf(a.organization_id);
    return {
      id: Number(a.id),
      orgId,
      orgName: relName(a.organization_id, orgId ? `Org ${orgId}` : '—'),
      fund: relName(a.grant_id, (a.award_name as string | null) || 'Unnamed fund'),
      year,
      amount: num(a.total_amount),
      currency: String(a.currency || 'ISK').toUpperCase(),
      status: String(a.award_status || 'unknown')
    };
  });

  return {
    root,
    rootId,
    rootName: root.name ?? `Project ${rootId}`,
    cohorts,
    personLinks,
    orgLinks,
    awards
  };
}

export type InsightsProjectOption = {
  id: number;
  name: string;
  year: number | null;
  kind: string | null;
  parentId: number | null;
  childCount: number;
};

/** Projects that can head a dashboard, for the picker. Rows with children are
 *  flagged so the picker can float programmes to the top — a single cohort is
 *  a drill-down, not the default view. */
export async function listInsightsProjects(): Promise<InsightsProjectOption[]> {
  const rows = (await directus.request(
    readItems('Project', {
      filter: { status: { _neq: 'archived' } } as never,
      fields: ['id', 'name', 'year', 'kind', 'scope', { parent_id: ['id'] }] as never,
      sort: ['name'] as never,
      limit: -1
    } as never)
  )) as Array<Record<string, unknown>>;
  const childCounts = new Map<number, number>();
  for (const r of rows) {
    const parent = idOf(r.parent_id);
    if (parent != null) childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1);
  }
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name ?? `Project ${r.id}`),
    year: typeof r.year === 'number' ? r.year : null,
    kind: (r.kind as string | null) ?? null,
    parentId: idOf(r.parent_id),
    childCount: childCounts.get(Number(r.id)) ?? 0
  }));
}
