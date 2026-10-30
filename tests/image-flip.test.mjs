import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from 'canvas';

import { flipCanvas, flipPins, flipView, normalizeFlip } from '../scripts/image-flip.js';

/** A 5×3 canvas whose every pixel is distinct, including semi-transparent ones. */
function patterned(width = 5, height = 3) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      image.data.set([x * 40, y * 80, (x + y) * 20, 255], i);
    }
  context.putImageData(image, 0, 0);
  return canvas;
}

const pixels = (canvas) =>
  Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data);
const pixelAt = (canvas, x, y) => Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data);

test('flipCanvas mirrors pixels horizontally and vertically, exactly', () => {
  const source = patterned();
  const before = pixels(source);
  const x = flipCanvas(source, 'x', createCanvas);
  assert.notEqual(x, source, 'a new canvas');
  assert.equal(x.width, 5);
  assert.equal(x.height, 3);
  for (let py = 0; py < 3; py += 1)
    for (let px = 0; px < 5; px += 1)
      assert.deepEqual(pixelAt(x, px, py), pixelAt(source, 4 - px, py));
  const y = flipCanvas(source, 'y', createCanvas);
  for (let py = 0; py < 3; py += 1)
    for (let px = 0; px < 5; px += 1)
      assert.deepEqual(pixelAt(y, px, py), pixelAt(source, px, 2 - py));
  assert.deepEqual(pixels(source), before, 'the input is untouched');
});

test('flipping a canvas twice restores it exactly', () => {
  const source = patterned(7, 4);
  for (const axis of ['x', 'y'])
    assert.deepEqual(
      pixels(flipCanvas(flipCanvas(source, axis, createCanvas), axis, createCanvas)),
      pixels(source),
    );
});

test('flipCanvas passes null through and ignores unknown axes', () => {
  assert.equal(flipCanvas(null, 'x', createCanvas), null);
  assert.equal(flipCanvas(undefined, 'y', createCanvas), null);
  assert.throws(() => flipCanvas(patterned(), 'z', createCanvas));
});

const pins = () => [
  {
    id: 'a',
    x: 10,
    y: 20,
    arm: 15,
    keyframes: [
      { t: 0, dx: 0, dy: 0 },
      { t: 0.5, dx: 4, dy: -3, rot: 0.25, ease: 'linear' },
    ],
  },
  { id: 'b', x: 0, y: 50, keyframes: [] },
];

test('flipPins mirrors positions, offsets and rotation', () => {
  const size = { width: 100, height: 60 };
  const original = pins();
  const x = flipPins(original, 'x', size);
  assert.deepEqual(x, [
    {
      id: 'a',
      x: 90,
      y: 20,
      arm: 15,
      keyframes: [
        { t: 0, dx: 0, dy: 0 },
        { t: 0.5, dx: -4, dy: -3, rot: -0.25, ease: 'linear' },
      ],
    },
    { id: 'b', x: 100, y: 50, keyframes: [] },
  ]);
  const y = flipPins(original, 'y', size);
  assert.deepEqual(y[0], {
    id: 'a',
    x: 10,
    y: 40,
    arm: 15,
    keyframes: [
      { t: 0, dx: 0, dy: 0 },
      { t: 0.5, dx: 4, dy: 3, rot: -0.25, ease: 'linear' },
    ],
  });
  assert.equal(y[1].y, 10);
  assert.deepEqual(original, pins(), 'the input is untouched');
});

test('flipping pins twice restores them exactly', () => {
  const size = { width: 100, height: 60 };
  for (const axis of ['x', 'y'])
    assert.deepEqual(flipPins(flipPins(pins(), axis, size), axis, size), pins());
  assert.deepEqual(flipPins(null, 'x', size), []);
});

test('flipView mirrors the offset along the flipped axis only', () => {
  const view = { zoom: 1.5, offsetX: -12, offsetY: 7 };
  assert.deepEqual(flipView(view, 'x'), { zoom: 1.5, offsetX: 12, offsetY: 7 });
  assert.deepEqual(flipView(view, 'y'), { zoom: 1.5, offsetX: -12, offsetY: -7 });
  assert.deepEqual(flipView(flipView(view, 'x'), 'x'), view);
  assert.deepEqual(view, { zoom: 1.5, offsetX: -12, offsetY: 7 }, 'the input is untouched');
  assert.equal(Object.is(flipView({ zoom: 1, offsetX: 0, offsetY: 0 }, 'x').offsetX, -0), false);
});

test('normalizeFlip defaults to no flip and keeps only booleans', () => {
  assert.deepEqual(normalizeFlip(undefined), { x: false, y: false });
  assert.deepEqual(normalizeFlip({ x: true }), { x: true, y: false });
  assert.deepEqual(normalizeFlip({ x: 'yes', y: 1 }), { x: false, y: false });
});
