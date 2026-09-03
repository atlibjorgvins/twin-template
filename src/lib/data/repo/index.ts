// The repository factory — the one place a backend is chosen.
//
// Precedence: the ACTIVE VAULT's stored choice (vaults.ts; the /welcome
// storage step writes it) beats the build's `PUBLIC_DATA_BACKEND` default;
// resolution rules live in choice.ts and are unit-tested there. With nothing
// chosen anywhere the default is directus if the build configured a Directus
// URL and local otherwise. Domain modules import `repo`/`auth` from here and
// never name a backend. A changed choice takes effect on the next full page
// load — the adapter is a per-load singleton by design (every live query in
// flight belongs to ONE backend; a mid-session swap would interleave two).
//
// LAZY adapters: `repo` and `auth` are thin facades whose methods await a
// dynamic import of the ONE adapter this vault needs. Measured before this
// change, the statically-imported supabase-js + @directus/sdk chunk was 238KB
// of a 544KB boot-critical graph (44%) — paid by every boot, every backend,
// and the spotlight window. The facade keeps every call site synchronous-
// looking (methods were always async) with one deliberate exception:
// `assetSrc` is synchronous BY CONTRACT (templates call it inline), so it is
// implemented here, SDK-free — device blob store lookup, or pure Directus URL
// construction via apiBase + credentials.
import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { resolveBackend, type BackendId, type StoredChoice } from './choice';
import { saveDirectusConnection, deviceDirectusUrl } from './directusConfig';
import { localFileStore } from './files';
import { activeVault, updateActiveVault, localDbName, localMediaDbName } from './vaults';
import { directusAbsolute } from '$lib/apiBase';
import { assetAuthParam } from '$lib/data/credentials';
import type { AuthProvider, Id, Query, Repository } from './types';

/** Where the Directus option actually points right now (device override or
 *  build default) — for the /welcome storage step's prefill and blurb. */
export { deviceDirectusUrl };

// The device's stored choice lives on the ACTIVE VAULT (vaults.ts); the
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
    const stored = localStorage.getItem(MEDIA_KEY);
    if (stored === 'device') return 'device';
    if (stored === 'backend') return 'backend';
    // Unset: per-backend default. Supabase has no file transport wired up
    // (Storage buckets are the follow-up), so its images default to the
    // device store — uploads and avatars just work instead of refusing.
    return resolved.backend === 'supabase' ? 'device' : 'backend';
  } catch {
    return 'backend';
  }
}

/** Persist the media-location choice; the caller reloads (same singleton
 *  rule as the backend choice). */
export function saveMediaLocation(v: MediaLocation): void {
  try {
    // Stored EXPLICITLY either way: with per-backend defaults, removing the
    // key on 'backend' would snap a Supabase vault right back to 'device'.
    localStorage.setItem(MEDIA_KEY, v);
  } catch {
    /* private mode — the default keeps applying */
  }
}

const deviceMedia = () => localFileStore(localMediaDbName(browser ? activeVault().id : 'primary'));

// ── The lazy adapter ──────────────────────────────────────────────────
// Loaded once per page load, on first use. Only the chosen backend's module
// (and its SDK) ever downloads.
type Loaded = { repo: Repository; auth: AuthProvider };
let loadedP: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  if (!loadedP) {
    loadedP = (async (): Promise<Loaded> => {
      const vaultId = browser ? activeVault().id : 'primary';
      if (resolved.backend === 'local') {
        const { LocalRepository, LocalAuthProvider } = await import('./local');
        return {
          repo: new LocalRepository(localDbName(vaultId), deviceMedia()),
          auth: new LocalAuthProvider()
        };
      }
      let made: Loaded;
      if (resolved.backend === 'supabase') {
        const [{ createClient }, { SupabaseRepository, SupabaseAuthProvider }] = await Promise.all([
          import('@supabase/supabase-js'),
          import('./supabase')
        ]);
        const client = createClient(resolved.supabaseUrl!, resolved.supabaseKey!);
        made = { repo: new SupabaseRepository(client), auth: new SupabaseAuthProvider(client) };
      } else {
        const { DirectusRepository, DirectusAuthProvider } = await import('./directus');
        made = { repo: new DirectusRepository(), auth: new DirectusAuthProvider() };
      }
      if (browser && mediaLocation() === 'device') {
        // Route the FILE plane to the device blob store (reads fall back to
        // the backend in assetSrc below; uploads/removals go local-first).
        const files = deviceMedia();
        const inner = made.repo;
        made = {
          auth: made.auth,
          repo: {
            ...bindAll(inner),
            uploadFile: (file, opts) => files.put(file, { title: opts?.title ?? file.name }),
            removeFile: async (id: Id) => {
              await files.remove(String(id)).catch(() => {});
              await inner.removeFile(id).catch(() => {});
            }
          }
        };
      }
      return made;
    })();
  }
  return loadedP;
}

