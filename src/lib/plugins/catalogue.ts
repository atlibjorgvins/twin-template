// The plugin marketplace — a vetted catalogue of plugins you can add to a build.
//
// This is the DISCOVERY layer for the Settings → Plugins page. It is separate
// from `registry.ts` (which lists plugins actually compiled INTO this build):
//
//   registry.PLUGINS   → what is installed right now (present in the bundle)
//   catalogue.CATALOGUE → what you could install (curated + community)
//
// twin is a static browser SPA (not Electron), so "install" is build-time: you
// add a plugin to your instance and redeploy — there is no runtime code loading
// and therefore no untrusted third-party JS running inside your session. The
// page turns each catalogue entry into copy-paste steps. See
// docs/plugin-authoring.md for how to write one and docs/phase4-plugins.md for
// the manifest contract.

/** A curated marketplace entry. `provides` are the plugin ids it registers,
 *  matched against the installed registry to show an Installed badge. */
export interface CatalogueEntry {
  /** Catalogue slug (unique within this file). */
  id: string;
  name: string;
  /** One or two sentences — what it does and who it is for. */
  description: string;
  /** 'official' ships with twin; 'community' is third-party, vetted. */
  tier: 'official' | 'community';
  author: string;
  /** GitHub (or other) repository — the source of truth for the plugin. */
  repo?: string;
  /** Plugin ids this entry registers, matched against registry.PLUGINS. */
  provides: string[];
  /** Directus collections it needs (so you know what the schema step adds). */
  collections?: string[];
}

// The vetted list. Official entries mirror what already ships (so the page can
// show "Installed" against the registry); community entries are examples that
// demonstrate the add-from-catalogue flow and point at real, inspectable repos.
//
// Keep this curated: an entry here is a statement that the code was looked at.
// Anything unvetted goes through the "Add from GitHub" box instead, which makes
// the you-are-trusting-this-repo step explicit.
export const CATALOGUE: readonly CatalogueEntry[] = [
  {
    id: 'family',
    name: 'Family',
    description:
      'Relationship edges between people — parent, sibling, partner — surfaced as a section on each person. The reference plugin: read it to learn the manifest + data shape.',
    tier: 'official',
    author: 'twin',
    repo: 'https://github.com/atlibjorgvins/twin/tree/main/src/lib/plugins/family',
    provides: ['family'],
    collections: ['Person_family']
  },
  {
    id: 'habits',
    name: 'Habits',
    description:
      'Daily habit tracking with streaks. The first route-owning reference plugin (family has no route of its own).',
    tier: 'official',
    author: 'twin',
    repo: 'https://github.com/atlibjorgvins/twin/tree/main/src/lib/plugins/habits',
    provides: ['habits'],
    collections: ['habit', 'habit_entry']
  },
  {
    id: 'games',
    name: 'Games',
    description: 'Small utilities — dice, coin flip, scorekeeper — for meetings and workshops.',
    tier: 'official',
    author: 'twin',
    provides: ['games']
  },
  {
    id: 'twin-plugin-template',
    name: 'Plugin template',
    description:
      'A copy-me starter repo: a manifest, a data module through the neutral repo, and a route page. Fork it to author your own plugin — see docs/plugin-authoring.md.',
    tier: 'community',
    author: 'twin',
    repo: 'https://github.com/atlibjorgvins/twin-plugin-template',
    provides: ['example']
  }
];
