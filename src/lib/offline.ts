// ─────────────────────────────────────────────────────────────────────
// Offline mirror (Layer A redundancy)
//
// A read-only local copy of People + Organizations kept in IndexedDB so
// the app still works as an *index* when the Directus host (on Tailscale)
// is unreachable. Two ideas underpin this:
//
//  1. A Tailscale-down server does NOT flip `navigator.onLine` — the
//     browser is "online", the host just times out. So we detect the
//     offline condition from request *failures*, not the online flag.
//
//  2. Browse pages only fetch 100 rows at a time, which is a useless
//     index offline. So we keep a FULL compact mirror (a few thousand
//     scalar rows — tiny in IndexedDB) and filter it client-side when a
//     live query can't be served.
//
// Writes are intentionally NOT mirrored or queued: redundancy here is
// read-only. Mutations still hit Directus directly and fail loudly when
// it's down — which is the correct, honest behaviour.
// ─────────────────────────────────────────────────────────────────────
import { writable } from 'svelte/store';
import type { Person, Organization } from './directus';

const DB_NAME = 'twin-offline';
type StoreName = 'people' | 'orgs' | 'meta' | 'queue';

// The stores this build needs, with their keyPaths. openDb() ensures every one
// exists regardless of what version the browser's DB is already at. There is
// deliberately NO fixed DB_VERSION: a hardcoded indexedDB.open(name, N) throws
// VersionError the moment the browser holds a HIGHER version — which happens
// whenever it previously ran a build with extra stores (e.g. the shopping
// branch's v3 shoppingLists/shoppingLines) and then loads an older bundle.
// That one throw kills the entire offline layer on open. See openDb().
const REQUIRED_STORES: ReadonlyArray<{ name: StoreName; keyPath: string }> = [
  { name: 'people', keyPath: 'id' },
  { name: 'orgs', keyPath: 'id' },
  { name: 'meta', keyPath: 'key' },
  { name: 'queue', keyPath: 'id' }
];

/** Connection/mirror state the chrome banner reads. `offline` flips true
 *  the first time a live read falls back to the mirror, and back to false
 *  on the next successful live request. */
export type Connection = {
  offline: boolean;
  /** When we first noticed the server was unreachable this session. */
  since: Date | null;
  /** When the local mirror was last refreshed (people/orgs min). */
  mirrorAt: Date | null;
  peopleCount: number;
  orgCount: number;
  /** Session mode only: the server returned 401 — the write queue is paused,
   *  holding its pending writes, until the user signs back in. Never set in
   *  static-token mode, where a 401 is a real permission error. */
  needsAuth: boolean;
};

export const connection = writable<Connection>({
  offline: false,
  since: null,
  mirrorAt: null,
  peopleCount: 0,
  orgCount: 0,
  needsAuth: false
});

let _since: Date | null = null;

/** Mark a live request as having succeeded — we're talking to Directus. */
export function markOnline(): void {
  if (_since !== null) {
    _since = null;
    connection.update((c) => ({ ...c, offline: false, since: null }));
  }
}

/** Mark a live request as having failed for connectivity reasons. */
export function markOffline(): void {
  if (_since === null) _since = new Date();
  connection.update((c) => ({ ...c, offline: true, since: _since }));
}

/** Session expired mid-request (session mode). Pauses the write queue instead
 *  of failing its ops, and the layout guard sends the user to /login on the
 *  next navigation. Cleared on a successful sign-in. */
export function markNeedsAuth(): void {
  connection.update((c) => (c.needsAuth ? c : { ...c, needsAuth: true }));
}

export function clearNeedsAuth(): void {
  connection.update((c) => (c.needsAuth ? { ...c, needsAuth: false } : c));
}

/** Did the server actually return 401/403 (as opposed to being unreachable)?
 *  A real API auth failure comes back WITH a response and, for Directus, an
 *  errors[].extensions.code of INVALID_CREDENTIALS / INVALID_TOKEN /
 *  TOKEN_EXPIRED / FORBIDDEN. Confirmed against the live server: a bad token on
 *  /users/me returns HTTP 401 with code INVALID_CREDENTIALS. */
export function isAuthError(e: unknown): boolean {
  const err = e as {
    response?: { status?: number };
    status?: number;
    errors?: Array<{ extensions?: { code?: string } }>;
  };
  const status = err?.response?.status ?? err?.status;
  if (status === 401 || status === 403) return true;
  const code = Array.isArray(err?.errors) ? err.errors[0]?.extensions?.code : undefined;
  return code === 'INVALID_CREDENTIALS' || code === 'INVALID_TOKEN'
      || code === 'TOKEN_EXPIRED' || code === 'FORBIDDEN';
}

