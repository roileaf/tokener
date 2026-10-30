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
  renderAnimationFrame,
  shouldBendPreview,
} from '../scripts/token-animation.js';
import { drawTokenFrame, getTokenFrameLayout } from '../scripts/token-composer.js';

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
  assert.equal(isPresetAvailable(one, [], 'breathe'), false);
  assert.equal(isPresetAvailable(two, [], 'breathe'), true);
  assert.equal(isPresetAvailable(one, ['a'], 'bob'), true);
  assert.equal(isPresetAvailable(one, [], 'sway'), false);
});

test('pin hit radius follows CSS scaling of the preview canvas and viewport zoom', () => {
  assert.equal(getPinHitRadius({ radius: 10, canvasWidth: 600, clientWidth: 300 }), 20);
  assert.equal(
    getPinHitRadius({ radius: 10, viewportScale: 2, canvasWidth: 600, clientWidth: 300 }),
    10,
  );
  assert.equal(getPinHitRadius({ radius: 10, canvasWidth: 600, clientWidth: 0 }), 10);
});

function alphaAt(canvas, x, y) {
  return pixels(canvas)[(y * canvas.width + x) * 4 + 3];
}

test('a rotating pin turns the art around it', () => {
  const cutout = createCanvas(40, 40);
  const context = cutout.getContext('2d');
  context.fillStyle = '#c03020';
  context.fillRect(6, 18, 28, 4);
  const pins = [
    {
      id: 'p',
      x: 20,
      y: 20,
      arm: 10,
      keyframes: [
        { t: 0, dx: 0, dy: 0, rot: 0 },
        { t: 0.5, dx: 0, dy: 0, rot: Math.PI / 2 },
      ],
    },
  ];
  const run = (t) =>
    bendTokenArt({
      cutout,
      view: VIEW,
      size: 40,
      animation: { duration: 2, fps: 30, mode: 'loop', pins },
      t,
      createCanvas,
    }).art;
  const flat = run(0);
  assert.ok(alphaAt(flat, 12, 20) > 128, 'bar is horizontal at rest');
  assert.ok(alphaAt(flat, 20, 12) < 128);
  const turned = run(0.5);
  assert.ok(alphaAt(turned, 20, 12) > 128, 'opaque above the pin');
  assert.ok(alphaAt(turned, 20, 28) > 128, 'opaque below the pin');
  assert.ok(alphaAt(turned, 10, 20) < 128, 'transparent left at arm distance');
  assert.ok(alphaAt(turned, 30, 20) < 128, 'transparent right at arm distance');
});

test('ping-pong animation bends the same at t and 1-t', () => {
  const cutout = makeCutout();
  const pins = [
    pin([
      { t: 0, dx: 0, dy: 0 },
      { t: 0.3, dx: 0, dy: -6 },
    ]),
  ];
  const run = (t) =>
    bendTokenArt({
      cutout,
      view: VIEW,
      size: SIZE,
      animation: { duration: 2, fps: 30, mode: 'pingpong', pins },
      t,
      createCanvas,
    }).art;
  assert.deepEqual(pixels(run(0.1)), pixels(run(0.9)));
  assert.notDeepEqual(pixels(run(0.1)), pixels(run(0)));
});

test('bend margin covers a rotated satellite', () => {
  const pins = [
    {
      id: 'p',
      x: 20,
      y: 20,
      arm: 10,
      keyframes: [
        { t: 0, dx: 0, dy: 0, rot: 0 },
        { t: 0.5, dx: 0, dy: 0, rot: Math.PI / 2 },
      ],
    },
  ];
  assert.ok(getBendMargin(pins, 1, 40) >= 15);
});

/** A 40x20 cut-out: red body with a green square at (14..20, 12..18); the region marks the square. */
function makeRegionArt() {
  const cutout = createCanvas(40, 20);
  const context = cutout.getContext('2d');
  context.fillStyle = '#c03020';
  context.fillRect(4, 4, 32, 14);
  context.fillStyle = '#20c040';
  context.fillRect(14, 12, 6, 6);
  const region = createCanvas(40, 20);
  const regionContext = region.getContext('2d');
  regionContext.fillStyle = '#ffffff';
  regionContext.fillRect(14, 12, 6, 6);
  return { cutout, region };
}

