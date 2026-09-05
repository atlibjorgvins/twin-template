// The signed-in member's role in the active managed vault — for hiding write
// controls. The DATABASE is the real enforcer (permissionsSchema RLS); this
// is the UX layer that keeps a viewer from being shown buttons that would
// only fail. When permissions aren't enabled on a vault, everyone is treated
// as an editor (the pre-roles behaviour: all members can write).

import type { MemberRole } from './permissionsSchema';
import { activeVault } from './vaults';

let cached: MemberRole | null | undefined; // undefined = not fetched; null = unknown/not-applicable

/** Fetch the current member's role once per load. Calls the twin_role() RPC
 *  with the member's own session. Returns 'editor' as the permissive default
 *  when permissions aren't enabled or the role can't be determined — the RLS
 *  policy still has the final say on any actual write. */
export async function loadVaultRole(): Promise<MemberRole | null> {
  if (cached !== undefined) return cached;
  cached = null;
  try {
    const { activeBackend } = await import('./index');
    const v = activeVault();
    if (activeBackend !== 'supabase' || !v.managed || !v.supabaseUrl || !v.supabaseKey) {
      return cached;
    }
    const raw = localStorage.getItem(`sb-${refOf(v.supabaseUrl)}-auth-token`);
    const token = raw ? JSON.parse(raw)?.access_token : null;
    if (!token) return cached;
    const res = await fetch(`${v.supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/twin_role`, {
      method: 'POST',
      headers: {
        apikey: v.supabaseKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: '{}'
    });
    if (res.status === 404) {
      // No twin_role() → permissions not enabled → treat as editor.
      cached = 'editor';
      return cached;
    }
    if (!res.ok) return cached;
    const role = (await res.json()) as MemberRole | null;
    cached = role ?? null;
    return cached;
  } catch {
    return cached;
  }
}

/** The cached role (call loadVaultRole first). null when unknown. */
export function vaultRole(): MemberRole | null {
  return cached ?? null;
}

/** May the current member write? True unless they are known to be a viewer —
 *  so a vault without permissions, or before the role loads, stays writable
 *  and the RLS policy remains the backstop. */
export function canWrite(): boolean {
  return vaultRole() !== 'viewer';
}

/** Reset (tests / vault switch). */
export function _resetRole(): void {
  cached = undefined;
}

function refOf(url: string): string {
  const m = url.match(/https?:\/\/([^.]+)\./);
  return m ? m[1] : '';
}
