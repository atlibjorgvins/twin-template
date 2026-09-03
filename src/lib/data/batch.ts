// Batch operations
//
// Bulk create/update/delete helpers used across the app.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { authHeader } from '$lib/data/client';
import { repo } from '$lib/data/repo';
import { PUBLIC_DIRECTUS_URL } from '$env/static/public';
import type { Organization, Person, Project } from '$lib/data/types';
import { getMirrorRecord, isNetworkError, isTempId, markOffline, markOnline } from '$lib/offline';
import { reconcilePersonProjectInheritance } from '$lib/project-inheritance';

// ─── Batch operations ───────────────────────────────────────────────────
// Wrap Directus's bulk endpoints so callers don't have to think about the
// SDK's slight quirks (PATCH /items/<collection> with `keys` body for
// updates; DELETE with body for deletes). Returns void — callers should
// refresh their local list after.

export async function bulkUpdatePeople(ids: number[], patch: Partial<Person>): Promise<void> {
  if (ids.length === 0) return;
  await repo.updateMany('Person', ids, patch as Record<string, unknown>);
}

export async function bulkDeletePeople(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await repo.removeMany('Person', ids);
}

export async function bulkUpdateOrgs(ids: number[], patch: Partial<Organization>): Promise<void> {
  if (ids.length === 0) return;
  await repo.updateMany('organization', ids, patch as Record<string, unknown>);
}

export async function bulkDeleteOrgs(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await repo.removeMany('organization', ids);
}

export async function bulkUpdateProjects(ids: number[], patch: Partial<Project>): Promise<void> {
  if (ids.length === 0) return;
  await repo.updateMany('Project', ids, patch as Record<string, unknown>);
}

export async function bulkDeleteProjects(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await repo.removeMany('Project', ids);
}

/** Attach many people to a single project in one round-trip. Skips
 *  people who already have a Project_people row for this project so
 *  re-running the operation is safe. */
export async function bulkAttachPeopleToProject(personIds: number[], projectId: number): Promise<void> {
  if (personIds.length === 0) return;
  // Find existing links so we don't insert duplicates.
  const existing = await repo.list<{ person_id: number | { id: number } | null }>('Project_people', {
    where: {
      and: [
        { field: 'project_id', op: 'eq', value: projectId },
        { field: 'person_id', op: 'in', value: personIds }
      ]
    },
    fields: ['person_id'],
    limit: -1
  });
  const linkedIds = new Set(
    existing
      .map((l) => (typeof l.person_id === 'object' ? l.person_id?.id : l.person_id))
      .filter((v): v is number => typeof v === 'number')
  );
  const toCreate = personIds.filter((id) => !linkedIds.has(id));
  if (toCreate.length === 0) return;
  await repo.createMany(
    'Project_people',
    toCreate.map((person_id) => ({ project_id: projectId, person_id, status: 'published' }))
  );
  for (const person_id of toCreate) await reconcilePersonProjectInheritance(person_id);
}

export async function getPerson(id: number) {
  // Offline-created records live only in the mirror.
  if (isTempId(id)) {
    const rec = await getMirrorRecord<Person>('people', id);
    if (rec) return rec;
    throw new Error(`Unknown pending record ${id}`);
  }
  try {
    const p = await repo.get<Person>('Person', id, {
      fields: ['*', { organization: ['id', 'name', 'website', 'industry', 'city', 'country'] }]
    });
    if (!p) throw new Error(`Person ${id} not found`);
    markOnline();
    return p;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    markOffline();
    const rec = await getMirrorRecord<Person>('people', id);
    if (rec) return rec;
    throw e;
  }
}

/**
 * Upload a single file to Directus /files. Returns the file's `id` (uuid string)
 * which can be assigned to fields like `Person.person_picture` or
 * `organization.logo`.
 */
