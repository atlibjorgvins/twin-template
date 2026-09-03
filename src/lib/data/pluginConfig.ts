// Cross-device plugin config sync.
//
// The enable toggle (instance.ts) and inline settings (plugins/settings.ts) are
// per-device localStorage by default. This layer mirrors them to a Directus
// `plugin_sync` row so they follow a person across devices: load it once at
// startup and hydrate the local state before gating; push it back on change.
//
// Degrades to localStorage-only whenever the row can't be reached — not signed
// in, offline, or the `plugin_sync` collection not created yet (run
// scripts/add-plugin-sync.sh). So this is safe to ship before the schema exists.
import { repo } from '$lib/data/repo';
import {
  runtimeDisabledList,
  hydrateRuntimeDisabled,
  runtimeEnabledList,
  hydrateRuntimeEnabled
} from '$lib/instance';
import { allPluginSettings, hydratePluginSettings } from '$lib/plugins/settings';

type Row = {
  id: number;
  disabled_plugins?: string[] | null;
  /** Default-off plugins this person turned ON (allow-list strip builds).
   *  Optional column — older plugin_sync schemas don't have it. */
  enabled_plugins?: string[] | null;
  plugin_settings?: Record<string, Record<string, unknown>> | null;
};

let _rowId: number | null = null;
let _loaded = false;

/** Fetch the synced config once and hydrate local state from it. Idempotent
 *  per session (later navigations skip the round-trip). Safe to call when
 *  signed out / offline / pre-schema — it just leaves localStorage in charge. */
export async function loadPluginConfig(): Promise<void> {
  if (_loaded) return;
  _loaded = true;
  try {
    const rows = await repo.list<Row>('plugin_sync', {
      fields: ['id', 'disabled_plugins', 'enabled_plugins', 'plugin_settings'],
      sort: ['id'],
      limit: 1
    });
    const row = rows[0];
    if (row) {
      _rowId = row.id;
      hydrateRuntimeDisabled(row.disabled_plugins ?? []);
      if (row.enabled_plugins != null) hydrateRuntimeEnabled(row.enabled_plugins);
      hydratePluginSettings(row.plugin_settings ?? {});
    }
  } catch {
    /* not signed in / offline / collection absent — keep localStorage */
  }
}

/** Push the current local state to Directus. Fire-and-forget from UI handlers;
 *  localStorage already holds the change, so a failure here only skips the sync. */
export async function savePluginConfig(): Promise<void> {
  const enabled = runtimeEnabledList();
  const patch = {
    disabled_plugins: runtimeDisabledList(),
    plugin_settings: allPluginSettings(),
    // Only sent when in use, so a Directus whose plugin_sync predates the
    // column doesn't reject the whole patch. (Allow-list builds are new; the
    // schema step in scripts/add-plugin-sync.sh adds the column going forward.)
    ...(enabled.length ? { enabled_plugins: enabled } : {})
  };
  try {
    if (_rowId != null) {
      await repo.update('plugin_sync', _rowId, patch);
    } else {
      const created = await repo.create<Row>('plugin_sync', patch);
      _rowId = created.id;
    }
  } catch {
    /* offline / no collection / no permission — localStorage still has it */
  }
}
