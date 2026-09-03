import { redirect } from '@sveltejs/kit';

// Reporting moved. The portfolio rollup this page carried is now on Plan, and
// the deep drills — age, gender, placement, region — belong on /insights next
// to the programme's people rather than in a tool you have to know about.
export const ssr = false;

export const load = () => {
  redirect(308, '/marketing');
};
