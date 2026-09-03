// Single source of truth for the quick-action highlights:
//   - the HIGHLIGHTS catalogue
//   - the currently-open sheet id
//   - open / close / pickFromMenu handlers
//
// Module-scope `$state` (Svelte 5) so any component can import the
// same reactive value without context plumbing — `QuickActions.svelte`
// renders the sheets, the dashboard's `HighlightsRow` and the mobile
// bottom-nav FAB all call the helpers below.
//
// File ends in `.svelte.ts` so the Svelte 5 compiler runs the `$state`
// rune transform here.
import type { IconName } from './icon-types';

export type QuickActionItem = {
  key: string;
  label: string;
  icon: IconName;
  /** Plugin this action creates rows for; omit for core (people/orgs). */
  feature?: import('$lib/plugins/keys').FeatureKey;
};

/** Canonical catalogue. Change here, everything that displays the
 *  highlights (dashboard row, mobile FAB menu) updates. Consumers filter by
 *  `feature` with featureOn() at render time — a strip build must not offer
 *  a quick action whose module it closed (the sheet would write rows no page
 *  can ever show). */
export const HIGHLIGHTS: QuickActionItem[] = [
  { key: 'capture',  label: 'Capture',  icon: 'bolt' },
  { key: 'interact', label: 'Log',      icon: 'sparkles', feature: 'interactions' },
  { key: 'receipt',  label: 'Receipt',  icon: 'receipt',  feature: 'receipts' },
  { key: 'prompt',   label: 'Prompt',   icon: 'command',  feature: 'prompts' },
  { key: 'event',    label: 'Event',    icon: 'calendar', feature: 'events' },
  { key: 'person',   label: 'Person',   icon: 'users' },
  { key: 'org',      label: 'Org',      icon: 'building' },
  { key: 'project',  label: 'Project',  icon: 'tag',      feature: 'projects' }
];

/** The catalogue filtered to what this build + device actually has.
 *  A function (not a constant) so featureOn's device toggles are read at
 *  call time, after plugin-config hydration. */
export function activeHighlights(featureOn: (k: NonNullable<QuickActionItem['feature']>) => boolean): QuickActionItem[] {
  return HIGHLIGHTS.filter((h) => !h.feature || featureOn(h.feature));
}

// Reactive container — components read `quickActions.sheet` directly.
export const quickActions = $state<{ sheet: string | null }>({ sheet: null });

export function openSheet(key: string) { quickActions.sheet = key; }
export function closeSheet() { quickActions.sheet = null; }
/** Used by the FAB menu: close itself so the slide-down plays, then
 *  open the picked detail sheet on the next tick. */
export function pickFromMenu(key: string) {
  quickActions.sheet = null;
  setTimeout(() => { quickActions.sheet = key; }, 220);
}
