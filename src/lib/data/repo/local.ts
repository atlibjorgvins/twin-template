// LocalRepository — the storage port with no server at all.
//
// `PUBLIC_DATA_BACKEND=local` keeps every row on the device, in IndexedDB.
// This is the out-of-the-box backend: `git clone && npm run dev` (or the
// desktop app) is a working twin with nothing to stand up, and the same
// adapter is what a packaged .dmg runs on. The trade is stated honestly in
// the UI copy: data lives in THIS browser profile until exported or synced.
//
// Implementation: MemoryRepository already carries the port's reference
// semantics (filters, sort, paging, aggregates, files) and passes the
// conformance suite. This subclass adds exactly one concern — durability:
// hydrate the in-memory maps from IndexedDB once, write mutations through.
// Query semantics are inherited, so `runRepositoryConformance` holds for free
// on the logic and the suite still runs against this class (over
// fake-indexeddb) to prove the persistence plumbing does not corrupt rows.
//
// Scale check, measured against the live twin: ~1.6k people + ~4.2k orgs.
// Full in-memory operation over that is sub-millisecond per query; hydration
// is one indexed cursor walk. If a future plugin brings 10^6 rows, that is
// the moment to swap this for a real embedded engine (PGlite shares the
// Supabase dialect) — behind the same port, which is the whole point.
//
// One store, one schema version, forever: rows keyed by `collection\0id`.
// Per-collection object stores would need a version bump (and an upgrade
// transaction) every time a plugin adds a collection — the exact VersionError
// trap offline.ts documents. A single flat store never migrates.

import type { AuthProvider, Id, Query } from './types';
// Explicit .ts so the node test runner (strip-types, no extension guessing)
// can load this module; Vite resolves it identically.
import { MemoryRepository } from './memory.ts';
import { LocalFileStore, localFileStore } from './files.ts';

type Row = Record<string, unknown>;
type Stored = { k: string; c: string; id: Id; row: Row };

const SEP = '\u0000'; // cannot appear in a collection name or id
const key = (c: string, id: Id) => `${c}${SEP}${id}`;

export class LocalRepository extends MemoryRepository {
  private dbp: Promise<IDBDatabase> | null = null;
  private hydrated: Promise<void> | null = null;

  private dbName: string;
  /** Blob storage for uploads — the shared device store in the app, an
   *  isolated one per test database. */
  private media: LocalFileStore;

  /** `dbName` is parameterised so the conformance suite can give every test a
   *  fresh database; the app always uses the default. (Not a TS parameter
   *  property — node's strip-types test runner cannot erase those.) */
  constructor(dbName = 'twin-local-data', media?: LocalFileStore) {
    super();
    this.dbName = dbName;
    this.media =
      media ?? (dbName === 'twin-local-data' ? localFileStore() : new LocalFileStore(`${dbName}-media`));
  }

  private db(): Promise<IDBDatabase> {
    if (!this.dbp) {
      this.dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('rows'))
            req.result.createObjectStore('rows', { keyPath: 'k' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbp;
  }

  private tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return this.db().then((db) => db.transaction('rows', mode).objectStore('rows'));
  }

  /** Load everything into the inherited maps, once. Sequence counters resume
   *  from the max numeric id per collection so a restored device never hands
   *  out an id that already exists. */
  private ready(): Promise<void> {
    if (!this.hydrated) {
      this.hydrated = this.tx('readonly').then(
        (store) =>
          new Promise<void>((resolve, reject) => {
            const req = store.getAll();
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
              for (const entry of req.result as Stored[]) {
                let col = this.store.get(entry.c);
                if (!col) {
                  col = new Map();
                  this.store.set(entry.c, col);
                }
                col.set(entry.id, entry.row);
                if (typeof entry.id === 'number')
                  this.seq.set(entry.c, Math.max(this.seq.get(entry.c) ?? 0, entry.id));
              }
              resolve();
            };
          })
      );
    }
    return this.hydrated;
  }

  private put(c: string, row: Row): Promise<void> {
    return this.tx('readwrite').then(
      (store) =>
        new Promise((resolve, reject) => {
          const req = store.put({ k: key(c, row.id as Id), c, id: row.id as Id, row } as Stored);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        })
    );
  }

  private del(c: string, id: Id): Promise<void> {
    return this.tx('readwrite').then(
      (store) =>
        new Promise((resolve, reject) => {
          const req = store.delete(key(c, id));
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        })
    );
  }

