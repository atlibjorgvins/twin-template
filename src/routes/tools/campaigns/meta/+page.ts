import { redirect } from '@sveltejs/kit';

// "All Meta campaigns" is now the Live tab of the workspace.
export const ssr = false;

export const load = () => {
  redirect(308, '/marketing/live');
};