function plainDraw(context, bent, size) {
  context.clearRect(0, 0, size, size);
  if (bent) context.drawImage(bent.art, 0, 0);
}

test('regions follow the art when the view changes', () => {
  const { cutout, region } = makeRegionArt();
  const size = 64;
  const animation = {
    duration: 2,
    fps: 30,
    pins: [],
    // Wobble forces the warp path, so region and art must share the same grid.
    effects: [
      { id: 'fx', type: 'flicker', region: 'eyes', amount: 0, kind: 'opacity', speed: 3 },
      { id: 'wb', type: 'wobble', region: null, strength: 3, scale: 40 },
    ],
  };
  for (const view of [
    { zoom: 1, offsetX: 0, offsetY: 0 },
    { zoom: 1.6, offsetX: 0.2, offsetY: -0.1 },
  ]) {
    const context = createCanvas(size, size).getContext('2d');
    const bent = renderAnimationFrame({
      context,
      size,
      t: 0.3,
      art: { cutout, popOutImage: null, regions: { eyes: region } },
      view,
      animation,
      createCanvas,
      drawFrame: (ctx, b) => plainDraw(ctx, b, size),
    });
    const bentRegion = bent.regions.eyes;
    assert.ok(bentRegion, 'bent region exists');
    const regionData = pixels(bentRegion);
    const artData = pixels(bent.art);
    let inside = 0;
    for (let i = 0; i < size * size; i += 1) {
      if (regionData[i * 4 + 3] < 250) continue;
      inside += 1;
      assert.ok(artData[i * 4 + 1] > artData[i * 4], `region pixel ${i} lies on the green square`);
    }
    assert.ok(inside > 10, 'region covers some pixels');
  }
});

test('a wind effect only moves pixels inside its region', () => {
  const size = 128;
  const cutout = createCanvas(128, 128);
  const context = cutout.getContext('2d');
  // Striped art over the whole image, so any displacement shows.
  for (let x = 0; x < 128; x += 4) {
    context.fillStyle = x % 8 ? '#2040c0' : '#e0d020';
    context.fillRect(x, 0, 4, 128);
  }
  const region = createCanvas(128, 128);
  const regionContext = region.getContext('2d');
  regionContext.fillStyle = '#ffffff';
  regionContext.fillRect(0, 0, 40, 128);
  const render = (effects) => {
    const target = createCanvas(size, size);
    renderAnimationFrame({
      context: target.getContext('2d'),
      size,
      t: 0.25,
      art: { cutout, popOutImage: null, regions: { left: region } },
      view: VIEW,
      animation: { duration: 2, fps: 30, pins: [], effects },
      createCanvas,
      drawFrame: (ctx, b) => plainDraw(ctx, b, size),
    });
    return pixels(target);
  };
  const still = render([{ id: 'flat', type: 'flicker', region: null, amount: 0 }]);
  const windy = render([{ id: 'w', type: 'wind', region: 'left', strength: 6, scale: 40 }]);
  let movedInside = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const o = (y * size + x) * 4;
      const diff = Math.abs(still[o] - windy[o]) + Math.abs(still[o + 2] - windy[o + 2]);
      if (x >= 56) assert.ok(diff <= 4, `pixel ${x},${y} outside the region stays put`);
      if (x < 32 && diff > 60) movedInside += 1;
    }
  }
  assert.ok(movedInside > 200, `wind moves the region (${movedInside} pixels changed)`);
});

