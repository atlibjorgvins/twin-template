// Kiosk event view — what an event looks like when you tap it on the wall.
//
// The normal calendar answers "where does this sit in my month", which needs
// the whole grid and a compact modal on top. From the wall the question is
// just "what is this, when, and who" — so this route loads the one event and
// nothing else.
import { error } from '@sveltejs/kit';
import {
  getDateRow,
  getDatePeople,
  type DateEvent,
  type DatePerson
} from '$lib/directus';

export const ssr = false;

export type KioskEventData = {
  event: DateEvent;
  people: DatePerson[];
  /** The occurrence the user actually tapped, ISO. */
  on: string | null;
};

export async function load({ params, url }): Promise<KioskEventData> {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw error(404, 'Event not found');
  try {
    const [event, people] = await Promise.all([
      getDateRow(id),
      // Attendees are a nice-to-have: an event with none should still render,
      // so a failure here must not take the page down.
      getDatePeople(id).catch(() => [] as DatePerson[])
    ]);
    return { event, people, on: url.searchParams.get('on') };
  } catch {
    throw error(404, 'Event not found');
  }
}
