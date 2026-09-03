# Phase 3 — the Supabase adapter: auth, RLS, files

Design for the *second* Repository/AuthProvider implementation. Written now that
every domain module goes through the port (see `phase3-data-port.md` §3, step 3)
and the port is proven honest by a second, non-Directus adapter + a conformance
suite (`src/lib/data/repo/memory.ts`, `conformance.test.ts`). This doc is
`phase3-data-port.md` §4/§7.4 — the RLS mapping — before any Supabase code.

**Status (2026-08-28): the adapter is written and VERIFIED against a live
throwaway project.** `src/lib/data/repo/supabase.ts` (`SupabaseRepository` +
`SupabaseAuthProvider`) was run against a spike Supabase project — a live spike
seeded a relational schema (person + team FK, a personal `secret` table with the
RLS policies in §3, and two auth users) and asserted the full contract: **35/35
passed**, covering CRUD, every filter op, the dot-path relational filter (via
auto `!inner` embed), sort, paging, projection, count, grouped aggregates, the
file store — and, the crux, **RLS member-privacy**: user A's private row is
invisible and undeletable to user B. What remains is the app-level wiring
(`PUBLIC_DATA_BACKEND=supabase` in `repo/index.ts`) and the full-schema/RLS
generation for a real instance; §3 is the pattern proven at spike scale.

## 0. The order of operations

1. This design (auth + RLS + files + verification). ← you are here
2. `SupabaseRepository` + `SupabaseAuthProvider`, wired into
   `runRepositoryConformance` / `runAuthConformance` — they must pass the same
   suite `memory` passes, run against a **throwaway** Supabase project.
3. Schema + RLS applied to that project by an idempotent script (mirrors
   `scripts/add-member-role.sh`).
4. `PUBLIC_DATA_BACKEND=supabase` on a **spike** instance only; run phase-2's
   browser matrix incl. the member-privacy test. `main` stays on Directus.

Never two live backends at once, and never the personal instance first
(`phase3-data-port.md` §5).

## 1. What the port needs from Supabase

The neutral surface (measured, small):

| Port method | supabase-js |
| --- | --- |
| `list(c, {where,fields,sort,limit,offset})` | `.from(c).select(fields).<filters>.order().range()` |
| `get(c, id, {fields})` | `.from(c).select(fields).eq('id', id).maybeSingle()` |
| `create` / `createMany` | `.from(c).insert(data).select()` |
| `update` / `updateMany` | `.from(c).update(patch).in('id', ids).select()` |
| `remove` / `removeMany` | `.from(c).delete().in('id', ids)` |
| `count(c, where)` | `.from(c).select('*', { count: 'exact', head: true })` |
| `aggregate` | a Postgres view / RPC per rollup (supabase-js has no group-by builder) |

Filter op → PostgREST: `eq→.eq`, `neq→.neq`, `in→.in`, `icontains→.ilike('%v%')`,
`null→.is(null)`, `nnull→.not.is(null)`, `lt/lte/gt/gte→.lt/.lte/.gt/.gte`,
`startswith→.ilike('v%')`, `nstartswith→.not.ilike('v%')`, `empty/nempty→` `.or`
of is-null / eq-''. `and`→chained filters; `or`→`.or('a.eq.x,b.eq.y')` string.
Dot-path relation filters → PostgREST embedded-resource filters
(`team.status=eq.ok` via `select('*, team!inner(status)')`).

**The one real gap: `aggregate` with `groupBy`.** PostgREST has no group-by.
Options: (a) a SQL view per rollup the adapter selects from; (b) an RPC
(`create function`) per rollup; (c) pull rows and fold in JS (only for small
sets). The app's aggregates are few (marketing spend rollups, focus max-sort,
evergreen post counts) — enumerate them and back each with a view. This is the
adapter's largest single task; the conformance `aggregate` tests define the exact
output shape a view must return (`{ groupCol, sum: { field } , count }`).

## 2. Auth mapping

Directus today: httpOnly **session cookie**, `readMe` for identity, login/logout
via the session client. Supabase: `supabase.auth.signInWithPassword` issues a
**JWT** the client library stores; `supabase.auth.getUser()` is identity.