test('with no effects and no motion, renderAnimationFrame draws the plain still frame', () => {
  const cutout = makeCutout();
  const size = 48;
  const view = { zoom: 1.3, offsetX: 0.1, offsetY: -0.05 };
  const frame = { size, borderWidth: 3, fill: true, fillColor: '#203040' };
  const drawFrame = (ctx, bent) =>
    bent
      ? drawTokenFrame(ctx, bent.art, frame)
      : drawTokenFrame(ctx, cutout, {
          ...frame,
          zoom: view.zoom,
          offsetX: view.offsetX * size,
          offsetY: view.offsetY * size,
        });
  const expected = createCanvas(size, size);
  drawFrame(expected.getContext('2d'), null);
  const actual = createCanvas(size, size);
  renderAnimationFrame({
    context: actual.getContext('2d'),
    size,
    t: 0.4,
    art: { cutout, popOutImage: null, regions: {} },
    view,
    animation: { duration: 2, fps: 30, pins: [pin([{ t: 0, dx: 0, dy: 0 }])], effects: [] },
    createCanvas,
    drawFrame,
  });
  assert.deepEqual(pixels(actual), pixels(expected));
});

test('a whole-figure glow is drawn behind the art, a region glow over it', () => {
  const { cutout, region } = makeRegionArt();
  const size = 64;
  const render = (effect) => {
    const target = createCanvas(size, size);
    renderAnimationFrame({
      context: target.getContext('2d'),
      size,
      t: 0,
      art: { cutout, popOutImage: null, regions: { eyes: region } },
      view: VIEW,
      animation: { duration: 2, fps: 30, pins: [], effects: [effect] },
      createCanvas,
      drawFrame: (ctx, b) => plainDraw(ctx, b, size),
    });
    return pixels(target);
  };
  const glow = { id: 'g', type: 'glow', color: '#0000ff', size: 40, pulse: 0 };
  const layout = getTokenFrameLayout({ imageWidth: 40, imageHeight: 20, size });
  const scale = layout.width / 40;
  const at = (data, x, y) => {
    const o = (Math.floor(layout.y + y * scale) * size + Math.floor(layout.x + x * scale)) * 4;
    return [...data.slice(o, o + 4)];
  };
  const behind = render({ ...glow, region: null });
  // Inside the red body the art is opaque and unchanged; just outside it the aura shows.
  assert.deepEqual(at(behind, 8.5, 8.5).slice(0, 3), [0xc0, 0x30, 0x20]);
  const aura = at(behind, 3, 2);
  assert.ok(aura[3] > 0 && aura[2] > aura[0], `aura outside the body (${aura})`);
  const over = render({ ...glow, region: 'eyes' });
  const eye = at(over, 17, 15);
  assert.ok(eye[2] > 0x40, `region glow brightens the eye (${eye})`);
  assert.deepEqual(at(over, 8.5, 8.5).slice(0, 3), [0xc0, 0x30, 0x20]);
});

test('a whole-figure glow stays inside the frame opening, between the fill and the art', () => {
  const size = 128;
  const glow = { id: 'g', type: 'glow', region: null, color: '#0000ff', size: 12, pulse: 0 };
  const render = (cutout, fill) => {
    const target = createCanvas(size, size);
    renderAnimationFrame({
      context: target.getContext('2d'),
      size,
      t: 0,
      art: { cutout, popOutImage: null, regions: {} },
      view: VIEW,
      animation: { duration: 2, fps: 30, pins: [], effects: [glow] },
      createCanvas,
      drawFrame: (ctx, bent) =>
        drawTokenFrame(ctx, bent.art, { size, borderWidth: 4, fill, fillColor: '#000000' }),
    });
    return pixels(target);
  };
  const cover = createCanvas(200, 200);
  cover.getContext('2d').fillStyle = '#c03020';
  cover.getContext('2d').fillRect(0, 0, 200, 200);
  for (const fill of [false, true]) {
    const data = render(cover, fill);
    for (const [x, y] of [
      [0, 0],
      [size - 1, 0],
      [0, size - 1],
      [size - 1, size - 1],
    ])
      assert.equal(data[(y * size + x) * 4 + 3], 0, `corner ${x},${y} stays transparent`);
  }
  // Art with an edge inside the opening: the aura shows just outside it, over the fill.
  const figure = createCanvas(200, 200);
  figure.getContext('2d').fillStyle = '#c03020';
  figure.getContext('2d').fillRect(60, 60, 80, 80);
  const data = render(figure, true);
  const edge = Math.floor((56 / 200) * size);
  const o = (Math.floor(size / 2) * size + edge) * 4;
  assert.ok(
    data[o + 2] > 10 && data[o + 2] > data[o],
    `glow just outside the art (${data.slice(o, o + 4)})`,
  );
});

