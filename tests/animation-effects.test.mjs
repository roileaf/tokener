import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from 'canvas';
import {
  EFFECT_SUPPORTS_REGION,
  EFFECT_TYPES,
  PARTICLE_KINDS,
  isEffectActive,
  isSafeEffectKey,
  createEffect,
  normalizeEffects,
  getDisplacement,
  getFlickerFactor,
  drawGlow,
  drawParticles,
  getEmitterPoints,
} from '../scripts/animation-effects.js';

const SIZE = 64;

function disc(radius = 14, cx = 32, cy = 32) {
  const canvas = createCanvas(SIZE, SIZE);
  const c = canvas.getContext('2d');
  c.fillStyle = '#fff';
  c.beginPath();
  c.arc(cx, cy, radius, 0, Math.PI * 2);
  c.fill();
  return canvas;
}

function alphaAt(canvas, x, y) {
  return canvas.getContext('2d').getImageData(x, y, 1, 1).data[3];
}

test('createEffect uses spec defaults and unique string ids', () => {
  assert.deepEqual(EFFECT_TYPES, ['wind', 'wobble', 'flicker', 'glow', 'particles']);
  assert.deepEqual(PARTICLE_KINDS, ['embers', 'smoke', 'sparkles', 'snow', 'drips']);
  const wind = createEffect('wind', { region: 'r1' });
  assert.equal(wind.type, 'wind');
  assert.equal(wind.region, 'r1');
  assert.equal(wind.strength, 4);
  assert.equal(wind.scale, 24);
  assert.equal(createEffect('wobble').strength, 3);
  assert.equal(createEffect('wobble').scale, 40);
  const flicker = createEffect('flicker');
  assert.equal(flicker.amount, 0.25);
  assert.equal(flicker.speed, 3);
  assert.equal(flicker.kind, 'opacity');
  const glow = createEffect('glow');
  assert.equal(glow.color, '#8fd3ff');
  assert.equal(glow.size, 10);
  assert.equal(glow.pulse, 0.5);
  const particles = createEffect('particles');
  assert.equal(particles.count, 24);
  assert.equal(particles.size, 3);
  assert.equal(particles.region, null);
  assert.equal(typeof wind.id, 'string');
  assert.notEqual(createEffect('wind').id, createEffect('wind').id);
  assert.throws(() => createEffect('nope'));
});

test('normalizeEffects drops unknown types and clamps params', () => {
  const list = normalizeEffects([
    { id: 'a', type: 'wind', strength: 999, scale: -5, region: 'r' },
    { id: 'b', type: 'bogus' },
    null,
    { type: 'flicker', amount: 3, speed: 2.6, kind: 'weird' },
    { id: 'c', type: 'glow', pulse: -1, size: 500, color: 'nope' },
    { id: 'd', type: 'particles', count: 9999, kind: 'lava', size: 0 },
  ]);
  assert.equal(list.length, 4);
  assert.ok(list[0].strength <= 40 && list[0].scale >= 16);
  assert.equal(list[0].region, 'r');
  assert.equal(list[1].amount, 1);
  assert.equal(list[1].speed, 3);
  assert.equal(list[1].kind, 'opacity');
  assert.equal(typeof list[1].id, 'string');
  assert.equal(list[2].pulse, 0);
  assert.equal(list[2].color, '#8fd3ff');
  assert.ok(list[2].size <= 60);
  assert.ok(list[3].count <= 200 && list[3].size >= 1);
  assert.equal(list[3].kind, 'embers');
  assert.deepEqual(normalizeEffects(undefined), []);
});

