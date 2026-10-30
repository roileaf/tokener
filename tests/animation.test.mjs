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
  PINGPONG_MAX_KEY,
  removeKeyframe,
  samplePinOffset,
  samplePins,
  setKeyframe,
} from '../scripts/animation.js';

test('a pin without keyframes never moves', () =>
  assert.deepEqual(samplePinOffset(createPin({ x: 1, y: 2 }), 0.3), { dx: 0, dy: 0, rot: 0 }));

test('offsets ease between keyframes and wrap around the loop', () => {
  let pin = setKeyframe(createPin({ x: 0, y: 0 }), 0, { dx: 0, dy: 0 });
  pin = setKeyframe(pin, 0.5, { dx: 0, dy: -10 });
  assert.deepEqual(samplePinOffset(pin, 0.5), { dx: 0, dy: -10, rot: 0 });
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
  assert.deepEqual(ANIMATION_PRESETS, [
    'bob',
    'sway',
    'breathe',
    'flap',
    'wave',
    'hover',
    'shiver',
    'look',
  ]);
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

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

function pinWith(keys, extra = {}) {
  let pin = createPin({ x: 0, y: 0, ...extra });
  for (const [t, v] of keys) pin = setKeyframe(pin, t, v);
  return pin;
}

test("'hold' keeps the previous value until the next keyframe", () => {
  const pin = pinWith([
    [0, { dx: 0, dy: 0, ease: 'hold' }],
    [0.5, { dx: 0, dy: -10 }],
  ]);
  assert.equal(samplePinOffset(pin, 0.49).dy, 0);
  assert.equal(samplePinOffset(pin, 0.5).dy, -10);
});

test("'linear' interpolates evenly", () => {
  const pin = pinWith([
    [0, { dx: 0, dy: 0, ease: 'linear' }],
    [0.5, { dx: 0, dy: -10 }],
  ]);
  near(samplePinOffset(pin, 0.25).dy, -5);
  near(samplePinOffset(pin, 0.1).dy, -2);
});

test('ping-pong mirrors the first half and holds without wrapping', () => {
  const pin = pinWith([
    [0.1, { dx: 0, dy: 0 }],
    [0.6, { dx: 0, dy: -10 }],
  ]);
  for (const t of [0.05, 0.2, 0.3, 0.45]) {
    near(samplePinOffset(pin, t, 'pingpong').dy, samplePinOffset(pin, 1 - t, 'pingpong').dy);
  }
  near(samplePinOffset(pin, 0.5, 'pingpong').dy, -10);
  near(samplePinOffset(pin, 0, 'pingpong').dy, 0);
  assert.equal(samplePinOffset(pin, 0.25, 'loop').dy, samplePinOffset(pin, 0.25).dy);
});

test('rotation adds two satellite control points about the pin', () => {
  const pin = pinWith([[0.5, { dx: 0, dy: 0, rot: Math.PI / 2 }]], { x: 5, y: 7, arm: 10 });
  const { rest, moved } = samplePins([pin], 0.5);
  assert.equal(rest.length, 3);
  assert.deepEqual(rest.slice(1), [
    { x: 15, y: 7 },
    { x: -5, y: 7 },
  ]);
  near(moved[1].x, 5);
  near(moved[1].y, 17);
  near(moved[2].x, 5);
  near(moved[2].y, -3);
});

test('pins without rotation (or without an arm) add no satellites', () => {
  const plain = pinWith([[0.5, { dx: 1, dy: 1 }]], { arm: 10 });
  assert.equal(samplePins([plain], 0.5).moved.length, 1);
  const noArm = pinWith([[0.5, { dx: 0, dy: 0, rot: 1 }]]);
  assert.equal(samplePins([noArm], 0.5).moved.length, 1);
});

test('flap moves selected pins down together and toward their centroid', () => {
  const a = createPin({ x: 0, y: 0 });
  const b = createPin({ x: 100, y: 0 });
  const c = createPin({ x: 50, y: 50 });
  const out = applyPreset([a, b, c], [a.id, b.id], 'flap', { amplitude: 10 });
  const end = (pin) => pin.keyframes.at(-1);
  assert.equal(end(out[0]).dy, 10);
  near(end(out[0]).dx, 3);
  near(end(out[1]).dx, -3);
  assert.deepEqual(out[2], c);
});

test('wave delays each selected pin by 0.12', () => {
  const a = createPin({ x: 0, y: 0 });
  const b = createPin({ x: 10, y: 0 });
  const out = applyPreset([a, b], [a.id, b.id], 'wave', { amplitude: 5 });
  near(samplePinOffset(out[0], 0.5).dx, 5);
  near(samplePinOffset(out[1], 0.62).dx, 5);
  near(samplePinOffset(out[1], 0.12).dx, -5);
  assert.deepEqual(applyPreset([a, b], [a.id], 'wave', { amplitude: 5 }), [a, b]);
});

test('hover moves every pin up together', () => {
  const a = createPin({ x: 0, y: 0 });
  const b = createPin({ x: 10, y: 0 });
  const out = applyPreset([a, b], [a.id], 'hover', { amplitude: 6 });
  for (const pin of out) near(samplePinOffset(pin, 0.5).dy, -6);
});

test('shiver alternates small linear jitter', () => {
  const a = createPin({ x: 0, y: 0 });
  const [pin] = applyPreset([a], [a.id], 'shiver', { amplitude: 8 });
  assert.equal(pin.keyframes.length, 8);
  assert.ok(pin.keyframes.every((k) => k.ease === 'linear'));
  assert.ok(pin.keyframes.every((k) => Math.abs(k.dx) <= 2 + 1e-9 && Math.abs(k.dy) <= 2 + 1e-9));
  assert.ok(pin.keyframes[0].dx * pin.keyframes[1].dx < 0);
});

test('look rotates the selected pin by +-0.18', () => {
  const a = createPin({ x: 0, y: 0, arm: 10 });
  const [pin] = applyPreset([a], [a.id], 'look', { amplitude: 8 });
  near(samplePinOffset(pin, 0).rot, -0.18);
  near(samplePinOffset(pin, 0.5).rot, 0.18);
});

test('old animations normalize to loop/smooth/[] and keep their data', () => {
  const out = normalizeAnimation({
    pins: [{ id: 'a', x: 1, y: 2, keyframes: [{ t: 0.2, dx: 1, dy: 1 }] }],
  });
  assert.equal(out.mode, 'loop');
  assert.deepEqual(out.effects, []);
  assert.equal(normalizeAnimation({ mode: 'pingpong' }).mode, 'pingpong');
  assert.equal(normalizeAnimation({ mode: 'bogus' }).mode, 'loop');
  const rich = normalizeAnimation({
    pins: [
      { id: 'a', x: 1, y: 2, arm: 4, keyframes: [{ t: 0, dx: 0, dy: 0, rot: 1, ease: 'hold' }] },
    ],
  });
  assert.equal(rich.pins[0].arm, 4);
  assert.equal(rich.pins[0].keyframes[0].rot, 1);
  assert.equal(rich.pins[0].keyframes[0].ease, 'hold');
});

test('hasMotion counts rotation and effects', () => {
  const rot = pinWith([[0, { dx: 0, dy: 0, rot: 0.2 }]]);
  assert.equal(hasMotion({ pins: [rot] }), true);
  assert.equal(hasMotion({ pins: [], effects: [{ id: 'e', type: 'wind' }] }), true);
  assert.equal(hasMotion({ pins: [], effects: [] }), false);
});

/** dx of `pin` sampled in ping-pong at n even scrub times over the forward half. */
function forwardHalf(pin, n = 40) {
  return Array.from(
    { length: n + 1 },
    (_, i) => samplePinOffset(pin, (i / n) * 0.5, 'pingpong').dx,
  );
}

test('ping-pong sway swings smoothly over the whole forward half, with no freeze', () => {
  const pin = createPin({ x: 0, y: 0 });
  const [loop] = applyPreset([pin], [pin.id], 'sway', { amplitude: 10 });
  assert.deepEqual(
    loop.keyframes.map((key) => key.t),
    [0, 0.5],
  );
  const [swing] = applyPreset([pin], [pin.id], 'sway', { amplitude: 10, mode: 'pingpong' });
  assert.deepEqual(
    swing.keyframes.map((key) => [key.t, key.dx]),
    [
      [0, -10],
      [PINGPONG_MAX_KEY, 10],
    ],
  );
  const values = forwardHalf(swing);
  assert.equal(values[0], -10);
  assert.ok(Math.abs(values[values.length - 1] - 10) < 1e-9);
  // Strictly increasing over the forward half: still moving in its last quarter.
  for (let i = 1; i < values.length - 1; i += 1) assert.ok(values[i] > values[i - 1], `step ${i}`);
  assert.ok(values[30] < 9.5, 'no freeze after the first quarter');
  // The way back mirrors the way out.
  for (const t of [0.1, 0.3, 0.45])
    assert.ok(
      Math.abs(
        samplePinOffset(swing, t, 'pingpong').dx - samplePinOffset(swing, 1 - t, 'pingpong').dx,
      ) < 1e-9,
    );
});

test('ping-pong presets peak at the apex instead of 0.5', () => {
  const pins = [createPin({ x: 0, y: 0 }), createPin({ x: 20, y: 30 })];
  const ids = pins.map((pin) => pin.id);
  for (const preset of ['bob', 'breathe', 'flap', 'look', 'hover']) {
    const next = applyPreset(pins, ids, preset, { amplitude: 6, mode: 'pingpong' });
    for (const pin of next)
      assert.deepEqual(
        pin.keyframes.map((key) => key.t),
        [0, PINGPONG_MAX_KEY],
        preset,
      );
  }
  const [shiver] = applyPreset(pins, [ids[0]], 'shiver', { amplitude: 8, mode: 'pingpong' });
  assert.equal(shiver.keyframes.length, 8);
  assert.equal(shiver.keyframes[0].t, 0);
  assert.ok(Math.abs(shiver.keyframes[7].t - PINGPONG_MAX_KEY) < 1e-12);
  assert.ok(shiver.keyframes.every((key) => key.ease === 'linear'));
});

test('ping-pong wave delays each pin start and keeps the follow-through order', () => {
  const pins = [0, 1, 2, 3, 4].map((i) => createPin({ x: i * 10, y: 0 }));
  const ids = pins.map((pin) => pin.id);
  const waved = applyPreset(pins, ids, 'wave', { amplitude: 10, mode: 'pingpong' });
  assert.deepEqual(
    waved[0].keyframes.map((key) => [key.t, key.dx]),
    [
      [0, -10],
      [PINGPONG_MAX_KEY, 10],
    ],
  );
  const starts = [0.24, 0.48, 0.72, 0.9];
  waved.slice(1).forEach((pin, i) => {
    assert.equal(pin.keyframes.length, 3);
    assert.ok(Math.abs(pin.keyframes[1].t - starts[i]) < 1e-12, `pin ${i + 1}`);
    assert.equal(pin.keyframes[1].dx, -10);
    assert.equal(pin.keyframes[2].t, PINGPONG_MAX_KEY);
  });
  // At every scrub time of the forward half a later pin is never ahead of an earlier one, and
  // everything reaches the peak together at the apex.
  for (let i = 1; i < 40; i += 1) {
    const t = (i / 40) * 0.5;
    const values = waved.map((pin) => samplePinOffset(pin, t, 'pingpong').dx);
    for (let k = 1; k < values.length; k += 1) assert.ok(values[k] <= values[k - 1] + 1e-9);
  }
  for (const pin of waved)
    assert.ok(Math.abs(samplePinOffset(pin, 0.5, 'pingpong').dx - 10) < 1e-9);
  // Each pin keeps moving after its start: no freeze before the apex.
  for (const pin of waved) {
    const values = forwardHalf(pin);
    assert.ok(values[38] > values[36], 'still moving near the apex');
  }
});

test('normalizeAnimation keeps a safe pin region key and drops an unsafe one', () => {
  const out = normalizeAnimation({
    pins: [
      { id: 'a', x: 1, y: 2, region: 'a', keyframes: [] },
      { id: 'b', x: 1, y: 2, region: '../x', keyframes: [] },
      { id: 'c', x: 1, y: 2, keyframes: [] },
    ],
  });
  assert.equal(out.pins[0].region, 'a');
  assert.equal('region' in out.pins[1], false);
  assert.equal('region' in out.pins[2], false);
});

test('a preset records itself on the pins it writes; editing a keyframe clears it', () => {
  const a = { ...createPin({ x: 0, y: 0 }), id: 'a' };
  const b = { ...createPin({ x: 10, y: 0 }), id: 'b' };
  const bobbed = applyPreset([a, b], ['a'], 'bob', { amplitude: 4 });
  assert.equal(bobbed[0].preset, 'bob');
  assert.equal(bobbed[1].preset, undefined, 'an unselected pin is left alone');
  // Hover writes every pin.
  assert.deepEqual(
    applyPreset([a, b], [], 'hover', { amplitude: 4 }).map((pin) => pin.preset),
    ['hover', 'hover'],
  );
  // A hand edit makes the motion the user's own.
  assert.equal(setKeyframe(bobbed[0], 0.25, { dx: 1, dy: 0 }).preset, undefined);
  assert.equal(removeKeyframe(bobbed[0], 0.5).preset, undefined);
  // Saved with the project, when it names a preset.
  const [kept, dropped] = normalizeAnimation({
    pins: [
      { ...bobbed[0], preset: 'bob' },
      { ...b, preset: 'nonsense' },
    ],
  }).pins;
  assert.equal(kept.preset, 'bob');
  assert.equal(dropped.preset, undefined);
});
