import { redirect } from '@sveltejs/kit';

// Manual spend is no longer its own ledger — /marketing/spend holds every
// medium, Meta included, so the total has one home.
export const ssr = false;

export const load = () => {
  redirect(308, '/marketing/spend');
};
