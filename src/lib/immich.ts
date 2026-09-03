// Immich client — the photo/face-recognition engine for the photo
// navigator. Immich runs on the NAS next to Directus; twin reaches it
// through a key-injecting nginx proxy on the same tailnet host, port
// 8444 (tailscale serve → 127.0.0.1:2284 → immich-server). The API key
// never reaches the browser — the proxy adds it server-side, and CORS
// is solved in the same hop.
//
// Photos never enter Directus. The only thing stored there is the
// face-cluster ↔ Person mapping (photo_person collection); thumbnails
// and originals stream straight from Immich via the URLs built here.
import { immichBase } from '$lib/apiBase';

// Absolute host (:8444) when configured with an absolute Directus URL; `/immich`
// when Directus is same-origin at /api. The choice lives in apiBase.ts next to
// the Directus-URL logic it mirrors — see immichBase().
export const IMMICH_URL = immichBase();

const API = `${IMMICH_URL}/api`;

export type ImmichPerson = {
  id: string;
  name: string;
  birthDate: string | null;
  thumbnailPath: string;
  isHidden: boolean;
  updatedAt?: string;
};

export type ImmichAsset = {
  id: string;
  type: 'IMAGE' | 'VIDEO';
  originalFileName: string;
  originalPath?: string;
  fileCreatedAt: string;
  localDateTime?: string;
  duration?: string | null;
};

export type TimelineBucket = { timeBucket: string; count: number };

/** Camera + place EXIF, as Immich exposes it on a single asset. */
export type ImmichExif = {
  dateTimeOriginal?: string | null;
  make?: string | null;
  model?: string | null;
  lensModel?: string | null;
  fNumber?: number | null;
  exposureTime?: string | null;
  focalLength?: number | null;
  iso?: number | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  description?: string | null;
  rating?: number | null;
  fileSizeInByte?: number | null;
  exifImageWidth?: number | null;
  exifImageHeight?: number | null;
  timeZone?: string | null;
};

/** A face cluster present in one asset (Immich's per-asset people list). */
export type ImmichFace = {
  id: string;
  name: string;
  thumbnailPath: string;
  isHidden: boolean;
};

/** The full single-asset DTO — exif, faces, favourite, description. */
export type ImmichAssetFull = ImmichAsset & {
  isFavorite: boolean;
  width?: number;
  height?: number;
  originalMimeType?: string;
  exifInfo?: ImmichExif | null;
  people?: ImmichFace[];
  tags?: { id: string; name: string }[];
};

/** A geotagged asset, as returned by Immich's reverse-geocoded map index. */
export type MapMarker = {
  id: string;
  lat: number;
  lon: number;
  city: string | null;
  state: string | null;
  country: string | null;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }
  });
  if (!res.ok) throw new Error(`Immich ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** True when the Immich server answers. Used for the setup/offline state. */
export async function immichAvailable(): Promise<boolean> {
  try {
    const r = await api<{ res: string }>('/server/ping');
    return r.res === 'pong';
  } catch {
    return false;
  }
}

/** Condensed job-queue status so the UI can say "still indexing". */
export async function immichIndexing(): Promise<{ active: number; waiting: number }> {
  const jobs = await api<Record<string, { jobCounts: { active: number; waiting: number } }>>('/jobs');
  let active = 0;
  let waiting = 0;
  for (const j of Object.values(jobs)) {
    active += j.jobCounts.active;
    waiting += j.jobCounts.waiting;
  }
  return { active, waiting };
}

export async function immichStatistics(): Promise<{ photos: number; videos: number }> {
  return api('/server/statistics');
}

/** Face clusters ("people" in Immich terms), biggest clusters first. */
export async function listImmichPeople(
  page = 1,
  size = 100
): Promise<{ people: ImmichPerson[]; total: number; hasNextPage: boolean }> {
  return api(`/people?page=${page}&size=${size}&withHidden=false`);
}

/** Rename a cluster inside Immich (kept in sync when mapping to a
 *  Person so the Immich UI stays useful on its own). Best-effort. */
export async function renameImmichPerson(id: string, name: string): Promise<void> {
  await api(`/people/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
}

/** Hide a cluster inside Immich (strangers, misfires). Best-effort. */
export async function hideImmichPerson(id: string): Promise<void> {
  await api(`/people/${id}`, { method: 'PUT', body: JSON.stringify({ isHidden: true }) });
}

