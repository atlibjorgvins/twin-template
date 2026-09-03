import { error } from '@sveltejs/kit';
import {
  getMkCampaign,
  getMkStructure,
  listMkAdAccounts,
  listMkMetrics,
  listMkCampaignTags,
  listMkTemplates,
  listProjectsForTree,
  listEvergreenForMkCampaign,
  evergreenPostCounts,
  listTags
} from '$lib/directus';

export const ssr = false;

export const load = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw error(404, 'Campaign not found');
  try {
    const [campaign, structure, metrics, campaignTags, projects, tags, templates, adAccounts, organic] =
      await Promise.all([
        getMkCampaign(id),
        getMkStructure(id),
        listMkMetrics(id),
        listMkCampaignTags(id).catch(() => []),
        listProjectsForTree().catch(() => []),
        listTags().catch(() => []),
        listMkTemplates().catch(() => []),
        listMkAdAccounts().catch(() => []),
        listEvergreenForMkCampaign(id).catch(() => [])
      ]);
    const counts = await evergreenPostCounts(organic.map((c) => c.id)).catch(() => new Map());
    const organicWithCounts = organic.map((c) => ({
      ...c,
      counts: counts.get(c.id) ?? { total: 0, used: 0 }
    }));
    return {
      campaign, structure, metrics, campaignTags, projects, tags, templates, adAccounts,
      organic: organicWithCounts,
      error: null as string | null
    };
  } catch (e) {
    throw error(404, e instanceof Error ? e.message : 'Campaign not found');
  }
};
