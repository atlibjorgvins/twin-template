// Compatibility shim. The family plugin's data moved to
// $lib/plugins/family/data.ts (docs/phase4-plugins.md §5). Re-exported here so
// existing imports (including directus.ts's re-export) keep resolving.
export * from '$lib/plugins/family/data';