test('displacement is periodic, zero at strength 0, and nonzero otherwise', () => {
  for (const type of ['wind', 'wobble']) {
    const effect = createEffect(type);
    const a = getDisplacement(effect, 20, 30, 0);
    const b = getDisplacement(effect, 20, 30, 1);
    assert.ok(Math.abs(a.dx - b.dx) < 1e-9 && Math.abs(a.dy - b.dy) < 1e-9);
    const mid = getDisplacement(effect, 20, 30, 0.3);
    assert.ok(Math.hypot(mid.dx, mid.dy) > 0.01);
    const off = getDisplacement({ ...effect, strength: 0 }, 20, 30, 0.3);
    assert.deepEqual(off, { dx: 0, dy: 0 });
  }
  const wind = createEffect('wind');
  const p = getDisplacement(wind, 10, 10, 0.25);
  const q = getDisplacement(wind, 90, 70, 0.25);
  assert.notDeepEqual(p, q);
  assert.deepEqual(getDisplacement(createEffect('glow'), 1, 1, 0.5), { dx: 0, dy: 0 });
});

test('flicker stays in [1-amount, 1] and is periodic', () => {
  const effect = createEffect('flicker');
  let min = 1;
  for (let i = 0; i <= 60; i += 1) {
    const v = getFlickerFactor(effect, i / 60);
    assert.ok(v >= 1 - effect.amount - 1e-9 && v <= 1 + 1e-9);
    min = Math.min(min, v);
  }
  assert.ok(min < 1 - effect.amount / 2);
  assert.ok(Math.abs(getFlickerFactor(effect, 0) - getFlickerFactor(effect, 1)) < 1e-9);
  assert.equal(getFlickerFactor({ ...effect, amount: 0 }, 0.4), 1);
});

test('glow behind adds alpha outside the silhouette; over brightens only the region', () => {
  const art = disc();
  const effect = createEffect('glow');
  const target = createCanvas(SIZE, SIZE);
  drawGlow(target.getContext('2d'), {
    effect,
    art,
    region: null,
    t: 0.5,
    size: SIZE,
    createCanvas,
    phase: 'behind',
  });
  assert.ok(alphaAt(target, 32 + 14 + 3, 32) > 0, 'aura outside silhouette');
  assert.equal(alphaAt(target, 2, 2), 0, 'far corner untouched');

  const none = createCanvas(SIZE, SIZE);
  drawGlow(none.getContext('2d'), {
    effect,
    art,
    region: null,
    t: 0.5,
    size: SIZE,
    createCanvas,
    phase: 'over',
  });
  assert.equal(alphaAt(none, 32, 32), 0, 'over without region draws nothing');

  const region = createCanvas(SIZE, SIZE);
  const rc = region.getContext('2d');
  rc.fillStyle = '#fff';
  rc.fillRect(26, 26, 6, 6);
  const over = createCanvas(SIZE, SIZE);
  const oc = over.getContext('2d');
  oc.fillStyle = '#000';
  oc.fillRect(0, 0, SIZE, SIZE);
  drawGlow(oc, { effect, art, region, t: 0.5, size: SIZE, createCanvas, phase: 'over' });
  const bright = oc.getImageData(28, 28, 1, 1).data;
  const dark = oc.getImageData(40, 40, 1, 1).data;
  assert.ok(bright[0] + bright[1] + bright[2] > 100);
  assert.equal(dark[0] + dark[1] + dark[2], 0);
  const behindRegion = createCanvas(SIZE, SIZE);
  drawGlow(behindRegion.getContext('2d'), {
    effect,
    art,
    region,
    t: 0.5,
    size: SIZE,
    createCanvas,
    phase: 'behind',
  });
  assert.equal(alphaAt(behindRegion, 32 + 14 + 3, 32), 0, 'region glow has no behind aura');
});

test('glow is periodic', () => {
  const art = disc();
  const effect = { ...createEffect('glow'), pulse: 1 };
  const render = (t) => {
    const canvas = createCanvas(SIZE, SIZE);
    drawGlow(canvas.getContext('2d'), {
      effect,
      art,
      region: null,
      t,
      size: SIZE,
      createCanvas,
      phase: 'behind',
    });
    return canvas.toBuffer('raw');
  };
  assert.ok(render(0).equals(render(1)));
});

