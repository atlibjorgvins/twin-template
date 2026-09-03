import { listAllMetaCampaigns, listProjectsForTree, listMetaCampaignEventLinks } from '$lib/directus';
import { listEvents } from '$lib/events/data';

export const ssr = false;

export const load = async () => {
  try {
    const [campaigns, projects, events, eventLinks] = await Promise.all([
      listAllMetaCampaigns(),
      listProjectsForTree().catch(() => []),
      listEvents().catch(() => []),
      listMetaCampaignEventLinks().catch(() => [])
    ]);
    return { campaigns, projects, events, eventLinks, error: null as string | null };
  } catch (e) {
    return { campaigns: [], projects: [], events: [], eventLinks: [], error: e instanceof Error ? e.message : String(e) };
  }
};
