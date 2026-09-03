import { redirect } from '@sveltejs/kit';

// Ad previews are about what is running, so they sit under Live.
export const ssr = false;

export const load = () => {
  redirect(308, '/marketing/live/previews');
};
