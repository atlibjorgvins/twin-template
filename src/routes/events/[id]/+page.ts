import { error } from '@sveltejs/kit';
import {
  getEvent,
  listEventPeople,
  listEventOrgs,
  listEventPhotos,
  listEventDates,
  importEventTaggedPhotos,
  listEventPlatformLinks
} from '$lib/events/data';
import { resolveProjectBrand } from '$lib/directus';

export const ssr = false;

export const load = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw error(404, 'Event not found');
  try {
    const event = await getEvent(id);
    const projectId =
      typeof event.project_id === 'object' ? event.project_id?.id : event.project_id;
    // Materialize any Immich library tags into the gallery before reading
    // it, so photos tagged in the navigator show here automatically.
    // Idempotent + cheap once done; ignore failures (e.g. Immich offline).
    await importEventTaggedPhotos(id).catch(() => {});
    const [people, orgs, photos, dates, brand, links] = await Promise.all([
      listEventPeople(id),
      listEventOrgs(id),
      listEventPhotos(id),
      listEventDates(id),
      projectId != null ? resolveProjectBrand(projectId).catch(() => null) : Promise.resolve(null),
      listEventPlatformLinks(id).catch(() => [])
    ]);
    return { event, people, orgs, photos, dates, brand, links, error: null as string | null };
  } catch (e) {
    throw error(404, e instanceof Error ? e.message : 'Event not found');
  }
};
