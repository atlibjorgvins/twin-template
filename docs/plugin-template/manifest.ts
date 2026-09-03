// Plugin template — manifest.
//
// Copy this directory to src/lib/plugins/<your-id>/ and register the export in
// src/lib/plugins/registry.ts (add it to the PLUGINS array). See
// docs/plugin-authoring.md.
import type { PluginManifest } from '$lib/plugins/types';

export const example: PluginManifest = {
  // Stable id. Also the deny-list key (PUBLIC_DISABLED_FEATURES) and the
  // FeatureKey the route guard uses. Lowercase, kebab-case.
  id: 'example',

  // Human label shown on the Settings → Plugins page.
  label: 'Example',

  // Grouping on the Plugins page. Reuse an existing one where it fits: 'People &
  // CRM', 'Productivity', 'Finance', 'Marketing & media', 'Utilities', 'System'.
  category: 'Utilities',

  // 'public' ships to anyone; 'private' is only in builds that include it
  // (e.g. an org's internal tooling).
  tier: 'public',

  // Route prefixes this plugin owns. The guard redirects these away when the
  // plugin is off, and ROUTE_FEATURES is derived from this. Omit if the plugin
  // is only an in-page section (like `family`) or a static asset (like `typing`).
  routes: ['/tools/example'],

  // Directus collections this plugin owns — for the docs surface + the schema
  // step. Omit if it stores nothing.
  collections: ['example_row'],

  // What it reads: the contacts core, or another plugin by id.
  dependsOn: ['contacts'],

  // Optional: full settings page(s) the detail view links to.
  // settingsLinks: [{ label: 'Options', href: '/settings/example' }],

  // Optional: inline per-device settings, rendered as a form on the detail page.
  // Read them with getPluginSetting('example', <key>, <default>) from
  // '$lib/plugins/settings'. See docs/plugin-authoring.md §4b.
  settings: [
    {
      key: 'compact',
      label: 'Compact view',
      type: 'toggle',
      default: false,
      description: 'Show the list densely.'
    }
  ]
};
