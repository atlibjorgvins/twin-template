import { listCampaigns } from '$lib/directus';

export const ssr = false;

export const load = async () => {
  try {
    return { campaigns: await listCampaigns(), error: null as string | null };
  } catch (e) {
    return { campaigns: [], error: e instanceof Error ? e.message : String(e) };
  }
};
