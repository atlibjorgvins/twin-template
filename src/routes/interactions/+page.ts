// Loader for the global interactions list. Returns the most-recent 30
// activities; live filtering happens client-side via further calls to
// `searchActivities` as the user toggles chips and pickers.
import { searchActivities, listActivityKinds, type Activity, type ActivityKind } from '$lib/directus';

export const ssr = false; // matches the rest of the SPA — no SSR for live data

export async function load(): Promise<{ activities: Activity[]; kinds: ActivityKind[] }> {
  const [activities, kinds] = await Promise.all([
    searchActivities({ limit: 30 }).catch(() => [] as Activity[]),
    listActivityKinds().catch(() => [] as ActivityKind[])
  ]);
  return { activities, kinds };
}
