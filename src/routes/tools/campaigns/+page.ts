import { redirect } from '@sveltejs/kit';

// The campaign manager became /marketing. 308 rather than 307: the move is
// permanent, so a bookmarked tool page should stop asking.
export const ssr = false;

export const load = () => {
  redirect(308, '/marketing');
};