/** Heuristic: is this error a "can't reach the server" failure (as opposed
 *  to a 4xx/5xx the server actually returned)? Network/timeout/DNS errors
 *  surface as TypeError("Failed to fetch") or have no HTTP status. */
export function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true; // fetch network failure
  const err = e as { response?: unknown; status?: number; errors?: unknown; message?: string };
  // Directus SDK errors that came back WITH a response are real API errors,
  // not connectivity — don't treat those as offline.
  if (err?.response || err?.errors) return false;
  if (typeof err?.message === 'string' && /failed to fetch|networkerror|load failed|timeout/i.test(err.message))
    return true;
  return false;
}

// ── IndexedDB plumbing (no deps) ─────────────────────────────────────
function createMissingStores(db: IDBDatabase): void {
  for (const { name, keyPath } of REQUIRED_STORES) {
    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
  }
}

// Version-resilient open. Instead of pinning a version (which downgrades and
// throws against a browser already on a higher one), attach to whatever exists
// and bump the version ONLY to ADD stores that are missing. This survives a
// browser that ran the shopping branch (v3) then loaded main, and any future
// branch/rollback version drift, without ever wiping data or throwing.
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    // 1) Open with no version: attaches to the current version, or creates the
    //    DB at v1 if it doesn't exist yet. Never throws VersionError.
    const probe = indexedDB.open(DB_NAME);
    probe.onerror = () => reject(probe.error);
    probe.onsuccess = () => {
      const db = probe.result;
      const missing = REQUIRED_STORES.some((s) => !db.objectStoreNames.contains(s.name));
      if (!missing) {
        resolve(db);
        return;
      }
      // 2) A required store is absent (fresh DB, or an older schema). Reopen one
      //    version higher to trigger onupgradeneeded and add just what's missing.
      const nextVersion = db.version + 1;
      db.close();
      const upgrade = indexedDB.open(DB_NAME, nextVersion);
      upgrade.onupgradeneeded = () => createMissingStores(upgrade.result);
      upgrade.onsuccess = () => resolve(upgrade.result);
      upgrade.onerror = () => reject(upgrade.error);
    };
  });
}

function tx<T>(db: IDBDatabase, store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

async function putAll(store: StoreName, rows: Array<Record<string, unknown>>): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const os = t.objectStore(store);
    os.clear();
    for (const row of rows) os.put(row);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  db.close();
}

async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  const rows = await tx<T[]>(db, store, 'readonly', (s) => s.getAll());
  db.close();
  return rows ?? [];
}

async function metaSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  await tx(db, 'meta', 'readwrite', (s) => s.put({ key, value }));
  db.close();
}

async function metaGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  const row = await tx<{ key: string; value: T } | undefined>(db, 'meta', 'readonly', (s) => s.get(key));
  db.close();
  return row?.value ?? null;
}

// ── Public mirror API ────────────────────────────────────────────────
export async function saveMirror(kind: 'people' | 'orgs', rows: Array<Record<string, unknown>>): Promise<void> {
  await putAll(kind, rows);
  await metaSet(`${kind}.syncedAt`, new Date().toISOString());
  await refreshConnectionMeta();
}

export async function loadMirrorPeople(): Promise<Person[]> {
  return getAll<Person>('people');
}

export async function loadMirrorOrgs(): Promise<Organization[]> {
  return getAll<Organization>('orgs');
}

/** Newest sync timestamp + counts, for the banner and the "last synced" line. */
export async function refreshConnectionMeta(): Promise<void> {
  try {
    const [pAt, oAt, people, orgs] = await Promise.all([
      metaGet<string>('people.syncedAt'),
      metaGet<string>('orgs.syncedAt'),
      getAll<Person>('people'),
      getAll<Organization>('orgs')
    ]);
    const times = [pAt, oAt].filter(Boolean).map((s) => new Date(s as string).getTime());
    const mirrorAt = times.length ? new Date(Math.min(...times)) : null;
    connection.update((c) => ({ ...c, mirrorAt, peopleCount: people.length, orgCount: orgs.length }));
  } catch {
    /* IDB unavailable — leave defaults */
  }
}

/** Has a mirror ever been written? (gates whether fallback is possible) */
export async function lastSyncAt(): Promise<Date | null> {
  const [p, o] = await Promise.all([metaGet<string>('people.syncedAt'), metaGet<string>('orgs.syncedAt')]);
  const t = [p, o].filter(Boolean).map((s) => new Date(s as string).getTime());
  return t.length ? new Date(Math.max(...t)) : null;
}

// ── Client-side filtering (mirrors the server search filters) ────────
function norm(s: unknown): string {
  return typeof s === 'string' ? s.toLowerCase() : '';
}

