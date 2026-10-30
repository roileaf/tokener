import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ANIMATION,
  ANIMATION_PRESETS,
  applyPreset,
  createPin,
  getFrameTimes,
  hasMotion,
  normalizeAnimation,
  removeKeyframe,
  samplePinOffset,
  samplePins,
  setKeyframe,
} from '../scripts/animation.js';

test('a pin without keyframes never moves', () =>
  assert.deepEqual(samplePinOffset(createPin({ x: 1, y: 2 }), 0.3), { dx: 0, dy: 0 }));

test('offsets ease between keyframes and wrap around the loop', () => {
  let pin = setKeyframe(createPin({ x: 0, y: 0 }), 0, { dx: 0, dy: 0 });
  pin = setKeyframe(pin, 0.5, { dx: 0, dy: -10 });
  assert.deepEqual(samplePinOffset(pin, 0.5), { dx: 0, dy: -10 });
  assert.ok(Math.abs(samplePinOffset(pin, 0.25).dy + 5) < 1e-9);
  assert.ok(Math.abs(samplePinOffset(pin, 0.75).dy + 5) < 1e-9);
});

test('a keyframe close to an existing one replaces it', () => {
  let pin = setKeyframe(createPin({ x: 0, y: 0 }), 0.5, { dx: 1, dy: 1 });
  pin = setKeyframe(pin, 0.5 + 1 / 240, { dx: 2, dy: 7 });
  assert.equal(pin.keyframes.length, 1);
  assert.equal(pin.keyframes[0].dy, 7);
});

test('setKeyframe keeps keyframes sorted and does not mutate; removeKeyframe removes', () => {
  const base = createPin({ x: 0, y: 0 });
  const a = setKeyframe(base, 0.6, { dx: 1, dy: 0 });
  const b = setKeyframe(a, 0.1, { dx: 2, dy: 0 });
  assert.deepEqual(base.keyframes, []);
  assert.deepEqual(
    b.keyframes.map((k) => k.t),
    [0.1, 0.6],
  );
  assert.deepEqual(
    removeKeyframe(b, 0.6).keyframes.map((k) => k.t),
    [0.1],
  );
});

test('samplePins returns rest and moved positions', () => {
  const pin = setKeyframe(createPin({ x: 10, y: 20 }), 0, { dx: 3, dy: 4 });
  const { rest, moved } = samplePins([pin], 0);
  assert.deepEqual(rest, [{ x: 10, y: 20 }]);
  assert.deepEqual(moved, [{ x: 13, y: 24 }]);
});

test('bob, sway and breathe presets fill keyframes for the selected pins only', () => {
  const p1 = createPin({ x: 0, y: 0 });
  const p2 = createPin({ x: 100, y: 0 });
  const p3 = createPin({ x: 50, y: 50 });
  const pins = [p1, p2, p3];

  const bob = applyPreset(pins, [p1.id], 'bob', { amplitude: 8 });
  assert.deepEqual(bob[0].keyframes, [
    { t: 0, dx: 0, dy: 0 },
    { t: 0.5, dx: 0, dy: -8 },
  ]);
  assert.deepEqual(bob[1].keyframes, []);
  assert.deepEqual(p1.keyframes, []);

  const sway = applyPreset(pins, [p2.id], 'sway', { amplitude: 5 });
  assert.deepEqual(sway[1].keyframes, [
    { t: 0, dx: -5, dy: 0 },
    { t: 0.5, dx: 5, dy: 0 },
  ]);

  const breathe = applyPreset(pins, [p1.id, p2.id], 'breathe', { amplitude: 99 });
  assert.deepEqual(breathe[0].keyframes[0], { t: 0, dx: 0, dy: 0 });
  assert.ok(Math.abs(breathe[0].keyframes[1].dx - -1.5) < 1e-9);
  assert.ok(Math.abs(breathe[1].keyframes[1].dx - 1.5) < 1e-9);
  assert.deepEqual(breathe[2], p3);
  assert.deepEqual(ANIMATION_PRESETS, ['bob', 'sway', 'breathe']);
});

test('animation settings clamp duration to 1-4 s in half steps and keep 30 fps', () => {
  assert.equal(normalizeAnimation({ duration: 9 }).duration, 4);
  assert.equal(normalizeAnimation({ duration: 1.2 }).duration, 1);
  assert.equal(normalizeAnimation({ duration: 2 }).fps, 30);
  assert.equal(getFrameTimes(normalizeAnimation({ duration: 2 })).length, 60);
  assert.equal(DEFAULT_ANIMATION.duration, 2);
});

test('normalizeAnimation drops invalid pins and out-of-range keyframes', () => {
  const out = normalizeAnimation({
    pins: [
      {
        id: 'a',
        x: 1,
        y: 2,
        keyframes: [
          { t: 0.2, dx: 1, dy: 1 },
          { t: 1, dx: 5, dy: 5 },
        ],
      },
      { id: 'b', x: NaN, y: 2 },
    ],
  });
  assert.equal(out.pins.length, 1);
  assert.deepEqual(out.pins[0].keyframes, [{ t: 0.2, dx: 1, dy: 1 }]);
  assert.deepEqual(normalizeAnimation(null).pins, []);
});

test('hasMotion is false for anchors only', () => {
  assert.equal(hasMotion({ pins: [createPin({ x: 1, y: 1 })] }), false);
  const moving = setKeyframe(createPin({ x: 1, y: 1 }), 0.5, { dx: 0, dy: 2 });
  assert.equal(hasMotion({ pins: [moving] }), true);
});

test('keyframe merging wraps the loop seam', () => {
  let pin = setKeyframe(createPin({ x: 0, y: 0 }), 0, { dx: 1, dy: 1 });
  pin = setKeyframe(pin, 0.999, { dx: 2, dy: 2 });
  assert.deepEqual(pin.keyframes, [{ t: 0.999, dx: 2, dy: 2 }]);
  pin = setKeyframe(pin, 0, { dx: 3, dy: 3 });
  assert.equal(removeKeyframe(pin, 0.999).keyframes.length, 0);
});