`SupabaseAuthProvider implements AuthProvider`:

| AuthProvider | supabase-js |
| --- | --- |
| `login(email, pw)` | `auth.signInWithPassword({email,password})`; throw on error |
| `logout()` | `auth.signOut()` |
| `me(fields)` | `auth.getUser()` → project `fields` from `user` + a `profiles` row; `null` on error |
| `serverInfo()` | a health/settings read (or a fixed `{ backend:'supabase' }`) |

`+layout.ts`'s guard and the write-queue re-auth already read only
`AuthProvider`, so no call-site changes. The one behavioural note: Directus
returns nothing to JS on login (cookie); Supabase hands the client a session —
`login()` still returns `void`, keeping the contract identical.

## 3. RLS — the phase-2 ownership model, as Postgres policies

**This is the highest-risk piece: a wrong policy leaks another user's private
rows.** Phase 2's model (Directus policies) is:

- **Shared collections** (People, Organizations, Projects, the ~95 in
  `add-member-role.sh`'s SHARED list): every member may read + write.
- **Personal collections** (finance_txn, focus_task, habit, notes, … — the 27
  with a `user_created` ownership filter): a row is visible/writable only to the
  user who created it.

RLS translation (every table: `alter table X enable row level security`):

```sql
-- Personal table: owner-only, all four verbs.
create policy own_select on finance_txn for select using  (auth.uid() = user_created);
create policy own_write  on finance_txn for insert with check (auth.uid() = user_created);
create policy own_update on finance_txn for update using  (auth.uid() = user_created)
                                                   with check (auth.uid() = user_created);
create policy own_delete on finance_txn for delete using  (auth.uid() = user_created);

-- Shared table: any authenticated member.
create policy member_all on person for all
  to authenticated using (true) with check (true);
```

Parity notes that must hold, or the spike fails its privacy test:

- `user_created` becomes a `uuid` column defaulting to `auth.uid()` (Directus
  stamped it from the session; Postgres stamps it from the JWT). The port's
  `create` must NOT send `user_created` — the DB default owns it, same as
  Directus's `user_created` special.
- The **owner vs admin** split (phase-2 GAP B/C): Directus admin bypasses
  policies; in Supabase the `service_role` key bypasses RLS. The browser bundle
  must only ever hold the **anon** key — never `service_role` — or the whole
  model is void. (Mirror of "admin token stays off the bundle".)
- Historical rows with a null/foreign `user_created` are invisible to their
  owner (phase-2 GAP C, fixed there by backfill). Any data migration repeats
  that backfill; a *new* twin has no such rows.
- Generate all policies from the SAME manifest `add-member-role.sh` uses (SHARED
  vs PERSONAL lists), so Directus and Supabase can never disagree about which
  collection is which.

## 4. Files

`listFiles`/`importFileFromUrl`/`removeFile` map to a Supabase **Storage**
bucket + a metadata table; asset URLs move from Directus `/assets/<id>` to the
bucket's public/signed URL. The multipart browser-File upload (`batch.ts
uploadFile`, already outside the port) needs its own Supabase-Storage path. The
Immich proxy is unaffected (separate system, `immich.ts`).

## 5. Verification (mirrors phase 2)

1. `SupabaseRepository`/`SupabaseAuthProvider` pass `conformance.test.ts` against
   a throwaway project — the same 21 assertions `memory` passes.
2. **Member-privacy test** (the one that matters): two users, a personal row
   created by A; assert B's `list` cannot see it and B's `update`/`delete` fail —
   the RLS analogue of phase-2's member-privacy pass.
3. Owner sees own data; shared graph visible to both; write-queue re-auth on an
   expired JWT.
4. Only then consider data migration (its own dump/restore rehearsal) — out of
   scope here.

## Open questions for the operator

- Is there a Supabase project to point a spike at, or should step 2 wait until
  one is stood up? (The conformance suite + `memory` adapter already prove the
  port; the Supabase adapter needs a live project to verify against.)
- Supabase for **new** twins only, or is migrating the personal instance's data
  ever in scope? (Sets whether §5.4 matters.)
