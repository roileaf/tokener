import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dropNestedParts,
  findPartClick,
  fitPartMask,
  pickPartMask,
  toHingeKeyframes,
} from '../scripts/auto-parts.js';

const W = 100;
const H = 60;

/** RGBA data, opaque inside any of the boxes. */
function image(...boxes) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (const box of boxes)
    for (let y = box.y0; y < box.y1; y += 1)
      for (let x = box.x0; x < box.x1; x += 1) data[(y * W + x) * 4 + 3] = 255;
  return { data, width: W, height: H };
}

// A body on the left and a wing sticking out to the right of it.
const BODY = { x0: 10, y0: 10, x1: 50, y1: 50 };
const WING = { x0: 50, y0: 20, x1: 90, y1: 30 };
const figure = image(BODY, WING);
const tip = { x: 88, y: 25 };
const chest = { x: 30, y: 30 };
const alphaAt = (rgba, x, y) => rgba[(y * W + x) * 4 + 3];

test('a part mask on the tip becomes a region with its hinge where it meets the body', () => {
  const part = fitPartMask({ mask: image(WING), figure, tip, chest, avoid: [{ x: 20, y: 49 }] });
  assert.ok(part, 'the wing is accepted');
  // The wing's root: its point nearest the chest.
  assert.deepEqual(part.hinge, { x: 50, y: 29 });
  assert.equal(alphaAt(part.rgba, 70, 25), 255);
  assert.equal(alphaAt(part.rgba, 30, 30), 0);
});

test('a part mask is clipped to the figure', () => {
  // SAM took some backdrop above the wing too.
  const part = fitPartMask({
    mask: image({ x0: 50, y0: 12, x1: 90, y1: 30 }),
    figure,
    tip,
    chest,
  });
  assert.ok(part);
  assert.equal(alphaAt(part.rgba, 70, 14), 0, 'backdrop is not part of the region');
  assert.equal(alphaAt(part.rgba, 70, 25), 255);
});

test('masks that miss the tip, take the chest or most of the figure are refused', () => {
  assert.equal(
    fitPartMask({ mask: image({ x0: 0, y0: 0, x1: 5, y1: 5 }), figure, tip, chest }),
    null,
  );
  assert.equal(
    fitPartMask({ mask: image({ x0: 25, y0: 20, x1: 90, y1: 35 }), figure, tip, chest }),
    null,
    'the chest is not part of a limb',
  );
  assert.equal(
    fitPartMask({
      mask: image({ x0: 40, y0: 10, x1: 90, y1: 50 }),
      figure,
      tip,
      chest: { x: 12, y: 12 },
    }),
    null,
    'too much of the figure',
  );
  assert.equal(fitPartMask({ mask: image(), figure, tip, chest }), null);
  // A mask reaching well behind the chest is the body, not a limb on the tip's side.
  assert.equal(
    fitPartMask({
      // The wing and, joined to its root, a band across the body.
      mask: image(WING, { x0: 10, y0: 28, x1: 51, y1: 36 }),
      figure,
      tip,
      chest: { x: 45, y: 45 },
    }),
    null,
  );
  // A part that runs right up to the chest is the body itself.
  assert.equal(
    fitPartMask({
      mask: image(WING, { x0: 45, y0: 20, x1: 50, y1: 30 }),
      figure,
      tip,
      chest: { x: 43, y: 25 },
    }),
    null,
  );
  // A mask over an anchor took the body along with the part.
  assert.equal(
    fitPartMask({
      mask: image({ x0: 45, y0: 20, x1: 90, y1: 30 }),
      figure,
      tip,
      chest,
      avoid: [{ x: 47, y: 25 }],
    }),
    null,
  );
});

test('a detached part hinges on its point nearest the chest', () => {
  const floating = image(BODY, { x0: 60, y0: 20, x1: 90, y1: 30 });
  const part = fitPartMask({
    mask: image({ x0: 60, y0: 20, x1: 90, y1: 30 }),
    figure: floating,
    tip,
    chest,
  });
  assert.ok(part);
  assert.deepEqual(part.hinge, { x: 60, y: 29 });
});

test('tip motion becomes a turn of the whole part about its hinge', () => {
  const keys = toHingeKeyframes(
    [
      { t: 0, dx: 0, dy: 0 },
      { t: 0.5, dx: 0, dy: 2 },
    ],
    { x: 20, y: 0 },
    { x: 0, y: 0 },
  );
  assert.deepEqual(keys[0], { t: 0, dx: 0, dy: 0, rot: 0 });
  assert.equal(keys[1].dx, 0);
  assert.equal(keys[1].dy, 0);
  // Moving the tip 2 px down at 20 px out is a turn of about 0.1 rad (clockwise on screen).
  assert.ok(Math.abs(keys[1].rot - 0.1) < 1e-9, `rot ${keys[1].rot}`);
  // Big swings are capped.
  const capped = toHingeKeyframes([{ t: 0, dx: 0, dy: 50 }], { x: 10, y: 0 }, { x: 0, y: 0 });
  assert.ok(capped[0].rot <= 0.6);
});

test('the click for a part lands inside its solid art, not on its faint outer edge', () => {
  // The tip pin sits on the wing's last, nearly transparent pixel.
  const faint = image(BODY, WING);
  for (let y = 20; y < 30; y += 1) faint.data[(y * W + 89) * 4 + 3] = 20;
  const click = findPartClick({ figure: faint, tip: { x: 89, y: 25 }, chest });
  assert.ok(click.x < 89 && click.x > 70, `click x ${click.x}`);
  assert.ok(Math.abs(click.y - 25) <= 1);
  assert.ok(faint.data[(click.y * W + click.x) * 4 + 3] >= 128);
  // No solid art between the tip and the chest: click the tip itself.
  assert.deepEqual(findPartClick({ figure: image(), tip: { x: 89, y: 25 }, chest }), {
    x: 89,
    y: 25,
  });
});

test('the largest SAM proposal that is still a part wins', () => {
  const sliver = image({ x0: 80, y0: 22, x1: 90, y1: 28 });
  const whole = image(BODY, WING);
  const part = pickPartMask([sliver, whole, image(WING)], { figure, tip, chest });
  assert.ok(part);
  assert.equal(part.area, 400, 'the whole wing, not the sliver or the whole figure');
  assert.equal(pickPartMask([whole], { figure, tip, chest }), null);
});

test('specks of the mask apart from the clicked part are dropped', () => {
  // SAM also marked a few pixels on the body next to the chest.
  const part = fitPartMask({
    mask: image(WING, { x0: 33, y0: 28, x1: 36, y1: 31 }),
    figure,
    tip,
    chest,
  });
  assert.ok(part);
  assert.equal(alphaAt(part.rgba, 34, 29), 0, 'the speck is not part of the wing');
  assert.equal(part.area, 400);
  assert.deepEqual(part.hinge, { x: 50, y: 29 });
});

test('a part found mostly inside a bigger one is dropped, so one limb gets one part', () => {
  const part = (...boxes) => {
    const rgba = image(...boxes).data;
    let area = 0;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i]) area += 1;
    return { rgba, area };
  };
  const found = new Map([
    ['wing', part(WING)],
    // A strip along the wing's edge, nearly all of it inside the wing.
    ['strip', part({ x0: 60, y0: 26, x1: 92, y1: 30 })],
    ['head', part({ x0: 10, y0: 52, x1: 30, y1: 60 })],
  ]);
  assert.deepEqual([...dropNestedParts(found).keys()], ['wing', 'head']);
  assert.equal(dropNestedParts(new Map()).size, 0);
});
