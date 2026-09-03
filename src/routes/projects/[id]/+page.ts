import type { PageLoad } from './$types';
import {
  getProject,
  getProjectDirectPeople,
  getProjectInheritedPeople,
  getProjectDirectOrganizations,
  getProjectInheritedOrganizations,
  countProjectInheritedMembers,
  INHERITED_PAGE,
  listProjectAncestors,
  listProjectChildren,
  listProjectDescendantIds,
  getOrgIdsForProjects,
  listGrantAwards
} from '$lib/directus';
import { loadProjectSpend } from '$lib/marketing/data';
import type { MarketingBundle } from '$lib/marketing/metrics';

export const load: PageLoad = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Error(`Bad id: ${params.id}`);
  // Load the project first so we can resolve its place in the
  // hierarchy in parallel with the people / org junctions.
  const project = await getProject(id);
  const [
    people, peopleInherited, peopleInheritedTotal,
    organisations, orgsInherited, orgsInheritedTotal,
    ancestors, children, descendantIds
  ] = await Promise.all([
    getProjectDirectPeople(id),
    getProjectInheritedPeople(id, { limit: INHERITED_PAGE, offset: 0 }).catch(() => []),
    countProjectInheritedMembers('Project_people', id).catch(() => 0),
    getProjectDirectOrganizations(id).catch(() => []),
    getProjectInheritedOrganizations(id, { limit: INHERITED_PAGE, offset: 0 }).catch(() => []),
    countProjectInheritedMembers('Project_organization', id).catch(() => 0),
    listProjectAncestors(project).catch(() => []),
    listProjectChildren(id).catch(() => []),
    // Self + every descendant so the parent-project grants card
    // rolls up cohort orgs from sub-projects automatically.
    listProjectDescendantIds(id).catch(() => [id])
  ]);
  // Resolve the union of orgs across this project + descendants
  // (owner_org_id and the Project_organization junction), then fetch
  // their grant awards in parallel. Empty list short-circuits.
  const memberOrgIds = await getOrgIdsForProjects(descendantIds).catch(() => []);
  // Grants and spend both key off the descendant set, so they go together.
  // Spend degrades to an empty bundle: the budget card is worth less than the
  // page, and a Directus permission it lacks must cost only the card.
  const [awards, spend] = await Promise.all([
    memberOrgIds.length ? listGrantAwards({ orgIds: memberOrgIds }).catch(() => []) : [],
    loadProjectSpend(descendantIds).catch(() => null)
  ]);
  return {
    project, people, organisations, ancestors, children, memberOrgIds, awards,
    peopleInherited, peopleInheritedTotal, orgsInherited, orgsInheritedTotal,
    spend: spend as MarketingBundle | null
  };
};
