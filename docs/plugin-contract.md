# The Twin plugin contract

The one-page definition of what a plugin *is* in Twin, and the promises every
plugin keeps. If `plugin-authoring.md` is the how-to, this is the *what* and the
*why* — the invariants that keep plugins swappable between instances and safe to
turn off.

## What a plugin is

> A plugin is a **build-time feature module**: a self-contained unit of Twin
> that can be included in a build or left out, identified by a stable `id`,
> declared by a single manifest, and gated everywhere by that id.

The core is a contact system — **People + Organizations + Projects**. Everything
else is a plugin: family, habits, finances, campaigns, the games, the kiosk.
Turning a plugin off removes its routes, its nav, and its tiles; the core keeps
working.

**Install = add + redeploy.** Twin is a static browser SPA, not Electron, so
there is no runtime loader today: a plugin is compiled into the bundle. A plugin
therefore runs with full app access — trust is by inspection, not by sandbox. A
runtime loader with a permission model is a deliberately deferred milestone
(`phase4-plugins.md`); until then, "principles now, SDK later."

## The contract — four invariants

Each is machine-enforced, so a violation fails CI rather than shipping.

1. **One manifest, in the registry.** A plugin declares itself with a single
   `PluginManifest` added to `PLUGINS` in `registry.ts`. `FEATURE_KEYS`,
   `ROUTE_FEATURES`, and the route guard are all *derived* from that array —
   never hand-edited. *Enforced by `consistency.test.ts`* (every gate names a
   real key; every key is used).

2. **Data through the neutral `repo` port — never the backend.** Plugin code
   imports `repo` from `$lib/data/repo`, never `@directus/sdk` and never the raw
   `$lib/data/client`. This is what makes a plugin born backend-agnostic. The
   port covers `list/get/create/createMany/update/updateMany/remove/removeMany/
   count/aggregate` plus the file store; filters compose with `and/or` and
   dot-paths (`src/lib/data/repo/types.ts`). *Enforced by
   `imports.guard.test.ts`.*

3. **No cross-plugin internals.** A plugin composes only through the registry
   (which imports each manifest) and through shared core in `$lib/data`. Plugin
   A importing `plugins/B/anything` is a hidden coupling that breaks the moment B
   is disabled. Depend on `contacts` (core) or another plugin by `id` via
   `dependsOn`; read core entities by their `$lib/data/types` types and link by
   id. *Enforced by `imports.guard.test.ts`.*

4. **Gated by id, everywhere.** Routes, nav tabs, and tool tiles all gate on the
   same `id`. `featureOn(id)` is `!disabled-in-build && !disabled-on-device`;
   disabling closes the route (redirect) and hides the entry. *Enforced by
   `consistency.test.ts`.*

## Where a plugin lives

The destination shape is one directory per plugin:

```
src/lib/plugins/<id>/
  manifest.ts   # required — how the app wires it in
  data.ts       # optional — its data access, via repo
```

…plus a route under `src/routes/<its-route>/` if it has UI, and an idempotent
`scripts/add-*.sh` if it owns a Directus collection. Copy
[`docs/plugin-template/`](./plugin-template/) to start. Settings surface on the
plugin's detail page (Settings → Plugins → *plugin*), either as `settingsLinks`
to full pages or inline `settings` — see `plugin-authoring.md §4b`.

## Ingesting an external plugin (GitHub)

A plugin's `src/lib/plugins/<id>/` (manifest + data + logic) can live in **its own
GitHub repo** and be pulled into a twin instance at build time — the "add from
GitHub" loop. A plugin can also ship its **route page(s)**: put them under a
`routes/` subtree in the repo (e.g. `routes/tools/habits/+page.svelte`) and
`fetch-plugins.sh` copies that subtree into twin's `src/routes/` verbatim on
ingest. So an external plugin can own its full surface — manifest, data, and UI
route — even before the runtime loader exists.

1. **Declare it** in `plugins.json` at the repo root:

   ```json
   { "external": [ { "id": "habits", "repo": "https://github.com/you/twin-plugin-habits", "ref": "main" } ] }
   ```
   `ref` is a branch, tag, or commit SHA — the moving target you *want* to track.

