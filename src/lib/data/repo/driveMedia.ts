// Google Drive as the image store — durable in the user's own Drive, with the
// device blob cache (LocalFileStore) kept as the SYNCHRONOUS render layer.
//
// Why the cache: assetSrc is synchronous by contract (44 templates call it
// inline), and Drive can only answer async. So the split is: Drive is where
// images live for real (survives a device wipe, follows you across devices);
// a local blob cache is what the UI actually renders from. put() uploads to
// Drive AND mirrors the blob into the cache; hydrate() downloads the folder's
// files into the cache on load; srcSync() reads the cache. An image not yet
// cached shows initials until hydrate fetches it — the same honest trade the
// device-media mode already documents.
//
// Scope is drive.file — twin can only see and touch files it created, never
// the rest of the user's Drive. Auth is Google Identity Services (the user
// consents in Google's own window; twin never sees their password), and the
// OAuth client id is public config the user pastes, not a secret.

import { LocalFileStore } from './files.ts';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'Twin';

const CLIENT_ID_KEY = 'twin.drive.clientId';
const TOKEN_KEY = 'twin.drive.token'; // { access_token, expiry }
const FOLDER_KEY = 'twin.drive.folderId';

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/** Is a stored token still good (with a 60s safety margin)? */
export function tokenValid(tok: { access_token?: string; expiry?: number } | null): boolean {
  return !!tok?.access_token && typeof tok.expiry === 'number' && tok.expiry - 60_000 > Date.now();
}

/** The Drive query that finds twin's folder. */
export function folderQuery(): string {
  return `mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`;
}

/** The multipart body for an upload — metadata part + binary part. Returns the
 *  boundary and the assembled Blob so the caller sets the matching header. */
export function multipartUpload(file: Blob, name: string, folderId: string): { boundary: string; body: Blob } {
  const boundary = `twin${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name, parents: [folderId] });
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  return { boundary, body: new Blob([head, file, tail]) };
}

// ── Auth (browser only) ─────────────────────────────────────────────────────

function readToken(): { access_token: string; expiry: number } | null {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
  } catch {
    return null;
  }
}
function writeToken(t: { access_token: string; expiry: number } | null): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode */
  }
}

export function driveClientId(): string {
  try {
    return localStorage.getItem(CLIENT_ID_KEY) || '';
  } catch {
    return '';
  }
}
export function setDriveClientId(id: string): void {
  try {
    localStorage.setItem(CLIENT_ID_KEY, id.trim());
  } catch {
    /* private mode */
  }
}
export function driveConnected(): boolean {
  return tokenValid(readToken());
}
export function disconnectDrive(): void {
  writeToken(null);
  try {
    localStorage.removeItem(FOLDER_KEY);
  } catch {
    /* ignore */
  }
}

let gisLoaded: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (!gisLoaded) {
    gisLoaded = new Promise((resolve, reject) => {
      if (typeof document === 'undefined') return reject(new Error('no document'));
      if ((window as unknown as { google?: unknown }).google) return resolve();
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load Google sign-in.'));
      document.head.appendChild(s);
    });
  }
  return gisLoaded;
}

/** Open Google's consent window and get an access token (interactive). */
export async function connectDrive(): Promise<void> {
  const clientId = driveClientId();
  if (!clientId) throw new Error('Add your Google OAuth client ID first.');
  await loadGis();
  const google = (window as unknown as { google: any }).google;
  await new Promise<void>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp: { access_token?: string; expires_in?: number; error?: string }) => {
        if (resp.error || !resp.access_token) return reject(new Error(resp.error || 'Authorization was cancelled.'));
        writeToken({ access_token: resp.access_token, expiry: Date.now() + (resp.expires_in ?? 3600) * 1000 });
        resolve();
      }
    });
    client.requestAccessToken({ prompt: '' });
  });
}

async function token(): Promise<string> {
  const t = readToken();
  if (tokenValid(t)) return t!.access_token;
  // Expired — a silent refresh needs an interactive gesture in GIS's implicit
  // flow, so tell the caller to reconnect rather than hang.
  throw new Error('Google Drive session expired — reconnect in Settings → Storage.');
}

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const t = await token();
  return fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` } });
}

async function ensureFolder(): Promise<string> {
  try {
    const cached = localStorage.getItem(FOLDER_KEY);
    if (cached) return cached;
  } catch {
    /* ignore */
  }
  const found = await driveFetch(`${DRIVE}/files?q=${encodeURIComponent(folderQuery())}&fields=files(id)`).then((r) =>
    r.json()
  );
  let id: string = found.files?.[0]?.id;
  if (!id) {
    const created = await driveFetch(`${DRIVE}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    }).then((r) => r.json());
    id = created.id;
  }
  try {
    localStorage.setItem(FOLDER_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

// ── The store (LocalFileStore-compatible) ───────────────────────────────────

export class DriveFileStore {
  // The render cache: a device blob store, same class the device-media mode
  // uses. Drive is durable; this is what srcSync answers from.
  private cache: LocalFileStore;
  private hydrated: Promise<void> | null = null;

  constructor(cacheDbName: string) {
    this.cache = new LocalFileStore(cacheDbName);
  }

  /** Upload to Drive, mirror into the cache, return the DRIVE file id (which
   *  becomes the row's stored image id, so it's stable across devices). */
  async put(file: Blob, meta: { title?: string; id?: string } = {}): Promise<string> {
    const folderId = await ensureFolder();
    const { boundary, body } = multipartUpload(file, meta.title || `twin-${Date.now()}`, folderId);
    const res = await driveFetch(UPLOAD, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    if (!res.ok) throw new Error(`Drive upload failed (${res.status}).`);
    const { id } = await res.json();
    await this.cache.put(file, { title: meta.title, id });
    return id;
  }

  srcSync(id: string): string {
    return this.cache.srcSync(id);
  }

  /** Ready the render layer: await the LOCAL cache only (fast — already-seen
   *  images render at once), then pull any new Drive files into the cache in
   *  the BACKGROUND so boot isn't held hostage to a large folder. Newly
   *  downloaded images appear on the next navigation. Best-effort throughout:
   *  a Drive/network hiccup just leaves whatever is already cached. */
  hydrate(): Promise<void> {
    if (!this.hydrated) {
      this.hydrated = this.cache.hydrate().then(() => {
        void this.syncFromDrive();
      });
    }
    return this.hydrated;
  }

  private async syncFromDrive(): Promise<void> {
    if (!driveConnected()) return;
    try {
      const folderId = await ensureFolder();
      const list = await driveFetch(
        `${DRIVE}/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&fields=files(id)`
      ).then((r) => r.json());
      const have = new Set((await this.cache.dumpAll()).map((f) => f.id));
      for (const f of (list.files ?? []) as { id: string }[]) {
        if (have.has(f.id)) continue;
        const blob = await driveFetch(`${DRIVE}/files/${f.id}?alt=media`).then((r) => (r.ok ? r.blob() : null));
        if (blob) await this.cache.put(blob, { id: f.id });
      }
    } catch {
      /* offline / expired — cached images still render */
    }
  }

  async remove(id: string): Promise<void> {
    await this.cache.remove(id).catch(() => {});
    try {
      await driveFetch(`${DRIVE}/files/${id}`, { method: 'DELETE' });
    } catch {
      /* the file may already be gone; the cache removal is what matters for UI */
    }
  }

  dumpAll() {
    return this.cache.dumpAll();
  }
}

let _drive: DriveFileStore | null = null;
export function driveFileStore(cacheDbName: string): DriveFileStore {
  if (!_drive) _drive = new DriveFileStore(cacheDbName);
  return _drive;
}
