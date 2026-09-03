// Login, logout, and "who am I" — the session half of phase 2.
//
// Only meaningful when PUBLIC_AUTH_MODE=session (authEnabled()). With the flag
// off, the app never imports a route that calls these: the static token in
// client.ts authenticates everything and there is no such thing as a session.
// Keeping the calls here rather than in client.ts preserves client.ts's rule
// of importing no domain concern — auth is a concern, the client is transport.
import { auth } from '$lib/data/repo';
import { authEnabled } from '$lib/instance';
import { clearNeedsAuth } from '$lib/offline';
import { flushQueue } from '$lib/writeQueue';

export type Me = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  /** The role id — the member/owner distinction is read from this later. */
  role: string | null;
};

/**
 * Sign in. Session mode: Directus sets an httpOnly cookie and the SDK begins
 * auto-refreshing it. Nothing is returned to store — the whole point of session
 * mode is that the browser holds the credential, not JS.
 *
 * Throws on bad credentials; the /login page turns that into a message.
 */
export async function login(email: string, password: string): Promise<void> {
  await auth.login(email, password);

  // The session is fresh again: clear the pause and replay whatever the expired
  // session had been holding. But login() resolves the moment Directus sets the
  // cookie, and the very next request can still race it — the first replayed
  // write 401s, isAuthError catches it, and flushQueue re-pauses the queue we
  // just cleared (the offline edits then sit stranded until the next reconnect).
  // A whoAmI() round-trip first forces the session to be provably live before we
  // replay, so the flush's first write can't lose that race. Fire-and-forget
  // after that — a real flush failure surfaces in the pending-changes UI and
  // must not block the redirect into the app.
  clearNeedsAuth();
  void (async () => {
    if (await whoAmI()) await flushQueue();
  })();
}

/** End the session — clears the cookie server-side and stops refreshing. */
export async function logout(): Promise<void> {
  try {
    await auth.logout();
  } catch {
    /* already gone; treat as logged out */
  }
}

/**
 * The current user, or null if not signed in. This is the session probe the
 * layout guard uses: a 401 means "send them to /login", anything else means
 * the cookie is good. Returns null rather than throwing so the guard reads
 * cleanly.
 */
export async function whoAmI(): Promise<Me | null> {
  if (!authEnabled()) return null; // no sessions in static-token mode
  const me = await auth.me<Me>(['id', 'email', 'first_name', 'last_name', 'role']);
  return me?.id ? me : null;
}


/**
 * Has this instance been set up yet? A fresh Directus has no users and no
 * login can succeed, so the /login page shows setup guidance instead of a form
 * that cannot work.
 *
 * `setupCompleted` comes from /server/info, which is readable UNAUTHENTICATED —
 * verified against the live server, where the field is present alongside the
 * public project block. twin never creates the first user itself: Directus
 * bootstraps it from ADMIN_EMAIL / ADMIN_PASSWORD in compose, so there is no
 * unauthenticated create path to secure. This only *detects* the empty state.
 *
 * Returns true only when we are confident setup is incomplete; any uncertainty
 * (older Directus without the field, a network blip) returns false so the
 * normal login form is shown rather than a misleading setup screen.
 */
export async function needsFirstRunSetup(): Promise<boolean> {
  if (!authEnabled()) return false;
  try {
    const info = await auth.serverInfo<{ setupCompleted?: boolean }>();
    return info?.setupCompleted === false;
  } catch {
    return false;
  }
}
