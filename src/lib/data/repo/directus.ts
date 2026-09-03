// DirectusRepository — the storage port over the Directus SDK.
//
// This is the ONLY file in the repo layer that imports `@directus/sdk` or the
// `directus` client. Everything above it speaks the neutral `Repository`
// interface, which is what lets a second backend be written later without
// touching a single domain module.

import {
  aggregate,
  createItem,
  createItems,
  deleteFile,
  deleteItem,
  deleteItems,
  importFile,
  readFiles,
  readItems,
  readMe,
  serverInfo,
  updateItem,
  updateItems
} from '@directus/sdk';
import { directus, authHeader, assetAuthParam } from '$lib/data/client';
import { directusAbsolute } from '$lib/apiBase';
import type { AggregateQuery, AuthProvider, Filter, Id, Query, Repository } from './types';

const OP_TO_DIRECTUS: Record<string, string> = {
  eq: '_eq',
  neq: '_neq',
  in: '_in',
  icontains: '_icontains',
  null: '_null',
  nnull: '_nnull',
  empty: '_empty',
  nempty: '_nempty',
  lt: '_lt',
  lte: '_lte',
  gt: '_gt',
  gte: '_gte',
  startswith: '_starts_with',
  nstartswith: '_nstarts_with'
};

/** Translate a neutral Filter into a Directus filter object. */
function toDirectusFilter(f: Filter | undefined): Record<string, unknown> | undefined {
  if (!f) return undefined;
  if ('and' in f) return { _and: f.and.map(toDirectusFilter) };
  if ('or' in f) return { _or: f.or.map(toDirectusFilter) };
  const dirOp = OP_TO_DIRECTUS[f.op];
  // Presence operators take a boolean `true`, not the (absent) value.
  const presence = f.op === 'null' || f.op === 'nnull' || f.op === 'empty' || f.op === 'nempty';
  const value = presence ? true : f.value;
  // A dot-path field (`person_id.status`) becomes a nested relational filter
  // (`{ person_id: { status: { _neq: … } } }`), the form Directus expects.
  const leaf = { [dirOp]: value } as Record<string, unknown>;
  const parts = f.field.split('.');
  let node: Record<string, unknown> = leaf;
  for (let i = parts.length - 1; i >= 0; i--) node = { [parts[i]]: node };
  return node;
}

/** Build the readItems options object from a neutral Query. */
function toReadOptions(q?: Query): Record<string, unknown> {
  const opts: Record<string, unknown> = {};
  // fields may be plain names or relational expansions; Directus takes this
  // shape as-is. The whole options object is cast to the SDK type at the call.
  if (q?.fields) opts.fields = q.fields;
  const filter = toDirectusFilter(q?.where);
  if (filter) opts.filter = filter;
  if (q?.sort) opts.sort = q.sort as unknown as string[];
  // Directus uses -1 for "no limit"; the neutral contract uses "omitted".
  opts.limit = q?.limit ?? -1;
  if (q?.offset != null) opts.offset = q.offset;
  return opts;
}

export class DirectusRepository implements Repository {
  async list<T>(collection: string, q?: Query): Promise<T[]> {
    return (await directus.request(
      readItems(collection as never, toReadOptions(q) as never)
    )) as T[];
  }

  // Implemented via readItems+filter (not readItem) so a missing row is an
  // empty array → null, rather than a thrown 403/404. That gives the neutral
  // "null if not found" contract without backend-specific error sniffing.
  async get<T>(collection: string, id: Id, q?: Pick<Query, 'fields'>): Promise<T | null> {
    const rows = (await directus.request(
      readItems(collection as never, {
        filter: { id: { _eq: id } },
        ...(q?.fields ? { fields: q.fields } : {}),
        limit: 1
      } as never)
    )) as T[];
    return rows[0] ?? null;
  }

  async create<T>(collection: string, data: Record<string, unknown>): Promise<T> {
    return (await directus.request(createItem(collection as never, data as never))) as T;
  }

  async createMany<T>(collection: string, data: Record<string, unknown>[]): Promise<T[]> {
    return (await directus.request(createItems(collection as never, data as never))) as T[];
  }

  async update<T>(collection: string, id: Id, data: Record<string, unknown>): Promise<T> {
    return (await directus.request(
      updateItem(collection as never, id as never, data as never)
    )) as T;
  }

