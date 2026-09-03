// The Directus credential helpers — split from client.ts so that modules
// which only need a header (uploads, OCR hand-off, enrichment probes) do not
// drag the @directus/sdk bundle into the boot graph. client.ts re-exports
// these for back-compat; new call sites import from here.
//
// "Where does the credential come from" still has exactly ONE answer.
import { PUBLIC_DIRECTUS_TOKEN } from '$env/static/public';
import { authEnabled } from '$lib/instance';
import { deviceDirectusToken } from '$lib/data/repo/directusConfig';

/** The Authorization header for direct fetch calls that bypass the SDK. */
export function authHeader(): Record<string, string> {
  // Session mode: the httpOnly cookie authenticates every request, so there is
  // no header to add (and no token in JS to build one from). Static-token mode:
  // the bearer header, exactly as before.
  if (authEnabled()) return {};
  const token = deviceDirectusToken() || PUBLIC_DIRECTUS_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** The credential for asset URLs — `<img src>` cannot send a header, so
 *  Directus takes `?access_token=` in the query string. See client.ts for the
 *  history of why sessions use cookies instead. */
export function assetAuthParam(): Record<string, string> {
  if (authEnabled()) return {};
  const token = deviceDirectusToken() || PUBLIC_DIRECTUS_TOKEN;
  return token ? { access_token: token } : {};
}
