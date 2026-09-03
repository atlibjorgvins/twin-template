import { redirect } from '@sveltejs/kit';

// One of the four pages that were all "reporting" and disagreed with each other
// because each blended spend differently. Plan is now the single answer to
// "what did we spend".
export const ssr = false;

export const load = () => {
  redirect(308, '/marketing');
};
