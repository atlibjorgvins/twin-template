// The plugin registry — the single source of truth for which build-time plugins
// exist and what routes they own. FEATURE_KEYS and ROUTE_FEATURES are DERIVED
// from it (instance.ts re-exports them), replacing the two hand-kept lists that
// could disagree. See docs/phase4-plugins.md.
//
// Ordered to match the historical FEATURE_KEYS order so the derived list is
// byte-identical (disabledFeatures() renders in this order). ROUTE_FEATURES is
// order-independent — featureForPath() picks the longest matching prefix.
import type { PluginManifest } from './types';
import type { FeatureKey } from './keys';
import { family } from './family/manifest.ts';
import { habits } from './habits/manifest.ts';
import { games } from './games/manifest.ts';

export const PLUGINS: readonly PluginManifest[] = [
  habits,
  {
    id: 'food',
    category: 'Productivity',
    label: 'Food orders',
    description: 'Log and track food orders — what was ordered, for whom, and when.',
    tier: 'public',
    routes: ['/tools/food']
  },
  {
    id: 'finances',
    category: 'Finance',
    label: 'Finances',
    description:
      'Personal finances: import bank statements, categorize transactions, budgets, and a shared-expense balance.',
    tier: 'public',
    routes: ['/tools/finances']
  },
  {
    id: 'receipts',
    category: 'Finance',
    label: 'Receipts',
    description: 'Capture receipt photos, OCR them, and attribute each to a project or organization.',
    tier: 'public',
    routes: ['/tools/receipts']
  },
  family,
  // ai-vault's UI is /settings/ai (+ /settings/ai/usage). Gating that route is
  // the real switch — before phase 4 the key existed but gated nothing, so a
  // build that disabled ai-vault could still reach the vault UI. The prefix also
  // covers /settings/ai/usage.
  {
    id: 'ai-vault',
    category: 'System',
    label: 'AI vault',
    description: 'Encrypted store for provider API keys, plus per-task model routing and usage tracking.',
    tier: 'public',
    routes: ['/settings/ai'],
    settingsLinks: [
      { label: 'Keys & tasks', href: '/settings/ai' },
      { label: 'Usage', href: '/settings/ai/usage' }
    ]
  },
  games,
  {
    id: 'focus',
    category: 'Productivity',
    label: 'Focus',
    description: 'A focus queue and timer for what you are actively working on, with time pushed to Clockify.',
    tier: 'public',
    routes: ['/tools/focus']
  },
  {
    id: 'grants',
    category: 'People & CRM',
    label: 'Grants',
    description: 'Grant programmes, awards, and payout schedules linked to organizations and people.',
    tier: 'private',
    routes: ['/grants']
  },
  {
    id: 'photos',
    category: 'Marketing & media',
    label: 'Photos',
    description: 'Browse and tag the photo library, matching faces to people and linking shots to orgs and events.',
    tier: 'public',
    routes: ['/photos'],
    settingsLinks: [{ label: 'Photo types', href: '/settings/photo-types' }]
  },
  {
    id: 'studio',
    category: 'Marketing & media',
    label: 'Studio',
    description: 'Image studio — crop, set focal points, and render brand-templated graphics from your assets.',
    tier: 'public',
    routes: ['/tools/studio']
  },
  {
    id: 'campaigns',
    category: 'Marketing & media',
    label: 'Marketing',
    description: 'Umbrella + Meta campaigns, ad spend, and a portfolio dashboard blending Meta with manual spend.',
    tier: 'private',
    routes: ['/tools/campaigns', '/marketing'],
    settingsLinks: [{ label: 'Meta (publishing + ad reports)', href: '/settings/meta' }]
  },
  {
    id: 'evergreen',
    category: 'Marketing & media',
    label: 'Evergreen',
    description: 'Plan and preview an evergreen social post queue across identities and Buffer channels.',
    tier: 'private',
    routes: ['/tools/evergreen'],
    settingsLinks: [
      { label: 'Buffer channels', href: '/settings/buffer' },
      { label: 'Posting identities', href: '/settings/posting-identities' }
    ]
  },
  {
    id: 'brand-book',
    category: 'Marketing & media',
    label: 'Brand book',
    description: 'Per-project brand assets — logos, fonts, colours — resolved for the studio and previews.',
    tier: 'private',
    routes: ['/tools/brand-book', '/brand-book']
  },
  {
    id: 'prompts',
    category: 'Productivity',
    label: 'Prompts',
    description: 'A reusable prompt library, tagged and linked to projects.',
    tier: 'public',
    routes: ['/tools/prompts']
  },
  {
    id: 'suggested-data',
    category: 'People & CRM',
    label: 'Suggested data',
    description: 'Surfaces enrichment suggestions — likely org links and missing fields — for you to accept.',
    tier: 'public',
    routes: ['/tools/suggested-data']
  },
  // typing: a static app under static/typing/, served by nginx directly. The
  // SvelteKit route guard cannot intercept it, so it has NO `routes` on purpose
  // — its only meaningful gate is the tools-page tile (featureOn('typing')).
  {
    id: 'typing',
    category: 'Utilities',
    label: 'Typing tutor',
    description: 'A standalone typing-practice app served alongside the Hub.',
    tier: 'public'
  },
  {
    id: 'display',
    category: 'Utilities',
    label: 'Display',
    description: 'A large-format display view for wall tablets and shared screens.',
    tier: 'public',
    routes: ['/display']
  },
  {
    id: 'kiosk',
    category: 'Utilities',
    label: 'Kiosk',
    description: 'A locked-down kiosk mode for a single event or surface.',
    tier: 'public',
    routes: ['/kiosk']
  },
  // Integrations — each wraps an outside service. Its only route is the settings
  // page that configures it (gated here), so disabling one closes its settings.
  // Action surfaces (WordPress publish button, Clockify time-push, Asana import,
  // the News section) still run — surface-gating those on featureOn is a follow-up.
  {
    id: 'clockify',
    category: 'Integrations',
    label: 'Clockify',
    description: 'Time tracking — twin keeps the clock; finished stretches push to Clockify as entries.',
    tier: 'public',
    routes: ['/settings/clockify'],
    settingsLinks: [{ label: 'Clockify', href: '/settings/clockify' }]
  },
  {
    id: 'wordpress',
    category: 'Integrations',
    label: 'WordPress',
    description: 'Publish events to a WordPress site; twin keeps the post id per event so it never duplicates.',
    tier: 'public',
    routes: ['/settings/wordpress'],
    settingsLinks: [{ label: 'WordPress', href: '/settings/wordpress' }]
  },
  {
    id: 'news',
    category: 'Integrations',
    label: 'News',
    description: 'Icelandic press monitoring from the frettir stack, surfaced on records.',
    tier: 'public',
    routes: ['/news', '/settings/news'],
    settingsLinks: [{ label: 'News', href: '/settings/news' }]
  },
  {
    id: 'asana',
    category: 'Integrations',
    label: 'Asana',
    description: 'Two-way Asana project mapping and task push-back.',
    tier: 'public',
    routes: ['/settings/asana'],
    settingsLinks: [{ label: 'Asana', href: '/settings/asana' }]
  },
  // Workspace modules — the routes core carried before the plugin system
  // existed. Registered as ROUTE-ONLY plugins: their code has not moved yet
  // (full extraction is the phase-4 tail), but registering them makes the
  // roadmap's actual core — People + Organizations — enforceable: a strip
  // build (PUBLIC_ENABLED_FEATURES=core) closes these routes and nav entries
  // like any other plugin, and a future plugin is off in that build by
  // default instead of leaking in.
  {
    id: 'notes',
    category: 'Workspace',
    label: 'Notes',
    description: 'Notes with follow-ups, attachable to people, orgs, and projects.',
    tier: 'public',
    routes: ['/notes'],
    dependsOn: ['contacts']
  },
  {
    id: 'projects',
    category: 'Workspace',
    label: 'Projects',
    description: 'Projects with members, roles, and inheritance across the graph.',
    tier: 'public',
    routes: ['/projects'],
    dependsOn: ['contacts']
  },
  {
    id: 'events',
    category: 'Workspace',
    label: 'Events',
    description: 'Events with attendees, conferencing cards, and publishing.',
    tier: 'public',
    routes: ['/events'],
    dependsOn: ['contacts']
  },
  {
    id: 'insights',
    category: 'Workspace',
    label: 'Insights',
    description: 'Cross-graph metrics and dashboards.',
    tier: 'public',
    routes: ['/insights'],
    dependsOn: ['contacts']
  },
  {
    id: 'tasks',
    category: 'Workspace',
    label: 'Tasks',
    description: 'Task list with closing flow and focus hand-off.',
    tier: 'public',
    routes: ['/tasks'],
    dependsOn: ['contacts']
  },
  {
    id: 'interactions',
    category: 'Workspace',
    label: 'Interactions',
    description: 'The activity log — meetings, calls, and moments on any record.',
    tier: 'public',
    routes: ['/interactions'],
    dependsOn: ['contacts']
  },
  {
    id: 'calendar',
    category: 'Workspace',
    label: 'Calendar',
    description: 'Month grid with recurring dates, birthdays, and holidays.',
    tier: 'public',
    routes: ['/calendar'],
    dependsOn: ['contacts']
  }
];

/** Every plugin id — the deny-list vocabulary. Derived; was hand-kept. */
export const FEATURE_KEYS: readonly FeatureKey[] = PLUGINS.map((p) => p.id);

/** [routePrefix, owningPlugin] — derived from each manifest's `routes`. */
export const ROUTE_FEATURES: ReadonlyArray<readonly [string, FeatureKey]> = PLUGINS.flatMap(
  (p) => (p.routes ?? []).map((r) => [r, p.id] as const)
);

/** Look a plugin up by id (for the settings surface, docs, etc.). */
export function pluginById(id: FeatureKey): PluginManifest | undefined {
  return PLUGINS.find((p) => p.id === id);
}
