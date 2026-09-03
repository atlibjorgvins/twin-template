# Writing a twin plugin

A **plugin** is a feature twin can be built with or without. The core is a
contact system (People + Organizations); everything else — family, habits,
grants, marketing — is a plugin. This guide is how to write one.

> For the *definition* and the invariants every plugin keeps (data through
> `repo`, no cross-plugin imports, one manifest, gated by id — each enforced by a
> test), see [`plugin-contract.md`](./plugin-contract.md). This guide is the
> step-by-step; that is the contract.

> **Install model.** twin is a static browser SPA (not Electron), so a plugin is
> **built into a bundle**, not hot-loaded at runtime. "Installing" = adding the
> plugin to your instance and redeploying. There is no runtime sandbox, so a
> plugin runs with full app access — only add code you trust. A runtime loader
> with a permission model is a future step (see `docs/phase4-plugins.md`).

## 1. Anatomy

A plugin is a directory under `src/lib/plugins/<id>/`:

```
src/lib/plugins/<id>/
  manifest.ts   # what the app needs to wire it in (required)
  data.ts       # its data access, via the neutral repo (optional)
```

…plus, if it has UI, a route under `src/routes/<its-route>/` and, if it stores
data, a schema script under `scripts/`.

Copy [`docs/plugin-template/`](./plugin-template/) as a starting point.

## 2. The manifest

`manifest.ts` exports one `PluginManifest` (`src/lib/plugins/types.ts`):

```ts
import type { PluginManifest } from '$lib/plugins/types';

export const example: PluginManifest = {
  id: 'example',               // stable id + deny-list key + FeatureKey
  label: 'Example',            // shown on the Plugins settings page
  tier: 'public',              // 'public' ships to anyone; 'private' = only builds that include it
  category: 'Utilities',       // grouping on the Plugins page (reuse an existing one where it fits)
  routes: ['/tools/example'],  // route prefixes it owns → gated + redirect when off
  collections: ['example_row'],// Directus collections it owns (docs + schema)
  dependsOn: ['contacts']      // 'contacts' core, or another plugin id
};
```

Then register it in `src/lib/plugins/registry.ts` by adding it to `PLUGINS`.
That one array is the source of truth: `FEATURE_KEYS`, `ROUTE_FEATURES`, and the
route guard are all **derived** from it — you never hand-edit those lists.

`consistency.test.ts` enforces that every nav/tile/route gate points at a real
key and every key is actually used, so a half-wired plugin fails CI.

## 3. Reading + writing data — use the neutral `repo`

Never import `@directus/sdk` in a plugin. Talk to the backend through the
neutral port so the plugin is born backend-agnostic:

```ts
import { repo } from '$lib/data/repo';

export async function listExampleRows(personId: number) {
  return repo.list('example_row', {
    where: { field: 'person_id', op: 'eq', value: personId },
    fields: ['id', 'person_id', 'note', 'date_created'],
    sort: ['-date_created'],
    limit: 200
  });
}

export async function addExampleRow(personId: number, note: string) {
  return repo.create('example_row', { person_id: personId, note });
}
```

The port covers `list / get / create / createMany / update / updateMany /
remove / removeMany / count / aggregate` and the file store
(`listFiles / importFileFromUrl / removeFile`). Filters compose with
`and / or` and support dot-paths (`person_id.status`). See
`src/lib/data/repo/types.ts` for the full contract.

## 4. Core datapoints a plugin may read

Plugins hang off the core. Read core entities by their types in
`src/lib/data/types.ts` — `Person`, `Organization`, `Project` — and link your
rows to them by id (e.g. `person_id`, `organization_id`). Depend on `contacts`
(the core) or on another plugin via `dependsOn`; don't reach into another
plugin's internals.

## 4b. Settings

Two ways to give a plugin settings, both surfaced on its detail page
(Settings → Plugins → *your plugin*):

- **Full settings page(s)** — list them in `settingsLinks` on the manifest and
  the detail page links to each. Use for anything substantial (like ai-vault →
  Keys & tasks + Usage, or evergreen → Buffer + Posting identities):
  `settingsLinks: [{ label: 'Keys & tasks', href: '/settings/ai' }]`.
- **Inline settings** — declare small per-device preferences on the manifest and
  they render as a form on the detail page, persisted in localStorage:

```ts
// manifest.ts
settings: [
  {
    key: 'defaultDice',
    label: 'Default dice',
    type: 'select',            // 'toggle' | 'text' | 'number' | 'select'
    default: '2',
    description: 'How many dice the roller starts with.',
    options: [ { value: '1', label: '1 die' }, { value: '2', label: '2 dice' } ]
  }
]
```

Read the value where the plugin needs it:

```ts
import { getPluginSetting } from '$lib/plugins/settings';
const count = getPluginSetting('games', 'defaultDice', '2'); // (pluginId, key, default)
```

(Worked example: the `games` plugin declares `defaultDice`; `/tools/dice` reads it
to pick its starting dice count.)

## 5. Storage (if your plugin persists data)

Add a Directus collection with a small idempotent script in `scripts/` (copy an
existing `scripts/add-*.sh`). Give member/owner permissions in
`scripts/add-member-role.sh` (add your collection to the `SHARED` or `PERSONAL`
list). Personal-scoped collections get a `user_created` ownership filter; shared
ones are open to all members.

## 6. Ship it

1. Build clean: `npm run check` (no new errors) and `node --test`.
2. Add it to your instance and redeploy: `bash scripts/deploy.sh`
   (or `--target <instance>`).
3. To leave it out of a build, add its `id` to `PUBLIC_DISABLED_FEATURES`.

## 7. Publishing to the marketplace

- **Start from the template repo:**
  [`twin-plugin-template`](https://github.com/atlibjorgvins/twin-plugin-template)
  — fork it; it already has the manifest, a `repo`-backed data module, a route
  under `routes/`, and `plugin.json`. (Reference plugins:
  [`twin-plugin-habits`](https://github.com/atlibjorgvins/twin-plugin-habits),
  [`twin-plugin-games`](https://github.com/atlibjorgvins/twin-plugin-games).)
- **Community entry** in `src/lib/plugins/catalogue.ts` — a vetted, inspectable
  repo shows up under Settings → Plugins → Marketplace.
- **Add from GitHub** — from that same page, declare the repo in `plugins.json`
  (`{ id, repo, ref }`), run `npm run plugins:update` to lock + fetch it, register
  its manifest in `registry.ts`, and redeploy. `fetch-plugins.sh` clones it into
  `src/lib/plugins/<id>/` (and its `routes/` into `src/routes/`); builds pull the
  locked SHA (`plugins.lock`). See `docs/plugin-contract.md §Ingest`.

Keep a plugin one repo, one manifest, data through `repo`, and it stays easy to
move between instances — and, when the runtime loader lands, easy to adapt.
