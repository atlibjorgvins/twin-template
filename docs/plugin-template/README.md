# twin plugin template

A copy-me starter for a twin plugin. Full guide: [`../plugin-authoring.md`](../plugin-authoring.md).

> **Publishing your own?** Fork the standalone repo
> [`twin-plugin-template`](https://github.com/atlibjorgvins/twin-plugin-template)
> instead — it carries this same starter plus `plugin.json` and a `routes/`
> example, laid out for GitHub ingest (`docs/plugin-contract.md §Ingest`). This
> in-repo copy is the inline reference.

## What's here

| File | Purpose |
|---|---|
| `manifest.ts` | The one declaration that wires the plugin in (id, label, tier, routes, collections, deps). |
| `data.ts` | Data access through the neutral `repo` — never `@directus/sdk`. |

A plugin with UI also adds a route under `src/routes/…` and, if it stores data,
a schema script under `scripts/`.

## Make your own

1. **Copy** this directory to `src/lib/plugins/<your-id>/`.
2. **Rename** the `example` export and set a unique `id` in `manifest.ts`.
3. **Register** it: add the export to `PLUGINS` in `src/lib/plugins/registry.ts`.
4. **Data**: adjust `data.ts` for your collection(s). Add the collection with an
   idempotent `scripts/add-<id>.sh`, and grant it in `scripts/add-member-role.sh`.
5. **UI** (optional): add `src/routes/<your-route>/+page.svelte`; the manifest's
   `routes` gates it automatically.
6. **Verify + ship**: `npm run check` && `node --test`, then
   `bash scripts/deploy.sh`.

## Rules that keep it portable

- One directory, one manifest.
- All data through `repo` (`src/lib/data/repo`).
- Link to core entities (`Person`, `Organization`, `Project`) by id; depend on
  `contacts` or another plugin via `dependsOn` — don't reach into another
  plugin's internals.
