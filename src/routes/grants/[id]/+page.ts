import type { PageLoad } from './$types';
import { getGrant, listGrantAwards } from '$lib/directus';

export const load: PageLoad = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Error(`Bad id: ${params.id}`);
  const [grant, awards] = await Promise.all([
    getGrant(id),
    listGrantAwards({ grantId: id }).catch(() => [])
  ]);
  return { grant, awards };
};
