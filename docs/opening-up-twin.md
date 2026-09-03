# Opening up twin — an assessment and a staged plan

**Goal:** a core twin anyone can run, with features installed as plugins the way
Obsidian does it, and a database layer that isn't married to Directus.

**Refined 2026-08-20, in Atli's words:** the core is a **contact system only** —
People and Organizations. Everything else is a plugin: family relations and
events are public plugins anyone gets; Projects and Grants are private plugins
(KLAK's programme tooling). Plugins read core datapoints — family uses Person,
grants use org + person — so the type contract and its documentation must be
good enough for outsiders to write plugins against. And a user has a personal
instance but can **join workspaces**: KLAK is a workspace, an instance of the
same core.

**Verdict: not too much. But the plugin system is the easy half, and doing it
first would be a mistake.** Written 2026-08-19 against `main` @ `1a7e581`; every
number below was measured, not estimated.

---

## 1. What the codebase actually looks like today

| | |
|---|---|
| Routes (`+page.svelte`) | 80 |
| `src/lib` modules | 197 |
| Source files | 339 |
| Schema scripts | 85 |
| **`src/lib/directus.ts`** | **11,151 lines · 611 exports · 590 `as never` casts** |
| Files importing it | **191 of 339 (56%)** |
| Files importing `@directus/sdk` directly | 21 |
| Collections reached via the `'X' as never` escape hatch | 24 |
| `FEATURE_KEYS` already defined | 19 |
| Routes already gated by feature | 21 |
| **Per-user authentication** | **none** |

Two of these rows decide the whole plan.

### The good news: a plugin system already exists, in embryo

`src/lib/instance.ts` has 19 feature keys, `featureForPath()` mapping 21 route
prefixes to features, `featureOn()`, and `pathAllowed()` enforced in
`+layout.ts` so a switched-off module's route is closed, not merely hidden.
`PUBLIC_DISABLED_FEATURES` is a deny-list, and `/settings` reports names that
match no module instead of ignoring the typo.

That is a **build-time plugin system**. It is subtraction rather than
composition, but the hard conceptual work — that features are separable, and
that separability must be enforced at the route boundary rather than in the nav
— is done and shipping.

### The bad news: there is no such thing as a user

```ts
// src/lib/directus.ts:988
return client.with(staticToken(PUBLIC_DIRECTUS_TOKEN)).with(rest());
```

One static token, baked into the bundle at build time. No login, no session, no
`/users/me`, no per-record ownership. **Every visitor to a deployed twin is the
same Directus identity with the same permissions.**

That is entirely reasonable for a personal twin behind Tailscale, and it is
exactly why the KLAK instance needed its own *separate database* rather than a
role inside the personal one — the architecture has no way to express "this row
is mine, that row is yours."

It also means the single sentence "so that anyone could use it" is not a
feature request. It is a request for a data model twin does not have. **This,
not plugins, is the gate.**

---

## 2. Why plugins-first is the wrong order

The instinct is to build the plugin API first, because it is the visible,
exciting part. Three reasons not to:

1. **A plugin API is a promise you cannot take back.** Whatever surface you
   expose on day one, third-party plugins bind to. Obsidian's plugin API is its
   single largest maintenance burden precisely because it shipped early and
   broadly. You want to publish that surface *after* the data layer stops moving.
2. **Right now, every plugin would import `directus.ts`.** 56% of the codebase
   does. A plugin API built today would hand third parties an 11,151-line
   Directus-shaped god-module as its data contract, and then Supabase support
   becomes impossible without breaking every plugin.
3. **Multi-user changes what a plugin *is*.** In a single-identity app, a plugin
   is a bundle of routes. In a multi-tenant app, a plugin also owns tables,
   migrations, and row-level access rules. Design it before auth exists and you
   will design the wrong object.

---

## 3. The staged plan

Four phases. Each is independently useful and shippable — none is a big-bang
rewrite, and you can stop after any of them with the app in a better state.

### Phase 1 — Break up `directus.ts` — **DONE, 2026-08-19**

Landed across #372–#381 and deployed. `src/lib/directus.ts` went **11,151 → 174
lines** and is now a re-export hub with no declarations of its own; **50 modules**
live in `src/lib/data/`.

| | |
|---|---|
| Exported surface | 616 → 624, **never lost a name** |
| `svelte-check` | 160 throughout — the measured baseline, every pass |
| Tests | 254/254, every pass |
| Call sites changed | **zero** |
| Download cost | +12.8 KB gzipped (+1.1%) |

`Schema` is now alone in `data/schema.ts` — the only Directus-shaped file left,
which is exactly the seam Phase 3 needs. `types.ts` (31 record shapes) names no
collection, filter or SDK type. Nothing in `src/lib/data` imports
`$lib/directus` any more, so the dependency runs one way.

Two things learned that the plan did not anticipate:

- **Leaves first, core last** — see §6. The obvious heuristic picked the worst
  possible starting file.
- **A section is only a leaf if nothing else depends on it *either*.** Checking
  only outgoing dependencies produced 40 errors in one pass;
  `scripts/section-deps.py` now checks both directions, and knows about the two
  things it cannot see (relative paths, and dynamic `import()`).

What is left of the original Phase 1 scope: the **24 collections still reached
with `'X' as never`** are not in `Schema`. That is roughly 100 of the 160
standing `svelte-check` errors, and it is now one well-scoped file to fix rather
than a hunt through 11,000 lines.

The enabling move for everything else, and valuable even if you go no further.

- Split 611 exports by domain into `src/lib/data/{people,orgs,events,grants,…}.ts`.
  The domain seams already exist and match the feature keys.
- Keep one thin `client.ts` owning `createDirectus` — nothing else touches the
  SDK. Today 21 files do.
- Introduce `Schema` entries for the 24 collections currently reached with
  `'X' as never`. Most of the 590 `as never` casts are that escape hatch; they
  are also ~108 of the ~160 standing `svelte-check` errors, so this pays a debt
  you are already carrying.
- **Test:** `npm run check` error count drops sharply; existing suites unchanged.

*Risk: low, tedium: high.* Mechanical, reviewable in slices, no user-visible change.

### Phase 2 — Identity and ownership (the actual gate)

- Replace the static token with a real session: Directus `authentication()` with
  refresh, or move straight to the Phase 3 adapter and let the backend own it.
- Add an owner column to every user-scoped collection and enforce it in the
  backend, not the client. **Client-side filtering is not access control** — and
  today a `PUBLIC_*` bundle cannot hold a secret anyway.
- Decide the tenancy model and write it down: one database per tenant (what
  KLAK does now, simple, operationally heavy) versus row-level ownership in a
  shared database (harder, and the only version that scales to strangers).
- **My recommendation:** row-level, with Postgres RLS as the enforcement point.
  Which points at Phase 3.

*Risk: high. This is where a mistake leaks one person's data to another.* Do it
before any stranger touches it, never after.

### Phase 3 — A data adapter, then Supabase as its proof

> **Detailed design:** [phase3-data-port.md](./phase3-data-port.md) (2026-08-22) —
> the neutral repository interface, the incremental migration, and the RLS/auth
> cross-cutting concerns, grounded in a survey of the current code.

- Define a narrow port — `list / get / create / update / delete / subscribe /
  uploadFile` — and make Phase 1's domain modules the only implementors.
- Write the Supabase adapter **second**, not first. Its job is to prove the port
  is honest; if the port leaks Directus semantics, the adapter cannot be written,
  which is the feedback you want.
- Know what you give up: Directus supplies an admin UI, schema-as-API, and file
  storage. Supabase supplies Postgres, RLS, auth, and storage but no admin UI
  over arbitrary tables. **Supabase's RLS is the right primitive for Phase 2** —
  which is why Phase 2 and Phase 3 are one project done in two steps, not two
  independent projects.
- The 85 schema scripts are Directus REST calls and do not port. They become
  SQL migrations. `TWIN_ENV_FILE` already makes them instance-aware, so the
  shape of "apply schema to a target" survives the swap.

*Risk: medium.* The port is cheap; the schema translation is the work.

### Phase 4 — Plugins, for real

> **Detailed design:** [phase4-plugins.md](./phase4-plugins.md) (2026-08-22) —
> the plugin manifest, the registry that generates FEATURE_KEYS/ROUTE_FEATURES,
> the core contract, and the incremental extraction (family first), grounded in
> a survey of every place a feature is wired today.

The core is **contacts**: People, Organizations, their junctions, and the type
contract in `data/types.ts` that every plugin reads. Everything else is a
plugin, in two tiers:

| Tier | Examples | Ships |
|---|---|---|
| Public | family relations, events, notes, habits | with the core, installable by anyone |
| Private | Projects, Grants, marketing, the KLAK programme tooling | present only in builds that include them |

Still two steps:

1. **Manifest-based, build-time.** Each plugin declares what it is:
   ```
   { id, label, routes[], nav[], collections[], migrations[], dependsOn[], settings[] }
   ```
   Generate `FEATURE_KEYS` and `ROUTE_FEATURES` *from* the manifests instead of
   hand-maintaining both. Today they are two hand-kept lists that can disagree —
   #366 had to remember to add `['/marketing','campaigns']` by hand, and did,
   but nothing would have caught it if it hadn't.
2. **Runtime install.** Only when a real third party needs it. This is where
   Obsidian's cost lives: a stable public API, sandboxing, versioning, a
   registry, and a compatibility promise. Do not pay it speculatively.

**Extraction order is dictated by the dependency graph, not by preference.**
Family relations and events are clean first plugins — family touches only
Person, events touch Person + organization. **Projects goes last:** `dates`,
`marketing`, `buffer`, `calendarMapping`, `projectMembers` and `asana` all
import the `Project` type today, so extracting it early would force plugins to
depend on a plugin before `dependsOn[]` is real and proven.

Private and custom plugins work at step 1 already — a manifest plus a
directory, installed by being present at build time. That covers the KLAK case
without any of step 2's cost.

### Phase 5 — Workspaces

A user has a personal instance and can join others. Two ways to build that:

- **(a) A workspace is an instance; the client holds several connections.**
  Slack's model. "Joining KLAK" means an owner there creates your account, you
  add the workspace URL in the app, log in, and switch. Identity is
  per-workspace.
- **(b) One identity across instances** — federation. An identity provider,
  token exchange, trust between servers.

**Build (a).** It is 90% of the experience for a fraction of the cost, and it
degrades gracefully — a personal-only user simply has one connection. What it
requires: the instance URL stops being baked at build time
(`PUBLIC_DIRECTUS_URL`) and becomes a runtime workspace list with a session
each. `apiBase.ts` already abstracts path-vs-absolute URLs, so the seam exists,
and Phase 2's session work is the prerequisite — multi-workspace is just
"sessions", plural.

On **Supabase for free personal accounts**: not until the Phase 3 port exists.
Running personal instances on Supabase while KLAK runs Directus means
maintaining two live backends — every schema change twice, every bug twice —
which is exactly what §4 warns against. Once the port is real, Supabase is one
adapter behind it and "personal account on the free tier" becomes a deployment
option rather than a fork. (Also practical: free-tier projects pause when
inactive, a poor fit for a system expected to always answer.) Until then, the
free path for a stranger is the docker-compose self-host that already exists
and is proven twice.

---

## 4. What I would not do

- **Don't build a plugin marketplace or runtime loader** until someone outside
  this repo is waiting for one.
- **Don't support Directus and Supabase simultaneously** for long. Two live
  adapters double the surface of every bug. Use Supabase to validate the port,
  then pick one.
- **Don't start with the database swap.** It is the most visible target and the
  worst first move: without Phase 1 there is no seam to swap at, and without
  Phase 2 you would port a single-user model onto a multi-user platform.
- **Don't open the repo publicly before Phase 2.** The bundle currently contains
  a working production token — that is fine for a private repo and a tailnet,
  and disqualifying for a public one.

---

## 5. Honest cost

Phase 1 is the largest amount of typing and the smallest amount of risk. Phase 2
is the smallest amount of typing and by far the largest risk — it is the phase
that can leak data between people, and the only one that genuinely cannot be
rushed. Phase 3 is bounded by the 85 schema scripts. Phase 4, done as step 1
only, is small — the registry already exists and needs inverting rather than
inventing.

The thing that makes this feasible at all is that the separability question is
already answered and running in production: two instances, one codebase, feature
subtraction enforced at the route boundary. Most projects attempting this have to
discover whether their features *can* be pulled apart. You already know they can,
because one of them is live at KLAK with seven modules switched off.

## 6. The first concrete step — and the correction it produced

The first draft of this section said to split `people` and `orgs` out first, on
the reasoning that they are the largest domains and the best tested. **That was
wrong.** Measured before touching anything: `Person` is referenced **116 times**
inside `directus.ts` and `Organization` **59**. They are the types every other
section builds on, so extracting them first makes every remaining section import
*backwards* into the module being emptied — and the file already carries one
acknowledged circular import with `project-inheritance.ts`.

**Leaves first, core last.** The real order within Phase 1:

1. **`data/client.ts`** — the client and the coalescing fetch, extracted first
   because it must sit at the bottom of the dependency graph. Every domain module
   imports the client; the client imports no domain module.
2. **Leaf domains** — habits, prompts, receipts, AI vault, finances, Buffer,
   Asana, Meta. Each needs the client and nothing else. Roughly 200–800 lines
   apiece, and each is independently shippable.
3. **`Schema` and the shared query types** — currently `Schema` lives in
   `directus.ts` and `client.ts` imports it as a *type only* (erased at compile
   time, so no runtime cycle). That stopgap ends here.
4. **`people` and `orgs` last**, once nothing else is left in the file to depend
   on them.

Done as [#372](https://github.com/atlibjorgvins/twin/pull/372): client + habits
out, `directus.ts` 11,151 → 10,911, **616 exports before / 617 reachable after /
0 lost**, 254 tests green, `svelte-check` unchanged at 160.

**What that measurement says about cost:** a self-contained ~200-line section is
a small, safe unit of work, and the re-export pattern means no call site changes
— so the leaf phase is boring and parallelisable. The real cost is concentrated
in steps 3 and 4, which is the opposite of where it looked before measuring.
