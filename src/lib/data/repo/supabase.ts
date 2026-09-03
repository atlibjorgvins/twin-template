// The Supabase implementation of the storage port — the third adapter, and the
// one that proves the port works against a real SQL backend with RLS (the first
// two are DirectusRepository and the in-memory MemoryRepository). It translates
// the neutral Query/Filter to supabase-js (PostgREST) and maps AuthProvider to
// Supabase Auth (JWT). See docs/phase3-supabase-rls.md.
//
// Selected the same way DirectusRepository is — a future
// `PUBLIC_DATA_BACKEND=supabase` in repo/index.ts. Not wired in yet; verified by
// the live spike (scripts/supabase-spike.ts) against a throwaway project.
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AggregateQuery,
  AuthProvider,
  FieldSpec,
  Filter,
  Id,
  Query,
  Repository
} from './types';

/** Build a PostgREST `select` string from the neutral FieldSpec[]. */
function selectOf(fields?: readonly FieldSpec[]): string {
  if (!fields || fields.length === 0) return '*';
  if (fields.some((f) => f === '*')) return '*';
  const parts: string[] = [];
  for (const f of fields) {
    if (typeof f === 'string') parts.push(f);
    else for (const [rel, sub] of Object.entries(f)) parts.push(`${rel}(${selectOf(sub)})`);
  }
  return parts.join(',');
}

