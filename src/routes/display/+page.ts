// Always-on tablet display. A read-only wall view: what is next, what is on
// today, what is coming, and the weather.
//
// Deliberately NOT the Today page. Today is a workspace you touch — quick
// actions, the activity feed, follow-ups. A screen on a wall is read from
// across a room and never tapped, so this loads only what earns its place at
// that distance and drops everything that assumes a hand on the glass.
import {
  listBirthdaysInRange,
  listDatesInRange,
  type CalendarEvent,
  type DateEvent
} from '$lib/directus';
import { expandRecurrence } from '$lib/recurrence';

export const ssr = false;

export type DisplayData = {
  asOf: string;
  /** Every occurrence from now to +7d, already expanded and sorted. */
  upcoming: DateEvent[];
  eventsToday: DateEvent[];
  birthdaysToday: CalendarEvent[];
  birthdaysWeek: CalendarEvent[];
};

export async function load(): Promise<DisplayData> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const weekOut = new Date(startOfToday);
  weekOut.setDate(weekOut.getDate() + 7);

  const [rawWeek, birthdaysToday, birthdaysWeek] = await Promise.all([
    listDatesInRange(startOfToday, weekOut),
    listBirthdaysInRange(startOfToday, startOfTomorrow),
    listBirthdaysInRange(startOfToday, weekOut)
  ]);

  // listDatesInRange returns recurring ANCHORS, not occurrences — a January
  // anchor comes back in July. expandRecurrence turns each row into the
  // instances that actually fall in the window; without it the wall would
  // show Þrettándinn in midsummer.
  const occurrences = rawWeek
    .flatMap((row) =>
      expandRecurrence(row, startOfToday, weekOut).map((occ) => ({
        ...row,
        start: occ.start,
        end: occ.end
      }))
    )
    .sort((a, b) => new Date(a.start ?? 0).getTime() - new Date(b.start ?? 0).getTime());

  const todayKeys = new Set(birthdaysToday.map((b) => b.key));

  return {
    asOf: now.toISOString(),
    upcoming: occurrences,
    eventsToday: occurrences.filter((e) => {
      const t = new Date(e.start ?? 0).getTime();
      return t >= startOfToday.getTime() && t < startOfTomorrow.getTime();
    }),
    birthdaysToday,
    birthdaysWeek: birthdaysWeek.filter((b) => !todayKeys.has(b.key))
  };
}