/** Replicate searchPeople's _or filter + archived guard. Advanced
 *  extraFilters (scope, etc.) are intentionally ignored offline — this is
 *  an emergency index, breadth beats precision. */
export function filterPeopleLocal(rows: Person[], q: string, includeArchived = false): Person[] {
  const query = q.trim().toLowerCase();
  let out = includeArchived ? rows : rows.filter((p) => p.status !== 'archived');
  if (query) {
    out = out.filter(
      (p) =>
        norm(p.full_name).includes(query) ||
        norm(p.first_name).includes(query) ||
        norm(p.last_name).includes(query) ||
        norm((p as { nickname?: string }).nickname).includes(query) ||
        norm(p.email).includes(query) ||
        norm((p as { phone?: string }).phone).includes(query)
    );
  }
  // Browse default: most-recently-updated first (mirrors server sort).
  return out.sort((a, b) => recency(b) - recency(a));
}

export function filterOrgsLocal(rows: Organization[], q: string, includeArchived = false, includeInactive = false): Organization[] {
  const query = q.trim().toLowerCase();
  let out = includeArchived ? rows : rows.filter((o) => o.status !== 'archived');
  if (!includeInactive) out = out.filter((o) => o.is_active !== false);
  if (query) {
    const kt = query.replace(/[-\s]/g, '');
    out = out.filter(
      (o) =>
        norm(o.name).includes(query) ||
        norm(o.legal_name).includes(query) ||
        norm(o.previous_names).includes(query) ||
        norm(o.email).includes(query) ||
        norm(o.website).includes(query) ||
        norm(o.industry).includes(query) ||
        norm(o.city).includes(query) ||
        norm(o.country).includes(query) ||
        norm(o.social_search).includes(query) ||
        norm(o.kennitala).replace(/[-\s]/g, '').includes(kt)
    );
  }
  return out.sort((a, b) => recency(b) - recency(a));
}

function recency(r: { date_updated?: string | null; date_created?: string | null }): number {
  const s = r.date_updated || r.date_created;
  return s ? new Date(s).getTime() : 0;
}

// ── Mirror mutations (optimistic offline writes) ─────────────────────
/** Insert or replace one record in the people/orgs mirror. */
export async function upsertMirror(kind: 'people' | 'orgs', record: Record<string, unknown>): Promise<void> {
  const db = await openDb();
  await tx(db, kind, 'readwrite', (s) => s.put(record));
  db.close();
  await refreshConnectionMeta();
}

/** Merge a patch into an existing mirrored record (no-op if absent). */
export async function patchMirror(kind: 'people' | 'orgs', id: number, patch: Record<string, unknown>): Promise<void> {
  const db = await openDb();
  const cur = await tx<Record<string, unknown> | undefined>(db, kind, 'readonly', (s) => s.get(id));
  if (cur) await tx(db, kind, 'readwrite', (s) => s.put({ ...cur, ...patch, id }));
  db.close();
}

/** Read a single mirrored record by id (used for temp-id detail loads). */
export async function getMirrorRecord<T>(kind: 'people' | 'orgs', id: number): Promise<T | null> {
  const db = await openDb();
  const row = await tx<T | undefined>(db, kind, 'readonly', (s) => s.get(id));
  db.close();
  return row ?? null;
}

/** Rename a record's id (temp → real) after a queued create is replayed. */
export async function remapMirrorId(kind: 'people' | 'orgs', tempId: number, realId: number): Promise<void> {
  const db = await openDb();
  const cur = await tx<Record<string, unknown> | undefined>(db, kind, 'readonly', (s) => s.get(tempId));
  if (cur) {
    await tx(db, kind, 'readwrite', (s) => s.delete(tempId));
    await tx(db, kind, 'readwrite', (s) => s.put({ ...cur, id: realId }));
  }
  db.close();
}

// ── Temp-id allocator ────────────────────────────────────────────────
// Offline-created records get a negative id (real Directus ids are
// positive), so they never collide and are trivially detectable.
export async function nextTempId(): Promise<number> {
  const cur = (await metaGet<number>('tempIdCounter')) ?? 0;
  const next = cur - 1;
  await metaSet('tempIdCounter', next);
  return next;
}

export const isTempId = (id: number): boolean => typeof id === 'number' && id < 0;

// ── Queue store CRUD (engine lives in writeQueue.ts) ─────────────────
export async function queuePut(entry: Record<string, unknown>): Promise<void> {
  const db = await openDb();
  await tx(db, 'queue', 'readwrite', (s) => s.put(entry));
  db.close();
}

export async function queueGetAll<T>(): Promise<T[]> {
  return getAll<T>('queue');
}

export async function queueDelete(id: string): Promise<void> {
  const db = await openDb();
  await tx(db, 'queue', 'readwrite', (s) => s.delete(id));
  db.close();
}
