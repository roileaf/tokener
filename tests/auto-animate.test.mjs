import test from 'node:test';
import assert from 'node:assert/strict';

import { analyseSubject } from '../scripts/auto-compose.js';
import { hasMotion } from '../scripts/animation.js';
import { buildAutoRig } from '../scripts/auto-animate.js';

const CLIP = 0.666;
const GRID = 96;
const VIEW = { zoom: 0.5, offsetX: 0, offsetY: 0 };

/** 200x300 figure: round head, wide body down to the bottom edge, optional raised sword. */
function figure({ sword = false } = {}) {
  const width = 200;
  const height = 300;
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const on =
        Math.hypot(x - 100, y - 70) <= 30 ||
        (y >= 95 && x >= 55 && x <= 145) ||
        (sword && x >= 140 && x <= 147 && y >= 6 && y <= 200);
      if (on) alpha[y * width + x] = 255;
    }
  }
  return { alpha, width, height, scale: 1 };
}

function rig(grid) {
  return buildAutoRig({
    alpha: grid,
    cutoutWidth: grid.width * grid.scale,
    cutoutHeight: grid.height * grid.scale,
    view: VIEW,
    clipRadius: CLIP,
    gridSize: GRID,
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
  assert.deepEqual(
    selectedPinIds,
    pins.map((pin) => pin.id),
  );
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

test('auto rig moves: breathe on the head and chest, bob at 60% on the head', () => {
  const { pins } = rig(figure());
  assert.equal(hasMotion({ pins }), true);
  const [head, chest] = pins;
  const amplitude = 0.03 * 300;
  const bob = head.keyframes.find((key) => key.t === 0.5);
  assert.ok(head.keyframes.length > 0 && chest.keyframes.length > 0);
  assert.ok(Math.abs(bob.dy) > 0 && Math.abs(bob.dy) <= amplitude * 0.6 + 12);
});

test('auto rig adds a swaying tip pin for a raised sword', () => {
  const grid = figure({ sword: true });
  const { pins } = rig(grid);
  const tips = pins.slice(4);
  assert.equal(tips.length, 1);
  assert.ok(Math.abs(tips[0].x - 143) <= 8, `tip x ${tips[0].x}`);
  assert.ok(tips[0].y <= 30, `tip y ${tips[0].y}`);
  const swayed = tips[0].keyframes.find((key) => key.dx !== 0);
  assert.ok(swayed && swayed.dy === 0);
  assert.equal(hasMotion({ pins }), true);
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
  assert.deepEqual(rig(grid), { pins: [], selectedPinIds: [] });
});
