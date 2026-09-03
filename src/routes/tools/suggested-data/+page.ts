import { getPendingSuggestions, groupSuggestionsByOrg } from '$lib/directus';

// Client-only (adapter-static shell); the review UI mutates Directus directly.
export const ssr = false;

export const load = async () => {
  try {
    const rows = await getPendingSuggestions();
    return { groups: groupSuggestionsByOrg(rows), total: rows.length, error: null as string | null };
  } catch (e) {
    return { groups: [], total: 0, error: e instanceof Error ? e.message : String(e) };
  }
};
