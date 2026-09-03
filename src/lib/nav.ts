// The primary navigation destinations, as data.
//
// Pulled out of +layout.svelte so it is one importable, testable list rather
// than an array buried in a component. The layout still owns all rendering and
// the scope/feature filtering; this is only the data. A consistency test
// (plugins/consistency.test.ts) checks the feature-gates here against the plugin
// registry, so a plugin route can never again be reachable through an ungated
// nav entry (the dead "Marketing" tab bug).
//
// $lib imports are type-only (erased at build), so this module stays free of
// runtime coupling and is loadable by a plain node test.
import type { IconName } from '$lib/icon-types';
import type { SurfaceScope } from '$lib/scope';
import type { FeatureKey } from '$lib/instance';

export type Tab = {
  href: string;
  label: string;
  icon: IconName;
  scope?: SurfaceScope;
  /** Build-time plugin this destination belongs to; omit for core. */
  feature?: FeatureKey;
};

export const NAV_TABS: Tab[] = [
  { href: '/', label: 'Today', icon: 'home' },
  { href: '/capture', label: 'Capture', icon: 'bolt' },
  { href: '/notes', label: 'Notes', icon: 'notebook', feature: 'notes' },
  { href: '/people', label: 'People', icon: 'users' },
  { href: '/orgs', label: 'Organization', icon: 'building', scope: 'work' },
  { href: '/projects', label: 'Projects', icon: 'sparkles', feature: 'projects' },
  { href: '/events', label: 'Events', icon: 'flag', scope: 'work', feature: 'events' },
  { href: '/grants', label: 'Grants', icon: 'gift', scope: 'work', feature: 'grants' },
  { href: '/insights', label: 'Insights', icon: 'chart-bar', scope: 'work', feature: 'insights' },
  { href: '/marketing', label: 'Marketing', icon: 'wallet', scope: 'work', feature: 'campaigns' },
  { href: '/tasks', label: 'Tasks', icon: 'list-checks', feature: 'tasks' },
  { href: '/interactions', label: 'Interactions', icon: 'bolt', feature: 'interactions' },
  { href: '/calendar', label: 'Calendar', icon: 'calendar', feature: 'calendar' },
  { href: '/photos', label: 'Photos', icon: 'image', feature: 'photos' }
];
