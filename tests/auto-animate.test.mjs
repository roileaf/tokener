import test from 'node:test';
import assert from 'node:assert/strict';

import { analyseSubject, findProtrusions } from '../scripts/auto-compose.js';
import { hasMotion, PINGPONG_MAX_KEY, samplePinOffset } from '../scripts/animation.js';
import { buildAutoRig, classifyTip, layerPresetKeyframes } from '../scripts/auto-animate.js';
import { getTokenFrameLayout } from '../scripts/token-composer.js';

const CLIP = 0.666;
const GRID = 96;
const VIEW = { zoom: 0.5, offsetX: 0, offsetY: 0 };
const WIDE = { zoom: 0.7, offsetX: 0, offsetY: 0 };

/**
 * 200x300 figure: round head, wide body down to the bottom edge, and optional parts: a raised
 * sword and spike, level wings out to both sides, or a tail hanging down to the right.
 */
function figure({ sword = false, spike = false, wings = false, tail = false } = {}) {
  const width = 200;
  const height = 300;
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const on =
        Math.hypot(x - 100, y - 70) <= 30 ||
        (y >= 95 && x >= 55 && x <= 145) ||
        (sword && x >= 140 && x <= 147 && y >= 6 && y <= 200) ||
        (spike && x >= 50 && x <= 57 && y >= 10 && y <= 200) ||
        (wings && y >= 110 && y <= 120) ||
        (tail && x >= 140 && Math.abs(y - 125 - (x - 140) * 0.9) <= 6);
      if (on) alpha[y * width + x] = 255;
    }
  }
  return { alpha, width, height, scale: 1 };
}

function rig(grid, view = VIEW, mode = undefined) {
  return buildAutoRig({
    alpha: grid,
    cutoutWidth: grid.width * grid.scale,
    cutoutHeight: grid.height * grid.scale,
    view,
    clipRadius: CLIP,
    gridSize: GRID,
    mode,
  });
}

test('auto rig puts a head pin on the analysed head and a chest below it', () => {
  const grid = figure();
  const { head } = analyseSubject(grid);
  const { pins, selectedPinIds } = rig(grid);
  const headPin = pins[0];
  assert.ok(Math.hypot(headPin.x - head.x, headPin.y - head.y) <= head.radius);
  const chest = pins[1];
  assert.ok(Math.abs(chest.y - (head.y + 1.6 * head.radius)) <= 1);
  assert.ok(Math.abs(chest.x - head.x) <= 1);
  // Nothing stays selected, so the next preset click doesn't land on every pin at once.
  assert.deepEqual(selectedPinIds, []);
  assert.ok(pins.every((pin) => pin.arm === Math.round(0.12 * 300)));
});

test('auto rig anchors sit on the bottom of the bounds without keyframes', () => {
  const grid = figure();
  const { bounds } = analyseSubject(grid);
  const { pins } = rig(grid);
  const anchors = pins.filter((pin) => pin.keyframes.length === 0);
  assert.equal(anchors.length, 2);
  const bottom = bounds.y + bounds.height;
  for (const anchor of anchors) assert.ok(Math.abs(anchor.y - bottom) <= 2);
  const xs = anchors.map((pin) => pin.x).sort((a, b) => a - b);
  assert.ok(Math.abs(xs[0] - (bounds.x + bounds.width * 0.25)) <= 2);
  assert.ok(Math.abs(xs[1] - (bounds.x + bounds.width * 0.75)) <= 2);
});

