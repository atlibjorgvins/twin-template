// The calendar is now a single unified grid — the old per-calendar
// landing tiles became type-filter chips on the grid itself. Anyone
// landing on /calendar goes straight to the grid.
import { redirect } from '@sveltejs/kit';

export const ssr = false;

export function load(): never {
  redirect(307, '/calendar/grid');
}
