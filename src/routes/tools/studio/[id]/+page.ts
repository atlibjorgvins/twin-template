import { error } from '@sveltejs/kit';
import { listProjectRoles, listProjectsForTree, listTags } from '$lib/directus';
import { getImageTemplate, listBrandedProjects, listGeneratedImages } from '$lib/studio/data';

export const ssr = false;

export const load = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw error(404, 'Template not found');
  try {
    const [template, generated, projects, tags, projectRoles, brandedProjects] = await Promise.all([
      getImageTemplate(id),
      listGeneratedImages(id).catch(() => []),
      listProjectsForTree(),
      listTags(),
      // Role catalogue for partner-logo layers — optional.
      listProjectRoles().catch(() => []),
      // Project-context candidates: only projects with brand colors.
      listBrandedProjects().catch(() => [])
    ]);
    return { template, generated, projects, tags, projectRoles, brandedProjects };
  } catch (e) {
    throw error(404, e instanceof Error ? e.message : 'Template not found');
  }
};
