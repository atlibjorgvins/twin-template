// The tools-landing catalogue, as data.
//
// Pulled out of routes/tools/+page.svelte so the tiles are one importable,
// testable list. The page still owns rendering, search, and the scope/feature
// filtering; the optional News tile stays there because it depends on runtime
// config (newsConfigured()). A consistency test (plugins/consistency.test.ts)
// checks every tile's feature-gate against the plugin registry.
//
// $lib imports are type-only (erased), so this stays node-loadable.
import type { IconName } from '$lib/icon-types';
import type { SurfaceScope } from '$lib/scope';
import type { FeatureKey } from '$lib/instance';

export type Row = {
  href: string;
  icon: IconName;
  title: string;
  desc: string;
  /** Standalone static app (lives in /static), not a SvelteKit route —
   *  needs a full-page load so the router doesn't 404 on it. */
  reload?: boolean;
  /** The plugin this tool belongs to. A build without it has no tile and,
   *  via +layout.ts, no route either. Omit for tools every twin gets. */
  feature?: FeatureKey;
};

/** `scope` opts the whole group into a single mode; omit = shown in both. */
export type Group = { label: string; rows: Row[]; scope?: SurfaceScope };

export const TOOL_GROUPS: Group[] = [
  {
    label: 'Money',
    scope: 'private',
    rows: [
      {
        href: '/tools/finances',
        feature: 'finances',
        icon: 'wallet',
        title: 'Personal finances',
        desc: 'Import bank statements (deduped), categorize spending, log manual + recurring entries, and track shared expenses to settle with your ex.'
      },
      {
        href: '/tools/receipts',
        feature: 'receipts',
        icon: 'receipt',
        title: 'Receipts',
        desc: 'Every photographed receipt — OCR fills the amount, merchant and date on the NAS, then you correct anything wrong, link it to a bank transaction, and attribute it to an organization or project.'
      }
    ]
  },
  {
    label: 'Day',
    rows: [
      {
        href: '/tools/focus',
        feature: 'focus',
        icon: 'bolt',
        title: 'Actively working on',
        desc: 'Your manual task queue — start one to run its timer, stop it or move to the next. The active task shows on Today, with project links + notes.'
      },
      {
        href: '/tools/time',
        icon: 'clock',
        title: 'Time',
        desc: 'Every tracked stretch as a list or a week calendar — what it was, which Clockify project it lands on and why, and a per-stretch project you can reassign before pushing.'
      },
      {
        href: '/tools/food',
        feature: 'food',
        icon: 'utensils',
        title: 'Food orders',
        desc: 'Upload or paste the canteen order screenshot — the NAS reads it, you confirm the parse, and each day’s meal shows on Today.'
      },
      {
        href: '/tools/habits',
        feature: 'habits',
        icon: 'check',
        title: 'Habits',
        desc: 'Dated history for every habit — 10-week dot grid, current and best streak, days hit. Log from the Today card; edit and look back here.'
      },
      {
        href: '/display',
        feature: 'display',
        icon: 'clock',
        title: 'Wall display',
        desc: 'Always-on view for a tablet on a shelf — clock, weather, what is next and the week ahead, in type you can read across a room. Refreshes itself and holds a wake lock; no app chrome.'
      },
      {
        href: '/timer',
        icon: 'clock',
        title: 'Countdown timer',
        desc: '60-second countdown in a fullscreen ring. Tap the face to start, pause, reset.'
      },
      {
        href: '/schedule-timer',
        icon: 'clock',
        title: 'Schedule timer',
        desc: 'Live paste-driven schedule clock for back-to-back time-boxes — mentoring rounds, lectures with breaks, panel slots.'
      }
    ]
  },
  {
    label: 'Work',
    scope: 'work',
    rows: [
      {
        href: '/tools/brand-book',
        feature: 'brand-book',
        icon: 'sparkles',
        title: 'Brand book',
        desc: 'Every brand in one place — logo variants on the right backgrounds, colours with computed contrast ratios, a type specimen and the usage rules. Resolved live, so it cannot go stale like an exported PDF.'
      },
      {
        href: '/tools/studio',
        feature: 'studio',
        icon: 'image',
        title: 'Image studio',
        desc: 'Layered image templates — crop record photos, add PNG overlays and {token} text, batch-render new assets into Directus.'
      },
      {
        href: '/marketing',
        feature: 'campaigns',
        icon: 'flag',
        title: 'Marketing',
        desc: 'Campaigns, budgets and every krona of spend — Meta and offline in one ledger. Deep reporting lives on the programme dashboard.'
      },
      {
        href: '/tools/evergreen',
        feature: 'evergreen',
        icon: 'sparkles',
        title: 'Evergreen machine',
        desc: 'Turn teams, people and projects into rotating social posts — filters, {token} templates, copyable briefs. Posting stays in Claude.'
      },
      {
        href: '/tools/suggested-data',
        feature: 'suggested-data',
        icon: 'sparkles',
        title: 'Suggested data',
        desc: 'Review web-search recommendations for org websites, social handles and logos. Accept to apply, reject to dismiss.'
      }
    ]
  },
  {
    label: 'Learn',
    rows: [
      {
        href: '/tools/prompts',
        feature: 'prompts',
        icon: 'command',
        title: 'Prompt library',
        desc: 'Reusable prompts with a purpose bio — tag by purpose, link to projects & systems, copy in one tap ({tokens} fill in).'
      },
      {
        href: '/typing/',
        feature: 'typing',
        icon: 'graduation-cap',
        title: 'Hraðritun — typing trainer',
        desc: 'Icelandic touch-typing drills with easy/medium/hard prompts. Standalone practice app.',
        reload: true
      }
    ]
  },
  {
    label: 'Play',
    scope: 'private',
    rows: [
      {
        href: '/tools/scorekeeper',
        feature: 'games',
        icon: 'users',
        title: 'Scorekeeper',
        desc: 'Live round-by-round score columns for card games — add players, score each round, and inspect total history.'
      },
      {
        href: '/tools/dice',
        feature: 'games',
        icon: 'gift',
        title: 'Dice throw',
        desc: 'Throw one or two dice, see the total, and keep a short throw history.'
      },
      {
        href: '/tools/coin-flip',
        feature: 'games',
        icon: 'wallet',
        title: 'Coin flip',
        desc: 'Flip an Icelandic coin with random front/back outcomes and a short recent-flips trail.'
      }
    ]
  }
];