test('no-op effects on the bent path still match the plain still frame', () => {
  const cutout = makeCutout();
  const size = 48;
  const view = { zoom: 1.3, offsetX: 0.1, offsetY: -0.05 };
  const frame = { size, borderWidth: 3, fill: true, fillColor: '#203040' };
  const expected = createCanvas(size, size);
  drawTokenFrame(expected.getContext('2d'), cutout, {
    ...frame,
    zoom: view.zoom,
    offsetX: view.offsetX * size,
    offsetY: view.offsetY * size,
  });
  const actual = createCanvas(size, size);
  const bent = renderAnimationFrame({
    context: actual.getContext('2d'),
    size,
    t: 0.4,
    art: { cutout, popOutImage: null, regions: {} },
    view,
    animation: {
      duration: 2,
      fps: 30,
      pins: [],
      effects: [{ id: 'f', type: 'flicker', region: null, amount: 0, kind: 'opacity', speed: 3 }],
    },
    createCanvas,
    drawFrame: (ctx, b) => drawTokenFrame(ctx, b.art, frame),
  });
  assert.ok(bent, 'the bent path ran');
  const a = pixels(actual);
  const e = pixels(expected);
  for (let i = 0; i < a.length; i += 1)
    assert.ok(Math.abs(a[i] - e[i]) <= 1, `channel ${i}: ${a[i]} vs ${e[i]}`);
});

test('glow size is given at the 480 px reference token', () => {
  // A small dot in the middle of a square cut-out, so the aura never reaches the canvas edge.
  const cutout = createCanvas(100, 100);
  cutout.getContext('2d').fillStyle = '#c03020';
  cutout.getContext('2d').fillRect(45, 45, 10, 10);
  const reach = (size) => {
    const target = createCanvas(size, size);
    renderAnimationFrame({
      context: target.getContext('2d'),
      size,
      t: 0,
      art: { cutout, popOutImage: null, regions: {} },
      view: VIEW,
      animation: {
        duration: 2,
        fps: 30,
        pins: [],
        effects: [{ id: 'g', type: 'glow', region: null, color: '#0000ff', size: 40, pulse: 0 }],
      },
      createCanvas,
      drawFrame: (ctx, b) => plainDraw(ctx, b, size),
    });
    const data = pixels(target);
    const y = Math.floor(size / 2);
    let x = Math.ceil(size * 0.55);
    while (x < size && data[(y * size + x) * 4 + 3] > 0) x += 1;
    return (x - size * 0.55) / size;
  };
  // A size-40 glow reaches about 40/480 of the token, whatever the token size.
  const small = reach(96);
  const large = reach(480);
  assert.ok(Math.abs(small - large) < 0.02, `${small} vs ${large}`);
  assert.ok(large > 0.06 && large < 0.11, `reach ${large}`);
});

