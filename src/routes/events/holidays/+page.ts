import { redirect } from '@sveltejs/kit';

// Holidays moved under /calendar.
export const ssr = false;
export const load = ({ url }) => {
  throw redirect(308, `/calendar/holidays${url.search}`);
};