/** A leaf as a PostgREST logic-string term (used inside or()/and()). */
function leafExpr(field: string, op: string, value: unknown): string {
  switch (op) {
    case 'eq': return `${field}.eq.${value}`;
    case 'neq': return `${field}.neq.${value}`;
    case 'in': return `${field}.in.(${(value as unknown[]).join(',')})`;
    case 'icontains': return `${field}.ilike.*${value}*`;
    case 'null': return `${field}.is.null`;
    case 'nnull': return `${field}.not.is.null`;
    case 'empty': return `${field}.is.null`;
    case 'nempty': return `${field}.not.is.null`;
    case 'lt': return `${field}.lt.${value}`;
    case 'lte': return `${field}.lte.${value}`;
    case 'gt': return `${field}.gt.${value}`;
    case 'gte': return `${field}.gte.${value}`;
    case 'startswith': return `${field}.ilike.${value}*`;
    case 'nstartswith': return `${field}.not.ilike.${value}*`;
    default: return `${field}.eq.${value}`;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Builder = any;

/** Apply one leaf via a typed PostgREST method (AND semantics when chained). */
function applyLeaf(b: Builder, f: Extract<Filter, { field: string }>): Builder {
  const { field, op, value } = f;
  switch (op) {
    case 'eq': return b.eq(field, value);
    case 'neq': return b.neq(field, value);
    case 'in': return b.in(field, value as unknown[]);
    case 'icontains': return b.ilike(field, `%${value}%`);
    case 'null': return b.is(field, null);
    case 'nnull': return b.not(field, 'is', null);
    case 'empty': return b.is(field, null);
    case 'nempty': return b.not(field, 'is', null);
    case 'lt': return b.lt(field, value);
    case 'lte': return b.lte(field, value);
    case 'gt': return b.gt(field, value);
    case 'gte': return b.gte(field, value);
    case 'startswith': return b.ilike(field, `${value}%`);
    case 'nstartswith': return b.not(field, 'ilike', `${value}%`);
    default: return b.eq(field, value);
  }
}

/** Apply a neutral Filter tree to a PostgREST builder. Covers the shapes the app
 *  actually uses: a leaf, `and` of leaves (chained), and `or` of leaves (one
 *  `.or()` string). Deeper nesting throws — widen when a real call site needs it
 *  (mirrors the port's "keep the surface to what's used" rule). */
function applyWhere(b: Builder, where: Filter): Builder {
  if ('and' in where) {
    let cur = b;
    for (const sub of where.and) {
      if ('field' in sub) cur = applyLeaf(cur, sub);
      else if ('or' in sub && sub.or.every((x) => 'field' in x))
        cur = cur.or(sub.or.map((x) => leafExpr((x as any).field, (x as any).op, (x as any).value)).join(','));
      else throw new Error('supabase adapter: unsupported nested filter in and()');
    }
    return cur;
  }
  if ('or' in where) {
    if (!where.or.every((x) => 'field' in x))
      throw new Error('supabase adapter: unsupported nested filter in or()');
    return b.or(where.or.map((x) => leafExpr((x as any).field, (x as any).op, (x as any).value)).join(','));
  }
  return applyLeaf(b, where);
}

/** Root relations referenced by dot-path leaves in a where tree — these must be
 *  `!inner`-embedded in the select so PostgREST filters parents by them (a plain
 *  embed left-joins and would not filter). This is the relational-filter parity
 *  the port promises; docs/phase3-supabase-rls.md §1. */
function whereRelations(where: Filter | undefined, out = new Set<string>()): Set<string> {
  if (!where) return out;
  if ('and' in where) { for (const s of where.and) whereRelations(s, out); return out; }
  if ('or' in where) { for (const s of where.or) whereRelations(s, out); return out; }
  const i = where.field.indexOf('.');
  if (i > 0) out.add(where.field.slice(0, i));
  return out;
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export class SupabaseRepository implements Repository {
  constructor(
    private client: SupabaseClient,
    /** The table backing the file registry (Supabase Storage in production; a
     *  plain table for the spike). */
    private filesTable = 'app_files'
  ) {}

  private selectString(q?: Query): string {
    let sel = selectOf(q?.fields);
    // Add !inner embeds for any relation a dot-path filter references, so the
    // filter narrows the parent rows instead of left-joining.
    for (const rel of whereRelations(q?.where)) {
      if (!new RegExp(`(^|,)\\s*${rel}!?\\w*\\(`).test(sel)) sel += `,${rel}!inner(id)`;
    }
    return sel;
  }

  private select(collection: string, q?: Query): Builder {
    let b = this.client.from(collection).select(this.selectString(q));
    if (q?.where) b = applyWhere(b, q.where);
    for (const key of q?.sort ?? []) {
      const desc = key.startsWith('-');
      b = b.order(desc ? key.slice(1) : key, { ascending: !desc });
    }
    const offset = q?.offset ?? 0;
    if (q?.limit != null && q.limit >= 0) b = b.range(offset, offset + q.limit - 1);
    else if (offset > 0) b = b.range(offset, offset + 100000);
    return b;
  }

  async list<T>(collection: string, q?: Query): Promise<T[]> {
    return unwrap(await this.select(collection, q)) as T[];
  }

  async get<T>(collection: string, id: Id, q?: Pick<Query, 'fields'>): Promise<T | null> {
    const res = await this.client.from(collection).select(selectOf(q?.fields)).eq('id', id).maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return (res.data as T) ?? null;
  }

  async create<T>(collection: string, data: Record<string, unknown>): Promise<T> {
    return unwrap(await this.client.from(collection).insert(data).select().single()) as T;
  }

  async createMany<T>(collection: string, data: Record<string, unknown>[]): Promise<T[]> {
    return unwrap(await this.client.from(collection).insert(data).select()) as T[];
  }

  async update<T>(collection: string, id: Id, data: Record<string, unknown>): Promise<T> {
    return unwrap(await this.client.from(collection).update(data).eq('id', id).select().single()) as T;
  }

  async updateMany<T>(collection: string, ids: Id[], data: Record<string, unknown>): Promise<T[]> {
    return unwrap(await this.client.from(collection).update(data).in('id', ids).select()) as T[];
  }

  async remove(collection: string, id: Id): Promise<void> {
    const { error } = await this.client.from(collection).delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async removeMany(collection: string, ids: Id[]): Promise<void> {
    const { error } = await this.client.from(collection).delete().in('id', ids);
    if (error) throw new Error(error.message);
  }

  async count(collection: string, where?: Filter): Promise<number> {
    let b = this.client.from(collection).select('*', { count: 'exact', head: true });
    if (where) b = applyWhere(b, where);
    const res = await b;
    if (res.error) throw new Error(res.error.message);
    return res.count ?? 0;
  }

  /**
   * Grouped aggregation. PostgREST has no group-by, so this folds in JS after a
   * filtered read — fine for the app's small rollups and the spike, but
   * production rollups over large tables should be backed by a SQL view/RPC
   * (docs/phase3-supabase-rls.md §1). Output shape matches the port contract.
   */
  async aggregate<T>(collection: string, opts: AggregateQuery): Promise<T[]> {
    const rows = await this.list<Record<string, unknown>>(collection, { where: opts.where });
    const groupBy = opts.groupBy ?? [];
    const groups = new Map<string, { keys: Record<string, unknown>; rows: Record<string, unknown>[] }>();
    for (const r of rows) {
      const keys: Record<string, unknown> = {};
      for (const g of groupBy) keys[g] = r[g];
      const k = JSON.stringify(groupBy.map((g) => keys[g]));
      let grp = groups.get(k);
      if (!grp) groups.set(k, (grp = { keys, rows: [] }));
      grp.rows.push(r);
    }
    if (groupBy.length === 0 && groups.size === 0) groups.set('[]', { keys: {}, rows });
    const spec = opts.aggregate;
    let out: Record<string, unknown>[] = [];
    for (const { keys, rows: gr } of groups.values()) {
      const row: Record<string, unknown> = { ...keys };
      if (spec.count === '*') row.count = gr.length;
      else if (spec.count) {
        const c: Record<string, number> = {};
        for (const f of spec.count) c[f] = gr.filter((r) => r[f] != null).length;
        row.count = c;
      }
      for (const op of ['sum', 'avg', 'min', 'max'] as const) {
        const fields = spec[op];
        if (!fields) continue;
        const acc: Record<string, number> = {};
        for (const f of fields) {
          const ns = gr.map((r) => toNum(r[f]));
          acc[f] = op === 'sum' ? ns.reduce((a, b) => a + b, 0)
            : op === 'avg' ? (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0)
            : op === 'min' ? Math.min(...(ns.length ? ns : [0]))
            : Math.max(...(ns.length ? ns : [0]));
        }
        row[op] = acc;
      }
      out.push(row);
    }
    if (opts.sort?.length) {
      out = [...out].sort((a, b) => {
        for (const key of opts.sort!) {
          const desc = key.startsWith('-');
          const f = desc ? key.slice(1) : key;
          const av = a[f], bv = b[f];
          const c = av == null && bv == null ? 0 : av == null ? -1 : bv == null ? 1 : av < bv ? -1 : av > bv ? 1 : 0;
          if (c !== 0) return desc ? -c : c;
        }
        return 0;
      });
    }
    return (opts.limit != null && opts.limit >= 0 ? out.slice(0, opts.limit) : out) as T[];
  }

  async listFiles<T>(q?: Query): Promise<T[]> {
    return this.list<T>(this.filesTable, q);
  }
  async importFileFromUrl<T>(url: string, data?: Record<string, unknown>): Promise<T> {
    return this.create<T>(this.filesTable, { ...data, url, imported: true });
  }
  async removeFile(id: Id): Promise<void> {
    return this.remove(this.filesTable, id);
  }

  /** Supabase Storage buckets are not wired up yet. Refuse loudly rather
   *  than pretend: the UI surfaces this message, and Settings → Storage
   *  offers "media on this device", which works with this backend today. */
  async uploadFile(): Promise<string> {
    throw new Error(
      'Image upload to Supabase Storage is not supported yet — set media storage to "this device" in Settings → Storage.'
    );
  }

  assetSrc(): string {
    return ''; // no bucket mapping yet — callers fall back to initials
  }
}

export class SupabaseAuthProvider implements AuthProvider {
  constructor(private client: SupabaseClient) {}

  async login(email: string, password: string): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }

  async logout(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) throw new Error(error.message);
  }

  async me<T>(fields: readonly string[]): Promise<T | null> {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) return null;
    const u = data.user as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const f of fields) if (f in u) out[f] = u[f];
    return out as T;
  }

  async serverInfo<T>(): Promise<T> {
    return { backend: 'supabase' } as T;
  }
}
