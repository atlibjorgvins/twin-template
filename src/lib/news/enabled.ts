// Whether the news feature exists at all, and whether you want it right now.
//
// Two switches, because they answer different questions.
//
//   BUILD TIME — is PUBLIC_NEWS_URL set? If not, the feature does not exist:
//   no nav entry, no tools tile, no card on an org page, and /news redirects
//   home. A twin built without the variable is a twin without the feature,
//   with no dead UI explaining an absence.
//
//   RUN TIME — a per-device toggle, so a twin that IS configured can still be
//   run CRM-only. Same shape as the Work/Private scope store.
//
// `$env/dynamic/public`, not `$env/static/public`. A static import of a
// variable nobody set is a svelte-check error in every build that does not
// want this feature — the dynamic form reads undefined and says nothing, which
// is what "optional" has to mean. Under adapter-static the value is still
// baked in at build time; there is no server to read it later.
//
// The WEIGHT question is answered by how this is imported, not by this file:
// the org page reaches its coverage card through a dynamic import() behind
// `newsConfigured()`, so the CRM bundle pays nothing when the feature is off.
// A static import there would pull the news client into every org page view
// whether frettir is running or not — the one way this could quietly make
// twin heavier.
import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';

export const NEWS_URL = (env.PUBLIC_NEWS_URL ?? '').replace(/\/+$/, '');
export const NEWS_TOKEN = env.PUBLIC_NEWS_TOKEN ?? '';

/** Build time: was this twin built with a news service to talk to? */
export function newsConfigured(): boolean {
  return NEWS_URL.length > 0;
}

const KEY = 'twin.news.enabled';

// Defaults to on when configured: someone who set the variable wants the
// feature, and making them hunt for a switch afterwards is a puzzle.
const initial = browser ? localStorage.getItem(KEY) !== '0' : true;

export const newsEnabled = writable<boolean>(initial);

newsEnabled.subscribe((v) => {
  if (!browser) return;
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    // Private mode. The toggle still works for this session; it just is not
    // remembered, which beats throwing on a settings page.
  }
});

/**
 * Both switches together — the only thing UI should ask.
 *
 * Checking `newsConfigured()` alone would show the feature to someone who has
 * explicitly turned it off.
 */
export function newsVisible(enabled: boolean): boolean {
  return newsConfigured() && enabled;
}