/** Explicit delegation of every Repository method (spread would drop
 *  prototype methods). */
function bindAll(inner: Repository): Repository {
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
    removeFile: inner.removeFile.bind(inner),
    uploadFile: inner.uploadFile.bind(inner),
    assetSrc: inner.assetSrc.bind(inner)
  };
}

/** Synchronous asset resolution WITHOUT the adapter — see the header. The
 *  device store answers first when it may hold the blob; Directus URLs are
 *  pure string construction; Supabase has no URL scheme yet ('' → initials). */
function facadeAssetSrc(
  fileId: string | null | undefined,
  params: Record<string, string | number> = {}
): string {
  if (!fileId) return '';
  if (browser && (resolved.backend === 'local' || mediaLocation() === 'device')) {
    const local = deviceMedia().srcSync(String(fileId));
    if (local) return local;
    if (resolved.backend === 'local') return '';
  }
  if (resolved.backend === 'directus') {
    const query = new URLSearchParams({ ...params, ...assetAuthParam() } as Record<string, string>);
    return `${directusAbsolute()}/assets/${fileId}?${query.toString()}`;
  }
  return '';
}

export const repo: Repository = {
  list: async <T>(c: string, q?: Query) => (await load()).repo.list<T>(c, q),
  get: async <T>(c: string, id: Id, q?: Pick<Query, 'fields'>) => (await load()).repo.get<T>(c, id, q),
  create: async <T>(c: string, d: Record<string, unknown>) => (await load()).repo.create<T>(c, d),
  createMany: async <T>(c: string, d: Record<string, unknown>[]) => (await load()).repo.createMany<T>(c, d),
  update: async <T>(c: string, id: Id, d: Record<string, unknown>) => (await load()).repo.update<T>(c, id, d),
  updateMany: async <T>(c: string, ids: Id[], d: Record<string, unknown>) =>
    (await load()).repo.updateMany<T>(c, ids, d),
  remove: async (c, id) => (await load()).repo.remove(c, id),
  removeMany: async (c, ids) => (await load()).repo.removeMany(c, ids),
  count: async (c, where) => (await load()).repo.count(c, where),
  aggregate: async <T>(c: string, o: Parameters<Repository['aggregate']>[1]) =>
    (await load()).repo.aggregate<T>(c, o),
  listFiles: async <T>(q?: Query) => (await load()).repo.listFiles<T>(q),
  importFileFromUrl: async <T>(url: string, d?: Record<string, unknown>) =>
    (await load()).repo.importFileFromUrl<T>(url, d),
  removeFile: async (id) => (await load()).repo.removeFile(id),
  uploadFile: async (file, opts) => (await load()).repo.uploadFile(file, opts),
  assetSrc: facadeAssetSrc
};

/** The auth plane, same lazy facade — domain code (data/auth.ts) imports this
 *  and never names a backend. */
export const auth: AuthProvider = {
  login: async (email, password) => (await load()).auth.login(email, password),
  logout: async () => (await load()).auth.logout(),
  me: async <T>(fields: readonly string[]) => (await load()).auth.me<T>(fields),
  serverInfo: async <T>() => (await load()).auth.serverInfo<T>()
};

/** Await once (root layout) before first render: assetSrc is synchronous by
 *  contract, so the device blob store's object-URL map must exist up front.
 *  No-op when no device media is in play. */
export function mediaReady(): Promise<void> {
  if (!browser) return Promise.resolve();
  if (resolved.backend === 'local' || mediaLocation() === 'device') {
    return deviceMedia()
      .hydrate()
      .catch(() => {});
  }
  return Promise.resolve();
}

/** Everything in a LOCAL vault, for Settings → Storage's export. Null on any
 *  other backend. (The facade hides the adapter, so pages can't instanceof.) */
export async function localDump(): Promise<Record<string, Record<string, unknown>[]> | null> {
  if (resolved.backend !== 'local') return null;
  const { LocalRepository } = await import('./local');
  const inner = (await load()).repo;
  return inner instanceof LocalRepository ? inner.dumpAll() : null;
}

export type {
  Repository, Query, Filter, FilterOp, FieldSpec, Id, AggregateQuery, AggregateSpec, AuthProvider
} from './types';
export type { BackendId } from './choice';
