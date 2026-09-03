// A second, non-Directus implementation of the storage port — in memory.
//
// Its whole job is to prove the port is honest (docs/phase3-data-port.md §2:
// "writing a second adapter IS the test that the interface is honest"). If the
// domain modules truly stopped naming Directus, this backend — a Map, no SDK, no
// network — satisfies the exact same `Repository`/`AuthProvider` contract, and
// `conformance.test.ts` runs that contract against it.
//
// It is also a fast, offline test double: a future `SupabaseRepository` is a
// third implementation of the same interface and must pass the same suite.
//
// Deliberately not wired into `repo/index.ts` — no `PUBLIC_DATA_BACKEND=memory`
// path ships. It exists for the conformance test and as the reference impl.
import type {
  AggregateQuery,
  AuthProvider,
  FieldSpec,
  Filter,
  Id,
  Query,
  Repository
} from './types';

type Row = Record<string, unknown>;

/** Walk a dot-path (`person_id.status`) into a row; undefined if any hop is nullish. */
function atPath(row: Row, path: string): unknown {
  if (!path.includes('.')) return row[path];
  let cur: unknown = row;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Row)[key];
  }
  return cur;
}

function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** Evaluate a neutral Filter against a row — the semantics every adapter owes. */
function matches(row: Row, f: Filter): boolean {
  if ('and' in f) return f.and.every((sub) => matches(row, sub));
  if ('or' in f) return f.or.some((sub) => matches(row, sub));
  const a = atPath(row, f.field);
  const v = f.value;
  switch (f.op) {
    case 'eq':
      return a === v;
    case 'neq':
      return a !== v;
    case 'in':
      return Array.isArray(v) && (v as unknown[]).includes(a);
    case 'icontains':
      return a != null && String(a).toLowerCase().includes(String(v).toLowerCase());
    case 'null':
      return a == null;
    case 'nnull':
      return a != null;
    case 'empty':
      return a == null || a === '' || (Array.isArray(a) && a.length === 0);
    case 'nempty':
      return !(a == null || a === '' || (Array.isArray(a) && a.length === 0));
    case 'lt':
      return cmp(a, v) < 0;
    case 'lte':
      return cmp(a, v) <= 0;
    case 'gt':
      return cmp(a, v) > 0;
    case 'gte':
      return cmp(a, v) >= 0;
    case 'startswith':
      return a != null && String(a).startsWith(String(v));
    case 'nstartswith':
      return a == null || !String(a).startsWith(String(v));
    default:
      return false;
  }
}

/** `field` ascending, `-field` descending — the port's sort convention. */
function sortRows(rows: Row[], sort?: readonly string[]): Row[] {
  if (!sort || sort.length === 0) return rows;
  return [...rows].sort((ra, rb) => {
    for (const key of sort) {
      const desc = key.startsWith('-');
      const field = desc ? key.slice(1) : key;
      const c = cmp(atPath(ra, field), atPath(rb, field));
      if (c !== 0) return desc ? -c : c;
    }
    return 0;
  });
}

/** Top-level field projection. '*' (or a nested {relation:[…]} spec) keeps the
 *  whole row — the in-memory store has no joins to expand. */
function project(row: Row, fields?: readonly FieldSpec[]): Row {
  if (!fields || fields.length === 0) return { ...row };
  if (fields.some((f) => f === '*' || typeof f === 'object')) return { ...row };
  const out: Row = {};
  for (const f of fields as string[]) if (f in row) out[f] = row[f];
  return out;
}

