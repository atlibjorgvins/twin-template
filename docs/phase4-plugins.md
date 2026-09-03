# Phase 4 — Plugins (build-time first)

**Goal:** make "a feature" a single declared thing — a **plugin** — so the core
twin (contacts) plus a set of plugins is how every build is assembled, and an
outsider can add one by writing a manifest and a directory. Build-time first;
a runtime install API comes only when a real third party needs it.

Read this before writing any of it. Grounded in a survey of `main` on
2026-08-22; see [opening-up-twin.md](./opening-up-twin.md) for the 4-phase plan
and [phase3-data-port.md](./phase3-data-port.md) for the data layer this sits on.

---

## 1. Where we are — a plugin system already exists, in pieces

`src/lib/instance.ts` already gates **19 feature keys** with a deny-list
(`PUBLIC_DISABLED_FEATURES`), and KLAK ships the same codebase with 7 of them
off. That is a build-time plugin system in embryo. The problem is that **one
feature's wiring is scattered across five places** that are hand-kept and can
disagree:

1. `FeatureKey` union + `FEATURE_KEYS` array — `instance.ts`
2. `ROUTE_FEATURES` route→feature map — `instance.ts`
3. Nav entries — the `tabs[]` array in `src/routes/+layout.svelte`
4. Home tiles + the tools catalogue — `src/routes/+page.svelte`, `src/routes/tools/+page.svelte`
5. In-page section gates — e.g. `people/[id]/+page.svelte` for `family`

Nothing keeps these in sync. The survey found the drift you would predict:

- **`ai-vault`** is a FeatureKey with essentially **no gate** — no nav, no tile,
  no route entry, no `featureOn()` call. Turning it off does almost nothing.
- **`family`** and **`typing`** are **not in `ROUTE_FEATURES`** — family is gated
  only as a UI section, typing only by its tile.
- **`campaigns`** off closes `/marketing` (redirect) but leaves a **dead
  Marketing nav entry** (the tab has no `feature`).
- **`/tools/wheel`** is in `ROUTE_FEATURES` and the tools catalogue but has **no
  route directory** — a dead link.

A manifest that declares all of a plugin's wiring in one file, and *generates*
the five lists above, removes this whole class of bug. That is phase-4 step 1.

## 2. What a plugin is

A **plugin** is a directory under `src/lib/plugins/<id>/` with a `manifest.ts`
that declares everything the app needs to wire it in. Two tiers, unchanged from
the plan:

| Tier | Examples | Ships |
|---|---|---|
| **Public** | family, events, notes, habits, focus, games | with the core; installable by anyone |
| **Private** | grants, marketing/campaigns, evergreen, brand-book, KLAK programme tooling | only in builds that include them |

"Build-time" means a plugin is *present or absent from the bundle*, selected by
the deny-list today (and, later, an allow-list per instance). No runtime
loading, no sandbox, no third-party API surface yet — those are step 2, and the
plan is explicit that we do not pay for them speculatively.

## 3. The manifest

```ts
// src/lib/plugins/types.ts  (proposed)
import type { FeatureKey } from '$lib/instance';

export interface NavEntry {
  label: string;
  href: string;
  icon?: string;
  scope?: 'work' | 'private';   // matches the existing tab scope gate
  surface?: ('rail' | 'menu' | 'bottom')[]; // where it shows; default all
}

export interface TileEntry {
  label: string;
  href: string;
  icon?: string;
  group?: string;               // which tools-page group it lands in
  blurb?: string;
}

export interface PluginManifest {
  /** Stable id === today's FeatureKey (e.g. 'family', 'grants'). */
  id: FeatureKey;
  /** Human label for settings + the "what's in this build" surface. */
  label: string;
  tier: 'public' | 'private';
  /** Route prefixes this plugin owns — becomes ROUTE_FEATURES entries. */
  routes?: string[];
  /** Nav entries — merged into the layout's tabs[]. */
  nav?: NavEntry[];
  /** Tools-page / home tiles — merged into the catalogues. */
  tiles?: TileEntry[];
  /** Directus collections the plugin owns (for docs + future migrations). */
  collections?: string[];
  /** Core (or other-plugin) capabilities it reads. Enforced, see §4. */
  dependsOn?: ('contacts' | FeatureKey)[];
  /** Whether disabling it is even allowed (core-adjacent plugins may pin on). */
  removable?: boolean;          // default true
}
```

A registry collects every manifest and **derives** what `instance.ts` hand-keeps
today:

```ts
// src/lib/plugins/registry.ts  (proposed)
export const PLUGINS: PluginManifest[] = [ family, grants, habits, /* … */ ];

export const FEATURE_KEYS = PLUGINS.map((p) => p.id);
export const ROUTE_FEATURES = PLUGINS.flatMap(
  (p) => (p.routes ?? []).map((r) => [r, p.id] as const)
);
// nav and tiles are assembled the same way and consumed by the layout/tools page.
```

