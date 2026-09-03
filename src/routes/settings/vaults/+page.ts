// Vaults exist only where the DEVICE owns its connections. A managed
// session-mode instance (KLAK's own deployment) IS a vault — its members
// don't re-point it. Same rule as Settings → Storage.
import { redirect } from '@sveltejs/kit';
import { authEnabled } from '$lib/instance';
import type { PageLoad } from './$types';

export const load: PageLoad = () => {
  if (authEnabled()) redirect(307, '/settings');
  return {};
};
