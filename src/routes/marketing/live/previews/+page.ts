import { listAllMetaCampaigns, listAdPreviews } from '$lib/directus';

export const ssr = false;

export const load = async () => {
  try {
    const [campaigns, previews] = await Promise.all([
      listAllMetaCampaigns(),
      listAdPreviews().catch(() => [])
    ]);
    return { campaigns, previews, error: null as string | null };
  } catch (e) {
    return { campaigns: [], previews: [], error: e instanceof Error ? e.message : String(e) };
  }
};