function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export class MemoryRepository implements Repository {
  // Protected, not private: LocalRepository (local.ts) subclasses this as the
  // reference semantics and needs the maps to hydrate from IndexedDB.
  protected store = new Map<string, Map<Id, Row>>();
  protected seq = new Map<string, number>();
  protected readonly FILES = '__files';

  /** Seed a collection (test setup). Rows are deep-cloned in. */
  seed(collection: string, rows: Row[]): void {
    const col = this.col(collection);
    for (const r of rows) {
      const id = (r.id ?? this.nextId(collection)) as Id;
      col.set(id, { ...r, id });
    }
  }

  private col(collection: string): Map<Id, Row> {
    let c = this.store.get(collection);
    if (!c) {
      c = new Map();
      this.store.set(collection, c);
    }
    return c;
  }

  private nextId(collection: string): number {
    const n = (this.seq.get(collection) ?? 0) + 1;
    this.seq.set(collection, n);
    return n;
  }

  private query(collection: string, q?: Query): Row[] {
    let rows = [...this.col(collection).values()];
    if (q?.where) rows = rows.filter((r) => matches(r, q.where!));
    rows = sortRows(rows, q?.sort);
    const offset = q?.offset ?? 0;
    // limit -1 (or omitted) means "all", matching the Directus convention.
    const end = q?.limit != null && q.limit >= 0 ? offset + q.limit : undefined;
    rows = rows.slice(offset, end);
    return rows.map((r) => project(r, q?.fields));
  }

  async list<T>(collection: string, q?: Query): Promise<T[]> {
    return this.query(collection, q) as T[];
  }

  async get<T>(collection: string, id: Id, q?: Pick<Query, 'fields'>): Promise<T | null> {
    const row = this.col(collection).get(id);
    return row ? (project(row, q?.fields) as T) : null;
  }

  async create<T>(collection: string, data: Row): Promise<T> {
    const id = (data.id ?? this.nextId(collection)) as Id;
    const row = { ...data, id };
    this.col(collection).set(id, row);
    return { ...row } as T;
  }

  async createMany<T>(collection: string, data: Row[]): Promise<T[]> {
    const out: T[] = [];
    for (const d of data) out.push(await this.create<T>(collection, d));
    return out;
  }

  async update<T>(collection: string, id: Id, data: Row): Promise<T> {
    const col = this.col(collection);
    const existing = col.get(id);
    if (!existing) throw new Error(`${collection} ${id} not found`);
    const row = { ...existing, ...data, id };
    col.set(id, row);
    return { ...row } as T;
  }

  async updateMany<T>(collection: string, ids: Id[], data: Row): Promise<T[]> {
    const out: T[] = [];
    for (const id of ids) out.push(await this.update<T>(collection, id, data));
    return out;
  }

  async remove(collection: string, id: Id): Promise<void> {
    this.col(collection).delete(id);
  }

  async removeMany(collection: string, ids: Id[]): Promise<void> {
    for (const id of ids) this.col(collection).delete(id);
  }

  async count(collection: string, where?: Filter): Promise<number> {
    return this.query(collection, { where }).length;
  }

  async aggregate<T>(collection: string, opts: AggregateQuery): Promise<T[]> {
    const rows = this.query(collection, { where: opts.where });
    const groupBy = opts.groupBy ?? [];
    const groups = new Map<string, { keys: Row; rows: Row[] }>();
    for (const r of rows) {
      const keyObj: Row = {};
      for (const g of groupBy) keyObj[g] = atPath(r, g);
      const k = JSON.stringify(groupBy.map((g) => keyObj[g]));
      let grp = groups.get(k);
      if (!grp) {
        grp = { keys: keyObj, rows: [] };
        groups.set(k, grp);
      }
      grp.rows.push(r);
    }
    // No groupBy → one group over everything.
    if (groupBy.length === 0 && groups.size === 0) groups.set('[]', { keys: {}, rows });

    const spec = opts.aggregate;
    const out: Row[] = [];
    for (const { keys, rows: grpRows } of groups.values()) {
      const row: Row = { ...keys };
      if (spec.count !== undefined) {
        if (spec.count === '*') row.count = grpRows.length;
        else {
          const c: Row = {};
          for (const f of spec.count) c[f] = grpRows.filter((r) => atPath(r, f) != null).length;
          row.count = c;
        }
      }
      for (const op of ['sum', 'avg', 'min', 'max'] as const) {
        const fields = spec[op];
        if (!fields) continue;
        const acc: Row = {};
        for (const f of fields) {
          const nums = grpRows.map((r) => toNum(atPath(r, f)));
          acc[f] =
            op === 'sum'
              ? nums.reduce((a, b) => a + b, 0)
              : op === 'avg'
                ? nums.length
                  ? nums.reduce((a, b) => a + b, 0) / nums.length
                  : 0
                : op === 'min'
                  ? Math.min(...(nums.length ? nums : [0]))
                  : Math.max(...(nums.length ? nums : [0]));
        }
        row[op] = acc;
      }
      out.push(row);
    }
    const sorted = sortRows(out, opts.sort);
    return (opts.limit != null && opts.limit >= 0 ? sorted.slice(0, opts.limit) : sorted) as T[];
  }

  // ── File store — a plain collection under a reserved name ─────────────────
  async listFiles<T>(q?: Query): Promise<T[]> {
    return this.list<T>(this.FILES, q);
  }

  async importFileFromUrl<T>(url: string, data?: Row): Promise<T> {
    return this.create<T>(this.FILES, { ...data, url, imported: true });
  }

  async removeFile(id: Id): Promise<void> {
    return this.remove(this.FILES, id);
  }

  async uploadFile(file: File, opts: { folder?: string; title?: string } = {}): Promise<string> {
    const row = await this.create<{ id: Id }>(this.FILES, {
      title: opts.title ?? file.name,
      filename_download: file.name,
      type: file.type
    });
    return String(row.id);
  }

  /** No blobs in the reference store — '' by contract (caller falls back). */
  assetSrc(_fileId?: string | null, _params?: Record<string, string | number>): string {
    return '';
  }
}

/** A matching in-memory AuthProvider — proves the auth plane is portable too. */
export class MemoryAuthProvider implements AuthProvider {
  private users: Array<{ email: string; password: string } & Row>;
  private currentEmail: string | null = null;

  constructor(users: Array<{ email: string; password: string } & Row> = []) {
    this.users = users;
  }

  async login(email: string, password: string): Promise<void> {
    const u = this.users.find((x) => x.email === email && x.password === password);
    if (!u) throw new Error('Invalid credentials');
    this.currentEmail = email;
  }

  async logout(): Promise<void> {
    this.currentEmail = null;
  }

  async me<T>(fields: readonly string[]): Promise<T | null> {
    if (!this.currentEmail) return null;
    const u = this.users.find((x) => x.email === this.currentEmail);
    if (!u) return null;
    const out: Row = {};
    for (const f of fields) if (f in u) out[f] = u[f];
    return out as T;
  }

  async serverInfo<T>(): Promise<T> {
    return { backend: 'memory', version: '0' } as T;
  }
}
