import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from 'canvas';

import {
  MAX_ANIMATED_SIZE,
  bendTokenArt,
  canPlayWithTool,
  getAnimatedOutputSize,
  getBendMargin,
  getPinHitRadius,
  isPresetAvailable,
  shouldBendPreview,
} from '../scripts/token-animation.js';
import { getTokenFrameLayout } from '../scripts/token-composer.js';

const SIZE = 32;
const VIEW = { zoom: 1, offsetX: 0, offsetY: 0 };

function makeCutout() {
  const canvas = createCanvas(40, 20);
  const context = canvas.getContext('2d');
  context.fillStyle = '#c03020';
  context.fillRect(10, 10, 20, 10);
  return canvas;
}

function pixels(canvas) {
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
}

function topOpaqueRow(canvas) {
  const data = pixels(canvas);
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (data[(y * canvas.width + x) * 4 + 3] > 128) return y;
    }
  }
  return -1;
}

function pin(keyframes) {
  return { id: 'p', x: 20, y: 10, keyframes };
}

function bend(cutout, popOutImage, pins, t) {
  return bendTokenArt({
    cutout,
    popOutImage,
    view: VIEW,
    size: SIZE,
    animation: { duration: 2, fps: 30, pins },
    t,
    createCanvas,
  });
}

test('art with pins that do not move matches the plain layout', () => {
  const cutout = makeCutout();
  const plain = createCanvas(SIZE, SIZE);
  const layout = getTokenFrameLayout({ imageWidth: 40, imageHeight: 20, size: SIZE });
  plain.getContext('2d').drawImage(cutout, layout.x, layout.y, layout.width, layout.height);

  const { art } = bend(cutout, null, [pin([{ t: 0.5, dx: 0, dy: 0 }])], 0.5);
  const a = pixels(art);
  const b = pixels(plain);
  let max = 0;
  for (let i = 0; i < a.length; i += 1) max = Math.max(max, Math.abs(a[i] - b[i]));
  assert.ok(max <= 2, `max channel difference ${max}`);
});

test('a moved pin bends the art and the pop-out image together', () => {
  const cutout = makeCutout();
  const popOut = makeCutout();
  const pins = [
    pin([
      { t: 0, dx: 0, dy: 0 },
      { t: 0.5, dx: 0, dy: -6 },
    ]),
  ];
  const still = bend(cutout, popOut, pins, 0);
  const moved = bend(cutout, popOut, pins, 0.5);
  const shift = 6 * (SIZE / 20);
  for (const key of ['art', 'popOut']) {
    const delta = topOpaqueRow(still[key]) - topOpaqueRow(moved[key]);
    assert.ok(Math.abs(delta - shift) <= 1, `${key} moved up by ${delta}, expected ${shift}`);
  }
});

test('no pop-out image gives popOut null', () => {
  const result = bend(makeCutout(), null, [pin([{ t: 0.5, dx: 0, dy: -6 }])], 0.5);
  assert.equal(result.popOut, null);
  assert.equal(result.art.width, SIZE);
});

test('art that overflows the token slides in instead of leaving a gap at the edge', () => {
  // A tall, fully opaque cut-out in a square token: the cover layout overflows top and bottom.
  const cutout = createCanvas(20, 40);
  const context = cutout.getContext('2d');
  context.fillStyle = '#20a040';
  context.fillRect(0, 0, 20, 40);
  const pins = [
    {
      id: 'p',
      x: 10,
      y: 20,
      keyframes: [
        { t: 0, dx: 0, dy: 0 },
        { t: 0.5, dx: 0, dy: -4 },
      ],
    },
  ];
  const { art } = bend(cutout, null, pins, 0.5);
  const data = pixels(art);
  for (let y = SIZE - 3; y < SIZE; y += 1) {
    for (let x = 2; x < SIZE - 2; x += 1) {
      const alpha = data[(y * SIZE + x) * 4 + 3];
      assert.ok(alpha > 200, `pixel ${x},${y} alpha ${alpha}`);
    }
  }
  assert.equal(art.width, SIZE);
  assert.equal(art.height, SIZE);
});

test('the bend margin covers the largest pin offset and at least a tenth of the token', () => {
  assert.equal(getBendMargin([], 1, 100), 10);
  const pins = [{ keyframes: [{ t: 0, dx: 3, dy: -30 }] }];
  assert.equal(getBendMargin(pins, 1, 100), 30);
  assert.equal(getBendMargin(pins, 0.5, 100), 15);
});

test('animated tokens are saved at most 512 px wide', () => {
  assert.equal(MAX_ANIMATED_SIZE, 512);
  assert.equal(getAnimatedOutputSize(1024), 512);
  assert.equal(getAnimatedOutputSize(512), 512);
  assert.equal(getAnimatedOutputSize(400), 400);
});

test('preview playback runs only under Move and the pin tool', () => {
  assert.equal(canPlayWithTool(null), true);
  assert.equal(canPlayWithTool('pin'), true);
  for (const tool of ['paint', 'erase', 'select', 'cut', 'restore', 'wand'])
    assert.equal(canPlayWithTool(tool), false);
});

test('the preview stays unbent while a mask tool or a mask stroke works on the still art', () => {
  assert.equal(shouldBendPreview({ maskTool: null, pointerMode: null }), true);
  assert.equal(shouldBendPreview({ maskTool: 'pin', pointerMode: null }), true);
  assert.equal(shouldBendPreview({ maskTool: null, pointerMode: 'paint' }), false);
  assert.equal(shouldBendPreview({ maskTool: 'paint', pointerMode: null }), false);
});

test('Breathe needs at least two pins; Bob and Sway need a selected pin', () => {
  const one = [{ id: 'a', x: 0, y: 0, keyframes: [] }];
  const two = [...one, { id: 'b', x: 5, y: 5, keyframes: [] }];
  assert.equal(isPresetAvailable(one, null, 'breathe'), false);
  assert.equal(isPresetAvailable(two, null, 'breathe'), true);
  assert.equal(isPresetAvailable(one, 'a', 'bob'), true);
  assert.equal(isPresetAvailable(one, null, 'sway'), false);
});

test('pin hit radius follows CSS scaling of the preview canvas and viewport zoom', () => {
  assert.equal(getPinHitRadius({ radius: 10, canvasWidth: 600, clientWidth: 300 }), 20);
  assert.equal(
    getPinHitRadius({ radius: 10, viewportScale: 2, canvasWidth: 600, clientWidth: 300 }),
    10,
  );
  assert.equal(getPinHitRadius({ radius: 10, canvasWidth: 600, clientWidth: 0 }), 10);
});
