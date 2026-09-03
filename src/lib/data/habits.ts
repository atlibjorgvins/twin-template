// Compatibility shim — the habits plugin's data moved to
// $lib/plugins/habits/data.ts (docs/phase4-plugins.md). Re-exported so existing
// imports (directus.ts's re-export, schema.ts's types) keep resolving.
export * from '$lib/plugins/habits/data';