  // ── Reads: hydrate, then inherit ─────────────────────────────────────────
  override async list<T>(c: string, q?: Query): Promise<T[]> {
    await this.ready();
    return super.list<T>(c, q);
  }
  override async get<T>(c: string, id: Id, q?: Pick<Query, 'fields'>): Promise<T | null> {
    await this.ready();
    return super.get<T>(c, id, q);
  }
  override async count(...args: Parameters<MemoryRepository['count']>) {
    await this.ready();
    return super.count(...args);
  }
  override async aggregate<T>(...args: Parameters<MemoryRepository['aggregate']>): Promise<T[]> {
    await this.ready();
    return super.aggregate(...args) as Promise<T[]>;
  }
  override async listFiles<T>(q?: Query): Promise<T[]> {
    await this.ready();
    return super.listFiles<T>(q);
  }

  // ── Writes: inherit, then persist the row the reference impl produced ────
  override async create<T>(c: string, data: Row): Promise<T> {
    await this.ready();
    const row = await super.create<Row>(c, data);
    await this.put(c, row);
    return row as T;
  }
  override async createMany<T>(c: string, data: Row[]): Promise<T[]> {
    await this.ready();
    const rows = await super.createMany<Row>(c, data);
    for (const r of rows) await this.put(c, r);
    return rows as T[];
  }
  override async update<T>(c: string, id: Id, data: Row): Promise<T> {
    await this.ready();
    const row = await super.update<Row>(c, id, data);
    await this.put(c, row);
    return row as T;
  }
  override async updateMany<T>(c: string, ids: Id[], data: Row): Promise<T[]> {
    await this.ready();
    const rows = await super.updateMany<Row>(c, ids, data);
    for (const r of rows) await this.put(c, r);
    return rows as T[];
  }
  override async remove(c: string, id: Id): Promise<void> {
    await this.ready();
    await super.remove(c, id);
    await this.del(c, id);
  }
  override async removeMany(c: string, ids: Id[]): Promise<void> {
    await this.ready();
    await super.removeMany(c, ids);
    for (const id of ids) await this.del(c, id);
  }
  override async importFileFromUrl<T>(url: string, data?: Row): Promise<T> {
    await this.ready();
    const row = await super.importFileFromUrl<Row>(url, data);
    await this.put(this.FILES, row);
    return row as T;
  }
  override async removeFile(id: Id): Promise<void> {
    await this.ready();
    await super.removeFile(id);
    await this.del(this.FILES, id);
    await this.media.remove(String(id)).catch(() => {});
  }

  /** Store the blob on the device and register a meta row in the files
   *  collection (so listFiles sees uploads, same as other backends). */
  override async uploadFile(file: File, opts: { folder?: string; title?: string } = {}): Promise<string> {
    await this.ready();
    const id = await this.media.put(file, { title: opts.title ?? file.name });
    const row = await super.create<Record<string, unknown>>(this.FILES, {
      id,
      title: opts.title ?? file.name,
      filename_download: file.name,
      type: file.type
    });
    await this.put(this.FILES, row);
    return id;
  }

  override assetSrc(fileId: string | null | undefined): string {
    return fileId ? this.media.srcSync(String(fileId)) : '';
  }

  /** The media store, for hydration (root layout) and the settings export. */
  mediaStore(): LocalFileStore {
    return this.media;
  }

  /** Every collection and every row — the JSON export (Settings → Storage).
   *  Local-first data trapped in one browser profile is the one real risk of
   *  this backend; a one-click dump is the counterweight, and the same shape
   *  is the future local→cloud migration payload. */
  async dumpAll(): Promise<Record<string, Row[]>> {
    await this.ready();
    const out: Record<string, Row[]> = {};
    for (const [collection, rows] of this.store) {
      out[collection] = [...rows.values()].map((r) => ({ ...r }));
    }
    return out;
  }
}

/**
 * Local mode has no accounts: the device is the identity. PUBLIC_AUTH_MODE
 * stays unset so the layout guard never engages; these methods exist only to
 * satisfy the port for surfaces that probe them (settings, connection card).
 */
export class LocalAuthProvider implements AuthProvider {
  async login(): Promise<void> {
    throw new Error('Local twin has no accounts — your data lives on this device.');
  }
  async logout(): Promise<void> {}
  async me<T>(): Promise<T | null> {
    return null;
  }
  async serverInfo<T>(): Promise<T> {
    return { backend: 'local', project: { project_name: 'twin (local)' } } as T;
  }
}
