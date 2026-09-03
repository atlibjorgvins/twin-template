import { listMkCampaigns, type MkCampaign } from '$lib/directus';
import { loadMarketing, defaultWindow } from '$lib/marketing/data';
import type { MarketingBundle } from '$lib/marketing/metrics';

export const ssr = false;

// The trailing year is fetched ONCE and every period chip filters it in the
// browser. A chip must not cost a round-trip: the whole point of the read model
// is that the arithmetic is cheap and pure.
export const load = async () => {
  const window = defaultWindow();
  try {
    const [bundle, campaigns] = await Promise.all([
      loadMarketing(window),
      listMkCampaigns().catch(() => [] as MkCampaign[])
    ]);
    return { bundle, campaigns, error: null as string | null };
  } catch (e) {
    return {
      bundle: {
        meta: [], manual: [], breakdowns: [], budgets: [], projects: [], mediums: [], window
      } as MarketingBundle,
      campaigns: [] as MkCampaign[],
      error: e instanceof Error ? e.message : String(e)
    };
  }
};
