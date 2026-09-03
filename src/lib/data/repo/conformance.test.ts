// The storage-port conformance suite — the contract every adapter owes.
//
// This is the phase-3 "is the port honest?" test made executable: it exercises
// the whole `Repository`/`AuthProvider` surface against an adapter and asserts
// backend-neutral semantics (filters, sort, paging, aggregates, files, auth).
// `MemoryRepository` — a second, non-Directus implementation — passes it, which
// is the proof the interface does not secretly depend on Directus. A future
// `SupabaseRepository` is wired into `runRepositoryConformance` too and must
// pass the same assertions (see docs/phase3-data-port.md §2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepository, MemoryAuthProvider } from './memory.ts';
import type { AuthProvider, Repository } from './types.ts';

type Person = {
  id: number;
  name: string;
  status: string;
  age: number;
  born: string;
  team_id?: number;
  team?: { status: string } | null;
};

const PEOPLE: Omit<Person, 'id'>[] = [
  { name: 'Ada', status: 'active', age: 36, born: '1990-01-01', team: { status: 'ok' } },
  { name: 'Bjarni', status: 'active', age: 41, born: '1985-06-15', team: { status: 'archived' } },
  { name: 'Cara', status: 'archived', age: 29, born: '1997-03-20', team: { status: 'ok' } },
  { name: 'Dröfn', status: 'active', age: 52, born: '1974-11-30', team: null }
];

/** Run the whole contract against one adapter. Any backend that passes this is
 *  a faithful implementation of the port. */
