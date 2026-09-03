import {
  getFocusTask,
  listFocusSubtasks,
  listProjectsForTree,
  type FocusTask
} from '$lib/directus';

export const ssr = false;

export const load = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return { task: null, subtasks: [], projects: [], error: `“${params.id}” is not a task id.` };
  }
  try {
    // The task first: without it there is no page, and a failing projects
    // lookup should not be what tells you the task is missing.
    const task = await getFocusTask(id);
    const [subtasks, projects] = await Promise.all([
      listFocusSubtasks(id).catch(() => [] as FocusTask[]),
      listProjectsForTree().catch(() => [])
    ]);
    return { task, subtasks, projects, error: null as string | null };
  } catch (e) {
    return {
      task: null,
      subtasks: [],
      projects: [],
      error: e instanceof Error ? e.message : String(e)
    };
  }
};