test('a region pin moves its painted area as one piece and leaves the rest still', () => {
  const size = 128;
  const cutout = createCanvas(128, 128);
  const context = cutout.getContext('2d');
  for (let x = 0; x < 128; x += 4) {
    context.fillStyle = x % 8 ? '#2040c0' : '#e0d020';
    context.fillRect(x, 0, 4, 128);
  }
  const region = createCanvas(128, 128);
  const regionContext = region.getContext('2d');
  regionContext.fillStyle = '#ffffff';
  regionContext.fillRect(0, 0, 40, 40);
  const render = (pins) => {
    const target = createCanvas(size, size);
    renderAnimationFrame({
      context: target.getContext('2d'),
      size,
      t: 0.5,
      art: { cutout, popOutImage: null, regions: { wing: region } },
      view: VIEW,
      animation: {
        duration: 2,
        fps: 30,
        pins,
        // A no-op effect keeps both renders on the bent path.
        effects: [{ id: 'flat', type: 'flicker', region: null, amount: 0 }],
      },
      createCanvas,
      drawFrame: (ctx, b) => plainDraw(ctx, b, size),
    });
    return pixels(target);
  };
  const keyframes = [
    { t: 0, dx: 0, dy: 0 },
    { t: 0.5, dx: 4, dy: 0 },
  ];
  const still = render([{ id: 'p', x: 20, y: 20, keyframes: [] }]);
  const moved = render([{ id: 'p', x: 20, y: 20, region: 'wing', keyframes }]);
  let shifted = 0;
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const o = (y * size + x) * 4;
      // Far from the region the art stays exactly where it was (a plain pin would move it all).
      if (x >= 96 || y >= 96) assert.ok(Math.abs(still[o] - moved[o]) <= 4, `${x},${y} stays`);
      // Inside, the stripes are shifted by 4 px, which swaps their colours.
      if (x >= 8 && x < 32 && y >= 8 && y < 32 && Math.abs(still[o] - moved[o]) > 100) shifted += 1;
    }
  assert.ok(shifted > 400, `the region moved (${shifted} pixels)`);
});

test('a region pin without paint yet bends like a plain pin', () => {
  const cutout = makeCutout();
  const keyframes = [
    { t: 0, dx: 0, dy: 0 },
    { t: 0.5, dx: 0, dy: -6 },
  ];
  const plain = bend(cutout, null, [pin(keyframes)], 0.5);
  const unpainted = bend(cutout, null, [{ ...pin(keyframes), region: 'missing' }], 0.5);
  assert.deepEqual(pixels(unpainted.art), pixels(plain.art));
});

test('particles and region glow stay inside the effect clip', () => {
  const size = 64;
  // Art across the whole token, so particles spawn everywhere.
  const cutout = createCanvas(size, size);
  const cutoutContext = cutout.getContext('2d');
  cutoutContext.fillStyle = '#4060c0';
  cutoutContext.fillRect(0, 0, size, size);
  const animation = {
    duration: 2,
    fps: 30,
    pins: [],
    effects: [{ id: 'p', type: 'particles', region: null, kind: 'bubbles', count: 60, size: 4 }],
  };
  const clip = { x: size / 2, y: size / 2, radius: 16 };
  const outside = (canvas) => {
    const data = pixels(canvas);
    let count = 0;
    for (let y = 0; y < size; y += 1)
      for (let x = 0; x < size; x += 1)
        if (
          Math.hypot(x + 0.5 - clip.x, y + 0.5 - clip.y) > clip.radius + 1 &&
          data[(y * size + x) * 4 + 3]
        )
          count += 1;
    return count;
  };
  const render = (effectClip) => {
    const canvas = createCanvas(size, size);
    for (const t of [0.1, 0.4, 0.7])
      renderAnimationFrame({
        context: canvas.getContext('2d'),
        size,
        t,
        art: { cutout, popOutImage: null, regions: {} },
        view: VIEW,
        animation,
        createCanvas,
        // The frame draws nothing, so only effects reach the canvas.
        drawFrame: () => {},
        effectClip,
      });
    return canvas;
  };
  assert.ok(outside(render(null)) > 0, 'unclipped particles reach the corners');
  assert.equal(outside(render(clip)), 0);
});

