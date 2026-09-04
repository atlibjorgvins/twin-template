// Write a record into a vault that is NOT the active one.
//
// The main repo is deliberately a per-page-load singleton (one vault, one
// module graph), and that stays true. But "add this person to the KLAK vault
// while I'm looking at my personal one" only needs a second ADAPTER INSTANCE
// for one call — the classes take their connection as plain arguments, so a
// throwaway instance pointed at the other vault's storage is safe: nothing
// about the active vault's state is shared or mutated.
//
// Scope: CREATES only, and only for local and Supabase vaults.
//  - local: LocalRepository is fully isolated by database name.
//  - supabase: a fresh client for that project; if the vault is managed,
//    supabase-js restores the member's persisted session for that project
//    ref from this origin's storage, so RLS lets the insert through — and a
//    signed-out member gets the honest RLS/auth error, not silent data loss.
//  - directus: the adapter is welded to the module-level client (which reads
//    the ACTIVE vault's connection), so cross-writing would silently target
//    the wrong server. Refused loudly instead; open that vault to add there.

import { env } from '$env/dynamic/public';
import type { Vault } from './vaults';
import type { BackendId } from './choice';
import type { Repository } from './types';
import { resolveBackend } from './choice';
import { vaults, activeVault, localDbName, localMediaDbName, vaultInScope } from './vaults';
import { repo } from './index';

/** A vault's effective backend. A vault with no explicit `backend` (the
 *  migrated primary/personal vault) resolves to the BUILD default — local on
 *  the desktop app — exactly as it does when it is the active vault. Getting
 *  this wrong is why the personal vault used to vanish from the unified view:
 *  `v.backend === 'local'` is false when backend is simply unset. */
export function effectiveBackend(v: Vault): BackendId {
  return (
    v.backend ??
    resolveBackend(
      env.PUBLIC_DATA_BACKEND,
      env.PUBLIC_SUPABASE_URL,
      env.PUBLIC_SUPABASE_ANON_KEY,
      {},
      env.PUBLIC_DIRECTUS_URL
    ).backend
  );
}

/** Can records be created into this vault while another one is active?
 *  Cross-vault writes work for local and Supabase targets (Directus is welded
 *  to the active connection). */
export function canCreateInto(v: Vault): boolean {
  if (v.id === activeVault().id) return true;
  const b = effectiveBackend(v);
  return b === 'local' || b === 'supabase';
}

/** The vaults a "Save to" picker should offer: the active one (always,
 *  whatever its backend) plus every other vault twin can cross-write to. */
export function creatableVaults(): Vault[] {
  return vaults().filter((v) => canCreateInto(v));
}

/** The OTHER vaults twin can read right now (local by database name; supabase
 *  via a fresh client that restores any persisted member session). Uses the
 *  EFFECTIVE backend, so the personal vault (unset backend) is included. */
export function foreignReadableVaults(): Vault[] {
  const active = activeVault().id;
  return vaults().filter((v) => {
    if (v.id === active) return false;
    const b = effectiveBackend(v);
    return b === 'local' || b === 'supabase';
  });
}

/** The foreign vaults whose world matches the current scope — what the
 *  unified list should overlay in Work/Private/All. */
export function foreignVaultsInScope(scope: 'all' | 'work' | 'private'): Vault[] {
  return foreignReadableVaults().filter((v) => vaultInScope(v, scope));
}

// ── Unified "All vaults" browsing (the 1Password model) ────────────────
// In All mode the People/Org lists show every vault's rows together, each
// foreign row wearing its vault's badge; opening one switches into its vault.
// Per-device and defaulted ON — the scope toggle already covers the moments
// you want to see only one world.
const UNIFIED_KEY = 'twin.vaults.unified';

export function unifiedEnabled(): boolean {
  try {
    return localStorage.getItem(UNIFIED_KEY) !== '0' && foreignReadableVaults().length > 0;
  } catch {
    return false;
  }
}
export function setUnifiedEnabled(on: boolean): void {
  try {
    localStorage.setItem(UNIFIED_KEY, on ? '1' : '0');
  } catch {
    /* private mode */
  }
}

export interface VaultTag {
  id: string;
  name: string;
}

/** List a collection across a set of foreign vaults (default: all readable),
 *  each row tagged with its vault. Per-vault failures contribute nothing
 *  rather than breaking the whole view — a signed-out managed vault is a
 *  normal state, not an error. */
export async function listForeign<T>(
  collection: string,
  query: Parameters<Repository['list']>[1],
  fromVaults: Vault[] = foreignReadableVaults()
): Promise<Array<T & { __vault: VaultTag }>> {
  const chunks = await Promise.all(
    fromVaults.map(async (v) => {
      try {
        const rows = await (await adapterFor(v)).list<T>(collection, query);
        return rows.map((r) => ({ ...r, __vault: { id: v.id, name: v.name } }));
      } catch (e) {
        console.warn(`[unified] ${v.name}: ${e instanceof Error ? e.message : e}`);
        return [];
      }
    })
  );
  return chunks.flat();
}

// One throwaway adapter per foreign vault per page load — repeat saves to the
// same destination shouldn't re-hydrate a local database every time.
const cache = new Map<string, Promise<Repository>>();

function adapterFor(v: Vault): Promise<Repository> {
  let made = cache.get(v.id);
  if (!made) {
    made = (async () => {
      const backend = effectiveBackend(v);
      if (backend === 'local') {
        const [{ LocalRepository }, { localFileStore }] = await Promise.all([
          import('./local'),
          import('./files')
        ]);
        // No explicit hydration: LocalRepository hydrates itself on first use.
        return new LocalRepository(localDbName(v.id), localFileStore(localMediaDbName(v.id)));
      }
      if (backend === 'supabase' && v.supabaseUrl && v.supabaseKey) {
        const [{ createClient }, { SupabaseRepository }] = await Promise.all([
          import('@supabase/supabase-js'),
          import('./supabase')
        ]);
        return new SupabaseRepository(createClient(v.supabaseUrl, v.supabaseKey));
      }
      throw new Error(
        `Records can't be added to “${v.name}” from here — open that vault and add them there.`
      );
    })();
    cache.set(v.id, made);
    // A failed construction must not poison later attempts.
    made.catch(() => cache.delete(v.id));
  }
  return made;
}

/** Create a record in the given vault. The active vault goes through the
 *  normal repo (offline queue and all); a foreign vault gets a throwaway
 *  adapter and FAILS HONESTLY when unreachable — no cross-vault offline
 *  queue exists, and pretending otherwise would strand the record. */
export async function createInVault<T>(
  vaultId: string,
  collection: string,
  data: Record<string, unknown>
): Promise<T> {
  if (vaultId === activeVault().id) return repo.create<T>(collection, data);
  const v = vaults().find((x) => x.id === vaultId);
  if (!v) throw new Error('That vault is no longer on this device.');
  const adapter = await adapterFor(v);
  return adapter.create<T>(collection, data);
}
