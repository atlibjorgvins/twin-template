// The repository factory — the one place a backend is chosen.
//
// Precedence: a device-local choice (written by the /welcome storage step,
// keys twin.backend / twin.supabaseUrl / twin.supabaseKey) beats the build's
// `PUBLIC_DATA_BACKEND` default; resolution rules live in choice.ts and are
// unit-tested there. Unset everywhere → Directus, byte-identical to before
// the flag existed. Domain modules import `repo`/`auth` from here and never
// name a backend. Changing the stored choice takes effect on the next full
// page load — `repo` is a module singleton by design (every live query in
// flight belongs to ONE backend; a mid-session swap would interleave two).
//
// Bundle note: the Supabase adapter is statically imported, so `@supabase/
// supabase-js` ships even in a Directus build. Acceptable for a self-hosted app;
// a later optimisation could `import()` it lazily behind the flag if size matters.
import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { DirectusRepository, DirectusAuthProvider } from './directus';
import { SupabaseRepository, SupabaseAuthProvider } from './supabase';
import { LocalRepository, LocalAuthProvider } from './local';
import { resolveBackend, type BackendId, type StoredChoice } from './choice';
import { saveDirectusConnection, deviceDirectusUrl } from './directusConfig';
import { localFileStore } from './files';
import { activeVault, updateActiveVault, localDbName, localMediaDbName } from './vaults';
import type { Id } from './types';

/** Where the Directus option actually points right now (device override or
 *  build default) — for the /welcome storage step's prefill and blurb. */
export { deviceDirectusUrl };
import { createClient } from '@supabase/supabase-js';
import type { AuthProvider, Repository } from './types';

// The device's stored choice now lives on the ACTIVE VAULT (vaults.ts); the
// pre-vault flat keys migrate into the primary vault on first load.
function storedChoice(): StoredChoice {
  if (!browser) return {};
  try {
    const v = activeVault();
    return {
      backend: v.backend ?? null,
      supabaseUrl: v.supabaseUrl ?? null,
      supabaseKey: v.supabaseKey ?? null,
      directusUrl: deviceDirectusUrl()
    };
  } catch {
    return {};
  }
}

/** Persist the device's backend choice (from the /welcome storage step).
 *  Takes effect on the next full page load — the caller reloads. */
export function saveBackendChoice(
  backend: BackendId,
  conn?: { supabase?: { url: string; key: string }; directus?: { url: string; token: string } }
): void {
  try {
    updateActiveVault({
      backend,
      ...(backend === 'supabase' && conn?.supabase
        ? { supabaseUrl: conn.supabase.url.trim(), supabaseKey: conn.supabase.key.trim() }
        : {})
    });
    if (backend === 'directus' && conn?.directus) {
      saveDirectusConnection(conn.directus.url, conn.directus.token);
    }
  } catch {
    /* private mode — the build default keeps applying */
  }
}

const resolved = resolveBackend(
  env.PUBLIC_DATA_BACKEND,
  env.PUBLIC_SUPABASE_URL,
  env.PUBLIC_SUPABASE_ANON_KEY,
  storedChoice(),
  // With no explicit choice anywhere: Directus only if the build actually
  // configured one, otherwise local — see resolveBackend's doc comment.
  env.PUBLIC_DIRECTUS_URL
);
if (resolved.fallbackReason) console.error(`[repo] ${resolved.fallbackReason}`);

/** The backend actually in effect this session — for the connection probe,
 *  the /welcome storage step's preselection, and the settings surface. */
export const activeBackend: BackendId = resolved.backend;

/** What the connectivity probe should ping for THIS backend, or null when
 *  there is nothing to ping (local). Any HTTP response — even a 401 — means
 *  reachable; only a network failure means offline. Found the hard way: the
 *  probe used to ping the Directus URL regardless of backend, so a healthy
 *  Supabase vault wore a permanent offline banner. */
export function probeUrl(): string | null {
  if (resolved.backend === 'local') return null;
  if (resolved.backend === 'supabase') return `${resolved.supabaseUrl}/rest/v1/`;
  return null; // directus: connection.ts builds its /server/ping from directusAbsolute()
}