export async function immichPersonStats(id: string): Promise<{ assets: number }> {
  return api(`/people/${id}/statistics`);
}

type SearchBody = {
  personIds?: string[];
  takenAfter?: string;
  takenBefore?: string;
  page?: number;
  size?: number;
  type?: 'IMAGE' | 'VIDEO';
  order?: 'asc' | 'desc';
  rating?: number; // exact star value (1–5)
};

/** Paged asset search — by face cluster(s) and/or date window.
 *  `nextPage` is null when exhausted. */
export async function searchImmichAssets(
  body: SearchBody
): Promise<{ items: ImmichAsset[]; total: number; nextPage: number | null }> {
  const r = await api<{
    assets: { items: ImmichAsset[]; total: number; count: number; nextPage: string | null };
  }>('/search/metadata', {
    method: 'POST',
    body: JSON.stringify({ order: 'desc', ...body })
  });
  return {
    items: r.assets.items,
    total: r.assets.total,
    nextPage: r.assets.nextPage ? Number(r.assets.nextPage) : null
  };
}

/** Semantic (CLIP) search over the library — matches scenes, objects,
 *  places, text in photos. Requires Immich ML; returns [] if it's off
 *  or errors, so callers can fall back to structured search. */
export async function smartSearchImmich(query: string, opts: { size?: number } = {}): Promise<ImmichAsset[]> {
  if (!query.trim()) return [];
  try {
    const r = await api<{ assets: { items: ImmichAsset[] } }>('/search/smart', {
      method: 'POST',
      body: JSON.stringify({ query: query.trim(), size: opts.size ?? 60 })
    });
    return r?.assets?.items ?? [];
  } catch {
    return [];
  }
}

/** Assets rated at least `minRating` stars (1–5), newest first. Immich
 *  filters by an exact rating, so we merge one query per star value in the
 *  range. Rated photos are a small subset, so a page or two each is plenty;
 *  capped for safety. Optional `personIds` scopes to a face cluster. */
export async function searchRatedAssets(
  minRating: number,
  opts: { personIds?: string[] } = {}
): Promise<ImmichAsset[]> {
  const lo = Math.max(1, Math.min(5, Math.round(minRating)));
  const byId = new Map<string, ImmichAsset>();
  for (let r = lo; r <= 5; r++) {
    let page: number | null = 1;
    while (page && byId.size < 1500) {
      const res = await searchImmichAssets({ rating: r, page, size: 250, ...opts });
      for (const a of res.items) byId.set(a.id, a);
      page = res.nextPage;
    }
  }
  return [...byId.values()].sort(
    (a, b) => new Date(b.fileCreatedAt).getTime() - new Date(a.fileCreatedAt).getTime()
  );
}

/** Month buckets for the whole library (newest first) — the browse index. */
export async function timelineBuckets(): Promise<TimelineBucket[]> {
  return api('/timeline/buckets?visibility=timeline');
}

/** Every geotagged asset (id + reverse-geocoded place) for the map view.
 *  Immich only returns markers for assets that carry GPS EXIF, so this is
 *  naturally a subset of the library. Optional date window. */
export async function mapMarkers(opts: { takenAfter?: string; takenBefore?: string } = {}): Promise<MapMarker[]> {
  const q = new URLSearchParams();
  if (opts.takenAfter) q.set('fileCreatedAfter', opts.takenAfter);
  if (opts.takenBefore) q.set('fileCreatedBefore', opts.takenBefore);
  const qs = q.toString();
  return api(`/map/markers${qs ? `?${qs}` : ''}`);
}

// ── URL builders (plain <img>/<video> srcs — the proxy injects auth) ──
export function assetThumbUrl(id: string, size: 'thumbnail' | 'preview' = 'thumbnail'): string {
  return `${API}/assets/${id}/thumbnail?size=${size}`;
}
export function assetVideoUrl(id: string): string {
  return `${API}/assets/${id}/video/playback`;
}
export function personThumbUrl(id: string): string {
  return `${API}/people/${id}/thumbnail`;
}

/** One asset by id — used to hydrate photo_link grids. */
export async function getImmichAsset(id: string): Promise<ImmichAsset> {
  return api(`/assets/${id}`);
}

/** Full metadata for one asset (exif, faces, favourite) — the lightbox
 *  info sidebar. */
export async function getAssetFull(id: string): Promise<ImmichAssetFull> {
  return api(`/assets/${id}`);
}