test('auto rig layers bob over breathe on the head and breathes the chest', () => {
  const { pins } = rig(figure());
  assert.equal(hasMotion({ pins }), true);
  const [head, chest] = pins;
  const amplitude = 0.03 * 300;
  // Breathe scales the head and chest about their midpoint by 3 %.
  const midY = (head.y + chest.y) / 2;
  const at = (pin, t) => pin.keyframes.find((key) => key.t === t);
  assert.ok(Math.abs(at(chest, 0.5).dy - (chest.y - midY) * 0.03) < 1e-9);
  assert.equal(chest.keyframes.length, 2);
  // The head bobs a beat behind the chest's breath, so it is still rising after the chest peaks.
  assert.ok(head.keyframes.some((key) => Math.abs(key.t - 0.58) < 1e-9));
  assert.ok(samplePinOffset(head, 0.58).dy < samplePinOffset(head, 0.5).dy, 'head peaks late');
  assert.ok(samplePinOffset(head, 0.58).dy < -0.6 * amplitude + 1);
});

test('auto rig adds a swaying tip pin, without breathe, for a raised sword', () => {
  const grid = figure({ sword: true });
  const { pins } = rig(grid);
  const tips = pins.slice(4);
  assert.equal(tips.length, 1);
  assert.ok(Math.abs(tips[0].x - 143) <= 8, `tip x ${tips[0].x}`);
  assert.ok(tips[0].y <= 30, `tip y ${tips[0].y}`);
  const [from, to] = tips[0].keyframes;
  assert.deepEqual([from.t, to.t], [0.1, 0.6], 'a crest trails the body');
  assert.equal(from.dy, 0);
  assert.equal(to.dy, 0);
  assert.ok(from.dx < 0 && to.dx === -from.dx, 'it sways from side to side');
  assert.equal(hasMotion({ pins }), true);
});

test('auto rig staggers two raised tips instead of moving them in lockstep', () => {
  const { pins } = rig(figure({ sword: true, spike: true }));
  const tips = pins.slice(4);
  assert.equal(tips.length, 2);
  const starts = tips.map((tip) => tip.keyframes[0].t).sort((a, b) => a - b);
  assert.ok(Math.abs(starts[0] - 0.1) < 1e-9 && Math.abs(starts[1] - 0.22) < 1e-9, `${starts}`);
});

test('auto rig flaps level wings together, down and toward the body', () => {
  // Zoomed in so the wings reach past the token ring.
  const { pins } = rig(figure({ wings: true }), WIDE);
  const [, chest] = pins;
  const tips = pins.slice(4);
  assert.equal(tips.length, 2, 'both wings get a pin');
  assert.ok(tips.some((tip) => tip.x < chest.x) && tips.some((tip) => tip.x > chest.x));
  for (const tip of tips) {
    assert.equal(classifyTip(tip, chest), 'wing');
    const [rest, apex] = tip.keyframes;
    assert.deepEqual([rest.t, apex.t], [0, 0.5], 'wings beat with the body');
    assert.ok(apex.dy > 0);
    assert.ok(Math.sign(apex.dx) === Math.sign(chest.x - tip.x));
  }
});

test('auto rig swings a hanging tail across its length, well behind the body', () => {
  const { pins, parts } = rig(figure({ tail: true }), WIDE);
  assert.deepEqual(parts, {
    chestId: pins[1].id,
    anchorIds: [pins[2].id, pins[3].id],
    tipIds: [pins[4].id],
  });
  const [, chest] = pins;
  const tips = pins.slice(4);
  assert.equal(tips.length, 1, 'the tail gets a pin');
  const [tail] = tips;
  assert.equal(classifyTip(tail, chest), 'tail');
  const [from, to] = tail.keyframes;
  assert.deepEqual([from.t, to.t], [0.25, 0.75]);
  // The swing is square to the line from the chest to the tip.
  const along = (to.dx - from.dx) * (tail.x - chest.x) + (to.dy - from.dy) * (tail.y - chest.y);
  assert.ok(Math.abs(along) < 1e-6, `swing along the tail ${along}`);
  assert.ok(Math.hypot(to.dx, to.dy) > 0);
});

