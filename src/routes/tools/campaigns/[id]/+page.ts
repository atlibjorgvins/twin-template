import { redirect } from '@sveltejs/kit';

// A campaign kept its id, only its address changed.
export const ssr = false;

export const load = ({ params }) => {
  redirect(308, `/marketing/${params.id}`);
};
