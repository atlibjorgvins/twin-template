import { redirect } from '@sveltejs/kit';

// Calendar moved to /calendar/grid. Preserve old deep-links (home
// "Today" card, person/org linked-events, bookmarks) by forwarding
// the query string (?event=, ?source=, ?view=, ?d=). This static
// route wins over the new /events/[id] happening detail.
export const ssr = false;
export const load = ({ url }) => {
  throw redirect(308, `/calendar/grid${url.search}`);
};