export function runRepositoryConformance(label: string, make: () => Repository): void {
  const fresh = () => {
    const repo = make();
    // MemoryRepository exposes seed(); other adapters would seed via createMany.
    return repo as Repository & { seed?: (c: string, r: object[]) => void };
  };
  async function seeded() {
    const repo = fresh();
    if (repo.seed) repo.seed('person', PEOPLE as object[]);
    else await repo.createMany('person', PEOPLE as Record<string, unknown>[]);
    return repo;
  }

  test(`[${label}] create assigns an id and returns the row`, async () => {
    const repo = fresh();
    const row = await repo.create<Person>('person', { name: 'Zoe', status: 'active', age: 1, born: '2025-01-01' });
    assert.ok(row.id != null, 'id assigned');
    assert.equal(row.name, 'Zoe');
    const got = await repo.get<Person>('person', row.id);
    assert.equal(got?.name, 'Zoe');
  });

  test(`[${label}] get returns null for a missing id`, async () => {
    const repo = fresh();
    assert.equal(await repo.get('person', 999), null);
  });

  test(`[${label}] list with no query returns everything`, async () => {
    const repo = await seeded();
    assert.equal((await repo.list('person')).length, 4);
  });

  test(`[${label}] eq / neq / in`, async () => {
    const repo = await seeded();
    assert.equal((await repo.list('person', { where: { field: 'status', op: 'eq', value: 'active' } })).length, 3);
    assert.equal((await repo.list('person', { where: { field: 'status', op: 'neq', value: 'active' } })).length, 1);
    assert.equal(
      (await repo.list('person', { where: { field: 'name', op: 'in', value: ['Ada', 'Cara'] } })).length,
      2
    );
  });

  test(`[${label}] icontains is case-insensitive`, async () => {
    const repo = await seeded();
    const rows = await repo.list<Person>('person', { where: { field: 'name', op: 'icontains', value: 'a' } });
    // Ada, Bjarni, Cara — Dröfn has no 'a'.
    assert.deepEqual(rows.map((r) => r.name).sort(), ['Ada', 'Bjarni', 'Cara']);
  });

  test(`[${label}] null / nnull`, async () => {
    const repo = await seeded();
    assert.equal((await repo.list('person', { where: { field: 'team', op: 'null' } })).length, 1);
    assert.equal((await repo.list('person', { where: { field: 'team', op: 'nnull' } })).length, 3);
  });

  test(`[${label}] comparisons lt / lte / gt / gte`, async () => {
    const repo = await seeded();
    assert.equal((await repo.list('person', { where: { field: 'age', op: 'lt', value: 36 } })).length, 1); // 29
    assert.equal((await repo.list('person', { where: { field: 'age', op: 'lte', value: 36 } })).length, 2); // 29,36
    assert.equal((await repo.list('person', { where: { field: 'age', op: 'gt', value: 41 } })).length, 1); // 52
    assert.equal((await repo.list('person', { where: { field: 'age', op: 'gte', value: 41 } })).length, 2); // 41,52
  });

  test(`[${label}] startswith / nstartswith`, async () => {
    const repo = await seeded();
    assert.equal((await repo.list('person', { where: { field: 'born', op: 'startswith', value: '19' } })).length, 4);
    assert.equal((await repo.list('person', { where: { field: 'name', op: 'nstartswith', value: 'A' } })).length, 3);
  });

  test(`[${label}] and / or composition`, async () => {
    const repo = await seeded();
    const both = await repo.list('person', {
      where: { and: [{ field: 'status', op: 'eq', value: 'active' }, { field: 'age', op: 'gte', value: 40 }] }
    });
    assert.equal(both.length, 2); // Bjarni 41, Dröfn 52
    const either = await repo.list('person', {
      where: { or: [{ field: 'name', op: 'eq', value: 'Ada' }, { field: 'status', op: 'eq', value: 'archived' }] }
    });
    assert.equal(either.length, 2); // Ada, Cara
  });

  test(`[${label}] dot-path filter into a nested object`, async () => {
    const repo = await seeded();
    const rows = await repo.list<Person>('person', { where: { field: 'team.status', op: 'eq', value: 'ok' } });
    assert.deepEqual(rows.map((r) => r.name).sort(), ['Ada', 'Cara']);
  });

  test(`[${label}] sort ascending and descending`, async () => {
    const repo = await seeded();
    const asc = await repo.list<Person>('person', { sort: ['age'] });
    assert.deepEqual(asc.map((r) => r.age), [29, 36, 41, 52]);
    const desc = await repo.list<Person>('person', { sort: ['-age'] });
    assert.deepEqual(desc.map((r) => r.age), [52, 41, 36, 29]);
  });

  test(`[${label}] limit and offset paginate`, async () => {
    const repo = await seeded();
    const page = await repo.list<Person>('person', { sort: ['age'], limit: 2, offset: 1 });
    assert.deepEqual(page.map((r) => r.age), [36, 41]);
  });

  test(`[${label}] fields projects top-level columns`, async () => {
    const repo = await seeded();
    const [row] = await repo.list<Person>('person', { fields: ['id', 'name'], sort: ['age'], limit: 1 });
    assert.deepEqual(Object.keys(row).sort(), ['id', 'name']);
  });

  test(`[${label}] createMany then update / updateMany`, async () => {
    const repo = fresh();
    const made = await repo.createMany<Person>('person', PEOPLE as Record<string, unknown>[]);
    assert.equal(made.length, 4);
    const one = await repo.update<Person>('person', made[0].id, { status: 'archived' });
    assert.equal(one.status, 'archived');
    const ids = made.slice(1).map((r) => r.id);
    const many = await repo.updateMany<Person>('person', ids, { status: 'retired' });
    assert.equal(many.length, 3);
    assert.ok(many.every((r) => r.status === 'retired'));
    assert.equal((await repo.list('person', { where: { field: 'status', op: 'eq', value: 'retired' } })).length, 3);
  });

  test(`[${label}] remove and removeMany`, async () => {
    const repo = await seeded();
    const all = await repo.list<Person>('person');
    await repo.remove('person', all[0].id);
    assert.equal((await repo.list('person')).length, 3);
    await repo.removeMany('person', all.slice(1).map((r) => r.id));
    assert.equal((await repo.list('person')).length, 0);
  });

  test(`[${label}] count with and without a filter`, async () => {
    const repo = await seeded();
    assert.equal(await repo.count('person'), 4);
    assert.equal(await repo.count('person', { field: 'status', op: 'eq', value: 'active' }), 3);
  });

  test(`[${label}] aggregate count '*', grouped count, and sum/min/max/avg`, async () => {
    const repo = await seeded();
    const [total] = await repo.aggregate<{ count: number }>('person', { aggregate: { count: '*' } });
    assert.equal(total.count, 4);

    const grouped = await repo.aggregate<{ status: string; count: number }>('person', {
      aggregate: { count: '*' },
      groupBy: ['status'],
      sort: ['status']
    });
    assert.deepEqual(grouped.map((r) => [r.status, r.count]), [['active', 3], ['archived', 1]]);

    const [stats] = await repo.aggregate<{ sum: { age: number }; min: { age: number }; max: { age: number }; avg: { age: number } }>(
      'person',
      { aggregate: { sum: ['age'], min: ['age'], max: ['age'], avg: ['age'] } }
    );
    assert.equal(stats.sum.age, 36 + 41 + 29 + 52);
    assert.equal(stats.min.age, 29);
    assert.equal(stats.max.age, 52);
    assert.equal(stats.avg.age, (36 + 41 + 29 + 52) / 4);
  });

  test(`[${label}] file store: import, list, remove`, async () => {
    const repo = fresh();
    const f = await repo.importFileFromUrl<{ id: number; url: string }>('https://x/y.png', { title: 'y' });
    assert.ok(f.id != null);
    assert.equal((await repo.listFiles()).length, 1);
    await repo.removeFile(f.id);
    assert.equal((await repo.listFiles()).length, 0);
  });
}

