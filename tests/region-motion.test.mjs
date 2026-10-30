import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRegionField, moveGridByRegions, sampleField } from '../scripts/region-motion.js';
import { buildWarpGrid, sampleGrid } from '../scripts/puppet-warp.js';

/** RGBA image data with alpha 255 inside the axis-aligned box, 0 elsewhere. */
function boxMask(width, height, box) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = box.y0; y < box.y1; y += 1)
    for (let x = box.x0; x < box.x1; x += 1) data[(y * width + x) * 4 + 3] = 255;
  return { data, width, height };
}

const SIZE = 160;
const STEP = 8;
const BOX = { x0: 40, y0: 40, x1: 80, y1: 80 };
const identity = () =>
  buildWarpGrid({ width: SIZE, height: SIZE, rest: [], moved: [], step: STEP });

test('region field is 1 inside the paint and fades to 0 over the feather', () => {
  const field = buildRegionField(boxMask(SIZE, SIZE, BOX), { step: STEP, feather: 24 });
  assert.equal(field.cols, SIZE / STEP + 1);
  assert.equal(sampleField(field, 56, 56), 1);
  assert.equal(sampleField(field, 40, 40), 1);
  const near = sampleField(field, 90, 56);
  assert.ok(near > 0 && near < 1, `near ${near}`);
  assert.equal(sampleField(field, 130, 130), 0);
  // Outside the grid the field is 0.
  assert.equal(sampleField(field, -50, 56), 0);
});

test('an empty region gives a zero field', () => {
  const field = buildRegionField(boxMask(SIZE, SIZE, { x0: 0, y0: 0, x1: 0, y1: 0 }), {
    step: STEP,
    feather: 24,
  });
  assert.ok(field.w.every((value) => value === 0));
});

test('moving a region translates its inside and leaves far art alone', () => {
  const field = buildRegionField(boxMask(SIZE, SIZE, BOX), { step: STEP, feather: 24 });
  const grid = moveGridByRegions(identity(), [{ field, cx: 60, cy: 60, dx: 16, dy: -8, rot: 0 }]);
  // The output at the moved centre samples the region's rest centre.
  const centre = sampleGrid(grid, 76, 52);
  assert.ok(Math.hypot(centre.x - 60, centre.y - 60) < 0.5, JSON.stringify(centre));
  const far = sampleGrid(grid, 144, 144);
  assert.ok(Math.abs(far.x - 144) < 1e-6 && Math.abs(far.y - 144) < 1e-6);
});

test('a rotated region turns about its pivot', () => {
  const field = buildRegionField(boxMask(SIZE, SIZE, BOX), { step: STEP, feather: 24 });
  const rot = 0.3;
  const grid = moveGridByRegions(identity(), [{ field, cx: 48, cy: 48, dx: 0, dy: 0, rot }]);
  // The rest point (72, 48) lands at pivot + R * (24, 0).
  const out = { x: 48 + 24 * Math.cos(rot), y: 48 + 24 * Math.sin(rot) };
  const node = { x: Math.round(out.x / STEP) * STEP, y: Math.round(out.y / STEP) * STEP };
  const source = sampleGrid(grid, node.x, node.y);
  // Map the node back by the inverse rotation to know what it should sample.
  const ux = node.x - 48;
  const uy = node.y - 48;
  const expected = {
    x: 48 + ux * Math.cos(rot) + uy * Math.sin(rot),
    y: 48 - ux * Math.sin(rot) + uy * Math.cos(rot),
  };
  assert.ok(Math.hypot(source.x - expected.x, source.y - expected.y) < 0.5, JSON.stringify(source));
});

test('the blend between a moved region and the still art is continuous', () => {
  const field = buildRegionField(boxMask(SIZE, SIZE, BOX), { step: STEP, feather: 32 });
  const grid = moveGridByRegions(identity(), [{ field, cx: 60, cy: 60, dx: 0, dy: -16, rot: 0 }]);
  // Walking down from the region, source y never jumps by more than a few px per node.
  let previous = null;
  for (let y = 40; y <= 152; y += STEP) {
    const { y: sy } = sampleGrid(grid, 60, y);
    if (previous !== null)
      assert.ok(sy - previous > 0 && sy - previous < STEP * 2.5, `${y}: ${sy}`);
    previous = sy;
  }
});

test('region motion runs on top of the pin warp grid', () => {
  const field = buildRegionField(boxMask(SIZE, SIZE, BOX), { step: STEP, feather: 24 });
  const shifted = buildWarpGrid({
    width: SIZE,
    height: SIZE,
    rest: [{ x: 0, y: 0 }],
    moved: [{ x: 4, y: 0 }],
    step: STEP,
  });
  const grid = moveGridByRegions(shifted, [{ field, cx: 60, cy: 60, dx: 0, dy: 0, rot: 0 }]);
  const point = sampleGrid(grid, 120, 120);
  assert.ok(Math.abs(point.x - 116) < 1e-6);
});
