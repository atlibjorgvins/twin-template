import { listFocusTasks, listProjectsForTree } from '$lib/directus';

export const ssr = false;

export const load = async () => {
  try {
    const [tasks, projects] = await Promise.all([
      listFocusTasks(),
      listProjectsForTree().catch(() => [])
    ]);
    return { tasks, projects, error: null as string | null };
  } catch (e) {
    return { tasks: [], projects: [], error: e instanceof Error ? e.message : String(e) };
  }
};
