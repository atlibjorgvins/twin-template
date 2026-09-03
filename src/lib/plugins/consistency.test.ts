// Guards the feature-gating invariants across the registry, the nav, and the
// tools catalogue — the drift classes the phase-4 survey found, so they cannot
// come back. Runs in `node --test` because nav.ts/catalogue.ts type-only $lib
// imports are erased, leaving pure data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_KEYS, ROUTE_FEATURES } from './registry.ts';
import { NAV_TABS } from '../nav.ts';
import { TOOL_GROUPS } from '../tools/catalogue.ts';

const keys = new Set<string>(FEATURE_KEYS);

/** The owning plugin of a path, longest-prefix wins — mirrors featureForPath. */
function ownerOf(href: string): string | null {
  let best: readonly [string, string] | null = null;
  for (const entry of ROUTE_FEATURES) {
    const [prefix] = entry;
    if (href === prefix || href.startsWith(prefix + '/')) {
      if (!best || prefix.length > best[0].length) best = entry;
    }
  }
  return best ? best[1] : null;
}

test('every nav/tile feature-gate names a real plugin', () => {
  for (const t of NAV_TABS) {
    if (t.feature) assert.ok(keys.has(t.feature), `nav ${t.href} → unknown feature ${t.feature}`);
  }
  for (const g of TOOL_GROUPS) {
    for (const r of g.rows) {
      if (r.feature) assert.ok(keys.has(r.feature), `tile ${r.href} → unknown feature ${r.feature}`);
    }
  }
});

test('a nav tab on a gated route is gated by that route’s plugin', () => {
  // The dead-"Marketing" class: /marketing is a campaigns route, so its nav tab
  // must carry feature:'campaigns' — otherwise disabling campaigns closes the
  // route but leaves a live, dead nav entry.
  for (const t of NAV_TABS) {
    const owner = ownerOf(t.href);
    if (owner) {
      assert.equal(t.feature, owner, `nav ${t.href}: route belongs to '${owner}' but tab.feature='${t.feature}'`);
    }
  }
});

// Plugins gated only by an in-page featureOn() the data can't reveal (family is
// a section on /people/[id], not a route/nav/tile). Any NEW orphan must be added
// here consciously, which is the point.
const INPAGE_GATED = new Set<string>(['family']);

test('every plugin key is actually used somewhere (no orphan gates)', () => {
  const referenced = new Set<string>(INPAGE_GATED);
  for (const [, k] of ROUTE_FEATURES) referenced.add(k);
  for (const t of NAV_TABS) if (t.feature) referenced.add(t.feature);
  for (const g of TOOL_GROUPS) for (const r of g.rows) if (r.feature) referenced.add(r.feature);
  for (const k of FEATURE_KEYS) {
    assert.ok(referenced.has(k), `plugin '${k}' gates nothing — no route, nav, tile, or in-page use`);
  }
});
