import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from 'canvas';

import { bendTokenArt } from '../scripts/token-animation.js';
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
