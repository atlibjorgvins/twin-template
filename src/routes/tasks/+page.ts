import { listAllFocusTasks, listAsanaProjectLinks, listProjectsForTree } from '$lib/directus';

export const ssr = false;

export const load = async () => {
  try {
    // Every task, not just open ones: the board needs a Done column and the
    // calendar shows what already happened this month.
    const [tasks, projects, links] = await Promise.all([
      listAllFocusTasks(),
      listProjectsForTree().catch(() => []),
      // A missing collection must not take the page down — the mapping is an
      // extra, and scripts/add-asana-project-links.sh may not have been run.
      listAsanaProjectLinks().catch(() => [])
    ]);
    return { tasks, projects, links, error: null as string | null };
  } catch (e) {
    return {
      tasks: [],
      projects: [],
      links: [],
      error: e instanceof Error ? e.message : String(e)
    };
  }
};
