import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faceFocal, coverWindow, unionBox, type Box } from './faceCrop.ts';

// Fixtures use real face boxes measured off the NAS library.
const PORTRAIT = 4000 / 6000;   // 0.667 — the common phone shot
const SQUARE = 1;
const LANDSCAPE = 5472 / 3648;  // 1.5

test('coverWindow: a square crop of a portrait keeps full width', () => {
  const w = coverWindow(PORTRAIT, SQUARE);
  assert.equal(w.w, 1);
  assert.ok(w.h > 0.66 && w.h < 0.67);   // 0.667 of the height is visible
});

test('coverWindow: a square crop of a landscape keeps full height', () => {
  const w = coverWindow(LANDSCAPE, SQUARE);
  assert.equal(w.h, 1);
  assert.ok(w.w > 0.66 && w.w < 0.67);
});

test('coverWindow: same aspect shows the whole image', () => {
  assert.deepEqual(coverWindow(SQUARE, SQUARE), { w: 1, h: 1 });
});

test('coverWindow: nonsense aspects fall back to the whole image', () => {
  assert.deepEqual(coverWindow(0, 1), { w: 1, h: 1 });
  assert.deepEqual(coverWindow(1, -1), { w: 1, h: 1 });
});

test('unionBox spans every face', () => {
  const u = unionBox([
    { x1: 0.281, y1: 0.191, x2: 0.381, y2: 0.271 },
    { x1: 0.684, y1: 0.245, x2: 0.770, y2: 0.323 }
  ]);
  assert.deepEqual(u, { x1: 0.281, y1: 0.191, x2: 0.770, y2: 0.323 });
});

test('unionBox of nothing is null', () => {
  assert.equal(unionBox([]), null);
});

test('no faces yields centre, flagged as not from faces', () => {
  const f = faceFocal([], PORTRAIT, SQUARE);
  assert.deepEqual({ fx: f.fx, fy: f.fy }, { fx: 0.5, fy: 0.5 });
  assert.equal(f.fromFaces, false);
});

test('faces high in a portrait pull the square crop upward', () => {
  // Real boxes from 44665c17: three heads at y≈0.19–0.32.
  const boxes: Box[] = [
    { x1: 0.463, y1: 0.227, x2: 0.564, y2: 0.321 },
    { x1: 0.281, y1: 0.191, x2: 0.381, y2: 0.271 },
    { x1: 0.684, y1: 0.245, x2: 0.770, y2: 0.323 }
  ];
  const f = faceFocal(boxes, PORTRAIT, SQUARE);
  assert.equal(f.fromFaces, true);
  // Centre would be 0.5; the faces should drag it up.
  assert.ok(f.fy < 0.5, `expected fy < 0.5, got ${f.fy}`);
  // …but not past the window edge, or the crop would leave the image.
  const win = coverWindow(PORTRAIT, SQUARE);
  assert.ok(f.fy >= win.h / 2 - 1e-9, `fy ${f.fy} escaped the top edge`);
});

test('the chosen window actually contains the faces', () => {
  const boxes: Box[] = [
    { x1: 0.463, y1: 0.227, x2: 0.564, y2: 0.321 },
    { x1: 0.281, y1: 0.191, x2: 0.381, y2: 0.271 }
  ];
  const f = faceFocal(boxes, PORTRAIT, SQUARE);
  const win = coverWindow(PORTRAIT, SQUARE);
  const top = f.fy - win.h / 2;
  const bottom = f.fy + win.h / 2;
  const u = unionBox(boxes)!;
  assert.ok(u.y1 >= top - 1e-6, `face top ${u.y1} above window top ${top}`);
  assert.ok(u.y2 <= bottom + 1e-6, `face bottom ${u.y2} below window bottom ${bottom}`);
});

test('a single face is centred on, horizontally too', () => {
  const f = faceFocal([{ x1: 0.741, y1: 0.269, x2: 0.820, y2: 0.436 }], LANDSCAPE, SQUARE);
  const win = coverWindow(LANDSCAPE, SQUARE);
  // Face sits right of centre, so the window should move right — up to the edge.
  assert.ok(f.fx > 0.5, `expected fx > 0.5, got ${f.fx}`);
  assert.ok(f.fx <= 1 - win.w / 2 + 1e-9, `fx ${f.fx} escaped the right edge`);
});

test('focal never puts the window outside the image', () => {
  const extremes: Box[] = [
    { x1: 0.0, y1: 0.0, x2: 0.05, y2: 0.05 },
    { x1: 0.95, y1: 0.95, x2: 1.0, y2: 1.0 }
  ];
  for (const target of [0.8, 1, 1.91, 0.5625]) {
    const f = faceFocal(extremes, PORTRAIT, target);
    const win = coverWindow(PORTRAIT, target);
    assert.ok(f.fx >= win.w / 2 - 1e-9 && f.fx <= 1 - win.w / 2 + 1e-9, `fx out of range at ${target}`);
    assert.ok(f.fy >= win.h / 2 - 1e-9 && f.fy <= 1 - win.h / 2 + 1e-9, `fy out of range at ${target}`);
  }
});

test('faces spread wider than the window are reported as clipped', () => {
  const spread: Box[] = [
    { x1: 0.02, y1: 0.4, x2: 0.10, y2: 0.5 },
    { x1: 0.90, y1: 0.4, x2: 0.98, y2: 0.5 }
  ];
  // Square crop of a wide landscape can only show ~2/3 of the width.
  const f = faceFocal(spread, LANDSCAPE, SQUARE);
  assert.equal(f.clipped, true);
  // Still best-effort centred rather than giving up.
  assert.ok(Math.abs(f.fx - 0.5) < 0.05);
});

test('a group that fits is not reported as clipped', () => {
  const f = faceFocal(
    [{ x1: 0.4, y1: 0.4, x2: 0.5, y2: 0.5 }, { x1: 0.52, y1: 0.4, x2: 0.6, y2: 0.5 }],
    SQUARE,
    SQUARE
  );
  assert.equal(f.clipped, false);
});

test('headroom biases upward, not downward', () => {
  const box: Box[] = [{ x1: 0.45, y1: 0.45, x2: 0.55, y2: 0.55 }];
  // Deliberately a portrait source with a square target: same-aspect leaves
  // the window equal to the image, so the focal can only ever be 0.5 and the
  // bias would be invisible. That is the clamp working, not the padding
  // failing — worth stating, because the first version of this test asserted
  // a bias in a configuration where panning is impossible.
  const f = faceFocal(box, PORTRAIT, SQUARE, 0.5);
  const win = coverWindow(PORTRAIT, SQUARE);
  assert.ok(f.fy < 0.5, `expected fy above centre, got ${f.fy}`);
  assert.ok(f.fy >= win.h / 2 - 1e-9, 'stayed inside the image');
});

test('a same-aspect crop pins the focal to centre — nothing to pan', () => {
  const f = faceFocal([{ x1: 0.1, y1: 0.05, x2: 0.2, y2: 0.15 }], SQUARE, SQUARE);
  assert.deepEqual({ fx: f.fx, fy: f.fy }, { fx: 0.5, fy: 0.5 });
  assert.equal(f.fromFaces, true);
});