test('tip roles come from the direction seen from the chest', () => {
  const chest = { x: 100, y: 100 };
  assert.equal(classifyTip({ x: 110, y: 10 }, chest), 'crest');
  assert.equal(classifyTip({ x: 190, y: 90 }, chest), 'wing');
  assert.equal(classifyTip({ x: 10, y: 120 }, chest), 'wing');
  assert.equal(classifyTip({ x: 150, y: 190 }, chest), 'tail');
});

test('auto rig keeps one tip when two pieces poke out of the same part', () => {
  // A forked blade: two prongs a few pixels apart, joined below the opening.
  const width = 200;
  const height = 300;
  const alpha = figure().alpha;
  for (let y = 6; y <= 200; y += 1)
    for (let x = 132; x <= 158; x += 1) {
      const prong = x <= 138 || x >= 152;
      if (prong || y >= 60) alpha[y * width + x] = 255;
    }
  const grid = { alpha, width, height, scale: 1 };
  const pieces = findProtrusions({
    alpha: grid,
    view: VIEW,
    clipRadius: CLIP,
    gridSize: GRID,
  }).pieces.filter((piece) => !piece.inBottomArc && piece.area >= 2);
  assert.ok(pieces.length >= 2, `the prongs should be separate pieces (${pieces.length})`);
  const { pins } = rig(grid);
  assert.equal(pins.length, 5);
  assert.ok(
    pins[4].keyframes.every((key) => key.dy === 0),
    'a lone raised tip sways',
  );
});

test('auto rig finds the sword tip under another zoom and offsets', () => {
  const { pins } = rig(figure({ sword: true }), { zoom: 0.55, offsetX: 0.05, offsetY: -0.08 });
  assert.equal(pins.length, 5);
  assert.ok(Math.abs(pins[4].x - 143) <= 10, `tip x ${pins[4].x}`);
  assert.ok(pins[4].y <= 30, `tip y ${pins[4].y}`);
});

test('auto rig ignores a piece that belongs to the head', () => {
  const grid = figure();
  const view = { zoom: 1, offsetX: 0, offsetY: 0.2 };
  const { head } = analyseSubject(grid);
  const layout = getTokenFrameLayout({
    imageWidth: grid.width,
    imageHeight: grid.height,
    size: GRID,
    zoom: view.zoom,
    offsetX: view.offsetX * GRID,
    offsetY: view.offsetY * GRID,
  });
  const scale = layout.width / grid.width;
  const found = findProtrusions({ alpha: grid, view, clipRadius: CLIP, gridSize: GRID })
    .pieces.filter((piece) => !piece.inBottomArc && piece.area >= 2)
    .filter(
      (piece) =>
        Math.hypot(
          (piece.tip.x - layout.x) / scale - head.x,
          (piece.tip.y - layout.y) / scale - head.y,
        ) <=
        head.radius * 1.2,
    );
  assert.ok(found.length > 0, 'the view should push the crown out of the opening');
  assert.equal(rig(grid, view).pins.length, 4);
});

test('layering keyframes sums matching times and resamples the others', () => {
  const base = [
    { t: 0, dx: 0, dy: 0 },
    { t: 0.5, dx: 2, dy: 4 },
  ];
  const summed = layerPresetKeyframes(base, [
    { t: 0.004, dx: 1, dy: 1 },
    { t: 0.5, dx: 3, dy: -1 },
  ]);
  assert.equal(summed.length, 2);
  assert.deepEqual(summed[1], { t: 0.5, dx: 5, dy: 3 });
  const offset = layerPresetKeyframes(base, [
    { t: 0.25, dx: 10, dy: 0 },
    { t: 0.75, dx: 0, dy: 0 },
  ]);
  assert.deepEqual(
    offset.map((key) => key.t),
    [0, 0.25, 0.5, 0.75],
  );
  for (const key of offset) {
    const one = samplePinOffset({ keyframes: base }, key.t);
    const two = samplePinOffset(
      {
        keyframes: [
          { t: 0.25, dx: 10, dy: 0 },
          { t: 0.75, dx: 0, dy: 0 },
        ],
      },
      key.t,
    );
    assert.ok(Math.abs(key.dx - (one.dx + two.dx)) < 1e-9);
    assert.ok(Math.abs(key.dy - (one.dy + two.dy)) < 1e-9);
  }
});