`instance.ts` keeps its runtime concerns (the deny-list parse, `featureOn`,
identity, scope-lock, auth-mode) and imports `FEATURE_KEYS`/`ROUTE_FEATURES`
from the registry instead of hand-declaring them.

## 4. The core contract — what a plugin may read

The core is **contacts**: `Person`, `Organization`, and their junctions, defined
in `src/lib/data/types.ts`. A plugin may:

- **Read** core entities through the data layer (`$lib/data/people`,
  `$lib/data/orgs`, and — as phase 3 lands — the neutral `repo`).
- **Own** its own collections and types (as `habits.ts` already keeps `Habit`
  local to itself — the pattern to follow).
- **Depend** on core (`dependsOn: ['contacts']`) or, rarely, on another plugin
  it names — never on another plugin implicitly.

Rule: **plugins depend on the core, not on each other**, except through a
declared `dependsOn`. This is why extraction order follows the dependency graph:

- **family first** — touches only `Person`. One data module
  (`familyRelations.ts`), one gate site (`people/[id]`). The clean reference.
- **events next** — `Person` + `Organization`.
- **Projects last** — `dates`, `marketing`, `buffer`, `calendarMapping`,
  `projectMembers`, `asana` all import the `Project` type today, so extracting
  it early would force real plugin→plugin dependencies before `dependsOn` is
  proven.

`types.ts` stays one file for now, but the intent is a visible split: core
entities vs plugin-owned. New plugin types go in the plugin directory, not
`types.ts`.

## 5. How to write a plugin (worked example: `family`)

1. **Create the directory** `src/lib/plugins/family/`.
2. **Write `manifest.ts`:**
   ```ts
   import type { PluginManifest } from '$lib/plugins/types';
   export const family: PluginManifest = {
     id: 'family',
     label: 'Family relations',
     tier: 'public',
     dependsOn: ['contacts'],
     collections: ['Person_family'],
     // family has no route of its own — it renders inside the Person page.
     // No nav, no tile. It is a section, declared so the registry knows it exists.
   };
   ```
3. **Move the code** it owns into the directory: `familyRelations.ts` →
   `src/lib/plugins/family/data.ts` (re-exported from `$lib/directus` during the
   transition so no call site breaks, exactly as the `directus.ts` split did).
4. **Register it** in `registry.ts`.
5. **Replace the ad-hoc gate.** `people/[id]/+page.svelte:856`'s
   `{#if featureOn('family')}` stays — it now reads a key the registry vouches
   for.

That is the whole contract for a build-time plugin. A private plugin (grants) is
identical plus `tier: 'private'` and real `routes`/`nav`/`tiles`.

## 6. Migration plan — incremental, no behavior change

Same discipline as the data port: land the mechanism, migrate one plugin at a
time, prove each step changes nothing.

1. **Add `plugins/types.ts` + `registry.ts`** describing **all 19 features as
   they are today**, and derive `FEATURE_KEYS`/`ROUTE_FEATURES` from it. Assert
   the generated lists **equal** the current hand-kept ones (a test), so this is
   provably a no-op. Fix the four drift bugs (§1) as deliberate, reviewed
   changes, not silently.
2. **Move nav + tile declarations** into manifests, and have the layout / tools
   page consume the registry. Verify each nav surface renders identically.
3. **Relocate one plugin's code** into its directory (family), re-exporting for
   compatibility. Prove the person page still shows family relations.
4. **Repeat** plugin by plugin, dependency order, Projects last.
5. Only after all of this, and after the data port is far enough along, consider
   step 2 (runtime install) — and only if a real third party needs it.

Every step is its own PR, `svelte-check` at baseline, tests green, and — for
anything with a UI surface — verified in a real browser against the NAS.

## 7. What this is NOT (yet)

- **Not a runtime loader.** No installing a plugin into a running instance, no
  downloading third-party code, no sandbox. Build-time only.
- **Not a stable public API.** The manifest shape will change as plugins are
  extracted; it is an internal contract until step 2.
- **Not blocked on the data port finishing.** Build-time plugins use the same
  data layer the app uses. But new plugin data access should target the neutral
  `repo` (phase 3), so plugins are born backend-neutral.

## 8. Open questions for the operator

- **Scope of step 1 now:** just the registry + derived lists + docs (lowest
  risk), or also relocate `family` into a real plugin directory as the reference?
- **Deny-list vs allow-list:** keep the deny-list (KLAK subtracts) as the model,
  or add a per-instance allow-list for genuinely private plugins that must never
  ship to the personal build? (The plan leans deny-list; private plugins are
  "absent from the build" via not being imported, which the registry can express.)
- **Fix the drift bugs in step 1?** (ai-vault's no-op gate, family/typing
  missing from ROUTE_FEATURES, the dead Marketing nav entry, the dead wheel
  route.) Recommend yes — they are cheap and the manifest makes them obvious.

---

*Status: design proposal, nothing implemented. This is phase-4 step 1
(build-time). Step 2 (runtime install) is deliberately out of scope until a real
third-party plugin author exists.*
