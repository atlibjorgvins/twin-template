import { loadMarketing, defaultWindow } from '$lib/marketing/data';
import { listEvents, type EventRecord } from '$lib/events/data';
import type { MarketingBundle } from '$lib/marketing/metrics';

export const ssr = false;

export const load = async () => {
  const window = defaultWindow();
  try {
    const [bundle, events] = await Promise.all([
      loadMarketing(window),
      listEvents().catch(() => [] as EventRecord[])
    ]);
    return { bundle, events, error: null as string | null };
  } catch (e) {
    return {
      bundle: {
        meta: [], manual: [], breakdowns: [], budgets: [], projects: [], mediums: [], window
      } as MarketingBundle,
      events: [] as EventRecord[],
      error: e instanceof Error ? e.message : String(e)
    };
  }
};