test('auto rig maps tips back through the grid scale to source pixels', () => {
  const grid = figure({ sword: true });
  const half = { ...grid };
  const small = new Uint8Array((grid.width / 2) * (grid.height / 2));
  for (let y = 0; y < grid.height / 2; y += 1)
    for (let x = 0; x < grid.width / 2; x += 1)
      small[y * (grid.width / 2) + x] = grid.alpha[y * 2 * grid.width + x * 2];
  half.alpha = small;
  half.width = grid.width / 2;
  half.height = grid.height / 2;
  half.scale = 2;
  const { pins } = rig(half);
  const tip = pins[4];
  assert.ok(Math.abs(tip.x - 143) <= 12, `tip x ${tip.x}`);
});

test('auto rig returns no pins for an empty cut-out', () => {
  const grid = { alpha: new Uint8Array(100), width: 10, height: 10, scale: 1 };
  assert.deepEqual(rig(grid), { pins: [], selectedPinIds: [], parts: null });
});

test('auto rig in ping-pong peaks at the apex and moves over the whole forward half', () => {
  const { pins } = rig(figure({ sword: true }), VIEW, 'pingpong');
  const amplitude = 0.03 * 300;
  const [head, chest] = pins;
  const midY = (head.y + chest.y) / 2;
  assert.deepEqual(
    chest.keyframes.map((key) => key.t),
    [0, PINGPONG_MAX_KEY],
  );
  // The head and the sword hold a moment, then still arrive at the apex.
  assert.deepEqual(
    head.keyframes.map((key) => key.t),
    [0, 0.16, PINGPONG_MAX_KEY],
  );
  const apex = head.keyframes.at(-1);
  assert.ok(Math.abs(apex.dy - ((head.y - midY) * 0.03 - 0.6 * amplitude)) < 1e-9);
  const tip = pins[4];
  assert.deepEqual(
    tip.keyframes.map((key) => key.t),
    [0, 0.2, PINGPONG_MAX_KEY],
  );
  const reach = tip.keyframes.at(-1).dx;
  const quarter = samplePinOffset(tip, 0.375, 'pingpong').dx;
  assert.ok(quarter > -reach && quarter < reach * 0.9, `quarter ${quarter}`);
  assert.ok(Math.abs(samplePinOffset(tip, 0.5, 'pingpong').dx - reach) < 1e-9);
});

test('layering in ping-pong holds the last key instead of wrapping', () => {
  const base = [
    { t: 0, dx: 0, dy: 0 },
    { t: 0.5, dx: 4, dy: 0 },
  ];
  const [, late] = layerPresetKeyframes(
    base,
    [
      { t: 0, dx: 0, dy: 0 },
      { t: 0.75, dx: 2, dy: 0 },
    ],
    'pingpong',
  ).filter((key) => key.t >= 0.5);
  // At 0.75 the base track holds 4 (a loop would ease it back toward 0).
  assert.equal(late.t, 0.75);
  assert.ok(Math.abs(late.dx - 6) < 1e-9);
});

test('auto rig records the motion each pin got, for the preset buttons', () => {
  const crest = rig(figure({ sword: true })).pins;
  assert.deepEqual(
    crest.map((pin) => pin.preset ?? null),
    ['bob', 'breathe', null, null, 'sway'],
  );
  assert.deepEqual(
    rig(figure({ wings: true }), WIDE)
      .pins.slice(4)
      .map((pin) => pin.preset),
    ['flap', 'flap'],
  );
  // A tail swings across its length, which no preset does.
  assert.equal(rig(figure({ tail: true }), WIDE).pins[4].preset, undefined);
});
