import { error } from '@sveltejs/kit';
import {
  getCampaign,
  listBufferChannels,
  listCampaignPosts,
  listPostingIdentities,
  listProjectRoles,
  listProjectsForTree,
  listMkCampaigns,
  listTags
} from '$lib/directus';
import { listImageTemplates } from '$lib/studio/data';

export const ssr = false;

export const load = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw error(404, 'Campaign not found');
  try {
    const [campaign, posts, projects, tags, identities, bufferChannels, projectRoles, studioTemplates, mkCampaigns] = await Promise.all([
      getCampaign(id),
      listCampaignPosts(id),
      listProjectsForTree(),
      listTags(),
      listPostingIdentities(),
      // Channel snapshot is optional — posting just hides if missing.
      listBufferChannels().catch(() => []),
      listProjectRoles().catch(() => []),
      // Studio templates power the "Studio template" image source —
      // one-off batches are deliberately not offered here.
      listImageTemplates()
        .then((ts) => ts.filter((t) => t.kind !== 'oneoff'))
        .catch(() => []),
      // Marketing campaigns — for tying this content to one (F5).
      listMkCampaigns().catch(() => [])
    ]);
    return {
      campaign, posts, projects, tags, identities, bufferChannels, projectRoles, studioTemplates, mkCampaigns,
      error: null as string | null
    };
  } catch (e) {
    throw error(404, e instanceof Error ? e.message : 'Campaign not found');
  }
};
