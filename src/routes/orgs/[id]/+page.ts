import type { PageLoad } from './$types';
import { getOrg, getOrgPeople, getOrgProjects, getOrganizationTags, listPreviousIdentities, listGrantAwards } from '$lib/directus';

export const load: PageLoad = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Error(`Bad id: ${params.id}`);
  // Satellites degrade to empty offline so the core org still renders.
  const orEmpty = <T>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [] as T[]);
  const [org, roles, projects, tags, previousIdentities, grantAwards] = await Promise.all([
    getOrg(id),
    orEmpty(getOrgPeople(id)),
    orEmpty(getOrgProjects(id)),
    orEmpty(getOrganizationTags(id)),
    orEmpty(listPreviousIdentities(id)),
    orEmpty(listGrantAwards({ orgId: id }))
  ]);
  return { org, roles, projects, tags, previousIdentities, grantAwards };
};
