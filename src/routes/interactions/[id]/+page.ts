// Loader for a single interaction (Activity). Fetches the row and the
// people linked via the Activity_Person junction so the page can render
// avatars + roles without a second round-trip.
import { error } from '@sveltejs/kit';
import { getActivity, getActivityPeople, getActivityOrgs, type Activity, type ActivityPerson, type ActivityOrg } from '$lib/directus';

export const ssr = false;

export async function load({ params }): Promise<{ activity: Activity; people: ActivityPerson[]; orgs: ActivityOrg[] }> {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw error(404, 'Not found');
  try {
    const [activity, people, orgs] = await Promise.all([
      getActivity(id),
      getActivityPeople(id).catch(() => [] as ActivityPerson[]),
      getActivityOrgs(id).catch(() => [] as ActivityOrg[])
    ]);
    if (!activity) throw error(404, 'Interaction not found');
    return { activity, people, orgs };
  } catch (e) {
    if ((e as { status?: number })?.status === 404) throw e;
    throw error(404, 'Interaction not found');
  }
}
