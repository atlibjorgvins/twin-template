// Connection probe and offline mirror sync
//
// Not an entity domain at all — this is the offline layer's write side, and it
// sits here rather than in people/orgs because syncOfflineMirror needs both.
// The read side lives in $lib/offline.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo, activeBackend, probeUrl } from '$lib/data/repo';
import { directusAbsolute } from '$lib/apiBase';
import type { Organization, Person } from '$lib/data/types';
import { isNetworkError, lastSyncAt, markOffline, markOnline, saveMirror } from '$lib/offline';

/**
 * Lightweight connectivity probe — hits the unauthenticated /server/ping
 * endpoint with a short timeout. Any HTTP response (even an error status)
 * means the host is reachable → online; only a network failure/timeout
 * means it's unreachable → offline. Used to drive the status indicator
 * proactively, so we show "offline" without waiting for a search to fail,
 * and to detect reconnection. Returns true if reachable.
 */
export async function probeConnection(timeoutMs = 4000): Promise<boolean> {
  // Local backend: the "server" is this device's IndexedDB — there is nothing
  // to ping, and probing the (unused) Directus URL would flap the offline
  // banner on an app that cannot be offline. activeBackend, not the env flag:
  // the device override (welcome storage step) must steer the probe too.
  if (activeBackend === 'local') {
    markOnline();
    return true;
  }
  // Ping the backend actually in use. Supabase: its REST root (a 401 without
  // an apikey still proves the host answers); Directus: /server/ping.
  const target = probeUrl() ?? `${directusAbsolute()}/server/ping`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(target, { signal: ctrl.signal, cache: 'no-store' });
    markOnline();
    return true;
  } catch {
    markOffline();
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Refresh the offline mirror — pulls the full People + organization sets
 * (scalar columns only, no relational expansion) into IndexedDB so the
 * index pages keep working when Directus is unreachable. Best-effort:
 * call it fire-and-forget on app load; failures are swallowed (if the
 * server's down there's simply nothing to sync, and the previous mirror
 * stays in place). Returns the row counts written, or null on failure.
 */
export async function syncOfflineMirror(
  opts: { force?: boolean; maxAgeMs?: number } = {}
): Promise<{ people: number; orgs: number } | null> {
  // Throttle: skip if the mirror was refreshed recently (default 30 min),
  // so a quick app reopen doesn't re-pull thousands of rows. `force`
  // bypasses it (e.g. a manual "Sync now" button).
  const maxAge = opts.maxAgeMs ?? 30 * 60 * 1000;
  if (!opts.force) {
    const last = await lastSyncAt();
    if (last && Date.now() - last.getTime() < maxAge) return null;
  }
  try {
    const [people, orgs, socials] = await Promise.all([
      repo.list<Person>('Person', { fields: ['*'] }),
      repo.list<Organization>('organization', { fields: ['*'] }),
      // Social profiles are rows, so `fields: ['*']` on organization cannot
      // reach them. Flattened into one string per org below: the offline index
      // only ever substring-matches, so it never needs the structure.
      repo
        .list<{ organization_id: number | { id: number } | null; url?: string | null; handle?: string | null }>(
          'organization_social',
          { fields: ['organization_id', 'url', 'handle'] }
        )
        .catch(() => [])
    ]);
    markOnline();
    const socialByOrg = new Map<number, string[]>();
    for (const r of socials) {
      const id = typeof r.organization_id === 'object' ? r.organization_id?.id : r.organization_id;
      if (typeof id !== 'number') continue;
      const bits = [r.url, r.handle].filter(Boolean) as string[];
      if (bits.length) socialByOrg.set(id, [...(socialByOrg.get(id) ?? []), ...bits]);
    }
    const orgsForMirror = orgs.map((o) => ({
      ...o,
      social_search: (socialByOrg.get(o.id) ?? []).join(' ') || null
    }));
    await saveMirror('people', people as unknown as Array<Record<string, unknown>>);
    await saveMirror('orgs', orgsForMirror as unknown as Array<Record<string, unknown>>);
    return { people: people.length, orgs: orgs.length };
  } catch (e) {
    if (isNetworkError(e)) markOffline();
    return null;
  }
}
