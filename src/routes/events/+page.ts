import { listEvents } from '$lib/events/data';

export const ssr = false;

export const load = async () => {
  try {
    // Include archived so the list can offer an "Archived" view +
    // restore without a refetch (the set is small).
    return { events: await listEvents({ includeArchived: true }), error: null as string | null };
  } catch (e) {
    return { events: [], error: e instanceof Error ? e.message : String(e) };
  }
};