test('getEmitterPoints is deterministic, in token space and within the region', () => {
  const art = disc();
  const region = createCanvas(SIZE, SIZE);
  const rc = region.getContext('2d');
  rc.fillStyle = '#fff';
  rc.fillRect(10, 10, 10, 10);
  const a = getEmitterPoints({ art, region, size: SIZE, createCanvas, count: 20, seed: 'x' });
  const b = getEmitterPoints({ art, region, size: SIZE, createCanvas, count: 20, seed: 'x' });
  assert.deepEqual(a, b);
  assert.equal(a.length, 20);
  for (const p of a) assert.ok(p.x >= 9 && p.x <= 21 && p.y >= 9 && p.y <= 21);
  const edge = getEmitterPoints({
    art,
    region: null,
    size: SIZE,
    createCanvas,
    count: 30,
    seed: 'y',
  });
  assert.equal(edge.length, 30);
  for (const p of edge) {
    const d = Math.hypot(p.x - 32, p.y - 32);
    assert.ok(d > 10 && d < 18, `edge point distance ${d}`);
  }
  const empty = getEmitterPoints({
    art: createCanvas(SIZE, SIZE),
    region: null,
    size: SIZE,
    createCanvas,
    seed: 'z',
  });
  assert.deepEqual(empty, []);
});

function particleFrame(effect, emitter, t) {
  const canvas = createCanvas(SIZE, SIZE);
  drawParticles(canvas.getContext('2d'), { effect, emitter, t, size: SIZE });
  return canvas.toBuffer('raw');
}

test('particles are deterministic, periodic, and draw something for every kind', () => {
  const art = disc();
  const emitter = {
    points: getEmitterPoints({ art, region: null, size: SIZE, createCanvas, seed: 'e' }),
  };
  for (const kind of PARTICLE_KINDS) {
    const effect = { ...createEffect('particles'), id: 'fixed', kind };
    const a = particleFrame(effect, emitter, 0.37);
    assert.ok(a.equals(particleFrame(effect, emitter, 0.37)), `${kind} deterministic`);
    assert.ok(particleFrame(effect, emitter, 0).equals(particleFrame(effect, emitter, 1)), kind);
    assert.ok(
      a.some((v) => v !== 0),
      `${kind} draws pixels`,
    );
  }
  const other = { ...createEffect('particles'), id: 'other' };
  const first = { ...other, id: 'fixed' };
  assert.ok(!particleFrame(other, emitter, 0.37).equals(particleFrame(first, emitter, 0.37)));
});

test('particle count is bounded and an empty emitter draws nothing', () => {
  const emitter = { points: [{ x: 32, y: 32 }] };
  const few = { ...createEffect('particles'), id: 'c', count: 3, size: 2 };
  const many = { ...few, count: 40 };
  const countPixels = (effect) => {
    const buf = particleFrame(effect, emitter, 0.4);
    let n = 0;
    for (let i = 3; i < buf.length; i += 4) if (buf[i]) n += 1;
    return n;
  };
  assert.ok(countPixels(many) > countPixels(few));
  assert.ok(countPixels(many) < SIZE * SIZE);
  assert.ok(particleFrame(many, { points: [] }, 0.4).every((v) => v === 0));
});

test('normalizeEffects uses deterministic fallback ids', () => {
  const a = normalizeEffects([{ type: 'wind' }, { type: 'glow' }]);
  const b = normalizeEffects([{ type: 'wind' }, { type: 'glow' }]);
  assert.deepEqual(a, b);
  assert.deepEqual(
    a.map((e) => e.id),
    ['fx-0', 'fx-1'],
  );
});

test('wind differs between effect ids', () => {
  const one = { ...createEffect('wind'), id: 'one' };
  const two = { ...one, id: 'two' };
  assert.notDeepEqual(getDisplacement(one, 50, 60, 0.2), getDisplacement(two, 50, 60, 0.2));
});