export async function uploadFile(file: File, opts: { folder?: string; title?: string } = {}): Promise<string> {
  // Through the storage port: Directus does its multipart POST, the local
  // backend (and the "media on this device" setting) stores the blob in
  // IndexedDB. This wrapper survives so ~a dozen call sites keep their import.
  return repo.uploadFile(file, opts);
}

/**
 * Resize a Blob (image) to fit within `maxEdge` px on the longest side.
 *
 * Format choice — important: alpha-capable sources (PNG, WebP, GIF, SVG) are
 * re-encoded as PNG so transparency survives. Otherwise we'd be drawing a
 * transparent source onto a fresh canvas and asking the browser to flatten
 * it to JPEG, which (per spec) substitutes a *black* fill for transparent
 * pixels. That's exactly what produced the dark backgrounds behind some
 * brand logos that were originally transparent PNGs.
 *
 * Photos (image/jpeg input) stay JPEG to keep file sizes small.
 */
async function resizeImageBlob(
  blob: Blob,
  opts: { maxEdge?: number; quality?: number; mime?: string } = {}
): Promise<Blob> {
  const maxEdge = opts.maxEdge ?? 800;
  const quality = opts.quality ?? 0.85;
  // Pick output format: explicit override → caller wins; alpha-capable source → PNG; else JPEG.
  const sourceType = (blob.type || '').toLowerCase();
  const sourceHasAlpha = /^image\/(png|webp|gif|svg\+xml|avif)/.test(sourceType);
  const mime = opts.mime ?? (sourceHasAlpha ? 'image/png' : 'image/jpeg');
  // Decode
  const bmp = await createImageBitmap(blob);
  const longest = Math.max(bmp.width, bmp.height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  // Prefer OffscreenCanvas; fall back to a regular <canvas> for older browsers.
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context');
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    return await canvas.convertToBlob({ type: mime, quality });
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), mime, quality)
  );
}

/**
 * Resize a File client-side and return a new File. Format is preserved when
 * transparency matters (PNG/WebP/SVG → PNG); JPEG sources stay JPEG.
 */
export async function resizeImageFile(file: File, opts: { maxEdge?: number; quality?: number } = {}): Promise<File> {
  const out = await resizeImageBlob(file, { ...opts });
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
  const ext = out.type === 'image/png' ? 'png'
            : out.type === 'image/webp' ? 'webp'
            : 'jpg';
  return new File([out], `${baseName}.${ext}`, { type: out.type });
}

/**
 * Try to fetch an image URL in the browser, resize it on a canvas, and upload
 * the small JPEG to Directus. If the source server doesn't allow CORS, we
 * fall back to Directus's server-side `/files/import` (which always works,
 * but stores the full-size original — display-time transforms via assetUrl()
 * keep the on-screen size small either way).
 */
