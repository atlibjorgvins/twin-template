// The registry is a refactor, not a behaviour change: FEATURE_KEYS and
// ROUTE_FEATURES are now derived from the manifests, and must equal the lists
// that were hand-kept in instance.ts before phase 4. These snapshots are those
// exact lists; if a manifest edit changes them, this test makes it deliberate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_KEYS, ROUTE_FEATURES } from './registry.ts';

// The keys, in registry order (disabledFeatures() renders in it). The last four
// are the integration plugins — Clockify, WordPress, News, Asana were settings
// pages before; they are first-class plugins now (each gated by its settings
// route; news also owns /news).
const EXPECTED_KEYS = [
  'habits', 'food', 'finances', 'receipts', 'family', 'ai-vault', 'games',
  'focus', 'grants', 'photos', 'studio', 'campaigns', 'evergreen',
  'brand-book', 'prompts', 'suggested-data', 'typing', 'display', 'kiosk',
  'clockify', 'wordpress', 'news', 'asana',
  // Workspace modules, registered as route-only plugins so the strip build
  // (PUBLIC_ENABLED_FEATURES=core) can close them — code not yet extracted.
  'notes', 'projects', 'events', 'insights', 'tasks', 'interactions', 'calendar'
];

// The route→feature pairs (order-free: featureForPath picks the longest
// matching prefix). This is the historical instance.ts list PLUS the phase-4
// drift-bug fixes, which are the two deliberate diffs from the old list:
//   + ['/settings/ai', 'ai-vault']  — was ungated; now gates the vault UI
//   − ['/tools/wheel', 'games']     — route never existed; removed
const EXPECTED_ROUTES = [
  ['/tools/habits', 'habits'],
  ['/tools/food', 'food'],
  ['/tools/finances', 'finances'],
  ['/tools/receipts', 'receipts'],
  ['/settings/ai', 'ai-vault'],
  ['/tools/focus', 'focus'],
  ['/tools/studio', 'studio'],
  ['/tools/campaigns', 'campaigns'],
  ['/marketing', 'campaigns'],
  ['/tools/evergreen', 'evergreen'],
  ['/tools/brand-book', 'brand-book'],
  ['/brand-book', 'brand-book'],
  ['/tools/prompts', 'prompts'],
  ['/tools/suggested-data', 'suggested-data'],
  ['/tools/dice', 'games'],
  ['/tools/coin-flip', 'games'],
  ['/tools/scorekeeper', 'games'],
  ['/grants', 'grants'],
  ['/photos', 'photos'],
  ['/display', 'display'],
  ['/kiosk', 'kiosk'],
  // Integration plugins — each gated by its settings route (news also owns /news).
  ['/settings/clockify', 'clockify'],
  ['/settings/wordpress', 'wordpress'],
  ['/news', 'news'],
  ['/settings/news', 'news'],
  ['/settings/asana', 'asana'],
  // Workspace route-only plugins (strip-build gating; code still in core).
  ['/notes', 'notes'],
  ['/projects', 'projects'],
  ['/events', 'events'],
  ['/insights', 'insights'],
  ['/tasks', 'tasks'],
  ['/interactions', 'interactions'],
  ['/calendar', 'calendar']
];

const norm = (pairs: ReadonlyArray<readonly string[]>): string[] =>
  [...pairs.map((p) => `${p[0]}=${p[1]}`)].sort();

test('FEATURE_KEYS is derived identically to the historical hand-kept list', () => {
  assert.deepEqual([...FEATURE_KEYS], EXPECTED_KEYS);
});

test('ROUTE_FEATURES covers exactly the historical route→feature pairs', () => {
  assert.deepEqual(norm(ROUTE_FEATURES), norm(EXPECTED_ROUTES));
});

test('every route maps to a known feature key', () => {
  for (const [, key] of ROUTE_FEATURES) {
    assert.ok(EXPECTED_KEYS.includes(key), `unknown feature key: ${key}`);
  }
});
