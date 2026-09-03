// The storage port — phase 3 (docs/phase3-data-port.md).
//
// A backend-neutral interface the domain modules in `src/lib/data/` call
// instead of `directus.request(sdkQuery)`. Two implementations sit behind it:
// `DirectusRepository` (today) and, later, a second one written to prove the
// port is honest. Nothing here names Directus.
//
// The query shape is deliberately only what the app actually uses — measured
// on 2026-08-22: operators eq / neq / in / icontains / null / nnull plus the
// comparisons and and/or composition. Keep it that small; widen it only when a
// real call site needs more, so the second adapter stays cheap to write.

export type Id = number | string;

export type FilterOp =
  | 'eq'
  | 'neq'
  | 'in'
  | 'icontains'
  | 'null'
  | 'nnull'
  | 'empty'
  | 'nempty'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  // Prefix match on a string column. Directus `_starts_with`/`_nstarts_with`;
  // supabase `ilike('x%')` / negated. Added for the birthday-row exclusion in
  // dates.ts (`external_id` not starting with `birthday_person_`).
  | 'startswith'
  | 'nstartswith';

/**
 * A leaf comparison, or an and/or of nested filters. `field` may be a dot-path
 * into a relation (e.g. `'person_id.status'`); the adapter expands it to the
 * backend's nested-relation filter form.
 */
export type Filter =
  | { field: string; op: FilterOp; value?: unknown }
  | { and: Filter[] }
  | { or: Filter[] };

/**
 * A field to return: a plain column name, `'*'` for all, or a relational
 * expansion `{ relation: [ ...sub-fields ] }`. Both backends express joins this
 * way — Directus takes exactly this shape; supabase-js maps it to
 * `select('rel(sub, fields)')`.
 */
export type FieldSpec = string | { [relation: string]: readonly FieldSpec[] };

export interface Query {
  /** Columns/relations to return. Omit for the backend default (all). */
  fields?: readonly FieldSpec[];
  where?: Filter;
  /** `field` ascending, `-field` descending — the Directus convention, kept
   *  because it maps cleanly onto every backend. */
  sort?: readonly string[];
  /** Omit for "all". */
  limit?: number;
  /** Skip this many rows before returning — for pager "Show more" (Directus
   *  `offset`; supabase `.range(offset, offset + limit - 1)`). */
  offset?: number;
}

/**
 * The storage port. Collections are addressed by string name; row shapes are
 * the caller's `<T>`. Errors propagate (a network failure stays a network
 * failure) so the offline queue's classification in `offline.ts` still works.
 */
export interface Repository {
  /** List rows matching `q` (all rows if `q` is omitted). */
  list<T>(collection: string, q?: Query): Promise<T[]>;
  /** One row by id, or `null` if it does not exist / is not visible. */
  get<T>(collection: string, id: Id, q?: Pick<Query, 'fields'>): Promise<T | null>;
  /** Create one row; returns the created row (with its assigned id). */
  create<T>(collection: string, data: Record<string, unknown>): Promise<T>;
  /** Create many rows in one call; returns the created rows. */
  createMany<T>(collection: string, data: Record<string, unknown>[]): Promise<T[]>;
  /** Patch one row by id; returns the updated row. */
  update<T>(collection: string, id: Id, data: Record<string, unknown>): Promise<T>;
  /** Patch many rows by id in one call — the same patch applied to each id;
   *  returns the updated rows. Both backends express this as one round-trip
   *  (Directus `updateItems(keys, patch)`, supabase `.in('id', ids).update(patch)`). */
  updateMany<T>(collection: string, ids: Id[], data: Record<string, unknown>): Promise<T[]>;
  /** Delete one row by id. */
  remove(collection: string, id: Id): Promise<void>;
  /** Delete many rows by id in one call. */
  removeMany(collection: string, ids: Id[]): Promise<void>;
  /** Count rows matching `where` (all rows if omitted). */
  count(collection: string, where?: Filter): Promise<number>;
  /**
   * Grouped/scalar aggregation (sum/min/max/avg/count over fields, optional
   * groupBy). Returns the backend's aggregate rows — each row carries the
   * groupBy columns plus a nested object per aggregate op, e.g.
   * `{ date: '2026-01', sum: { spend: '42' } }`.
   */
  aggregate<T>(collection: string, opts: AggregateQuery): Promise<T[]>;

  // ── File / asset store ──────────────────────────────────────────────────
  // The stored-files registry, distinct from item collections (Directus
  // `directus_files`; supabase Storage). The multipart upload of a browser
  // File stays OUT of the port for now (batch.ts `uploadFile`, a raw fetch to
  // /files with FormData + authHeader); these cover the three operations the
  // domain modules actually route through the SDK: listing the store, importing
  // a file by URL, and deleting one.

  /** List stored files (optionally filtered), e.g. to find orphaned uploads. */
  listFiles<T>(q?: Query): Promise<T[]>;
  /** Import a file from a URL into the store (server-side fetch); returns the
   *  created file row. */
  importFileFromUrl<T>(url: string, data?: Record<string, unknown>): Promise<T>;
  /** Delete a stored file by id. */
  removeFile(id: Id): Promise<void>;
  /** Upload a file (a browser File/Blob); returns its assigned id, which item
   *  fields reference (Person.person_picture, organization.logo, …). */
  uploadFile(file: File, opts?: { folder?: string; title?: string }): Promise<string>;
  /**
   * The renderable `<img src>` for a stored file id, or '' when this backend
   * cannot resolve it (caller falls back — usually to an initials avatar).
   * SYNCHRONOUS by contract: templates call it inline. `params` are transform
   * hints (width/height/fit) that URL-serving backends may honor and blob
   * backends ignore.
   */
  assetSrc(fileId: string | null | undefined, params?: Record<string, string | number>): string;
}

export interface AggregateSpec {
  count?: '*' | readonly string[];
  sum?: readonly string[];
  avg?: readonly string[];
  min?: readonly string[];
  max?: readonly string[];
}

export interface AggregateQuery {
  aggregate: AggregateSpec;
  groupBy?: readonly string[];
  where?: Filter;
  sort?: readonly string[];
  limit?: number;
}

/**
 * The authentication plane — sign-in, sign-out, identity, and server metadata.
 * Separate from `Repository` because a second backend implements auth very
 * differently (Directus session cookie + `readMe`; supabase `supabase.auth.*`),
 * even though both share one transport. `PUBLIC_AUTH_MODE` already selects the
 * path today; this is the seam a second backend plugs its own auth into.
 */
export interface AuthProvider {
  /** Sign in; the backend sets its own credential (Directus: an httpOnly
   *  session cookie the browser holds, nothing returned to JS). Throws on bad
   *  credentials. */
  login(email: string, password: string): Promise<void>;
  /** End the session server-side. May throw if the session is already gone —
   *  callers that treat that as success wrap it. */
  logout(): Promise<void>;
  /** The current user projected to `fields`, or `null` if not signed in / on
   *  any error (so a guard can read it without a try/catch). */
  me<T>(fields: readonly string[]): Promise<T | null>;
  /** Backend/server metadata — used to detect a fresh, unconfigured instance.
   *  Propagates errors (the caller decides what an unreachable server means). */
  serverInfo<T>(): Promise<T>;
}
