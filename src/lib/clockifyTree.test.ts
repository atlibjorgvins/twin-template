// Run with:  npm run test:clockify-tree
//
// The real module, imported directly — clockifyTree.ts has no imports, so bare
// node can run it. What is tested here is who gets billed to what: a wrong
// answer sends hours to the wrong client's project, which is worse than sending
// them nowhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  indexById,
  nearestMapped,
  inheritorsOf,
  coveredCount,
  redundantMappings,
  fallbackMapping,
  resolveForPush,
  parentIdOf,
  type ProjectNode
} from './clockifyTree.ts';

// Shaped after the real tree: 8 roots, children 3 deep, one Clockify project
// standing in for a whole family.
const TREE: ProjectNode[] = [
  { id: 1, name: 'Gulleggið', parent_id: null, clockify_project_id: 'CL-GULL' },
  { id: 2, name: 'Gulleggið 2026', parent_id: 1 },
  { id: 3, name: 'Gulleggið 2026 — dómnefnd', parent_id: 2 },
  { id: 4, name: 'Gulleggið 2025', parent_id: 1, clockify_project_id: 'CL-GULL-25' },
  { id: 5, name: 'Gulleggið 2025 — úrslit', parent_id: 4 },
  { id: 6, name: 'KLAK', parent_id: null },
  { id: 7, name: 'Innra starf', parent_id: 6 }
];
const byId = indexById(TREE);

// ── inheritance ───────────────────────────────────────────────────────
test('a project with its own mapping uses it', () => {
  assert.deepEqual(nearestMapped(1, byId), { clockifyId: 'CL-GULL', viaId: 1, inherited: false });
});

test('a child with no mapping inherits its parent', () => {
  // The whole point: map Gulleggið once, and the cohort under it is covered.
  assert.deepEqual(nearestMapped(2, byId), { clockifyId: 'CL-GULL', viaId: 1, inherited: true });
});

test('inheritance reaches a grandchild', () => {
  assert.deepEqual(nearestMapped(3, byId), { clockifyId: 'CL-GULL', viaId: 1, inherited: true });
});

test('a descendant with its own mapping overrides the parent', () => {
  // Without this, a sub-project that genuinely has its own Clockify project
  // could never be split back out once the parent was mapped.
  assert.equal(nearestMapped(4, byId)?.clockifyId, 'CL-GULL-25');
});

test('the override applies to that subtree, not the whole tree', () => {
  assert.equal(nearestMapped(5, byId)?.clockifyId, 'CL-GULL-25');
  assert.equal(nearestMapped(3, byId)?.clockifyId, 'CL-GULL');
});

test('nothing mapped anywhere up the chain resolves to null', () => {
  // Must stay null rather than guessing: an entry with no project is
  // recoverable in Clockify, an entry on the wrong project is not.
  assert.equal(nearestMapped(7, byId), null);
  assert.equal(nearestMapped(6, byId), null);
});

test('an unknown project id resolves to null instead of throwing', () => {
  assert.equal(nearestMapped(999, byId), null);
  assert.equal(nearestMapped(null, byId), null);
  assert.equal(nearestMapped(undefined, byId), null);
});

test('a parent cycle terminates', () => {
  // parent_id is editable in the Directus admin, so a loop is reachable by
  // hand. This runs on the page that pushes time; it must not hang.
  const loop = indexById([
    { id: 10, parent_id: 11 },
    { id: 11, parent_id: 10 }
  ]);
  assert.equal(nearestMapped(10, loop), null);
});

test('a cycle still finds a mapping that is inside it', () => {
  const loop = indexById([
    { id: 10, parent_id: 11 },
    { id: 11, parent_id: 10, clockify_project_id: 'CL-X' }
  ]);
  assert.equal(nearestMapped(10, loop)?.clockifyId, 'CL-X');
});

test('parent_id is read whether Directus expands it or not', () => {
  // readItems returns an id for a plain field list and an object when the
  // relation is expanded; both shapes occur in this codebase.
  assert.equal(parentIdOf({ id: 1, parent_id: 4 }), 4);
  assert.equal(parentIdOf({ id: 1, parent_id: { id: 4 } }), 4);
  assert.equal(parentIdOf({ id: 1, parent_id: null }), null);
  assert.equal(parentIdOf(undefined), null);
});

// ── what a mapping covers ─────────────────────────────────────────────
test('a mapping reports the projects it actually covers', () => {
  // 2 and 3 inherit from Gulleggið. 4 and 5 do not — 4 overrides.
  assert.deepEqual(
    inheritorsOf(1, TREE).map((p) => p.id),
    [2, 3]
  );
});