test('a region pin hands back its region moved with the art, for the preview tint', () => {
  const size = 160;
  // A green square in the art, and the same square painted as the pin's region.
  const cutout = createCanvas(size, size);
  const art = cutout.getContext('2d');
  art.fillStyle = '#c03020';
  art.fillRect(0, 0, size, size);
  art.fillStyle = '#00ff00';
  art.fillRect(60, 60, 40, 40);
  const region = createCanvas(size, size);
  region.getContext('2d').fillStyle = '#ffffff';
  region.getContext('2d').fillRect(60, 60, 40, 40);
  const pin = {
    id: 'p',
    x: 80,
    y: 80,
    arm: 0,
    region: 'p',
    keyframes: [
      { t: 0, dx: 8, dy: 0 },
      { t: 0.5, dx: 8, dy: 0 },
    ],
  };
  const bent = renderAnimationFrame({
    context: createCanvas(size, size).getContext('2d'),
    size,
    t: 0.25,
    art: { cutout, popOutImage: null, regions: { p: region } },
    view: VIEW,
    animation: { duration: 2, fps: 30, mode: 'loop', pins: [pin], effects: [] },
    createCanvas,
    drawFrame: () => {},
  });
  assert.ok(bent.regions.p, 'the pin region is bent too');
  const regionRow = bent.regions.p.getContext('2d').getImageData(0, 80, size, 1).data;
  const artRow = bent.art.getContext('2d').getImageData(0, 80, size, 1).data;
  const inRegion = (x) => regionRow[x * 4 + 3] > 128;
  const green = (x) => artRow[x * 4 + 1] > 128 && artRow[x * 4] < 128;
  const edges = (inside) => {
    let first = -1;
    let last = -1;
    for (let x = 0; x < size; x += 1)
      if (inside(x)) {
        if (first < 0) first = x;
        last = x;
      }
    return [first, last];
  };
  const [regionLeft, regionRight] = edges(inRegion);
  const [artLeft, artRight] = edges(green);
  // The tint lies on the art, to within the anti-aliased edge pixel.
  assert.ok(Math.abs(regionLeft - artLeft) <= 1, `left ${regionLeft} vs ${artLeft}`);
  assert.ok(Math.abs(regionRight - artRight) <= 1, `right ${regionRight} vs ${artRight}`);
  assert.ok(regionLeft >= 64, `the region moved right with the pin (left edge ${regionLeft})`);
});

test('a region moved further than its soft edge still moves whole, not squashed in place', () => {
  const size = 480;
  const cutout = createCanvas(size, size);
  const art = cutout.getContext('2d');
  art.fillStyle = '#c03020';
  art.fillRect(0, 0, size, size);
  art.fillStyle = '#00ff00';
  art.fillRect(190, 190, 100, 100);
  const region = createCanvas(size, size);
  region.getContext('2d').fillStyle = '#ffffff';
  region.getContext('2d').fillRect(190, 190, 100, 100);
  for (const [dx, rot] of [
    [60, 0],
    [100, 0],
    [0, 0.5],
  ]) {
    const pin = {
      id: 'p',
      x: 240,
      y: 240,
      arm: 0,
      region: 'p',
      keyframes: [
        { t: 0, dx, dy: 0, rot },
        { t: 0.5, dx, dy: 0, rot },
      ],
    };
    const bent = renderAnimationFrame({
      context: createCanvas(size, size).getContext('2d'),
      size,
      t: 0.25,
      art: { cutout, popOutImage: null, regions: { p: region } },
      view: VIEW,
      animation: { duration: 2, fps: 30, mode: 'loop', pins: [pin], effects: [] },
      createCanvas,
      drawFrame: () => {},
    });
    const row = bent.art.getContext('2d').getImageData(0, 240, size, 1).data;
    let left = -1;
    let right = -1;
    for (let x = 0; x < size; x += 1)
      if (row[x * 4 + 1] > 128 && row[x * 4] < 128) {
        if (left < 0) left = x;
        right = x;
      }
    // Moved rigidly: shifted by dx, or (turned half a radian about its centre) as wide as the
    // square's diagonal reach along the row, never smeared from its old place.
    if (rot) {
      const half = 50 / Math.cos(rot);
      assert.ok(Math.abs(left - (240 - half)) <= 4, `turned: left ${left}`);
      assert.ok(Math.abs(right - (240 + half)) <= 4, `turned: right ${right}`);
    } else {
      assert.ok(Math.abs(left - (190 + dx)) <= 3, `dx ${dx}: left ${left}`);
      assert.ok(Math.abs(right - (289 + dx)) <= 3, `dx ${dx}: right ${right}`);
    }
  }
});
