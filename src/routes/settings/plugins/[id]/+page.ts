import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import { pluginById } from '$lib/plugins/registry';
import { CATALOGUE } from '$lib/plugins/catalogue';
import type { FeatureKey } from '$lib/instance';

// All plugin data is build-time (the registry + catalogue), so this resolves
// synchronously — no fetch. A bad id 404s rather than rendering an empty page.
export const load: PageLoad = ({ params }) => {
  const plugin = pluginById(params.id as FeatureKey);
  if (!plugin) throw error(404, `Unknown plugin: ${params.id}`);
  const catalogue = CATALOGUE.find((c) => c.provides.includes(plugin.id)) ?? null;
  return { plugin, catalogue };
};
