import {
  listBirthdaysInRange,
  listDatesInRange,
  listFollowUpsDue,
  listActivities,
  type Activity,
  type CalendarEvent,
  type DateEvent,
  type Note,
} from '$lib/directus';
import { expandRecurrence } from '$lib/recurrence';

export const ssr = false; // PWA pulls live data client-side; matches the rest of the app.

/**
 * Today dashboard loader. Runs once on every navigation to `/` and assembles
 * the four data sources the dashboard renders. We deliberately keep this
 * function dumb — five parallel reads, returned as-is — so the page component
 * can stay declarative.
 */
export async function load(): Promise<{
  asOf: string;
  birthdaysToday: CalendarEvent[];
  birthdaysWeek: CalendarEvent[];
  eventsToday: DateEvent[];
  /** Everything from tomorrow to +7d, already expanded and sorted — the
   *  agenda the dashboard shows under Today. */
  upcoming: DateEvent[];
  followUps: Note[];
  recent: Activity[];
}> {
  // Anchor "today" to the user's local midnight so the same date math works
  // for both birthday matching (date-only field) and event overlap (instants).
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const sevenDaysOut = new Date(startOfToday);
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);

  // One read for the whole week, not one for today and another for the rest:
  // listDatesInRange returns recurring ANCHORS, so both windows need the same
  // expandRecurrence pass anyway, and today is just a slice of the result.
  //
  // allSettled, not all: this is the FIRST page a fresh install renders, and
  // a rejected read here used to surface as a bare "500 Internal Error" —
  // the worst possible first screen when the backend is unreachable or not
  // yet configured. Each source degrades to empty; the offline banner (and
  // each section's own empty state) tells the story, the page still stands.
  const settled = await Promise.allSettled([
    listBirthdaysInRange(startOfToday, startOfTomorrow),
    listBirthdaysInRange(startOfToday, sevenDaysOut),
    listDatesInRange(startOfToday, sevenDaysOut),
    listFollowUpsDue(startOfToday, 10),
    // Recent activity is a glance on this page, not the record — /interactions
    // is the record. Five rows is what fits without pushing the agenda under
    // the fold, which is the thing you actually came here to read.
    listActivities({ limit: 5 }),
  ]);
  const or = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
    r.status === 'fulfilled' ? r.value : fallback;
  const todaysBirthdays = or(settled[0] as PromiseSettledResult<CalendarEvent[]>, []);
  const weekBirthdays = or(settled[1] as PromiseSettledResult<CalendarEvent[]>, []);
  const rawWeekRows = or(settled[2] as PromiseSettledResult<DateEvent[]>, []);
  const followUps = or(settled[3] as PromiseSettledResult<Note[]>, []);
  const recent = or(settled[4] as PromiseSettledResult<Activity[]>, []);

  // listDatesInRange returns BOTH one-shot rows that overlap the
  // window AND every recurring anchor whose start <= rangeEnd —
  // anchors from January (Bun Day, Þrettándinn, …) come back even
  // when today is May. We have to run expandRecurrence per row to
  // see whether the rule produces an occurrence that actually falls
  // inside [startOfToday, startOfTomorrow).
  const expand = (from: Date, to: Date) =>
    rawWeekRows
      .flatMap((row) => {
        const occurrences = expandRecurrence(row, from, to);
        if (occurrences.length === 0) return [];
        // Substitute the occurrence's start/end so the UI shows the instance,
        // not the anchor row from January.
        return occurrences.map((occ) => ({ ...row, start: occ.start, end: occ.end }));
      })
      .sort((a, b) => new Date(a.start ?? 0).getTime() - new Date(b.start ?? 0).getTime());

  // Today is expanded against TODAY's window, not sliced out of the week's.
  // expandRecurrence clips an occurrence to the window it is given, so an
  // event that began yesterday and runs through today comes back with a start
  // of yesterday when the window is the whole week — and a naive
  // "starts today" filter then drops it. Slicing took the dashboard from
  // three of today's events to one.
  const todaysEvents = expand(startOfToday, startOfTomorrow);

  // Everything after today, expanded against the rest of the week.
  const laterEvents = expand(startOfTomorrow, sevenDaysOut);

  // Drop today's birthdays from the week list — the page renders them in their
  // own callout. Same for events: today's go to the dedicated row, the week
  // version is unused here but cheap enough to keep the API symmetrical.
  const todayKeys = new Set(todaysBirthdays.map((b) => b.key));

  return {
    asOf: startOfToday.toISOString(),
    birthdaysToday: todaysBirthdays,
    birthdaysWeek: weekBirthdays.filter((b) => !todayKeys.has(b.key)),
    eventsToday: todaysEvents,
    upcoming: laterEvents,
    followUps,
    recent,
  };
}
