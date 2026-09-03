// /login exists only in session mode. In static-token mode there is no such
// thing as signing in, so bounce to the app — a stray bookmark or link should
// not land on a dead form.
import { redirect } from '@sveltejs/kit';
import { authEnabled } from '$lib/instance';
import type { PageLoad } from './$types';

export const load: PageLoad = () => {
  if (!authEnabled()) redirect(307, '/');
  return {};
};