test('max-allowed wind and wobble never fold the 8 px warp mesh', () => {
  for (const type of ['wind', 'wobble']) {
    for (const scale of [16, 24, 40, 100, 200]) {
      const [effect] = normalizeEffects([{ id: 'm', type, strength: 999, scale }]);
      for (const t of [0, 0.125, 0.25, 0.5, 0.75, 0.9]) {
        const grid = [];
        for (let y = 0; y <= 60; y += 1) {
          const row = [];
          for (let x = 0; x <= 60; x += 1) {
            const d = getDisplacement(effect, x * 8, y * 8, t);
            row.push({ x: x * 8 + d.dx, y: y * 8 + d.dy });
          }
          grid.push(row);
        }
        for (let y = 0; y < 60; y += 1) {
          for (let x = 0; x < 60; x += 1) {
            const p = grid[y][x];
            const ex = { x: grid[y][x + 1].x - p.x, y: grid[y][x + 1].y - p.y };
            const ey = { x: grid[y + 1][x].x - p.x, y: grid[y + 1][x].y - p.y };
            const det = (ex.x * ey.y - ex.y * ey.x) / 64;
            assert.ok(det > 0.2, `${type} scale ${scale} t ${t} det ${det}`);
          }
        }
      }
    }
  }
});

test('flicker is whole-figure only: normalizeEffects drops its region', () => {
  assert.deepEqual(EFFECT_SUPPORTS_REGION, {
    wind: true,
    wobble: true,
    flicker: false,
    glow: true,
    particles: true,
  });
  for (const type of EFFECT_TYPES) assert.equal(typeof EFFECT_SUPPORTS_REGION[type], 'boolean');
  const [flicker, glow] = normalizeEffects([
    { id: 'f', type: 'flicker', region: 'f' },
    { id: 'g', type: 'glow', region: 'g' },
  ]);
  assert.equal(flicker.region, null);
  assert.equal(glow.region, 'g');
});

test('normalizeEffects replaces unsafe effect ids and region keys', () => {
  assert.equal(isSafeEffectKey('fx-1_a'), true);
  assert.equal(isSafeEffectKey('a"]'), false);
  assert.equal(isSafeEffectKey(''), false);
  assert.equal(isSafeEffectKey(42), false);
  const effects = normalizeEffects([
    { id: 'ok-1', type: 'wind', region: 'ok-1' },
    { id: 'x"] , *', type: 'glow', region: 'x"] , *' },
    { id: '__proto__ x', type: 'particles', region: 'r 1' },
  ]);
  assert.deepEqual(
    effects.map((effect) => [effect.id, effect.region]),
    [
      ['ok-1', 'ok-1'],
      ['fx-1', null],
      ['fx-2', null],
    ],
  );
  // Deterministic: the same file gives the same ids.
  assert.deepEqual(
    normalizeEffects([{ id: 'a b', type: 'wind' }]).map((effect) => effect.id),
    ['fx-0'],
  );
});

test('isEffectActive: strength / amount must be positive, painted regions must exist', () => {
  const canvas = createCanvas(4, 4);
  assert.equal(
    isEffectActive({ id: 'w', type: 'wind', strength: 0, scale: 24, region: null }),
    false,
  );
  assert.equal(
    isEffectActive({ id: 'w', type: 'wind', strength: 2, scale: 24, region: null }),
    true,
  );
  assert.equal(isEffectActive({ id: 'f', type: 'flicker', amount: 0, region: null }), false);
  assert.equal(isEffectActive({ id: 'f', type: 'flicker', amount: 0.3, region: null }), true);
  assert.equal(isEffectActive(createEffect('glow')), true);
  assert.equal(isEffectActive(createEffect('particles')), true);
  assert.equal(isEffectActive({ id: 'x', type: 'nope' }), false);
  assert.equal(isEffectActive(null), false);
  const painted = { id: 'g', type: 'glow', region: 'g', color: '#ffffff', size: 4, pulse: 0 };
  assert.equal(isEffectActive(painted, {}), false);
  assert.equal(isEffectActive(painted, undefined), false);
  assert.equal(isEffectActive(painted, { g: canvas }), true);
  // Inherited keys never count as a painted region.
  assert.equal(isEffectActive({ ...painted, region: 'constructor' }, {}), false);
  // Flicker ignores a stray region: it always covers the whole figure.
  assert.equal(isEffectActive({ id: 'f', type: 'flicker', amount: 0.3, region: 'f' }, {}), true);
});