/** Write editable fields back to Immich (description, favourite, …). The
 *  change lands on the Immich server itself, so it shows in Immich's own
 *  UI too. Returns the updated asset. */
export async function updateAsset(
  id: string,
  patch: {
    description?: string;
    isFavorite?: boolean;
    rating?: number;
    /** ISO 8601 — overrides the photo's capture date ("Taken"). */
    dateTimeOriginal?: string;
    latitude?: number;
    longitude?: number;
  }
): Promise<ImmichAssetFull> {
  return api(`/assets/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
}

/** Deep link to an asset in the Immich web UI (through the same tailnet
 *  host as the API proxy). Fallback for editing metadata twin doesn't
 *  expose yet. */
export function immichAssetWebUrl(id: string): string {
  return `${IMMICH_URL}/photos/${id}`;
}

/** The most recent asset across the given face clusters, or null.
 *  Used to pick a default profile photo for a mapped person. */
export async function firstMappedAsset(clusterIds: string[]): Promise<ImmichAsset | null> {
  if (clusterIds.length === 0) return null;
  const r = await searchImmichAssets({ personIds: clusterIds, page: 1, size: 1 });
  return r.items[0] ?? null;
}

export type UploadResult = { id: string; status: 'created' | 'duplicate' };

/** Upload one file into Immich (managed storage) through the proxy — the
 *  drop-zone path. The proxy injects the key; we must NOT set a JSON
 *  Content-Type here so the browser writes the multipart boundary itself.
 *  Throws with the HTTP status in the message (e.g. 413 = proxy body cap). */
export async function uploadAsset(file: File): Promise<UploadResult> {
  const stamp = new Date(file.lastModified || Date.now()).toISOString();
  const fd = new FormData();
  fd.append('deviceAssetId', `twin-web-${file.name}-${file.size}-${file.lastModified}`);
  fd.append('deviceId', 'twin-web');
  fd.append('fileCreatedAt', stamp);
  fd.append('fileModifiedAt', stamp);
  fd.append('assetData', file);
  const res = await fetch(`${API}/assets`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Immich upload → HTTP ${res.status}`);
  return (await res.json()) as UploadResult;
}

/** Download an Immich asset (preview JPEG) through the proxy and wrap
 *  it as a File, ready to upload into Directus — e.g. to adopt a
 *  library photo as a person's avatar. The proxy injects the key and
 *  allows CORS, so this runs in the browser. */
export async function fetchAssetFile(
  assetId: string,
  filename: string,
  size: 'thumbnail' | 'preview' = 'preview'
): Promise<File> {
  const url = assetThumbUrl(assetId, size);
  // An <img> that loaded this URL without crossorigin leaves an opaque entry
  // in the HTTP cache, and a CORS-mode fetch that reuses it throws TypeError
  // before any status exists to check. Retry once past the cache: the network
  // response is fine, only the cached copy is unusable.
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    res = await fetch(url, { cache: 'reload' });
  }
  if (!res.ok) throw new Error(`Immich asset ${assetId} → HTTP ${res.status}`);
  const blob = await res.blob();
  const safe = (filename || 'photo').replace(/[^\w.-]+/g, '_').slice(0, 60);
  return new File([blob], `${safe}.jpg`, { type: blob.type || 'image/jpeg' });
}

// ── Albums ───────────────────────────────────────────────────────────
// Immich albums are the sorting workspace: photos get grouped into an
// album in Immich (e.g. right after an event upload), then the Albums
// tab here shows each album's assets so they can be batch-tagged to
// projects/events/people in one pass.
export type ImmichAlbum = {
  id: string;
  albumName: string;
  description?: string | null;
  albumThumbnailAssetId: string | null;
  assetCount: number;
  startDate?: string | null;
  endDate?: string | null;
  updatedAt?: string;
  shared?: boolean;
};

/** All albums, most recently updated first. */
export async function listImmichAlbums(): Promise<ImmichAlbum[]> {
  const albums = await api<ImmichAlbum[]>('/albums');
  return albums.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

/** One album with its assets (newest capture first). */
export async function getImmichAlbum(id: string): Promise<ImmichAlbum & { assets: ImmichAsset[] }> {
  const album = await api<ImmichAlbum & { assets: ImmichAsset[] }>(`/albums/${id}`);
  album.assets.sort((a, b) => (b.fileCreatedAt ?? '').localeCompare(a.fileCreatedAt ?? ''));
  return album;
}
