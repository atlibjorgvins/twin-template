# Phase 3 — the data-layer port

**Goal:** make the app stop naming Directus, so a twin can run on a different
storage backend (starting with Supabase). The port is only proven honest when a
**second** adapter exists — so the Supabase adapter is written *second*, and the
Directus adapter is refactored *first* into the same shape.

This is the design. Read it before writing any of it. Numbers below were measured
against `main` on 2026-08-22.

Phases 1 (split `directus.ts`) and 2 (identity + ownership, now live) are done —
see [opening-up-twin.md](./opening-up-twin.md) and [phase2-auth.md](./phase2-auth.md).

---

## 1. Where the seam is today

The data layer is already isolated in `src/lib/data/` — **51 modules**. But it is
isolated *around Directus*, not *from* it:

- **68 files** import from `@directus/sdk`; **55** import the `directus` client.
- Every read/write is an SDK query object handed to `directus.request(...)`.
- Verb surface in use: `readItems` ×352, `updateItem` ×176, `createItem` ×140,
  `deleteItem` ×105, `readItem` ×60, `aggregate` ×27, the `*Items` batch verbs
  ×31, `readFiles` ×3, `readMe` ×2.
- The one Directus-shaped type left is `Schema` in `data/schema.ts` (~143 lines).
  Everything routes its generics through it. **557 `as never` casts across 75
  collections** exist because those collections are not described in `Schema` —
  that is the phase-1 tail, and it doubles as phase-3 groundwork (§6).

The good news, measured: the **filter operators actually used are few** —
`_eq`, `_neq`, `_in`, `_icontains`, `_null`/`_nnull`, composed with `_and`/`_or`.
A neutral query language only has to cover that set, plus `sort`, `fields`,
`limit`/`offset`, and `aggregate(count)`. That is small enough to be real.

## 2. The core decision: where the adapter sits

**Option A — adapt at `directus.request()`.** Keep the SDK query objects, swap
what executes them. Least call-site churn, but it makes the "neutral" layer speak
Directus's query AST — the Supabase adapter would have to parse and translate that
AST. The coupling we are trying to remove just moves down a level. **Rejected.**

**Option B — a backend-neutral repository interface (recommended).** Data modules
stop calling `directus.request(sdkQuery)` and instead call a small repository:

```ts
// src/lib/data/repo/types.ts  (illustrative)
export interface Repository {
  list<T>(collection: string, q?: Query): Promise<T[]>;
  get<T>(collection: string, id: Id, q?: Query): Promise<T | null>;
  create<T>(collection: string, data: Partial<T>): Promise<T>;
  createMany<T>(collection: string, rows: Partial<T>[]): Promise<T[]>;
  update<T>(collection: string, id: Id, data: Partial<T>): Promise<T>;
  updateMany<T>(collection: string, ids: Id[], data: Partial<T>): Promise<T[]>;
  remove(collection: string, id: Id): Promise<void>;
  count(collection: string, where?: Filter): Promise<number>;
  // auth + files split into their own small interfaces (§4)
}

// The neutral query — deliberately only what the app uses today.
export type Filter =
  | { field: string; op: 'eq'|'neq'|'in'|'icontains'|'null'|'nnull'; value?: unknown }
  | { and: Filter[] } | { or: Filter[] };
export interface Query { where?: Filter; fields?: string[]; sort?: string[]; limit?: number; offset?: number; }
```

Two implementations of that one interface:

- **`DirectusRepository`** — a thin wrapper that builds the SDK query from the
  neutral `Query` and calls `directus.request()`. Behaviour identical to today.
- **`SupabaseRepository`** — written *second*, translating `Query` to
  `supabase-js` calls. Writing it is the test that the interface is honest and
  the app truly stopped naming Directus.

Selected by a config flag, same pattern as `PUBLIC_AUTH_MODE`: e.g.
`PUBLIC_DATA_BACKEND=directus|supabase`, resolved once in a `repo()` factory.

## 3. Migration strategy — incremental, always shippable

Do **not** rewrite 68 files then flip a switch. Instead:

1. **Land the interface + `DirectusRepository` with zero behaviour change.** The
   factory returns the Directus repo; nothing else changes yet.
