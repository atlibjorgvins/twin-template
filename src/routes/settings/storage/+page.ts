// Storage settings exist only where the DEVICE owns the storage decision.
// On a managed session-mode instance (KLAK) the operator chose the database;
// a member re-pointing their client would only orphan their own writes —
// same rule as the hidden wizard step.
import { redirect } from '@sveltejs/kit';
import { authEnabled } from '$lib/instance';
import type { PageLoad } from './$types';

export const load: PageLoad = () => {
  if (authEnabled()) redirect(307, '/settings');
  return {};
};
