import type { PageLoad } from './$types';
import { getGrantAward } from '$lib/directus';

export const load: PageLoad = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Error(`Bad id: ${params.id}`);
  const award = await getGrantAward(id);
  return { award };
};
