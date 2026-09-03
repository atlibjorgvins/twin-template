// Where Directus is, from the browser's point of view.
//
// Two shapes are valid for PUBLIC_DIRECTUS_URL:
//
//   ABSOLUTE  https://twin.example.com   — the personal twin.
//             One host, one tailnet, one URL baked into the bundle.
//
//   PATH      /api                                        — the KLAK twin.
//             Directus is proxied by the same nginx that serves the app, so
//             the API is always same-origin. This is what makes more than one
//             front door possible: staff reach the site at
//             https://klaki.<klak-tailnet>.ts.net and Atli reaches the very
//             same bundle at https://your-server…:8448 on the personal
//             tailnet, and both work, because neither one has an API hostname
//             hard-coded into it. It also means no CORS: same origin, no
//             preflight, nothing to keep in sync when a hostname changes.
//
// Most callers interpolate the value into a fetch URL — `${BASE}/files/x` —
// and a leading-slash path resolves against the origin on its own, so they
// need no help. The two that DO need an absolute URL are the SDK
// (`createDirectus` parses it) and anything doing `new URL(...)` on it.
import { PUBLIC_DIRECTUS_URL } from '$env/static/public';
import { deviceDirectusUrl } from '$lib/data/repo/directusConfig';

/** As configured. Safe in template literals; may be a path. */
export const DIRECTUS_BASE = (PUBLIC_DIRECTUS_URL ?? '').replace(/\/+$/, '');

/**
 * The same base, guaranteed absolute — for `new URL()` and the Directus SDK.
 *
 * A function rather than a const because it reads `location`: a const would
 * be evaluated when the module is first imported, which is fine in the
 * browser but throws in a `node --test` run of anything downstream.
 */
export function directusAbsolute(): string {
  // A device-level connection (set in /welcome when the user picked "external
  // Directus" on a shipped bundle) beats the build default — same precedence
  // as the backend choice itself (data/repo/choice.ts). Always absolute.
  const device = deviceDirectusUrl();
  if (device) return device;
  // No URL configured anywhere (local-backend build, bare clone): return a
  // dead-end that is still a VALID absolute URL. The SDK client is built
  // eagerly at module init and `new URL('')` throws — which took the whole
  // app down, not just the unused Directus path. Nothing dials this in local
  // mode; if a port leak does, it fails fast and visibly.
  if (!DIRECTUS_BASE) return 'http://localhost:8055';
  if (!DIRECTUS_BASE.startsWith('/')) return DIRECTUS_BASE;
  if (typeof location === 'undefined') return 'http://localhost:8055' + DIRECTUS_BASE;
  return location.origin + DIRECTUS_BASE;
}


/**
 * Where Immich is, from the browser's point of view — the same two shapes.
 *
 *   ABSOLUTE config  the Directus host with the port swapped to 8444, which is
 *                    how the personal twin reached Immich before the same-origin
 *                    move: a key-injecting nginx proxy on its own public port.
 *   PATH config      `/immich`, proxied by the same nginx that serves the app,
 *                    exactly like `/api` for Directus. No second host, no port
 *                    to swap, no CORS.
 *
 * This used to live inline in immich.ts as `new URL(directusAbsolute()); u.port
 * = '8444'`. That breaks the moment PUBLIC_DIRECTUS_URL is a path: the fallback
 * origin is the app's own (…:8443), and swapping its port to 8444 points at
 * nothing. Keeping both shapes here means the /api migration does not force
 * itself on dev or on a rollback — an absolute config still gets the :8444 host.
 */
export function immichBase(): string {
  if (DIRECTUS_BASE.startsWith('/')) return '/immich';
  const u = new URL(directusAbsolute());
  u.port = '8444';
  u.pathname = '';
  u.search = '';
  return u.toString().replace(/\/$/, '');
}
