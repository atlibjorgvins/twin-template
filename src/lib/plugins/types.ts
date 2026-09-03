// The plugin manifest — one declaration per build-time plugin.
// See docs/phase4-plugins.md. Nav and tile fields are defined here but not yet
// consumed by the layout/tools page (that is a later migration step); the
// registry currently derives FEATURE_KEYS and ROUTE_FEATURES from `id`+`routes`.
import type { FeatureKey } from './keys';

export interface NavEntry {
  label: string;
  href: string;
  icon?: string;
  scope?: 'work' | 'private';
  /** Which nav surfaces show this; default all. */
  surface?: ('rail' | 'menu' | 'bottom')[];
}

export interface TileEntry {
  label: string;
  href: string;
  icon?: string;
  /** Which tools-page group it lands in. */
  group?: string;
  blurb?: string;
}

/** A per-device setting a plugin declares; rendered as a form on its detail
 *  page and persisted in localStorage. The plugin reads it with
 *  getPluginSetting(id, key, default) from '$lib/plugins/settings'. */
export interface PluginSetting {
  /** Key within the plugin's settings namespace. */
  key: string;
  label: string;
  /** Control to render. */
  type: 'toggle' | 'text' | 'number' | 'select';
  /** Optional helper line under the control. */
  description?: string;
  /** Default when the person hasn't set it. Type should match `type`. */
  default?: string | number | boolean;
  /** For type:'select' — the choices. */
  options?: { value: string; label: string }[];
  /** For text/number — input placeholder. */
  placeholder?: string;
}

export interface PluginManifest {
  /** Stable id, also the deny-list key (PUBLIC_DISABLED_FEATURES). */
  id: FeatureKey;
  /** Human label for the settings "what's in this build" surface. */
  label: string;
  /** One or two sentences — what it is, shown on the plugin detail page and in
   *  the installed list. Falls back to the catalogue entry, then the label. */
  description?: string;
  /** Grouping for the Plugins page (e.g. 'Productivity', 'Marketing & media').
   *  Uncategorised plugins fall under 'Other'. */
  category?: string;
  /** Links to the plugin's own settings pages (e.g. ai-vault → Keys, Usage),
   *  shown under "Manage" on the detail page. These used to live scattered on
   *  the main Settings index; a plugin owns them now. Omit if it has none. */
  settingsLinks?: { label: string; href: string }[];
  /** Inline per-device settings, rendered as a form on the detail page. For
   *  small preferences that don't warrant a whole settings route. */
  settings?: PluginSetting[];
  tier: 'public' | 'private';
  /** Route prefixes this plugin owns → generates ROUTE_FEATURES entries. */
  routes?: string[];
  /** Nav entries (not yet consumed — see file header). */
  nav?: NavEntry[];
  /** Tools-page / home tiles (not yet consumed — see file header). */
  tiles?: TileEntry[];
  /** Directus collections the plugin owns — for docs and future migrations. */
  collections?: string[];
  /** Capabilities it reads: the core contacts core, or another named plugin. */
  dependsOn?: ('contacts' | FeatureKey)[];
  /** Whether a deployment may switch it off. Default true. */
  removable?: boolean;
}
