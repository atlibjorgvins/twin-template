import type { PageLoad } from './$types';
import { getPerson, getPersonRoles, getInferredFamily, getPersonProjects, getPersonTags } from '$lib/directus';

// Related reads degrade to empty offline (or for a still-pending offline
// creation) so the core record always renders — the person comes from the
// mirror, the satellites just come back empty until reconnect.
const orEmpty = <T>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [] as T[]);

export const load: PageLoad = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Error(`Bad id: ${params.id}`);
  const [person, roles, family, projects, tags] = await Promise.all([
    getPerson(id),
    orEmpty(getPersonRoles(id)),
    orEmpty(getInferredFamily(id)),
    orEmpty(getPersonProjects(id)),
    orEmpty(getPersonTags(id))
  ]);
  return { person, roles, family, projects, tags };
};
