// The device-level Directus connection — URL and (optionally) a static token,
// entered in the /welcome storage step and stored in localStorage.
//
// This is what stops twin RELYING on Directus being configured at build time:
// the build's PUBLIC_DIRECTUS_URL / PUBLIC_DIRECTUS_TOKEN remain the default
// (self-hosters with an .env keep exactly today's behaviour, and session-mode
// deployments are always build-configured), but a shipped bundle — the .dmg,
// the GitHub template — can connect to a Directus the user names at runtime,
// the same way the Supabase option takes a URL + anon key.
//
// Deliberately dependency-free and lazy (localStorage read per call, guarded)
// so apiBase.ts and client.ts — the bottom of the dependency graph — can use
// it, and node tests can import anything downstream without a browser.

import { activeVault, updateActiveVault } from './vaults';

function safe(fn: () => string): string {
  try {
    if (typeof localStorage === 'undefined') return '';
    return fn();
  } catch {
    return '';
  }
}

/** The ACTIVE VAULT's Directus URL, '' when the build default applies. (The
 *  pre-vault twin.directusUrl key migrates into the primary vault — see
 *  vaults.ts.) */
export function deviceDirectusUrl(): string {
  return safe(() => (activeVault().directusUrl ?? '').trim().replace(/\/+$/, ''));
}

/** The active vault's static token, '' when the build default applies.
 *  Meaningless in session mode (the cookie is the credential) — the storage
 *  step is hidden there, so this can never be set on such an instance. */
export function deviceDirectusToken(): string {
  return safe(() => (activeVault().directusToken ?? '').trim());
}

/** Persist the connection into the active vault (from the /welcome storage
 *  step or Settings → Storage). Empty strings clear the override so the
 *  build default applies again. */
export function saveDirectusConnection(url: string, token: string): void {
  try {
    updateActiveVault({
      directusUrl: url.trim().replace(/\/+$/, '') || undefined,
      directusToken: token.trim() || undefined
    });
  } catch {
    /* private mode — the build default keeps applying */
  }
}