2. **Migrate data modules one at a time** from `directus.request(sdkQuery)` to the
   repository. Each module is its own PR, verified against the live NAS, exactly
   like the `directus.ts` split (#372–#381). `svelte-check` and tests stay at
   baseline; the app keeps working on Directus throughout.
3. **Only once every module goes through the repository**, write
   `SupabaseRepository` and stand up a throwaway Supabase project to test against.
4. **Flip the flag on a spike instance** (never the live personal one first) and
   run the same browser verification matrix phase 2 used.

At no point is `main` broken or mid-port — the flag defaults to Directus until the
Supabase side is proven.

## 4. Cross-cutting concerns (the parts that are not just CRUD)

- **Permissions / ownership.** Phase 2's model (`user_created = $CURRENT_USER` for
  personal collections; shared collections open to members) is enforced by
  **Directus policies**. Supabase has no policy engine — it uses **Postgres RLS**.
  The port must express the same rules as RLS policies (`auth.uid() = user_created`
  on personal tables). This is the highest-risk piece: a wrong RLS policy leaks
  another user's private rows. It gets its own design + a dedicated verification
  pass mirroring the member-privacy test from phase 2.
- **Auth.** `auth.ts` (login/logout/whoAmI, session cookie) is Directus-specific.
  Supabase Auth issues JWTs. Keep auth behind its own small interface
  (`AuthProvider`) so `+layout.ts`'s guard and the write-queue re-auth stay
  backend-agnostic.
- **Files / images.** `readFiles`, asset URLs, and the Immich proxy assume
  Directus's `/assets`. Supabase Storage has different URLs. Behind a
  `FileStore` interface.
- **Relations.** M2A (`notes_related_to`), junctions (Activity_*), and nested
  `fields` expansion are Directus conveniences. The neutral layer either models
  them explicitly or the adapters emulate them. Enumerate every relational read
  during migration — this is where "small operator set" optimism can break.
- **Offline mirror + write queue.** `offline.ts`/`writeQueue.ts` mirror People/Org
  and replay writes. They already speak `createItem`/`updateItem` shapes — point
  them at the repository too, so offline works regardless of backend.
- **Aggregates & search.** `aggregate(count)` and `_icontains` map to Postgres
  `count(*)` and `ilike`; straightforward, but verify collation/case behaviour.

## 5. What Supabase buys, and the trap

Supabase gives a real per-user auth model (RLS) that matches the phase-2 direction
better than a shared Directus instance, plus Postgres directly. **The trap
(from the plan): do not run two live backends at once.** The Supabase adapter is
written to *prove the seam*, not to migrate the personal instance's data on day
one. Data migration (Directus → Supabase) is a separate, later decision with its
own dump/restore rehearsal.

## 6. Prerequisite / parallel work: the `Schema` tail

The 557 `as never` casts across 75 collections are collections absent from
`Schema`. The neutral repository's generics want honest row types, so folding
these collections into typed definitions is both the last of phase 1 and the
foundation of phase 3. It can proceed **in parallel** with §3 step 1 — it changes
no runtime behaviour and only tightens types. Doing it first makes each module
migration in step 2 mechanical rather than a typing puzzle.

## 7. Proposed first steps (for review)

1. **Spike (throwaway):** implement `Repository` + `DirectusRepository` and
   migrate **one** representative module end-to-end (candidate: `notes.ts` — it
   has create/update/delete, is in the offline queue, and is small). Verify the
   app behaves identically. This validates the interface shape against reality
   before committing to it.
2. In parallel, start the `Schema` fold-in (§6) on the collections that spike
   module touches.
3. Review the spike, freeze the interface, then migrate the rest module-by-module.
4. Design the RLS mapping (§4) as its own doc before the Supabase adapter.

## 8. Open questions for the operator

- **Timing/appetite:** is phase 3 a now-push, or parked behind other priorities?
  It is multi-session by nature.
- **Supabase specifically, or just "not Directus"?** The interface is
  backend-neutral either way, but the second adapter's target sets the RLS/auth
  design.
- **Is data migration ever in scope, or is Supabase only for *new* twins** that
  someone else stands up? That changes whether §5's migration rehearsal matters.

---

*Status: design proposal, nothing implemented. Supersedes the one-paragraph
phase-3 sketch in `opening-up-twin.md`.*
