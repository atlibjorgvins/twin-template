// Loader for /calendar/holidays. Pulls every Dates row tagged with
// event_type='holiday' (regardless of status, since archived holidays
// shouldn't surface here — but Directus's listDatesInRange already
// filters _neq archived). We don't filter by date range: the holiday
// list shows the full catalogue, and we use the recurrence engine
// client-side to compute the next occurrence per row.
import { directus, type DateEvent } from '$lib/directus';
import { readItems } from '@directus/sdk';

export const ssr = false;

export type HolidaysData = {
  rows: DateEvent[];
};

const HOLIDAY_FIELDS = [
  'id', 'title', 'description',
  'event_type', 'start', 'end', 'all_day', 'color',
  'is_recurring', 'recurrence_rule', 'recurrence_end_date',
  'source', 'source_ref', 'scope', 'status',
  { project_id: ['id', 'name', 'kind'] },
  { organization: ['id', 'name', 'logo', 'image_focal'] }
] as const;

export async function load(): Promise<HolidaysData> {
  try {
    const rows = (await directus.request(
      readItems('Dates', {
        filter: {
          _and: [
            { status: { _neq: 'archived' } },
            { event_type: { _eq: 'holiday' } }
          ]
        } as never,
        fields: HOLIDAY_FIELDS as never,
        sort: ['title'],
        limit: -1
      })
    )) as DateEvent[];
    return { rows };
  } catch {
    return { rows: [] };
  }
}
