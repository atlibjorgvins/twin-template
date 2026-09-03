import type { PageLoad } from './$types';
import { listGrants, listGrantAwards } from '$lib/directus';

export const load: PageLoad = async () => {
  const [grants, awards] = await Promise.all([
    listGrants().catch(() => []),
    listGrantAwards().catch(() => [])
  ]);
  return { grants, awards };
};
