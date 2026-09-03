// Clockify rejections, turned into something you can act on.
//
// The raw API text names neither the twin project nor where to fix it, and it
// lands in a `push_error` column that someone reads days later wondering why
// hours are missing. What that person needs is the next click.
//
// No imports on purpose — bare node runs this (npm run test:clockify-errors).

/**
 * The failure that actually happens.
 *
 * A workspace with `forceProjects` on — as KLAK's is — refuses any entry
 * without a project, so a session whose project has no mapping at or above it
 * fails outright. This code used to assume such an entry would quietly arrive
 * project-less; it does not, and the hours simply never landed.
 */
export function explainPushFailure(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);

  // Clockify returns both halves in one sentence ("Project is either required
  // field or given project is archived"), so check archived first — it is the
  // more specific diagnosis of the two.
  if (/archived/i.test(raw) && !/is either required/i.test(raw)) {
    return `The mapped Clockify project is archived, so it will not accept entries. Re-map this project under Settings → Clockify. (${raw.slice(0, 160)})`;
  }
  if (/project is either required|forceprojects/i.test(raw)) {
    return 'Clockify requires a project on every entry, and nothing is mapped for this task. Map its project — or any parent of it — under Settings → Clockify, then push again.';
  }
  if (/\b(401|403)\b|api key|unauthor/i.test(raw)) {
    return 'Clockify rejected the API key. Check the “Clockify API proxy” Flow in Directus — its X-Api-Key header holds the key.';
  }
  return raw;
}
