// The set of plugin ids. A leaf module (no imports) so both instance.ts and
// the plugin registry can depend on it without a cycle.
//
// Historically these were "feature keys" hand-listed in instance.ts. They are
// the ids of the build-time plugins — see docs/phase4-plugins.md. The union is
// kept hand-written and asserted against the registry (plugins/registry.test.ts)
// so a manifest and this type can never silently disagree.
export type FeatureKey =
  | 'habits'
  | 'food'
  | 'finances'
  | 'receipts'
  | 'family'
  | 'ai-vault'
  | 'games'
  | 'focus'
  | 'grants'
  | 'photos'
  | 'studio'
  | 'campaigns'
  | 'evergreen'
  | 'brand-book'
  | 'prompts'
  | 'suggested-data'
  | 'typing'
  | 'display'
  | 'kiosk'
  | 'clockify'
  | 'wordpress'
  | 'news'
  | 'asana'
  // Workspace modules — route-only plugins for now (their code still lives in
  // core), registered so a strip build (PUBLIC_ENABLED_FEATURES=core) can
  // close them. Full extraction per docs/phase4-plugins.md comes later; the
  // roadmap's core is People + Organizations only.
  | 'notes'
  | 'projects'
  | 'events'
  | 'insights'
  | 'tasks'
  | 'interactions'
  | 'calendar';
