import { redirect } from '@sveltejs/kit';

// Ad accounts are plumbing, so they live in Setup alongside the medium
// vocabulary rather than as a sibling of the campaign list.
export const ssr = false;

export const load = () => {
  redirect(308, '/marketing/setup');
};
