import { error } from '@sveltejs/kit';
import { getImageTemplate, listGeneratedImages, listBrandedProjects, getProjectContext } from '$lib/studio/data';
import { loadEventPool } from '$lib/studio/carousel';
import { listEvents } from '$lib/events/data';
import { listProjectRoles } from '$lib/directus';

export const ssr = false;

export const load = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw error(404, 'Summary post not found');
  try {
    const template = await getImageTemplate(id);
    const [events, generated, pool, brandedProjects, projectRoles, projectContext] = await Promise.all([
      listEvents().catch(() => []),
      listGeneratedImages(id).catch(() => []),
      template.event_id ? loadEventPool(template.event_id).catch(() => []) : Promise.resolve([]),
      listBrandedProjects().catch(() => []),
      listProjectRoles().catch(() => []),
      template.project_id ? getProjectContext(template.project_id).catch(() => null) : Promise.resolve(null)
    ]);
    return { template, events, generated, pool, brandedProjects, projectRoles, projectContext };
  } catch (e) {
    throw error(404, e instanceof Error ? e.message : 'Summary post not found');
  }
};