export async function uploadFromUrl(
  url: string,
  opts: { folder?: string; title?: string; maxEdge?: number; quality?: number } = {}
): Promise<{ id: string; via: 'browser-resize' | 'directus-import'; type?: string; filesize?: number }> {
  const trimmed = url.trim();
  if (!trimmed) throw new Error('URL is empty');
  // Path A — try in-browser fetch + resize
  try {
    const res = await fetch(trimmed, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) throw new Error(`Not an image (${blob.type || 'unknown'})`);
    const small = await resizeImageBlob(blob, {
      maxEdge: opts.maxEdge ?? 800,
      quality: opts.quality ?? 0.85
      // mime omitted — picks PNG for alpha-capable sources, JPEG for photos.
    });
    const ext = small.type === 'image/png' ? 'png'
              : small.type === 'image/webp' ? 'webp'
              : 'jpg';
    const filename = `${pickFilename(trimmed)}.${ext}`;
    const file = new File([small], filename, { type: small.type });
    const id = await uploadFile(file, { folder: opts.folder, title: opts.title ?? filename });
    return { id, via: 'browser-resize', type: small.type, filesize: small.size };
  } catch {
    // Fall through to server-side import.
  }
  // Path B — Directus /files/import (server-side download, no CORS)
  const res = await fetch(`${PUBLIC_DIRECTUS_URL}/files/import`, {
    method: 'POST',
    headers: {
      ...authHeader(),
      'Content-Type': 'application/json'
    },
    credentials: 'include',
    body: JSON.stringify({
      url: trimmed,
      data: opts.title ? { title: opts.title } : {}
    })
  });
  if (!res.ok) {
    let msg = `Import failed: ${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      msg = body?.errors?.[0]?.message ?? msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  const json = await res.json();
  const id = json?.data?.id as string;
  if (!id) throw new Error('Import returned no file id');
  return {
    id,
    via: 'directus-import',
    type: json?.data?.type as string | undefined,
    filesize: json?.data?.filesize as number | undefined
  };
}

/** Delete a Directus file by id. Used to clean up after a bad import. */
export async function deleteDirectusFile(id: string): Promise<void> {
  await fetch(`${PUBLIC_DIRECTUS_URL}/files/${id}`, {
    method: 'DELETE',
    headers: authHeader(),
    credentials: 'include'
  });
}

function pickFilename(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? 'image';
    return last.replace(/\.[^.]+$/, '') || 'image';
  } catch {
    return 'image';
  }
}

export function assetUrl(fileId: string | null | undefined, params: Record<string, string | number> = {}) {
  // Through the storage port — synchronous by contract, because 44 files call
  // this inline in templates. '' means "this backend can't show it"; the
  // avatar/logo components fall back to initials, never a broken glyph.
  return repo.assetSrc(fileId, params);
}

/**
 * Deep-link to a Directus admin item page — useful as an escape hatch from
 * the PWA for admin-only operations like permanent delete, raw-field edits,
 * permission tweaks, etc.
 *
 * Example: `directusAdminUrl('organization', 42)` →
 *   http://localhost:8055/admin/content/organization/42
 */
export function directusAdminUrl(collection: string, id: number | string): string {
  return `${PUBLIC_DIRECTUS_URL}/admin/content/${collection}/${id}`;
}

/**
 * Turn anything thrown by Directus / fetch / our own code into a human-
 * readable string. Directus SDK throws plain objects with shape
 *   { errors: [{ message, extensions: { code } }] }
 * which `String(err)` renders as the useless "[object Object]". This helper
 * walks that shape, with sensible fallbacks for Errors and strings.
 */
export function formatError(e: unknown): string {
  if (e == null) return '';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  if (typeof e === 'object') {
    const obj = e as { errors?: Array<{ message?: string; extensions?: { code?: string } }>; message?: string };
    if (Array.isArray(obj.errors) && obj.errors.length) {
      return obj.errors
        .map((x) => {
          const code = x.extensions?.code;
          const msg = x.message ?? 'Unknown error';
          // Translate common codes into something the user can act on.
          if (code === 'RECORD_NOT_UNIQUE') return `${msg} (it's already on another record)`;
          if (code === 'FAILED_VALIDATION') return msg;
          return msg;
        })
        .join(' · ');
    }
    if (typeof obj.message === 'string') return obj.message;
    try { return JSON.stringify(e); } catch { return String(e); }
  }
  return String(e);
}

/**
 * Build the right Directus asset URL for an avatar/logo, given the saved
 * `image_focal` string. When the user chose Contain mode (focal ends in
 * "contain"), we ask Directus for `fit=inside` so the original aspect ratio
 * survives — the Avatar component's `object-contain` then does the visual
 * fitting. Otherwise we ask for `fit=cover` for crisp uniform thumbnails.
 *
 * Pass `size` as the longest-edge target (e.g. 80 for list rows, 320 for
 * detail-page heroes). Returns '' for missing files.
 */
export function avatarSrc(
  fileId: string | null | undefined,
  focal: string | null | undefined,
  size = 160
): string {
  if (!fileId) return '';
  const isContain = typeof focal === 'string' && /\bcontain\b/i.test(focal);
  return assetUrl(fileId, {
    width: size,
    height: size,
    fit: isContain ? 'inside' : 'cover'
  });
}
