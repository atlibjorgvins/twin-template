// The Directus client, and nothing else.
//
// Split out of directus.ts (11,151 lines) as the first step of the data-layer
// work in docs/opening-up-twin.md. This module sits at the BOTTOM of the
// dependency graph on purpose: every domain module imports the client, so the
// client must import no domain module. That is what makes the rest of the split
// possible without circular imports.
//
// Schema now lives in data/schema.ts, beside the types it indexes. That was the
// stopgap this file opened with — a type-only import back into directus.ts —
// and it is closed: nothing in src/lib/data imports directus.ts any more.
import { createDirectus, rest, staticToken, authentication } from '@directus/sdk';
import { PUBLIC_DIRECTUS_URL, PUBLIC_DIRECTUS_TOKEN } from '$env/static/public';
import { deviceDirectusToken } from '$lib/data/repo/directusConfig';
export { authHeader, assetAuthParam } from '$lib/data/credentials';
import { directusAbsolute } from '$lib/apiBase';
import { authEnabled } from '$lib/instance';
import type { Schema } from '$lib/data/schema';

/** A Directus filter object. Deliberately loose: the SDK's generic Filter is
 *  unusable against the collections reached with `as never`, which is most of
 *  them until Schema covers all 24. */
export type Filter = Record<string, unknown>;

// ── Request coalescing ───────────────────────────────────────────────────
//
// Independent components ask for the same thing at the same time. Measured on
// /orgs/2: 45 API calls but only 28 distinct URLs — 17 requests were
// byte-for-byte repeats of one already in flight. The org's brand row alone
// was fetched four times, because every component that needs a brand resolves
// it for itself.
//
// Rather than thread a cache through a dozen call sites, dedupe at the
// transport: if an identical GET is already running, hand back the same
// promise. Two simultaneous identical reads would have returned the same
// bytes anyway, so this is invisible to callers.
//
// Deliberately narrow:
//   - GET only. Writes always go to the server.
//   - Any write clears the table, so a read after a save is never served a
//     settled entry from before it.
//   - Settled entries live 800ms — long enough to catch components that mount
//     a few hundred ms apart during one page load, too short to be a cache.
//
// Every caller gets `.clone()`: a Response body can only be read once, so
// sharing the original would make the second reader throw.
const inFlightGets = new Map<string, Promise<Response>>();
const COALESCE_WINDOW_MS = 800;

function coalescingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'GET') {
    inFlightGets.clear();
    return fetch(input, init);
  }
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const running = inFlightGets.get(url);
  if (running) return running.then((r) => r.clone());

  const p = fetch(input, init);
  inFlightGets.set(url, p);
  p.then(
    () => setTimeout(() => inFlightGets.delete(url), COALESCE_WINDOW_MS),
    () => inFlightGets.delete(url)
  );
  return p.then((r) => r.clone());
}

function buildClient() {
  // The SDK calls `new URL(base)` internally, which throws on a path like
  // '/api'. So it must get an absolute URL even when PUBLIC_DIRECTUS_URL is a
  // path — directusAbsolute() resolves '/api' against location.origin. (The
  // /api flip broke exactly here before this line used directusAbsolute.)
  const client = createDirectus<Schema>(directusAbsolute(), {
    globals: { fetch: coalescingFetch }
  });

  // Session mode (PUBLIC_AUTH_MODE=session): a real login. Directus sets an
  // httpOnly session cookie, the SDK refreshes it, and nothing lives in the
  // bundle or the DOM. `credentials: 'include'` so the cookie rides every
  // request — including the same-origin /api and /immich fetches. No
  // staticToken: the whole point is that there is no shared token.
  if (authEnabled()) {
    return client
      .with(authentication('session', { autoRefresh: true, credentials: 'include' }))
      .with(rest({ credentials: 'include' }));
  }

  // Static-token mode. The device-level token (entered in /welcome on a
  // shipped bundle connecting to an external Directus) beats the build's,
  // same precedence as the URL in apiBase.directusAbsolute(). An unset
  // PUBLIC_AUTH_MODE with neither token is an anonymous client — valid
  // against a Directus with public read roles.
  const token = deviceDirectusToken() || PUBLIC_DIRECTUS_TOKEN;
  if (token) {
    return client.with(staticToken(token)).with(rest());
  }
  return client.with(rest());
}

export const directus = buildClient();

/**
 * The Authorization header for direct `fetch` calls that bypass the SDK —
 * file uploads, the OCR hand-off, Asana, the enrichment probes.
 *
 * It exists so that "where does the credential come from" has exactly ONE
 * answer. Nine call sites across six files used to interpolate
 * PUBLIC_DIRECTUS_TOKEN into a template literal themselves, which meant a
 * login would have had to find and change all nine — and a missed one is a
 * feature that keeps working until the session rotates, then fails somewhere
 * nobody is looking.
 *
 * Today it returns the build-time token, so this is a pure refactor. When the
 * session lands (docs/phase2-auth.md §4) this function starts returning the
 * live access token and nothing else has to change.
 */

/**
 * The credential for asset URLs — `<img src>`, `<video src>`, download links.
 *
 * Separate from authHeader() because it cannot be a header: an <img> tag has no
 * way to send one, so Directus takes `?access_token=` in the query string
 * instead. That is a materially worse place for a credential than a header —
 * it lands in the DOM, in browser history, in referrers, and in any screenshot
 * of devtools — and today the credential in question is an admin token.
 *
 * This is the widest exposure of the token in the app, and it is the reason the
 * session work has to use COOKIES rather than a bearer token: a cookie is sent
 * by <img> automatically, a header is not. See docs/phase2-auth.md §4.
 *
 * Isolated here so that when sessions land there is one function to change
 * rather than a search for every image in the codebase.
 */