2. **Lock + materialise it.** `npm run plugins:update` resolves each `ref` to the
   commit it points at, clones that into `src/lib/plugins/<id>/` (strips `.git`),
   and writes **`plugins.lock`** — the resolved SHA per plugin, committed like a
   package lockfile. Commit `plugins.json` + `plugins.lock` together. Thereafter
   builds run `fetch-plugins.sh --frozen` (via the `plugins:fetch` script), which
   clones the **locked SHAs**, not the moving `ref`, so two builds a week apart
   are byte-identical. You rarely call fetch by hand: `npm run build` / `dev` /
   `check` (and `:klak`) run the frozen fetch first via npm `pre*` hooks, and
   `deploy.sh` runs it too — a fresh clone builds without a manual step and every
   deploy ships the locked versions. Each plugin is cloned to a temp dir and
   swapped in only on success, so an offline/failed fetch keeps the existing copy
   instead of wiping it. To upgrade a plugin, re-run `plugins:update` and commit
   the new lock.

3. **Redeploy.** The registry's static `import` of the plugin's manifest resolves
   against the materialised dir, and it compiles into the bundle like any other.

The materialised dirs are **gitignored** in twin — GitHub is their source of
truth, not this repo. Consequence: a fresh `git clone` of twin has no external
plugin code until `fetch-plugins.sh` runs, so `registry.ts`'s static import (and
`npm run check`/`build`) will fail until then — fetch first, the same way you
`npm install` before building. The external repo is authored against twin's
contract (`import { repo } from '$lib/data/repo'`, `../types`), so it is meant to
be cloned into twin and does not typecheck standalone; a standalone SDK is the
runtime-loader milestone below. Reference repo:
[`twin-plugin-habits`](https://github.com/atlibjorgvins/twin-plugin-habits).

## Current state (2026-08-28)

Twin has **23 plugins**. The contract is a target the codebase is converging on,
not a claim that every line already sits in `src/lib/plugins/`:

- **Ingested from GitHub:** `habits` and `games`. Their code lives in the
  external repos
  [`twin-plugin-habits`](https://github.com/atlibjorgvins/twin-plugin-habits)
  (manifest + data) and
  [`twin-plugin-games`](https://github.com/atlibjorgvins/twin-plugin-games)
  (manifest-only — client-only, no data module), declared in `plugins.json` and
  materialised into `src/lib/plugins/<id>/` by `fetch-plugins.sh` (gitignored
  here). `habits` also ships its `/tools/habits` **route page** from its repo's
  `routes/` subtree (copied into `src/routes/`, gitignored here) — the full
  surface is GitHub-owned. `games`' route pages still live in `src/routes/`.
- **Fully relocated + compliant (the reference plugin):** `family`. Lives under
  `src/lib/plugins/family/` with data through `repo`. The in-repo template.
- **Declared by manifest, backing code still in `src/lib/*`:** the other 21.
  They are correctly registered, gated, and categorised, but their data modules
  were not part of the phase-3 `src/lib/data/*` port and some still import
  `@directus/sdk` directly.

The guard test scans `src/lib/plugins/**`, so it *fully* protects the reference
plugins today and *automatically* extends to each of the other 21 the moment its
code is relocated into `src/lib/plugins/<id>/` — no test edit needed.

### Migration backlog (SDK → repo)

**Plugin backlog: complete.** Every plugin-owned module now goes through `repo`
(grep source of truth: `grep -rln "@directus/sdk" src/`). Migrated: family,
habits, food, clockify, focus, wordpress, evergreen (`data/evergreen.ts`),
campaigns (`marketing/data.ts`), photos (`photos/explore.ts` +
`data/photoPeople.ts`), studio (`studio/data.ts`), brand-book (`brand.ts` +
`brand-book/[kind]/[id]/+page.ts`).

Still on `@directus/sdk`, but **core/infrastructure — not plugins**, so out of
scope for the plugin contract and migrated on their own track: `directus.ts` (the
re-export shim + the `staticToken` client bootstrap), `writeQueue.ts` (offline
queue), `insights/data.ts`, `events/data.ts` (core calendar), `orgSocial.ts`,
`project-inheritance.ts`, and the `orgs/[id]` / `calendar/holidays` routes.

**Intentional exceptions — foreign-backend clients that keep their own SDK
client** (the `repo` port is bound to *twin's* backend; these talk to a
different server, so routing them through `repo` would hit the wrong instance):
`news/client.ts` + `news/data.ts` (the frettir news instance — its own URL +
token, isolated exactly like `immich.ts`). These are correct as-is; the "data
through `repo`" rule is about twin's own backend.

## Deferred to the runtime-loader milestone

A standalone `@twin/plugin-sdk` package, a plugin CLI, packaging/preview host,
an install lifecycle, and marketplace artifacts. These presume a runtime loader
Twin does not have yet; adopting them now would duplicate the contract in two
places. The principles above stand on their own until that milestone —
`phase4-plugins.md` tracks it.