/** The AuthProvider half of the contract. */
export function runAuthConformance(label: string, make: () => AuthProvider): void {
  test(`[${label}] me is null before login, the user after, null after logout`, async () => {
    const auth = make();
    assert.equal(await auth.me(['email']), null);
    await auth.login('owner@example.com', 'pw');
    assert.deepEqual(await auth.me<{ email: string }>(['email']), { email: 'owner@example.com' });
    await auth.logout();
    assert.equal(await auth.me(['email']), null);
  });

  test(`[${label}] login throws on bad credentials`, async () => {
    const auth = make();
    await assert.rejects(() => auth.login('owner@example.com', 'wrong'));
  });

  test(`[${label}] serverInfo resolves`, async () => {
    const auth = make();
    assert.ok(await auth.serverInfo());
  });
}

// ── The MemoryRepository must satisfy the whole contract ────────────────────
runRepositoryConformance('memory', () => new MemoryRepository());
runAuthConformance('memory', () =>
  new MemoryAuthProvider([{ email: 'owner@example.com', password: 'pw', first_name: 'O' }])
);

// ── LocalRepository (IndexedDB) over fake-indexeddb ─────────────────────────
// Same contract, plus persistence: the second block proves rows survive a
// "restart" (a fresh instance over the same database) and that resumed id
// sequences never collide with restored rows. Each conformance run gets its
// own database name — IndexedDB persists per name within the process, and the
// suite assumes every make() starts empty.
import 'fake-indexeddb/auto';
import { LocalRepository } from './local.ts';

let localDbSeq = 0;
runRepositoryConformance('local', () => new LocalRepository(`twin-local-test-${++localDbSeq}`));

test('[local] uploadFile stores the blob; assetSrc resolves it; removeFile forgets it', async () => {
  const repo = new LocalRepository(`twin-local-files-${Date.now()}`);
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' });
  const id = await repo.uploadFile(file, { title: 'Logo' });
  assert.ok(id, 'id assigned');
  assert.ok(repo.assetSrc(id).length > 0, 'assetSrc resolves to a renderable URL');
  assert.equal((await repo.listFiles()).length, 1, 'meta row registered');
  await repo.removeFile(id);
  assert.equal(repo.assetSrc(id), '', 'removed file no longer resolves');
  assert.equal((await repo.listFiles()).length, 0);
});

test('[local] rows survive a restart, and new ids never collide with restored ones', async () => {
  const name = `twin-local-restart-${Date.now()}`;
  const first = new LocalRepository(name);
  const a = await first.create<{ id: number }>('person', { name: 'Ada' });
  const b = await first.create<{ id: number }>('person', { name: 'Bjarni' });

  const second = new LocalRepository(name); // same db, fresh instance = restart
  const rows = await second.list<{ id: number; name: string }>('person', { sort: ['id'] });
  assert.deepEqual(
    rows.map((r) => r.name),
    ['Ada', 'Bjarni']
  );
  const c = await second.create<{ id: number }>('person', { name: 'Cara' });
  assert.ok(c.id !== a.id && c.id !== b.id, 'resumed sequence must not reuse a restored id');
  assert.equal(await second.count('person'), 3);
});
