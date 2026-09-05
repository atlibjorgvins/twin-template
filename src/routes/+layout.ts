// SPA mode — no SSR; Directus calls run in the browser over Tailscale at A2,
// localhost during A1.
import { redirect } from '@sveltejs/kit';
import { pathAllowed, authEnabled } from '$lib/instance';
import { whoAmI } from '$lib/data/auth';
import { loadPluginConfig } from '$lib/data/pluginConfig';
import { mediaReady, auth } from '$lib/data/repo';
import { activeVault } from '$lib/data/repo/vaults';
import { browser } from '$app/environment';
import { isOnboarded } from '$lib/profile.svelte';
import type { LayoutLoad } from './$types';

// Routes the onboarding redirect must never touch: the wizard itself, the
// sign-in page (auth outranks onboarding), the PWA share/capture targets
// (redirecting one away silently drops the thing being shared), and the
// unattended wall screens where a wizard would just be a hung kiosk.
const ONBOARDING_EXEMPT = ['/welcome', '/login', '/vault-login', '/join', '/share', '/capture', '/display', '/kiosk', '/spotlight'];

// One auth probe per page load — the managed-vault gate runs on every
// navigation, but the session answer cannot change without a reload anyway.
let _vaultUser: Promise<boolean> | null = null;
function vaultSignedIn(): Promise<boolean> {
  if (!_vaultUser) _vaultUser = auth.me<{ id: string }>(['id']).then((u) => !!u?.id, () => false);
  return _vaultUser;
}

export const ssr = false;
export const prerender = false;
export const trailingSlash = 'ignore';

// The one place a switched-off module is actually closed. Hiding a tile or a
// nav row is cosmetic: a bookmark, the command palette, a link in a note and
// the back button all still reach the route, and a workplace twin that opens
// /tools/finances because someone kept the URL is not "off". Checked here,
// once, for every navigation — `url` makes this load re-run on each one.
export const load: LayoutLoad = async ({ url }) => {
  // Device media (local backend, or "media on this device"): build the blob
  // store's object-URL map before anything renders — assetSrc is synchronous
  // by contract, so it must be able to answer from the first template call.
  await mediaReady();

  // Hydrate cross-device plugin config (the enabled set + inline settings) from
  // Directus before gating, so pathAllowed/featureOn below see the synced state.
  // Once per session; falls back to localStorage when signed out / offline / the
  // plugin_sync collection doesn't exist yet.
  // Plugin config syncs through the active backend when it can hold it: a
  // session-mode Directus, or a managed vault's shared plugin_sync table —
  // so a team vault carries its plugin setup to every member. Degrades to
  // localStorage silently everywhere else.
  if (authEnabled() || (browser && activeVault().managed)) await loadPluginConfig();

  if (!pathAllowed(url.pathname)) redirect(307, '/');

  // Managed vault: members must be signed in (Supabase Auth). The vault
  // login page itself and the wizard stay reachable, and the spotlight
  // window shows empty results rather than a login form.
  if (
    browser &&
    activeVault().managed &&
    !['/vault-login', '/welcome', '/spotlight', '/join'].some((p) => url.pathname.startsWith(p))
  ) {
    if (!(await vaultSignedIn())) redirect(307, '/vault-login');
    // Signed in — resolve the member's role so write controls know to hide
    // for a viewer. Cached; the RLS policy is the real enforcer regardless.
    await (await import('$lib/data/repo/vaultRole')).loadVaultRole();
  }

  // First run on this device → the onboarding wizard, once. Device-local
  // (twin.onboarded in localStorage), checked after the feature gate and
  // before auth so a signed-out session-mode user still lands on /login first.
  const needsOnboarding =
    !isOnboarded() && !ONBOARDING_EXEMPT.some((p) => url.pathname.startsWith(p));

  // Session mode only: everything except /login itself requires a signed-in
  // user. whoAmI() probes the session cookie; null means 401 / not signed in.
  // In static-token mode authEnabled() is false and this whole block is skipped
  // — the guard is invisible to the personal build until the flag is set.
  if (authEnabled() && url.pathname !== '/login') {
    const me = await whoAmI();
    if (!me) redirect(307, '/login');
    if (needsOnboarding) redirect(307, '/welcome');
    return { me };
  }
  if (needsOnboarding) redirect(307, '/welcome');
  return {};
};