// ── Media location ("offload") ────────────────────────────────────────
// Rows and media are separate planes. `twin.mediaLocation = 'device'` routes
// UPLOADS to the device blob store even when rows live on a cloud backend —
// company logos and photos never leave the machine. Reads are hybrid: local
// first, then the backend, so images that already live in the cloud keep
// rendering. The honest trade (stated in Settings → Storage): device-only
// media does not follow you to other devices — those show initials instead.
const MEDIA_KEY = 'twin.mediaLocation';

export type MediaLocation = 'backend' | 'device';

export function mediaLocation(): MediaLocation {
  try {
    return localStorage.getItem(MEDIA_KEY) === 'device' ? 'device' : 'backend';
  } catch {
    return 'backend';
  }
}

/** Persist the media-location choice; the caller reloads (same singleton
 *  rule as the backend choice). */
export function saveMediaLocation(v: MediaLocation): void {
  try {
    if (v === 'device') localStorage.setItem(MEDIA_KEY, v);
    else localStorage.removeItem(MEDIA_KEY);
  } catch {
    /* private mode — backend media keeps applying */
  }
}

/** Wrap a cloud backend so its FILE plane lives on the device. Explicit
 *  delegation (not spread — that would drop prototype methods). */
function withDeviceMedia(inner: Repository): Repository {
  const files = localFileStore(localMediaDbName(activeVault().id));
  return {
    list: inner.list.bind(inner),
    get: inner.get.bind(inner),
    create: inner.create.bind(inner),
    createMany: inner.createMany.bind(inner),
    update: inner.update.bind(inner),
    updateMany: inner.updateMany.bind(inner),
    remove: inner.remove.bind(inner),
    removeMany: inner.removeMany.bind(inner),
    count: inner.count.bind(inner),
    aggregate: inner.aggregate.bind(inner),
    listFiles: inner.listFiles.bind(inner),
    importFileFromUrl: inner.importFileFromUrl.bind(inner),
    uploadFile: (file, opts) => files.put(file, { title: opts?.title ?? file.name }),
    removeFile: async (id: Id) => {
      // The id lives in exactly one of the two stores; try both, forgive both.
      await files.remove(String(id)).catch(() => {});
      await inner.removeFile(id).catch(() => {});
    },
    assetSrc: (fileId, params) =>
      fileId ? files.srcSync(String(fileId)) || inner.assetSrc(fileId, params) : ''
  };
}

function instantiate(): { repo: Repository; auth: AuthProvider } {
  // Per-vault local databases: the primary vault keeps the legacy names so
  // pre-vault data survives; every other vault is isolated.
  const vaultId = browser ? activeVault().id : 'primary';
  if (resolved.backend === 'local') {
    return {
      repo: new LocalRepository(localDbName(vaultId), localFileStore(localMediaDbName(vaultId))),
      auth: new LocalAuthProvider()
    };
  }
  const made =
    resolved.backend === 'supabase'
      ? (() => {
          const client = createClient(resolved.supabaseUrl!, resolved.supabaseKey!);
          return { repo: new SupabaseRepository(client) as Repository, auth: new SupabaseAuthProvider(client) as AuthProvider };
        })()
      : { repo: new DirectusRepository() as Repository, auth: new DirectusAuthProvider() as AuthProvider };
  if (browser && mediaLocation() === 'device') made.repo = withDeviceMedia(made.repo);
  return made;
}

const chosen = instantiate();

/** Await once (root layout) before first render: assetSrc is synchronous by
 *  contract, so the device blob store's object-URL map must exist up front.
 *  No-op when no device media is in play. */
export function mediaReady(): Promise<void> {
  if (!browser) return Promise.resolve();
  if (resolved.backend === 'local' || mediaLocation() === 'device') {
    return localFileStore(localMediaDbName(activeVault().id))
      .hydrate()
      .catch(() => {});
  }
  return Promise.resolve();
}

export const repo: Repository = chosen.repo;

/** The auth plane, chosen the same way `repo` is — see docs/phase3-data-port.md.
 *  Domain code (data/auth.ts) imports this and never names a backend. */
export const auth: AuthProvider = chosen.auth;

export type {
  Repository, Query, Filter, FilterOp, FieldSpec, Id, AggregateQuery, AggregateSpec, AuthProvider
} from './types';
export type { BackendId } from './choice';