test('an overriding mapping reports its own subtree', () => {
  assert.deepEqual(
    inheritorsOf(4, TREE).map((p) => p.id),
    [5]
  );
});

test('a project is never counted as inheriting from itself', () => {
  assert.equal(
    inheritorsOf(1, TREE).some((p) => p.id === 1),
    false
  );
});

// ── the catch-all ─────────────────────────────────────────────────────
test('work with no project at all lands on the flagged fallback', () => {
  // The common case by far: most focus tasks carry no project, and Clockify
  // refuses an entry without one. Without this they never push.
  const nodes: ProjectNode[] = [
    ...TREE,
    { id: 8, name: 'Innra starf', parent_id: null, clockify_project_id: 'CL-INNRA', clockify_fallback: true }
  ];
  assert.equal(resolveForPush(null, nodes)?.clockifyId, 'CL-INNRA');
  assert.equal(resolveForPush(7, nodes)?.clockifyId, 'CL-INNRA');
});

test('a real mapping always beats the fallback', () => {
  const nodes: ProjectNode[] = [
    ...TREE,
    { id: 8, parent_id: null, clockify_project_id: 'CL-INNRA', clockify_fallback: true }
  ];
  assert.equal(resolveForPush(2, nodes)?.clockifyId, 'CL-GULL');
});

test('no fallback flagged means unmapped work still resolves to nothing', () => {
  // Must not invent a destination: hours on the wrong project are worse than
  // hours that visibly failed to push.
  assert.equal(resolveForPush(7, TREE), null);
  assert.equal(fallbackMapping(TREE), null);
});

test('a fallback that maps nowhere is not treated as a fallback', () => {
  const nodes: ProjectNode[] = [{ id: 8, parent_id: null, clockify_fallback: true }];
  assert.equal(fallbackMapping(nodes), null);
  assert.equal(resolveForPush(null, nodes), null);
});

test('the fallback may inherit its own mapping from a parent', () => {
  const nodes: ProjectNode[] = [
    { id: 1, parent_id: null, clockify_project_id: 'CL-GULL' },
    { id: 2, parent_id: 1, clockify_fallback: true }
  ];
  assert.equal(fallbackMapping(nodes)?.clockifyId, 'CL-GULL');
});

// ── redundant mappings ────────────────────────────────────────────────
test('a child mapped to what it would inherit anyway is redundant', () => {
  // The residue of mapping by hand: clearing it changes nothing today, and
  // stops the child pinning itself when the parent is re-pointed later.
  const nodes: ProjectNode[] = [
    { id: 1, parent_id: null, clockify_project_id: 'CL-GULL' },
    { id: 2, parent_id: 1, clockify_project_id: 'CL-GULL' }
  ];
  assert.deepEqual(
    redundantMappings(nodes).map((p) => p.id),
    [2]
  );
});

test('a child mapped somewhere else is not redundant', () => {
  const nodes: ProjectNode[] = [
    { id: 1, parent_id: null, clockify_project_id: 'CL-GULL' },
    { id: 2, parent_id: 1, clockify_project_id: 'CL-OTHER' }
  ];
  assert.deepEqual(redundantMappings(nodes), []);
});

test('a mapping with nothing above it is never redundant', () => {
  // Deleting this would drop the subtree's hours on the floor.
  const nodes: ProjectNode[] = [
    { id: 1, parent_id: null },
    { id: 2, parent_id: 1, clockify_project_id: 'CL-GULL' }
  ];
  assert.deepEqual(redundantMappings(nodes), []);
});

test('redundancy is judged against the grandparent too', () => {
  const nodes: ProjectNode[] = [
    { id: 1, parent_id: null, clockify_project_id: 'CL-GULL' },
    { id: 2, parent_id: 1 },
    { id: 3, parent_id: 2, clockify_project_id: 'CL-GULL' }
  ];
  assert.deepEqual(
    redundantMappings(nodes).map((p) => p.id),
    [3]
  );
});

test('clearing every redundant mapping leaves coverage unchanged', () => {
  // The safety property the button depends on.
  const before = coveredCount(TREE);
  const cleared = TREE.map((n) =>
    redundantMappings(TREE).some((r) => r.id === n.id) ? { ...n, clockify_project_id: null } : n
  );
  assert.equal(coveredCount(cleared), before);
});

test('coverage counts everything that resolves, not just what is mapped', () => {
  // 1,2,3,4,5 resolve; 6 and 7 do not. Two mappings covering five projects is
  // the number worth showing — "2 mapped" understates it badly.
  assert.equal(coveredCount(TREE), 5);
});