  async updateMany<T>(collection: string, ids: Id[], data: Record<string, unknown>): Promise<T[]> {
    return (await directus.request(
      updateItems(collection as never, ids as never, data as never)
    )) as T[];
  }

  async remove(collection: string, id: Id): Promise<void> {
    await directus.request(deleteItem(collection as never, id as never));
  }

  async removeMany(collection: string, ids: Id[]): Promise<void> {
    await directus.request(deleteItems(collection as never, ids as never));
  }

  async count(collection: string, where?: Filter): Promise<number> {
    const filter = toDirectusFilter(where);
    const res = (await directus.request(
      aggregate(collection as never, {
        aggregate: { count: '*' },
        ...(filter ? { query: { filter } } : {})
      } as never)
    )) as Array<{ count: string | number }>;
    const c = res?.[0]?.count;
    return typeof c === 'number' ? c : parseInt(String(c ?? '0'), 10) || 0;
  }

  async aggregate<T>(collection: string, opts: AggregateQuery): Promise<T[]> {
    // readItems-with-aggregate: the exact query shape the app used before the
    // port, so aggregate rows come back identically ({ groupByCols, sum:{…} }).
    const q: Record<string, unknown> = { aggregate: opts.aggregate };
    if (opts.groupBy) q.groupBy = opts.groupBy;
    const filter = toDirectusFilter(opts.where);
    if (filter) q.filter = filter;
    if (opts.sort) q.sort = opts.sort;
    q.limit = opts.limit ?? -1;
    return (await directus.request(readItems(collection as never, q as never))) as T[];
  }

  async listFiles<T>(q?: Query): Promise<T[]> {
    return (await directus.request(readFiles(toReadOptions(q) as never))) as T[];
  }

  async importFileFromUrl<T>(url: string, data?: Record<string, unknown>): Promise<T> {
    return (await directus.request(importFile(url, (data ?? {}) as never))) as T;
  }

  async removeFile(id: Id): Promise<void> {
    await directus.request(deleteFile(id as never));
  }

  /** Multipart POST to /files — moved here from batch.ts so the transport
   *  and credential handling live with the backend that defines them. */
  async uploadFile(file: File, opts: { folder?: string; title?: string } = {}): Promise<string> {
    const fd = new FormData();
    if (opts.title) fd.append('title', opts.title);
    if (opts.folder) fd.append('folder', opts.folder);
    fd.append('file', file, file.name);
    const res = await fetch(`${directusAbsolute()}/files`, {
      method: 'POST',
      headers: authHeader(),
      // Session mode authenticates via the httpOnly cookie, which fetch only
      // sends with credentials:'include'. Without it a session-mode upload
      // goes out unauthenticated and Directus 403s. Harmless in static-token
      // mode (the bearer header still authenticates; there is no cookie).
      credentials: 'include',
      body: fd
    });
    if (!res.ok) {
      let msg = `Upload failed: ${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        msg = body?.errors?.[0]?.message ?? msg;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    const json = await res.json();
    return json?.data?.id as string;
  }

  assetSrc(fileId: string | null | undefined, params: Record<string, string | number> = {}): string {
    if (!fileId) return '';
    const query = new URLSearchParams({ ...params, ...assetAuthParam() } as Record<string, string>);
    return `${directusAbsolute()}/assets/${fileId}?${query.toString()}`;
  }
}

/** The Directus implementation of the auth plane. Wraps the SDK's session
 *  authentication client (`login`/`logout`, configured in client.ts) plus
 *  `readMe`/`serverInfo`. Like DirectusRepository, this is a backend-named file;
 *  domain code speaks the neutral `AuthProvider`. */
export class DirectusAuthProvider implements AuthProvider {
  async login(email: string, password: string): Promise<void> {
    // The client is built with authentication('session'), but login() still has
    // to be told the mode or the SDK defaults to json and hands back a token.
    await (directus as unknown as {
      login: (e: string, p: string, o?: { mode?: 'session' }) => Promise<unknown>;
    }).login(email, password, { mode: 'session' });
  }

  async logout(): Promise<void> {
    await (directus as unknown as { logout: () => Promise<void> }).logout();
  }

  async me<T>(fields: readonly string[]): Promise<T | null> {
    try {
      const me = (await directus.request(readMe({ fields: fields as never }))) as T;
      return me ?? null;
    } catch {
      return null; // 401 / no session
    }
  }

  async serverInfo<T>(): Promise<T> {
    return (await directus.request(serverInfo())) as T;
  }
}
