import { error } from '@sveltejs/kit';
import { getNote } from '$lib/directus';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw error(404, 'Not a numeric id');
  try {
    const note = await getNote(id);
    return { note };
  } catch (e) {
    throw error(404, e instanceof Error ? e.message : 'Note not found');
  }
};
