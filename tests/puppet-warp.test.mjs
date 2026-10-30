import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWarpGrid, mlsRigid, warpImageData } from '../scripts/puppet-warp.js';

function blank(width, height) {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

function pixel(image, x, y) {
  const o = (y * image.width + x) * 4;
  return Array.from(image.data.slice(o, o + 4));
}

function warp(source, rest, moved) {
  const target = blank(source.width, source.height);
  const grid = buildWarpGrid({ width: source.width, height: source.height, rest, moved });
  warpImageData(source, grid, target);
  return target;
}

test('warp leaves the image unchanged when no pin moves', () => {
  const source = blank(32, 32);
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const o = (y * 32 + x) * 4;
      source.data.set([x * 8, y * 8, (x + y) * 4, 255], o);
    }
  }
  const pins = [
    { x: 4, y: 4 },
    { x: 28, y: 28 },
  ];
  const target = warp(
    source,
    pins,
    pins.map((p) => ({ ...p })),
  );
  assert.deepEqual(target.data, source.data);
});

test('a moved pin carries the source pixel under its rest position', () => {
  const source = blank(40, 40);
  for (let y = 7; y <= 13; y += 1) {
    for (let x = 7; x <= 13; x += 1) source.data.set([255, 0, 0, 255], (y * 40 + x) * 4);
  }
  const rest = [
    { x: 2, y: 38 },
    { x: 38, y: 38 },
    { x: 38, y: 2 },
    { x: 10, y: 10 },
  ];
  const moved = rest.map((p) => ({ ...p }));
  moved[3] = { x: 10, y: 4 };
  const target = warp(source, rest, moved);
  const [r, , , a] = pixel(target, 10, 4);
  assert.ok(a > 200 && r > 200, `expected red dot at (10,4), got alpha ${a} red ${r}`);
  assert.equal(pixel(target, 10, 16)[3], 0);
});

test('a single pin translates the whole image', () => {
  const source = blank(40, 20);
  for (let y = 0; y < 20; y += 1) {
    for (let x = 0; x < 40; x += 1) source.data.set([x * 6, y * 12, 90, 255], (y * 40 + x) * 4);
  }
  const target = warp(source, [{ x: 5, y: 5 }], [{ x: 8, y: 5 }]);
  for (let k = 0; k < 20; k += 1) {
    assert.deepEqual(pixel(target, 8 + k, 5), pixel(source, 5 + k, 5));
  }
});

test('pixels mapped outside the source stay transparent', () => {
  const source = blank(40, 20);
  for (let i = 0; i < source.data.length; i += 4) source.data.set([10, 20, 30, 255], i);
  const target = warp(source, [{ x: 20, y: 10 }], [{ x: 0, y: 10 }]);
  assert.equal(pixel(target, 39, 10)[3], 0);
  assert.equal(pixel(target, 5, 10)[3], 255);
});

test('mlsRigid returns the target exactly at a control point', () => {
  assert.deepEqual(
    mlsRigid(
      3,
      4,
      [
        { x: 3, y: 4 },
        { x: 9, y: 9 },
      ],
      [
        { x: 5, y: 6 },
        { x: 9, y: 9 },
      ],
    ),
    { x: 5, y: 6 },
  );
});

test('mlsRigid returns the point itself with no pins', () => {
  assert.deepEqual(mlsRigid(3, 4, [], []), { x: 3, y: 4 });
});
