// Vaults — named backend connections the client can hold several of.
//
// Phase 5 of docs/opening-up-twin.md, built the recommended way: "a workspace
// is an instance; the client holds several connections." A vault is a saved
// connection (local / supabase / directus + its credentials) plus a name and
// a kind. Exactly ONE vault is active per page load — the repo singleton rule
// — and switching vaults is a full reload, the same contract as switching
// backends. Joining a workspace is adding a vault that points at its server.
//
// Storage: `twin.vaults` (JSON array) + `twin.activeVault` (id). The flat
// single-connection keys that predate vaults (twin.backend, twin.supabaseUrl,
// twin.supabaseKey — and twin.directusUrl/-Token via directusConfig) migrate
// into the 'primary' vault the first time this module loads, so every
// existing device keeps exactly its current connection and, crucially, its
// current IndexedDB names (see localDbName): the primary vault maps to the
// legacy database names, other vaults get suffixed ones.
//
// Deliberately dependency-light (types only) — directusConfig.ts at the very
// bottom of the graph reads from here.
//
// Session-cookie auth (KLAK-style managed instances) is NOT a joinable vault
// yet: cookies demand a same-origin deployment, which a desktop app or a
// foreign origin cannot satisfy. Workspace vaults authenticate with a static
// token (Directus) or anon key + row rules (Supabase) for now.

import type { BackendId } from './choice';

export interface Vault {
  id: string;
  name: string;
  kind: 'personal' | 'workspace';
  /** Unset = resolve from the build's env defaults (choice.ts). */
  backend?: BackendId;
  directusUrl?: string;
  directusToken?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
  /** Managed team vault: members must SIGN IN (Supabase Auth) — the anon key
   *  alone opens nothing, and removing a member in Supabase revokes access. */
  managed?: boolean;
  /** Admin only: the project's SECRET (service_role) key, pasted into
   *  Settings → Vaults → Members. Unlocks in-app member administration on
   *  THIS device; never synced, never sent anywhere but the project itself. */
  adminKey?: string;
}

const VAULTS_KEY = 'twin.vaults';
const ACTIVE_KEY = 'twin.activeVault';
export const PRIMARY_ID = 'primary';

function readLS(key: string): string {
  try {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function writeLS(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

/** Pure: parse a stored vault list, dropping malformed entries. Exported for
 *  the unit tests. */
export function parseVaults(raw: string): Vault[] {
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (v): v is Vault =>
        !!v &&
        typeof v === 'object' &&
        typeof (v as Vault).id === 'string' &&
        typeof (v as Vault).name === 'string'
    );
  } catch {
    return [];
  }
}

/** Pure: the migrated primary vault from the pre-vault flat keys. Exported
 *  for the unit tests. */
export function migrateFlat(flat: {
  backend?: string | null;
  directusUrl?: string | null;
  directusToken?: string | null;
  supabaseUrl?: string | null;
  supabaseKey?: string | null;
}): Vault {
  const backend = (flat.backend ?? '').trim().toLowerCase();
  return {
    id: PRIMARY_ID,
    name: 'Personal',
    kind: 'personal',
    ...(backend === 'local' || backend === 'supabase' || backend === 'directus'
      ? { backend: backend as BackendId }
      : {}),
    ...(flat.directusUrl ? { directusUrl: flat.directusUrl } : {}),
    ...(flat.directusToken ? { directusToken: flat.directusToken } : {}),
    ...(flat.supabaseUrl ? { supabaseUrl: flat.supabaseUrl } : {}),
    ...(flat.supabaseKey ? { supabaseKey: flat.supabaseKey } : {})
  };
}

let _vaults: Vault[] | null = null;

/** All vaults on this device. First call migrates the flat keys into the
 *  primary vault so pre-vault devices keep their exact connection. */
export function vaults(): Vault[] {
  if (_vaults) return _vaults;
  const parsed = parseVaults(readLS(VAULTS_KEY));
  if (parsed.length > 0) {
    _vaults = parsed;
    return _vaults;
  }
  _vaults = [
    migrateFlat({
      backend: readLS('twin.backend'),
      directusUrl: readLS('twin.directusUrl'),
      directusToken: readLS('twin.directusToken'),
      supabaseUrl: readLS('twin.supabaseUrl'),
      supabaseKey: readLS('twin.supabaseKey')
    })
  ];
  persist();
  return _vaults;
}

function persist(): void {
  if (_vaults) writeLS(VAULTS_KEY, JSON.stringify(_vaults));
}

/** The vault this page load runs against. Falls back to primary. */
export function activeVault(): Vault {
  const all = vaults();
  const id = readLS(ACTIVE_KEY) || PRIMARY_ID;
  return all.find((v) => v.id === id) ?? all[0];
}

/** Switch vaults. The caller does a FULL reload — the repo is a per-load
 *  singleton, and two vaults' queries must never interleave. */
export function setActiveVault(id: string): void {
  writeLS(ACTIVE_KEY, id);
}

export function addVault(v: Omit<Vault, 'id'>): Vault {
  const all = vaults();
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `v-${Date.now()}`;
  const created: Vault = { ...v, id };
  _vaults = [...all, created];
  persist();
  return created;
}

/** Update the active vault's connection in place (the wizard and Settings →
 *  Storage both edit "the current connection", which is now vault-scoped). */
export function updateActiveVault(patch: Partial<Omit<Vault, 'id'>>): void {
  const active = activeVault();
  _vaults = vaults().map((v) => (v.id === active.id ? { ...v, ...patch } : v));
  persist();
}

/** Remove a vault (never the last one; never the active one — switch first).
 *  Local data is deliberately NOT deleted: removing a connection must not
 *  destroy rows. Returns false when refused. */
export function removeVault(id: string): boolean {
  const all = vaults();
  if (all.length <= 1) return false;
  if (activeVault().id === id) return false;
  _vaults = all.filter((v) => v.id !== id);
  persist();
  return true;
}

/** Per-vault IndexedDB names. The primary vault keeps the LEGACY names so a
 *  pre-vault device's data survives the migration untouched; every other
 *  vault gets its own isolated databases. */
export function localDbName(vaultId: string): string {
  return vaultId === PRIMARY_ID ? 'twin-local-data' : `twin-local-data--${vaultId}`;
}
export function localMediaDbName(vaultId: string): string {
  return vaultId === PRIMARY_ID ? 'twin-local-media' : `twin-local-media--${vaultId}`;
}
