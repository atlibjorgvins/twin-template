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

import type { Vault } from './vaults';
import type { Repository } from './types';
import { vaults, activeVault, localDbName, localMediaDbName } from './vaults';
import { repo } from './index';

/** Can records be created into this vault while another one is active? */
export function canCreateInto(v: Vault): boolean {
  if (v.id === activeVault().id) return true;
  // A vault with no explicit backend resolves from build env only while
  // ACTIVE — from the outside its target is unknowable, so it's not offered.
  return v.backend === 'local' || v.backend === 'supabase';
}

/** The vaults a "Save to" picker should offer: the active one (always,
 *  whatever its backend) plus every other vault twin can cross-write to. */
export function creatableVaults(): Vault[] {
  return vaults().filter((v) => canCreateInto(v));
}

// One throwaway adapter per foreign vault per page load — repeat saves to the
// same destination shouldn't re-hydrate a local database every time.
const cache = new Map<string, Promise<Pick<Repository, 'create'>>>();

function adapterFor(v: Vault): Promise<Pick<Repository, 'create'>> {
  let made = cache.get(v.id);
  if (!made) {
    made = (async () => {
      if (v.backend === 'local') {
        const [{ LocalRepository }, { localFileStore }] = await Promise.all([
          import('./local'),
          import('./files')
        ]);
        // No explicit hydration: LocalRepository hydrates itself on first use.
        return new LocalRepository(localDbName(v.id), localFileStore(localMediaDbName(v.id)));
      }
      if (v.backend === 'supabase' && v.supabaseUrl && v.supabaseKey) {
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
