// LocalFileStore — image/file blobs on the device, in IndexedDB.
//
// Two masters, one store:
//   1. LocalRepository — the local backend keeps its media here, always.
//   2. The "media on this device" setting (Settings → Storage): rows live on
//      a cloud backend, but uploads route HERE — company logos and photos
//      never leave the machine. Reads fall back to the backend (index.ts
//      wrapper), so images that already live in the cloud keep rendering.
//
// IndexedDB stores Blobs natively (no base64 bloat). `srcSync` must be
// synchronous — 44 templates call assetUrl() inline — so hydrate() builds an
// id → object-URL map up front; the root layout awaits it once per load.
// Object URLs live until the page unloads, which is exactly the lifetime the
// map needs.

type StoredFile = {
  id: string;
  blob: Blob;
  title?: string;
  type?: string;
  createdAt: string;
};

const DB_NAME = 'twin-local-media';

function uuid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `f-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export class LocalFileStore {
  private dbp: Promise<IDBDatabase> | null = null;
  private urls = new Map<string, string>();
  private hydrated: Promise<void> | null = null;
  private dbName: string;

  constructor(dbName = DB_NAME) {
    this.dbName = dbName;
  }

  private db(): Promise<IDBDatabase> {
    if (!this.dbp) {
      this.dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('files'))
            req.result.createObjectStore('files', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbp;
  }

  private tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return this.db().then((db) => db.transaction('files', mode).objectStore('files'));
  }

  /** Build the object-URL map. Idempotent; awaited once by the root layout. */
  hydrate(): Promise<void> {
    if (!this.hydrated) {
      this.hydrated = this.tx('readonly').then(
        (store) =>
          new Promise<void>((resolve, reject) => {
            const req = store.getAll();
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
              for (const f of req.result as StoredFile[]) {
                if (!this.urls.has(f.id)) this.urls.set(f.id, URL.createObjectURL(f.blob));
              }
              resolve();
            };
          })
      );
    }
    return this.hydrated;
  }

  /** Store a file; returns its id. The object URL is available immediately,
   *  so the uploading page can render the image without a reload. */
  async put(file: Blob, meta: { title?: string; id?: string } = {}): Promise<string> {
    const entry: StoredFile = {
      id: meta.id ?? uuid(),
      blob: file,
      title: meta.title,
      type: file.type,
      createdAt: new Date().toISOString()
    };
    const store = await this.tx('readwrite');
    await new Promise<void>((resolve, reject) => {
      const req = store.put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    this.urls.set(entry.id, URL.createObjectURL(entry.blob));
    return entry.id;
  }

  /** The renderable src for an id this store holds, or '' — synchronous by
   *  contract (see file header). '' lets callers fall back (backend URL, or
   *  the initials avatar). */
  srcSync(id: string): string {
    return this.urls.get(id) ?? '';
  }

  async remove(id: string): Promise<void> {
    const store = await this.tx('readwrite');
    await new Promise<void>((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    const url = this.urls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(id);
  }

  /** Every stored file with its blob — for the Settings → Storage export. */
  async dumpAll(): Promise<StoredFile[]> {
    const store = await this.tx('readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as StoredFile[]);
      req.onerror = () => reject(req.error);
    });
  }
}

/** The one device media store for the ACTIVE VAULT. Lazy so importing this
 *  module in node (tests of downstream code) never touches IndexedDB. The
 *  first caller (the repo factory, at module init) names it for the active
 *  vault; later callers get the same instance. */
let _store: LocalFileStore | null = null;
export function localFileStore(name?: string): LocalFileStore {
  if (!_store) _store = new LocalFileStore(name);
  return _store;
}
