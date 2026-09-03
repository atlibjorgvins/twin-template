// Per-device plugin settings — the store behind a plugin's inline settings form
// (declared as `settings` on its manifest, rendered on the detail page).
//
// Persisted in one localStorage blob, namespaced by plugin id. Per-device on
// purpose, same as the enable toggle — a small preference, no backend. A plugin
// reads its own value with getPluginSetting(id, key, default). Guarded so the
// Node build (no localStorage) never touches it.

const KEY = 'twin.plugins.settings';
type Blob = Record<string, Record<string, unknown>>;

let _cache: Blob | null = null;
function read(): Blob {
  if (_cache) return _cache;
  _cache = {};
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(KEY);
      if (raw) _cache = JSON.parse(raw) as Blob;
    }
  } catch {
    /* private mode / bad JSON — treat as empty */
  }
  return _cache;
}

/** The stored value for (pluginId, key), or `fallback` if unset. */
export function getPluginSetting<T>(pluginId: string, key: string, fallback: T): T {
  const v = read()[pluginId]?.[key];
  return v === undefined || v === null ? fallback : (v as T);
}

/** The whole settings blob, for pushing to cross-device sync. */
export function allPluginSettings(): Blob {
  return read();
}

/** Replace the settings blob from a synced source (Directus), mirrored to
 *  localStorage. Called at load. */
export function hydratePluginSettings(blob: Blob | null | undefined): void {
  _cache = blob ?? {};
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(_cache));
  } catch {
    /* nothing else to try */
  }
}

/** Set (pluginId, key) and persist. */
export function setPluginSetting(pluginId: string, key: string, value: unknown): void {
  const b = read();
  (b[pluginId] ??= {})[key] = value;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* nothing else to try */
  }
}
