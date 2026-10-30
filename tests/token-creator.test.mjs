import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getAlphaBounds,
  getBorderPalette,
  removeImageBackground,
} from '../scripts/background-removal.js';
import {
  colorizeRingBackground,
  colorizeRingFrame,
  resolveRingColor,
  selectRingFrame,
} from '../scripts/ring-preview.js';
import {
  buildCreatedTokenCandidate,
  buildCreatedTokenFileName,
  getCreatedTokenFolder,
  getAutoPopOutRect,
  getTokenFrameLayout,
  previewPointToImage,
} from '../scripts/token-composer.js';

function createImage(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a = 255] = fill(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
    }
  }
  return { data, width, height };
}

function alphaAt(image, x, y) {
  return image.data[(y * image.width + x) * 4 + 3];
}

test('background removal clears edge-connected background and keeps the subject', () => {
  const image = createImage(10, 10, (x, y) =>
    x >= 3 && x <= 6 && y >= 3 && y <= 6 ? [200, 20, 20] : [20, 200, 20],
  );

  const result = removeImageBackground(image, { tolerance: 30, feather: 0 });

  assert.equal(result, image);
  assert.equal(alphaAt(image, 0, 0), 0);
  assert.equal(alphaAt(image, 9, 9), 0);
  assert.equal(alphaAt(image, 2, 5), 0);
  assert.equal(alphaAt(image, 4, 4), 255);
  assert.equal(alphaAt(image, 6, 6), 255);
});

test('background removal keeps enclosed background-coloured pixels inside the subject', () => {
  const image = createImage(9, 9, (x, y) => {
    if (x === 4 && y === 4) return [20, 200, 20];
    return x >= 2 && x <= 6 && y >= 2 && y <= 6 ? [30, 30, 220] : [20, 200, 20];
  });

  removeImageBackground(image, { tolerance: 30, feather: 0 });

  assert.equal(alphaAt(image, 0, 0), 0);
  assert.equal(alphaAt(image, 4, 4), 255);
});

test('background removal handles a gradient background with several border colours', () => {
  const image = createImage(12, 12, (x, y) =>
    x >= 4 && x <= 7 && y >= 4 && y <= 7 ? [250, 250, 30] : [x * 4, 40, 120 + y * 4],
  );

  removeImageBackground(image, { tolerance: 28, feather: 0 });

  assert.equal(alphaAt(image, 0, 0), 0);
  assert.equal(alphaAt(image, 11, 0), 0);
  assert.equal(alphaAt(image, 0, 11), 0);
  assert.equal(alphaAt(image, 11, 11), 0);
  assert.equal(alphaAt(image, 5, 5), 255);
});

test('background removal feathers subject edges next to removed pixels', () => {
  const image = createImage(10, 10, (x, y) =>
    x >= 3 && x <= 6 && y >= 3 && y <= 6 ? [200, 20, 20] : [20, 200, 20],
  );

  removeImageBackground(image, { tolerance: 30, feather: 1 });

  const edgeAlpha = alphaAt(image, 3, 4);
  assert.ok(edgeAlpha > 0 && edgeAlpha < 255, `edge alpha ${edgeAlpha} should be partial`);
  assert.equal(alphaAt(image, 0, 0), 0);
});

test('background removal leaves already transparent images alone', () => {
  const image = createImage(6, 6, (x, y) =>
    x >= 2 && x <= 3 && y >= 2 && y <= 3 ? [200, 20, 20, 255] : [0, 0, 0, 0],
  );

  removeImageBackground(image, { tolerance: 30, feather: 0 });

  assert.equal(alphaAt(image, 0, 0), 0);
  assert.equal(alphaAt(image, 2, 2), 255);
});

test('border palette groups similar border colours', () => {
  const image = createImage(8, 8, (x) => (x < 4 ? [10, 10, 10] : [240, 240, 240]));
  const palette = getBorderPalette(image);
  assert.equal(palette.length, 2);
});

test('alpha bounds trim transparent padding', () => {
  const image = createImage(10, 8, (x, y) =>
    x >= 2 && x <= 5 && y >= 1 && y <= 6 ? [1, 2, 3, 255] : [0, 0, 0, 0],
  );
  assert.deepEqual(getAlphaBounds(image), { x: 2, y: 1, width: 4, height: 6 });
  assert.equal(getAlphaBounds(createImage(3, 3, () => [0, 0, 0, 0])), null);
});

test('token frame layout covers the frame and applies zoom and offset', () => {
  assert.deepEqual(getTokenFrameLayout({ imageWidth: 200, imageHeight: 400, size: 100 }), {
    x: 0,
    y: -50,
    width: 100,
    height: 200,
  });

  assert.deepEqual(
    getTokenFrameLayout({
      imageWidth: 200,
      imageHeight: 200,
      size: 100,
      zoom: 2,
      offsetX: 10,
      offsetY: -5,
    }),
    { x: -40, y: -55, width: 200, height: 200 },
  );
});

test('created token file names are slugged and timestamped', () => {
  const now = new Date(Date.UTC(2026, 9, 27, 13, 4, 5));
  assert.equal(
    buildCreatedTokenFileName('Goblin War-Chanter!', { now }),
    'goblin-war-chanter-20261027-130405.webp',
  );
  assert.equal(
    buildCreatedTokenFileName('', { now, suffix: 'subject', extension: 'png' }),
    'token-20261027-130405-subject.png',
  );
});

test('created token folder defaults to the current world', () => {
  assert.equal(getCreatedTokenFolder({ worldId: 'my-world' }), 'worlds/my-world/tokener');
  assert.equal(
    getCreatedTokenFolder({ worldId: 'my-world', configured: '/custom/tokens/' }),
    'custom/tokens',
  );
});

test('created token candidate maps token, subject and portrait sources', () => {
  assert.deepEqual(
    buildCreatedTokenCandidate({
      label: 'Goblin',
      tokenSrc: 'worlds/w/tokener/goblin.webp',
      portraitSrc: 'art/goblin.png',
    }),
    {
      id: 'tokener-created:worlds/w/tokener/goblin.webp',
      label: 'Goblin',
      sourceId: 'tokener-created',
      tokenSrc: 'worlds/w/tokener/goblin.webp',
      portraitSrc: 'art/goblin.png',
      scale: 1,
    },
  );

  const withSubject = buildCreatedTokenCandidate({
    label: 'Goblin',
    tokenSrc: 't.webp',
    subjectSrc: 's.webp',
  });
  assert.equal(withSubject.subjectSrc, 's.webp');
  assert.equal(withSubject.subjectScale, 1);
});

test('token updates apply dynamic ring colours from created candidates', async () => {
  const { buildTokenUpdate } = await import('../scripts/actions.js');
  const candidate = buildCreatedTokenCandidate({
    label: 'Goblin',
    tokenSrc: 'subject.webp',
    subjectSrc: 'subject.webp',
    ringColors: { ring: '#aa0000', background: '#001122' },
  });

  const update = buildTokenUpdate(candidate, { profile: { supportsDynamicTokenRing: true } });

  assert.equal(update['ring.enabled'], true);
  assert.equal(update['ring.subject.texture'], 'subject.webp');
  assert.equal(update['ring.subject.scale'], 1);
  assert.equal(update['ring.colors.ring'], '#aa0000');
  assert.equal(update['ring.colors.background'], '#001122');
});

test('revert snapshots restore previous dynamic ring colours', async () => {
  const { buildRevertSnapshot, buildTokenRevertUpdate } = await import('../scripts/actions.js');
  const tokenDocument = {
    texture: { src: 'old.webp', scaleX: 1, scaleY: 1 },
    ring: {
      enabled: false,
      subject: { texture: '', scale: 1 },
      colors: { ring: null, background: '#123456' },
    },
  };
  const snapshot = buildRevertSnapshot({
    action: 'token',
    candidate: { tokenSrc: 'new.webp' },
    tokenDocument,
    profile: { supportsDynamicTokenRing: true },
  });

  const update = buildTokenRevertUpdate(snapshot, { profile: { supportsDynamicTokenRing: true } });

  assert.equal(update['ring.colors.ring'], null);
  assert.equal(update['ring.colors.background'], '#123456');
});

test('background removal keeps subjects cropped by the bottom edge', () => {
  const image = createImage(20, 20, (x, y) =>
    x >= 6 && x <= 13 && y >= 8 ? [220, 220, 180] : [60, 90, 160],
  );

  removeImageBackground(image, { tolerance: 30, feather: 0 });

  assert.equal(alphaAt(image, 0, 19), 0);
  assert.equal(alphaAt(image, 10, 19), 255);
  assert.equal(alphaAt(image, 10, 10), 255);
});

const RING_SHEET = {
  config: { defaultColorBand: { startRadius: 0.6, endRadius: 0.7 }, defaultRingColor: '#400c07' },
  frames: {
    'ring-med-bkg': { frame: { x: 0, y: 0, w: 8, h: 8 } },
    'ring-med': { frame: { x: 8, y: 0, w: 8, h: 8 } },
    'ring-big-bkg': { frame: { x: 0, y: 8, w: 16, h: 16 } },
    'ring-big': {
      frame: { x: 16, y: 8, w: 16, h: 16 },
      gridTarget: 2,
      backgroundColor: '#112233',
      colorBand: { startRadius: 0.5, endRadius: 0.9 },
    },
    'ring-big-msk': { frame: { x: 32, y: 8, w: 16, h: 16 } },
  },
  meta: { image: 'rings.webp' },
};

test('ring frame selection mirrors Foundry grid target matching', () => {
  const medium = selectRingFrame(RING_SHEET, 1);
  assert.equal(medium.ringName, 'ring-med');
  assert.deepEqual(medium.ring, { x: 8, y: 0, w: 8, h: 8 });
  assert.deepEqual(medium.background, { x: 0, y: 0, w: 8, h: 8 });
  assert.equal(medium.mask, null);
  assert.deepEqual(medium.colorBand, { startRadius: 0.6, endRadius: 0.7 });
  assert.equal(medium.defaultRingColor, '#400c07');
  assert.equal(medium.defaultBackgroundColor, null);

  const big = selectRingFrame(RING_SHEET, 3);
  assert.equal(big.ringName, 'ring-big');
  assert.deepEqual(big.mask, { x: 32, y: 8, w: 16, h: 16 });
  assert.deepEqual(big.colorBand, { startRadius: 0.5, endRadius: 0.9 });
  assert.equal(big.defaultBackgroundColor, '#112233');

  assert.equal(selectRingFrame({ frames: {} }, 1), null);
});

test('ring colours fall back to spritesheet defaults like Foundry', () => {
  assert.equal(resolveRingColor(null, '#400c07'), '#400c07');
  assert.equal(resolveRingColor('#ffffff', '#400c07'), '#400c07');
  assert.equal(resolveRingColor('#aa0000', '#400c07'), '#aa0000');
  assert.equal(resolveRingColor(null, null), '#ffffff');
});

test('ring frame colourises only the colour band using the red channel', () => {
  const ring = createImage(10, 10, () => [200, 100, 50, 255]);
  colorizeRingFrame(ring, null, {
    colorBand: { startRadius: 0.55, endRadius: 0.95 },
    ringColor: '#ff0000',
  });

  const pixel = (x, y) => [...ring.data.slice((y * 10 + x) * 4, (y * 10 + x) * 4 + 4)];
  assert.deepEqual(pixel(5, 5), [200, 100, 50, 255]);
  assert.deepEqual(pixel(9, 5), [200, 0, 0, 255]);
  assert.deepEqual(pixel(0, 0), [200, 100, 50, 255]);
});

test('ring background uses overlay tint and ignores white', () => {
  const background = createImage(2, 1, () => [64, 192, 128, 255]);
  colorizeRingBackground(background, '#ffffff');
  assert.deepEqual([...background.data.slice(0, 4)], [64, 192, 128, 255]);

  colorizeRingBackground(background, '#808080');
  assert.deepEqual([...background.data.slice(0, 4)], [64, 192, 128, 255]);
});

test('preview points map back into source image pixels', () => {
  const layout = getTokenFrameLayout({ imageWidth: 200, imageHeight: 400, size: 100, zoom: 2 });
  assert.deepEqual(layout, { x: -50, y: -150, width: 200, height: 400 });
  assert.deepEqual(
    previewPointToImage({ layout, imageWidth: 200, imageHeight: 400, x: 50, y: 50 }),
    {
      x: 100,
      y: 200,
      scale: 1,
    },
  );

  const half = getTokenFrameLayout({ imageWidth: 400, imageHeight: 400, size: 100 });
  assert.deepEqual(
    previewPointToImage({ layout: half, imageWidth: 400, imageHeight: 400, x: 25, y: 75 }),
    {
      x: 100,
      y: 300,
      scale: 4,
    },
  );
});

test('automatic pop-out area spans the token width down to just below the centre', () => {
  const layout = getTokenFrameLayout({ imageWidth: 400, imageHeight: 400, size: 100 });
  assert.deepEqual(
    getAutoPopOutRect({ layout, imageWidth: 400, imageHeight: 400, size: 100, radius: 40 }),
    { x: 0, y: 0, width: 400, height: 256 },
  );
});

test('mask shortcuts map keys to creator commands', async () => {
  const { getMaskShortcut } = await import('../scripts/creator-shortcuts.js');
  assert.equal(getMaskShortcut({ key: 'b' }), 'tool-paint');
  assert.equal(getMaskShortcut({ key: 'E' }), 'tool-erase');
  assert.equal(getMaskShortcut({ key: 'Escape' }), 'tool-move');
  assert.equal(getMaskShortcut({ key: 'x' }), 'swap');
  assert.equal(getMaskShortcut({ key: '[' }), 'brush-smaller');
  assert.equal(getMaskShortcut({ key: ']' }), 'brush-larger');
  assert.equal(getMaskShortcut({ key: 'z', ctrlKey: true }), 'undo');
  assert.equal(getMaskShortcut({ key: 'Z', ctrlKey: true, shiftKey: true }), 'redo');
  assert.equal(getMaskShortcut({ key: 'y', metaKey: true }), 'redo');
  assert.equal(getMaskShortcut({ key: 'b', ctrlKey: true }), null);
  assert.equal(getMaskShortcut({ key: 'k' }), null);
});

test('stroke mode honours modifiers, right button and the active brush', async () => {
  const { getStrokeMode } = await import('../scripts/creator-shortcuts.js');
  assert.equal(getStrokeMode({}), null);
  assert.equal(getStrokeMode({ shiftKey: true }), 'paint');
  assert.equal(getStrokeMode({ altKey: true, tool: 'paint' }), 'erase');
  assert.equal(getStrokeMode({ tool: 'paint' }), 'paint');
  assert.equal(getStrokeMode({ tool: 'paint', button: 2 }), 'erase');
  assert.equal(getStrokeMode({ tool: 'erase', button: 2 }), 'paint');
  assert.equal(getStrokeMode({ button: 2 }), 'erase');
});

test('brush size steps scale with size and stay in range', async () => {
  const { stepBrushSize, MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } =
    await import('../scripts/creator-shortcuts.js');
  assert.equal(stepBrushSize(10, 1), 12);
  assert.equal(stepBrushSize(24, -1), 20);
  assert.equal(stepBrushSize(80, 1), 88);
  assert.equal(stepBrushSize(MIN_BRUSH_SIZE, -1), MIN_BRUSH_SIZE);
  assert.equal(stepBrushSize(MAX_BRUSH_SIZE, 1), MAX_BRUSH_SIZE);
});

test('preview viewport centres the token and maps screen points back', async () => {
  const { getPreviewViewport, viewportPointToToken } = await import('../scripts/token-composer.js');
  assert.deepEqual(getPreviewViewport({ size: 320 }), { x: 0, y: 0, scale: 1, size: 320 });

  const zoomedOut = getPreviewViewport({ size: 320, scale: 0.5, panX: 10, panY: -20 });
  assert.deepEqual(zoomedOut, { x: 90, y: 60, scale: 0.5, size: 160 });
  assert.deepEqual(viewportPointToToken(zoomedOut, { x: 90, y: 60 }), { x: 0, y: 0 });
  assert.deepEqual(viewportPointToToken(zoomedOut, { x: 170, y: 140 }), { x: 160, y: 160 });
});

test('view shortcuts zoom the preview without touching the art', async () => {
  const { getMaskShortcut, stepViewScale, MIN_VIEW_SCALE, MAX_VIEW_SCALE } =
    await import('../scripts/creator-shortcuts.js');
  assert.equal(getMaskShortcut({ key: '-' }), 'view-out');
  assert.equal(getMaskShortcut({ key: '=' }), 'view-in');
  assert.equal(getMaskShortcut({ key: '+' }), 'view-in');
  assert.equal(getMaskShortcut({ key: '0' }), 'view-reset');
  assert.equal(stepViewScale(1, -1), 0.8);
  assert.equal(stepViewScale(1, 1), 1.25);
  assert.equal(stepViewScale(MIN_VIEW_SCALE, -1), MIN_VIEW_SCALE);
  assert.equal(stepViewScale(MAX_VIEW_SCALE, 1), MAX_VIEW_SCALE);
});

test('select tool shortcut is W', async () => {
  const { getMaskShortcut } = await import('../scripts/creator-shortcuts.js');
  assert.equal(getMaskShortcut({ key: 'w' }), 'tool-select');
});

test('SAM helpers pick the best mask and convert it to an alpha mask', async () => {
  const { pickBestMaskIndex, samMaskToImageData, scaleSamPoint } =
    await import('../scripts/ai-tools.js');
  assert.equal(pickBestMaskIndex([0.4, 0.92, 0.7]), 1);
  assert.equal(pickBestMaskIndex(new Float32Array([0.9, 0.1, 0.2])), 0);

  // three 2x2 masks back to back, choose the second
  const data = Uint8Array.from([1, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1]);
  const rgba = samMaskToImageData(data, 2, 2, 1);
  assert.deepEqual([...rgba.filter((_, i) => i % 4 === 3)], [0, 255, 255, 0]);
  assert.deepEqual([...rgba.slice(4, 8)], [255, 255, 255, 255]);

  assert.deepEqual(
    scaleSamPoint({ x: 100, y: 50 }, { height: 400, width: 800 }, { height: 512, width: 1024 }),
    [128, 64],
  );
});

test('portrait rectangles fit the preview for each aspect', async () => {
  const { getPortraitRect } = await import('../scripts/token-composer.js');
  assert.deepEqual(getPortraitRect({ size: 300, aspect: '1:1', imageWidth: 10, imageHeight: 20 }), {
    x: 0,
    y: 0,
    width: 300,
    height: 300,
  });
  assert.deepEqual(getPortraitRect({ size: 300, aspect: '2:3', imageWidth: 10, imageHeight: 20 }), {
    x: 50,
    y: 0,
    width: 200,
    height: 300,
  });
  assert.deepEqual(
    getPortraitRect({ size: 300, aspect: 'original', imageWidth: 400, imageHeight: 200 }),
    { x: 0, y: 75, width: 300, height: 150 },
  );
});

test('rect layouts cover the rectangle like the token layout covers the square', async () => {
  const { getRectFrameLayout, getTokenFrameLayout } = await import('../scripts/token-composer.js');
  assert.deepEqual(
    getRectFrameLayout({ imageWidth: 200, imageHeight: 400, width: 100, height: 100 }),
    getTokenFrameLayout({ imageWidth: 200, imageHeight: 400, size: 100 }),
  );
  assert.deepEqual(
    getRectFrameLayout({
      imageWidth: 400,
      imageHeight: 400,
      width: 200,
      height: 300,
      zoom: 1,
      offsetX: 10,
      offsetY: 0,
    }),
    { x: -40, y: 0, width: 300, height: 300 },
  );
});

test('an untouched portrait reuses the original image', async () => {
  const { isPortraitUnchanged } = await import('../scripts/token-composer.js');
  const view = { zoom: 1, offsetX: 0, offsetY: 0 };
  assert.equal(
    isPortraitUnchanged({ portraitAspect: 'original', portraitBackground: 'original' }, view),
    true,
  );
  assert.equal(
    isPortraitUnchanged({ portraitAspect: '2:3', portraitBackground: 'original' }, view),
    false,
  );
  assert.equal(
    isPortraitUnchanged({ portraitAspect: 'original', portraitBackground: 'transparent' }, view),
    false,
  );
  assert.equal(
    isPortraitUnchanged(
      { portraitAspect: 'original', portraitBackground: 'original' },
      { ...view, zoom: 1.2 },
    ),
    false,
  );
});

test('creator section is found whether it is the part root or a child of it', async () => {
  const { getCreatorSection } = await import('../scripts/token-creator.js');
  const section = { nodeType: 1, matches: (selector) => selector === '.pf2e-tokener-creator' };
  assert.equal(getCreatorSection({ parts: { main: section } }), section);

  const child = { id: 'child' };
  const wrapper = { nodeType: 1, matches: () => false, querySelector: () => child };
  assert.equal(getCreatorSection({ parts: { main: wrapper } }), child);
});

test('model download progress is combined across files', async () => {
  const { createDownloadTracker } = await import('../scripts/ai-tools.js');
  const updates = [];
  const track = createDownloadTracker((percent) => updates.push(percent));
  track({ status: 'initiate', file: 'a.onnx' });
  track({ status: 'progress', file: 'a.onnx', loaded: 50, total: 100 });
  track({ status: 'progress', file: 'b.onnx', loaded: 0, total: 300 });
  track({ status: 'progress', file: 'b.onnx', loaded: 300, total: 300 });
  track({ status: 'done', file: 'a.onnx' });
  assert.deepEqual(updates, [50, 13, 88, 100]);
});

test('model caching needs a secure context with the Cache API', async () => {
  const { canCacheModels } = await import('../scripts/ai-tools.js');
  assert.equal(canCacheModels({ isSecureContext: true, caches: {} }), true);
  assert.equal(canCacheModels({ isSecureContext: false, caches: {} }), false);
  assert.equal(canCacheModels({ isSecureContext: true }), false);
});

test('fill region selects connected pixels similar to the clicked colour', async () => {
  const { getFillRegion } = await import('../scripts/background-removal.js');
  // left half dark, right half light, with a dark island inside the light half
  const image = createImage(10, 6, (x, y) => {
    if (x === 8 && y === 3) return [20, 20, 20];
    return x < 5 ? [20, 20, 20] : [220, 220, 220];
  });
  const region = getFillRegion(image, 1, 1, { tolerance: 30 });
  assert.equal(region[1 * 10 + 1], 1);
  assert.equal(region[5 * 10 + 4], 1);
  assert.equal(region[1 * 10 + 6], 0);
  assert.equal(region[3 * 10 + 8], 0, 'disconnected island stays unselected');
  assert.equal(
    region.reduce((sum, value) => sum + value, 0),
    30,
  );
  assert.equal(
    getFillRegion(image, -1, 2, { tolerance: 30 }).reduce((a, b) => a + b, 0),
    0,
  );
});

test('cleanup tools flip between remove and restore with Alt or right button', async () => {
  const { getStrokeMode, getMaskShortcut, isCleanupTool } =
    await import('../scripts/creator-shortcuts.js');
  assert.equal(getStrokeMode({ tool: 'cut' }), 'cut');
  assert.equal(getStrokeMode({ tool: 'cut', altKey: true }), 'restore');
  assert.equal(getStrokeMode({ tool: 'restore', button: 2 }), 'cut');
  assert.equal(getStrokeMode({ tool: 'restore', shiftKey: true }), 'restore');
  assert.equal(getStrokeMode({ tool: 'wand' }), null);
  assert.equal(getMaskShortcut({ key: 'q' }), 'tool-cut');
  assert.equal(getMaskShortcut({ key: 'r' }), 'tool-restore');
  assert.equal(getMaskShortcut({ key: 'g' }), 'tool-wand');
  assert.equal(isCleanupTool('wand'), true);
  assert.equal(isCleanupTool('paint'), false);
});

test('touch-ups restore original pixels and remove leftovers on top of the auto cut-out', async () => {
  const { createCanvas } = await import('canvas');
  const { applyCutoutTouchUps } = await import('../scripts/token-composer.js');
  const make = (fill) => {
    const canvas = createCanvas(4, 1);
    const context = canvas.getContext('2d');
    fill(context);
    return canvas;
  };
  // original: four opaque blue pixels; auto cut-out kept only the first two
  const source = make((c) => {
    c.fillStyle = '#0000ff';
    c.fillRect(0, 0, 4, 1);
  });
  const base = make((c) => {
    c.fillStyle = '#0000ff';
    c.fillRect(0, 0, 2, 1);
  });
  const keep = make((c) => {
    c.fillStyle = '#fff';
    c.fillRect(3, 0, 1, 1);
  });
  const remove = make((c) => {
    c.fillStyle = '#fff';
    c.fillRect(0, 0, 1, 1);
  });

  assert.equal(applyCutoutTouchUps({ base, source, keep: null, remove: null, createCanvas }), base);

  const result = applyCutoutTouchUps({ base, source, keep, remove, createCanvas });
  const alpha = [...result.getContext('2d').getImageData(0, 0, 4, 1).data].filter(
    (_, index) => index % 4 === 3,
  );
  assert.deepEqual(alpha, [0, 255, 0, 255]);
});

test('portrait save plan picks render, original path or upload per action', async () => {
  const { getPortraitSavePlan } = await import('../scripts/token-composer.js');
  const base = { edited: false, sourcePath: 'art/a.webp', hasFile: false };
  assert.equal(getPortraitSavePlan({ ...base, action: 'token' }), 'none');
  assert.equal(getPortraitSavePlan({ ...base, action: 'actor' }), 'path');
  assert.equal(getPortraitSavePlan({ ...base, action: 'portrait', edited: true }), 'render');
  assert.equal(getPortraitSavePlan({ ...base, action: null, edited: true }), 'render');
  assert.equal(getPortraitSavePlan({ ...base, action: null }), 'path');
  const local = { edited: false, sourcePath: null, hasFile: true };
  assert.equal(getPortraitSavePlan({ ...local, action: 'both' }), 'upload-source');
  assert.equal(getPortraitSavePlan({ ...local, action: null }), 'none');
  assert.equal(
    getPortraitSavePlan({ edited: false, sourcePath: null, hasFile: false, action: 'actor' }),
    'render',
    'a generated image (e.g. from the portrait) has no file to reuse',
  );
});

test('saving uses the token image for the token and the separate image for the portrait', async () => {
  const { createCanvas, loadImage } = await import('canvas');
  const { createToken, normalizeTokenCreatorOptions } = await import('../scripts/token-creator.js');

  const solid = (color) => {
    const canvas = createCanvas(64, 64);
    const context = canvas.getContext('2d');
    context.fillStyle = color;
    context.fillRect(0, 0, 64, 64);
    return canvas;
  };
  const workspace = (color, path) => {
    const canvas = solid(color);
    return {
      source: { canvas, path, file: null, label: 'Hero' },
      autoCutout: canvas,
      cutout: canvas,
      cleanup: { keep: null, remove: null },
      cutoutToken: 0,
    };
  };

  const uploads = [];
  const previous = {
    document: globalThis.document,
    foundry: globalThis.foundry,
    game: globalThis.game,
  };
  globalThis.document = {
    createElement: () => {
      const canvas = createCanvas(1, 1);
      canvas.toBlob = (callback) => callback(new Blob([canvas.toBuffer('image/png')]));
      return canvas;
    },
  };
  globalThis.foundry = {
    applications: {
      apps: {
        FilePicker: {
          implementation: {
            browse: async () => ({}),
            upload: async (_source, folder, file) => {
              uploads.push({ name: file.name, buffer: Buffer.from(await file.arrayBuffer()) });
              return { path: `${folder}/${file.name}` };
            },
          },
        },
      },
    },
  };
  globalThis.game = { world: { id: 'w' }, settings: { get: () => '' } };

  try {
    const app = {
      creatorOptions: normalizeTokenCreatorOptions({ portraitAspect: '1:1', borderWidth: 0 }),
      view: { zoom: 1, offsetX: 0, offsetY: 0 },
      portraitView: { zoom: 1, offsetX: 0, offsetY: 0 },
      editTarget: 'portrait',
      workspaces: {
        token: workspace('#ff0000', 'art/red.webp'),
        portrait: workspace('#0000ff', 'art/blue.webp'),
      },
      popOutMask: null,
      _maskVersion: 0,
    };
    const delegate = (key) => ({
      get() {
        return this.workspace[key];
      },
      set(value) {
        this.workspace[key] = value;
      },
    });
    Object.defineProperties(app, {
      workspace: {
        get() {
          return this.editTarget === 'portrait' && this.workspaces.portrait
            ? this.workspaces.portrait
            : this.workspaces.token;
        },
      },
      source: delegate('source'),
      cutout: delegate('cutout'),
      autoCutout: delegate('autoCutout'),
      cleanup: delegate('cleanup'),
    });

    await createToken(app, null);

    assert.equal(app.editTarget, 'portrait', 'saving restores the edited target');
    // token, portrait and the project file (both sources already have paths)
    assert.equal(uploads.length, 3);
    const projectUpload = uploads.find((entry) => entry.name.endsWith('.tokener.json'));
    const project = JSON.parse(projectUpload.buffer.toString('utf8'));
    assert.equal(project.token.sourcePath, 'art/red.webp');
    assert.equal(project.portrait.sourcePath, 'art/blue.webp');
    assert.equal(
      project.output,
      `worlds/w/tokener/${projectUpload.name.replace('.tokener.json', '.webp')}`,
    );
    const pixel = async (name) => {
      const upload = uploads.find((entry) => entry.name.includes(name));
      const image = await loadImage(upload.buffer);
      const canvas = createCanvas(image.width, image.height);
      canvas.getContext('2d').drawImage(image, 0, 0);
      return [
        ...canvas.getContext('2d').getImageData(image.width / 2, image.height / 2, 1, 1).data,
      ];
    };
    const tokenName = uploads.find(
      (entry) => entry.name.endsWith('.webp') && !entry.name.includes('portrait'),
    ).name;
    assert.deepEqual(await pixel(tokenName), [255, 0, 0, 255]);
    assert.deepEqual(await pixel('portrait'), [0, 0, 255, 255]);
  } finally {
    globalThis.document = previous.document;
    globalThis.foundry = previous.foundry;
    globalThis.game = previous.game;
  }
});

async function runCreatorSave({ sourcePath, failJson = false, effects = [], regions = {} }) {
  const { createCanvas } = await import('canvas');
  const { createToken, normalizeTokenCreatorOptions } = await import('../scripts/token-creator.js');
  const canvas = createCanvas(32, 32);
  canvas.getContext('2d').fillRect(0, 0, 32, 32);
  canvas.toBlob = (callback, type) =>
    callback(new Blob([canvas.toBuffer('image/png')], { type: type ?? 'image/png' }));
  const uploads = [];
  const notices = { info: [], error: [] };
  const previous = {
    document: globalThis.document,
    foundry: globalThis.foundry,
    game: globalThis.game,
    ui: globalThis.ui,
  };
  globalThis.document = {
    createElement: () => {
      const element = createCanvas(1, 1);
      element.toBlob = (callback, type) =>
        callback(new Blob([element.toBuffer('image/png')], { type: type ?? 'image/png' }));
      return element;
    },
  };
  globalThis.foundry = {
    applications: {
      apps: {
        FilePicker: {
          implementation: {
            browse: async () => ({}),
            upload: async (_source, folder, file) => {
              if (failJson && file.name.endsWith('.json')) throw new Error('nope');
              uploads.push({
                name: file.name,
                type: file.type,
                buffer: Buffer.from(await file.arrayBuffer()),
              });
              return { path: `${folder}/${file.name}` };
            },
          },
        },
      },
    },
  };
  globalThis.game = { world: { id: 'w' }, settings: { get: () => '' } };
  globalThis.ui = {
    notifications: {
      info: (message) => notices.info.push(message),
      error: (message) => notices.error.push(message),
    },
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const workspace = {
      source: { canvas, path: sourcePath, file: null, label: 'Hero' },
      autoCutout: canvas,
      cutout: canvas,
      cleanup: { keep: null, remove: null },
      cutoutToken: 0,
    };
    const app = {
      creatorOptions: normalizeTokenCreatorOptions({ borderWidth: 0 }),
      view: { zoom: 1, offsetX: 0, offsetY: 0 },
      portraitView: { zoom: 1, offsetX: 0, offsetY: 0 },
      editTarget: 'token',
      workspaces: { token: workspace, portrait: null },
      popOutMask: null,
      _maskVersion: 0,
      animation: { duration: 2, fps: 30, mode: 'loop', pins: [], effects },
      effectRegions: regions,
    };
    Object.defineProperties(app, {
      workspace: { get: () => workspace },
      source: { get: () => workspace.source },
      cutout: { get: () => workspace.cutout },
      cleanup: { get: () => workspace.cleanup },
    });
    await createToken(app, null);
    return { uploads, notices };
  } finally {
    console.warn = warn;
    Object.assign(globalThis, previous);
  }
}

test('saving uploads a path-less source as a lossless png and references it in the project', async () => {
  const { createCanvas } = await import('canvas');
  const { uploads } = await runCreatorSave({
    sourcePath: null,
    effects: [{ id: 'fx', type: 'wind', region: 'used' }],
    regions: { used: createCanvas(32, 32), orphan: createCanvas(32, 32) },
  });
  const token = uploads.find((entry) => entry.name.endsWith('.webp'));
  const stem = token.name.replace(/\.webp$/, '');
  const source = uploads.find((entry) => entry.name === `${stem}-source.png`);
  assert.ok(source, 'source uploaded');
  assert.equal(source.type, 'image/png');
  const projectUpload = uploads.find((entry) => entry.name === `${stem}.tokener.json`);
  assert.equal(projectUpload.type, 'application/json');
  const project = JSON.parse(projectUpload.buffer.toString('utf8'));
  assert.equal(project.version, 1);
  assert.equal(project.token.sourcePath, `worlds/w/tokener/${stem}-source.png`);
  assert.equal(project.output, `worlds/w/tokener/${token.name}`);
  assert.equal(project.portrait, null);
  assert.deepEqual(Object.keys(project.animation.regions), ['used']);
  assert.match(project.animation.regions.used, /^data:image\/png;base64,/);
});

test('a failed project upload still saves the token', async () => {
  const { uploads, notices } = await runCreatorSave({
    sourcePath: 'art/hero.webp',
    failJson: true,
  });
  assert.deepEqual(
    uploads.map((entry) => entry.name.endsWith('.webp')),
    [true],
  );
  assert.equal(notices.error.length, 0);
  assert.equal(notices.info.length, 1);
});

test('From portrait turns the edited portrait into the token image and unlinks the portrait', async () => {
  const { createCanvas } = await import('canvas');
  const { normalizeTokenCreatorOptions, useEditedPortraitAsToken } =
    await import('../scripts/token-creator.js');
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => createCanvas(1, 1) };
  try {
    // token image: red on the left half, transparent on the right half
    const source = createCanvas(64, 64);
    source.getContext('2d').fillStyle = '#ff0000';
    source.getContext('2d').fillRect(0, 0, 32, 64);
    const app = {
      creatorOptions: normalizeTokenCreatorOptions({
        portraitAspect: '1:1',
        portraitBackground: 'color',
        portraitColor: '#0000ff',
        backgroundMode: 'none',
      }),
      view: { zoom: 1, offsetX: 0, offsetY: 0 },
      portraitView: { zoom: 1, offsetX: 0, offsetY: 0 },
      editTarget: 'portrait',
      workspaces: {
        token: {
          source: { canvas: source, path: 'art/hero.webp', file: null, label: 'Hero' },
          autoCutout: source,
          cutout: source,
          cleanup: { keep: null, remove: null },
          cutoutToken: 0,
        },
        portrait: null,
      },
      popOutMask: null,
      _maskVersion: 0,
      _maskHistory: { undo: [], redo: [] },
    };
    const delegate = (key) => ({
      get() {
        return this.workspace[key];
      },
      set(value) {
        this.workspace[key] = value;
      },
    });
    Object.defineProperties(app, {
      workspace: {
        get() {
          return this.editTarget === 'portrait' && this.workspaces.portrait
            ? this.workspaces.portrait
            : this.workspaces.token;
        },
      },
      source: delegate('source'),
      cutout: delegate('cutout'),
      autoCutout: delegate('autoCutout'),
      cleanup: delegate('cleanup'),
    });

    await useEditedPortraitAsToken(app);

    assert.equal(app.editTarget, 'token');
    assert.ok(app.workspaces.portrait, 'the portrait keeps its own workspace');
    assert.equal(app.workspaces.portrait.source.canvas, source);
    const tokenSource = app.workspaces.token.source;
    assert.equal(tokenSource.path, null);
    const at = (x) => [...tokenSource.canvas.getContext('2d').getImageData(x, 32, 1, 1).data];
    assert.deepEqual(at(8), [255, 0, 0, 255]);
    assert.deepEqual(at(56), [0, 0, 255, 255], 'the portrait colour background came along');
  } finally {
    globalThis.document = previousDocument;
  }
});

test('ring inner edge is measured from where the ring art becomes solid', async () => {
  const { measureRingInnerEdge } = await import('../scripts/ring-preview.js');
  const size = 200;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const radius = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      // soft shading from 0.55, solid ring from 0.68 to 0.82
      const alpha =
        radius >= 0.68 && radius <= 0.82 ? 255 : radius >= 0.55 && radius < 0.68 ? 120 : 0;
      data[(y * size + x) * 4 + 3] = alpha;
    }
  }
  const edge = measureRingInnerEdge({ data, width: size, height: size });
  assert.ok(Math.abs(edge - 0.68) <= 0.015, `edge ${edge}`);
  assert.equal(
    measureRingInnerEdge({
      data: new Uint8ClampedArray(size * size * 4),
      width: size,
      height: size,
    }),
    null,
  );
});

test('breakout room shrinks the ring inside the token and scales the token up to match', async () => {
  const { getRingScale, getRingGeometry, buildCreatedTokenCandidate } =
    await import('../scripts/token-composer.js');
  assert.equal(getRingScale(0), 1);
  assert.equal(getRingScale(25), 0.8);
  assert.deepEqual(getRingGeometry({ size: 500, ringScale: 0.8 }), {
    center: 250,
    ringSize: 400,
    offset: 50,
    outerRadius: 199,
  });
  const candidate = buildCreatedTokenCandidate({
    label: 'Knight',
    tokenSrc: 'k.webp',
    subjectSrc: 'k.webp',
    breakoutScale: 1.25,
  });
  assert.equal(candidate.scale, 1);
  assert.equal(candidate.breakoutScale, 1.25);
  assert.equal(candidate.subjectScale, 1.25);
});

test('breakout art enlarges the creature scale, pauses PF2e autoscale and restores it later', async () => {
  const { buildTokenUpdate, getBaseTokenScale } = await import('../scripts/actions.js');
  const profile = { id: 'pf2e' };
  const small = { _source: { flags: { pf2e: { autoscale: true } } } };
  const update = buildTokenUpdate(
    { tokenSrc: 'k.webp', subjectSrc: 'k.webp', subjectScale: 1.25, breakoutScale: 1.25 },
    { scale: 0.8, profile, document: small },
  );
  assert.equal(update['texture.scaleX'], 1);
  assert.equal(update['ring.subject.scale'], 1.25);
  assert.equal(update['flags.pf2e.autoscale'], false);
  assert.deepEqual(update['flags.pf2e-tokener.breakout'], {
    scale: 1.25,
    src: 'k.webp',
    autoscale: true,
  });

  const applied = {
    _source: {
      texture: { src: 'k.webp', scaleX: 1, scaleY: 1 },
      flags: {
        pf2e: { autoscale: false },
        'pf2e-tokener': { breakout: { scale: 1.25, src: 'k.webp', autoscale: true } },
      },
    },
  };
  assert.equal(getBaseTokenScale(applied, 1), 0.8);
  const reverted = structuredClone(applied);
  reverted._source.texture.src = 'old.webp';
  assert.equal(getBaseTokenScale(reverted, 1), 1);
  const plain = buildTokenUpdate(
    { tokenSrc: 'p.webp' },
    { scale: 0.8, profile, document: applied },
  );
  assert.equal(plain['texture.scaleX'], 0.8);
  assert.equal(plain['flags.pf2e-tokener.breakout'], null);
  assert.equal(plain['flags.pf2e.autoscale'], true);
});

test('P selects the pin tool', async () => {
  const { getMaskShortcut } = await import('../scripts/creator-shortcuts.js');
  assert.equal(getMaskShortcut({ key: 'p' }), 'tool-pin');
  assert.equal(getMaskShortcut({ key: 'P' }), 'tool-pin');
});

test('a new token image clears pins and effects but keeps the loop length and mode', async () => {
  const { resetAnimationForNewSource } = await import('../scripts/token-animation.js');
  const animation = {
    duration: 3.5,
    fps: 30,
    mode: 'pingpong',
    pins: [{ id: 'a', x: 1, y: 2, keyframes: [{ t: 0, dx: 1, dy: 0 }] }],
    effects: [{ id: 'fx', type: 'glow', region: 'fx', color: '#ffffff', size: 4, pulse: 0 }],
  };
  const reset = resetAnimationForNewSource(animation);
  assert.deepEqual(reset, { duration: 3.5, fps: 30, mode: 'pingpong', pins: [], effects: [] });
  assert.equal(animation.pins.length, 1);
  assert.equal(animation.effects.length, 1);
  assert.deepEqual(resetAnimationForNewSource(undefined), {
    duration: 2,
    fps: 30,
    mode: 'loop',
    pins: [],
    effects: [],
  });
});

test('pin dots map from source to preview space with the current layout', async () => {
  const { getPinPreviewPoints } = await import('../scripts/token-animation.js');
  const pins = [
    { id: 'a', x: 10, y: 20, keyframes: [] },
    {
      id: 'b',
      x: 50,
      y: 50,
      keyframes: [
        { t: 0, dx: 0, dy: 0 },
        { t: 0.5, dx: 10, dy: 0 },
      ],
    },
  ];
  const layout = { x: 5, y: -10, width: 200, height: 200 };
  const points = getPinPreviewPoints({
    pins,
    layout,
    cutoutWidth: 100,
    t: 0.5,
    selectedIds: ['b', 'a'],
  });
  assert.deepEqual(points, [
    { id: 'a', x: 25, y: 30, selected: true, primary: false, anchor: true },
    { id: 'b', x: 125, y: 90, selected: true, primary: true, anchor: false },
  ]);
  const atStart = getPinPreviewPoints({ pins, layout, cutoutWidth: 100, t: 0 });
  assert.equal(atStart[1].x, 105);
  assert.equal(atStart[1].selected, false);
  // Ping-pong at t = 0.75 plays back to u = 0.5, where the pin is fully moved.
  const back = getPinPreviewPoints({ pins, layout, cutoutWidth: 100, t: 0.75, mode: 'pingpong' });
  assert.equal(back[1].x, 125);
});

test('preset targets: selected-pin presets keep selection order; breathe and hover use all', async () => {
  const { getPresetTargets } = await import('../scripts/token-animation.js');
  const pins = [
    { id: 'a', x: 0, y: 0, keyframes: [] },
    { id: 'b', x: 10, y: 0, keyframes: [] },
    { id: 'c', x: 0, y: 10, keyframes: [] },
  ];
  for (const preset of ['bob', 'sway', 'look', 'shiver', 'flap', 'wave']) {
    assert.deepEqual(getPresetTargets(pins, ['c', 'a'], preset), ['c', 'a'], preset);
    assert.deepEqual(getPresetTargets(pins, [], preset), [], preset);
    assert.deepEqual(getPresetTargets(pins, ['missing', 'b'], preset), ['b'], preset);
  }
  for (const preset of ['breathe', 'hover']) {
    assert.deepEqual(getPresetTargets(pins, [], preset), ['a', 'b', 'c'], preset);
    assert.deepEqual(getPresetTargets(pins, ['b'], preset), ['a', 'b', 'c'], preset);
  }
  assert.deepEqual(getPresetTargets(undefined, ['a'], 'bob'), []);
});

test('preset availability: flap 1+, wave 2+ selected, breathe 2+ pins, hover 1+ pin', async () => {
  const { isPresetAvailable } = await import('../scripts/token-animation.js');
  const one = [{ id: 'a', x: 0, y: 0, keyframes: [] }];
  const two = [...one, { id: 'b', x: 5, y: 5, keyframes: [] }];
  assert.equal(isPresetAvailable(two, ['a'], 'flap'), true);
  assert.equal(isPresetAvailable(two, [], 'flap'), false);
  assert.equal(isPresetAvailable(two, ['a'], 'wave'), false);
  assert.equal(isPresetAvailable(two, ['a', 'b'], 'wave'), true);
  assert.equal(isPresetAvailable(two, ['a', 'missing'], 'wave'), false);
  assert.equal(isPresetAvailable(one, ['a'], 'breathe'), false);
  assert.equal(isPresetAvailable(two, [], 'breathe'), true);
  assert.equal(isPresetAvailable([], [], 'hover'), false);
  assert.equal(isPresetAvailable(one, [], 'hover'), true);
  for (const preset of ['bob', 'sway', 'look', 'shiver']) {
    assert.equal(isPresetAvailable(two, [], preset), false, preset);
    assert.equal(isPresetAvailable(two, ['b'], preset), true, preset);
  }
});

test('toggleSelection: click selects one, shift toggles in order', async () => {
  const { toggleSelection } = await import('../scripts/token-animation.js');
  assert.deepEqual(toggleSelection(['a', 'b'], 'c', false), ['c']);
  assert.deepEqual(toggleSelection(['a', 'b'], 'b', false), ['b']);
  assert.deepEqual(toggleSelection(['a'], 'c', true), ['a', 'c']);
  assert.deepEqual(toggleSelection(['a', 'c'], 'a', true), ['c']);
  assert.deepEqual(toggleSelection([], 'a', true), ['a']);
  assert.deepEqual(toggleSelection(undefined, 'a', false), ['a']);
  const ids = ['a'];
  toggleSelection(ids, 'b', true);
  assert.deepEqual(ids, ['a']);
});

test('preset amplitude is 3% of the long side, shiver 1%; rotation arm is 12%', async () => {
  const { getPresetAmplitude, getRotationArm } = await import('../scripts/token-animation.js');
  assert.equal(getPresetAmplitude('bob', { width: 200, height: 400 }), 12);
  assert.equal(getPresetAmplitude('wave', { width: 400, height: 100 }), 12);
  assert.equal(getPresetAmplitude('shiver', { width: 200, height: 400 }), 4);
  assert.equal(getRotationArm({ width: 300, height: 410 }), 49);
  assert.equal(getRotationArm({ width: 0, height: 0 }), 0);
});

test('keyframe controls edit the keyframe at the current time, creating it when missing', async () => {
  const { getKeyframeAt, updateKeyframeAt } = await import('../scripts/token-animation.js');
  const { createPin, setKeyframe } = await import('../scripts/animation.js');
  let pin = setKeyframe(createPin({ x: 0, y: 0, arm: 10 }), 0, { dx: 0, dy: 0 });
  pin = setKeyframe(pin, 0.5, { dx: 10, dy: 0 });
  assert.equal(getKeyframeAt(pin, 0.25), null);
  assert.deepEqual(getKeyframeAt(pin, 0.5 + 1 / 500), { t: 0.5, dx: 10, dy: 0 });

  const eased = updateKeyframeAt(pin, 0.5, { ease: 'hold' });
  assert.deepEqual(eased.keyframes[1], { t: 0.5, dx: 10, dy: 0, ease: 'hold' });
  const rotated = updateKeyframeAt(eased, 0.5, { rot: 0.3 });
  assert.deepEqual(rotated.keyframes[1], { t: 0.5, dx: 10, dy: 0, rot: 0.3, ease: 'hold' });

  // No keyframe at 0.25: one is created from the sampled pose.
  const created = updateKeyframeAt(pin, 0.25, { rot: -0.2 });
  assert.equal(created.keyframes.length, 3);
  const { dx, ...rest } = created.keyframes[1];
  assert.ok(Math.abs(dx - 5) < 1e-9);
  assert.deepEqual(rest, { t: 0.25, dy: 0, rot: -0.2 });
  assert.equal(pin.keyframes.length, 2);
});

test('breathe on three pins through the creator path gives real motion', async () => {
  const { getPresetTargets } = await import('../scripts/token-animation.js');
  const { applyPreset, hasMotion } = await import('../scripts/animation.js');
  const pins = [
    { id: 'a', x: 0, y: 0, keyframes: [] },
    { id: 'b', x: 100, y: 0, keyframes: [] },
    { id: 'c', x: 50, y: 90, keyframes: [] },
  ];
  const ids = getPresetTargets(pins, ['a'], 'breathe');
  const next = applyPreset(pins, ids, 'breathe', { amplitude: 3 });
  assert.equal(hasMotion({ pins: next }), true);
  assert.ok(next.every((pin) => pin.keyframes.length === 2));
});

test('dragging a pin moves its rest position until it has keyframes', async () => {
  const { getPinDragMode } = await import('../scripts/token-animation.js');
  assert.equal(getPinDragMode({ id: 'a', x: 0, y: 0, keyframes: [] }), 'rest');
  assert.equal(
    getPinDragMode({ id: 'a', x: 0, y: 0, keyframes: [{ t: 0, dx: 0, dy: 0 }] }),
    'keyframe',
  );
});

test('anchors-only or unavailable encoding saves a still image', async () => {
  const { getAnimatedSavePlan } = await import('../scripts/token-animation.js');
  const { createPin, setKeyframe } = await import('../scripts/animation.js');
  const moving = setKeyframe(createPin({ x: 1, y: 1 }), 0.5, { dx: 2, dy: 0 });
  const animatedFixture = { duration: 2, fps: 30, pins: [moving] };
  assert.equal(
    getAnimatedSavePlan({ animation: { pins: [createPin({ x: 1, y: 1 })] }, canEncode: true }),
    'still',
  );
  assert.equal(getAnimatedSavePlan({ animation: animatedFixture, canEncode: false }), 'still');
  assert.equal(getAnimatedSavePlan({ animation: animatedFixture, canEncode: true }), 'animated');
});

test('no-op effects do not force an animated save; active ones do', async () => {
  const { createCanvas } = await import('canvas');
  const { getAnimatedSavePlan, hasActiveMotion } = await import('../scripts/token-animation.js');
  const { createPin } = await import('../scripts/animation.js');
  const anchor = createPin({ x: 1, y: 1 });
  const plan = (effects, regions) =>
    getAnimatedSavePlan({ animation: { pins: [anchor], effects }, canEncode: true, regions });
  const still = { id: 'w', type: 'wind', strength: 0, scale: 24, region: null };
  const dark = { id: 'f', type: 'flicker', amount: 0, kind: 'opacity', speed: 3, region: null };
  const unpainted = { id: 'g', type: 'glow', region: 'g', color: '#ffffff', size: 4, pulse: 0 };
  assert.equal(plan([still, dark]), 'still');
  assert.equal(plan([unpainted], {}), 'still');
  assert.equal(hasActiveMotion({ pins: [anchor], effects: [unpainted] }, {}), false);
  assert.equal(plan([unpainted], { g: createCanvas(2, 2) }), 'animated');
  assert.equal(plan([{ ...still, strength: 2 }]), 'animated');
  assert.equal(plan([{ ...dark, amount: 0.2 }]), 'animated');
  assert.equal(
    getAnimatedSavePlan({
      animation: { pins: [anchor], effects: [{ ...still, strength: 2 }] },
      canEncode: false,
    }),
    'still',
  );
});

test('effect ids are escaped for attribute selectors without CSS.escape', async () => {
  const { escapeSelectorValue } = await import('../scripts/token-creator.js');
  const previous = globalThis.CSS;
  try {
    globalThis.CSS = undefined;
    assert.equal(escapeSelectorValue('fx-1'), 'fx-1');
    assert.equal(escapeSelectorValue('a"]b\\c'), 'a\\"]b\\\\c');
    globalThis.CSS = { escape: (value) => `<${value}>` };
    assert.equal(escapeSelectorValue('fx'), '<fx>');
  } finally {
    globalThis.CSS = previous;
  }
});

test('pop-out never draws semi-transparent art twice inside the frame opening', async () => {
  const { createCanvas } = await import('canvas');
  const { drawRingSubject, drawTokenFrame } = await import('../scripts/token-composer.js');
  const size = 100;
  const art = createCanvas(size, size);
  const artContext = art.getContext('2d');
  artContext.fillStyle = 'rgba(200, 40, 40, 0.5)';
  artContext.fillRect(0, 0, size, size);
  const mask = createCanvas(size, size);
  mask.getContext('2d').drawImage(art, 0, 0);

  const alphaAt = (canvas, x, y) => canvas.getContext('2d').getImageData(x, y, 1, 1).data[3];
  for (const popOutImage of [null, mask]) {
    const ring = createCanvas(size, size);
    drawRingSubject(ring.getContext('2d'), art, {
      size,
      clipRadius: 0.6,
      popOut: true,
      popOutImage,
    });
    // Inside the opening, above and below the automatic cutoff line: same density.
    assert.equal(alphaAt(ring, 50, 35), alphaAt(ring, 50, 70));

    // The pop-out shadow never darkens art inside the opening either.
    const shaded = createCanvas(size, size);
    drawRingSubject(shaded.getContext('2d'), art, {
      size,
      clipRadius: 0.6,
      popOut: true,
      popOutImage,
      popOutShadow: true,
    });
    const pixel = (x, y) => [...shaded.getContext('2d').getImageData(x, y, 1, 1).data];
    assert.deepEqual(pixel(50, 35), pixel(50, 70));

    const frame = createCanvas(size, size);
    drawTokenFrame(frame.getContext('2d'), art, {
      size,
      borderWidth: 4,
      popOut: true,
      popOutImage,
    });
    assert.equal(alphaAt(frame, 50, 20), alphaAt(frame, 50, 80));
  }
});

test('the frame opening maps from token space onto the source image', async () => {
  const { getOpeningInImage } = await import('../scripts/token-composer.js');
  // 200x100 image drawn at twice its size, shifted 10px right: a 400x200 layout at (10, 0).
  const layout = { x: 10, y: 0, width: 400, height: 200 };
  assert.deepEqual(
    getOpeningInImage({ layout, imageWidth: 200, imageHeight: 100, size: 200, radius: 60 }),
    { x: 45, y: 50, radius: 30 },
  );
});

test('pop-out brushes only reach outside the frame opening', async () => {
  const { createCanvas } = await import('canvas');
  const { clipOutsideOpening } = await import('../scripts/token-composer.js');
  const canvas = createCanvas(40, 40);
  const context = canvas.getContext('2d');
  context.save();
  clipOutsideOpening(context, { x: 20, y: 20, radius: 10 }, 40, 40);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 40, 40);
  context.restore();
  const alphaAt = (x, y) => context.getImageData(x, y, 1, 1).data[3];
  assert.equal(alphaAt(20, 20), 0);
  assert.equal(alphaAt(20, 13), 0);
  assert.equal(alphaAt(20, 5), 255);
  assert.equal(alphaAt(2, 2), 255);
});

test('the pop-out brush button stands for both brush modes', async () => {
  const { getToolButton } = await import('../scripts/creator-shortcuts.js');
  assert.equal(getToolButton('paint'), 'paint');
  assert.equal(getToolButton('erase'), 'paint');
  assert.equal(getToolButton('cut'), 'cut');
  assert.equal(getToolButton('restore'), 'cut');
  assert.equal(getToolButton(null), 'move');
});

test('a pin that only rotates is not drawn as an anchor', async () => {
  const { isAnchorPin } = await import('../scripts/token-animation.js');
  assert.equal(isAnchorPin({ id: 'a', x: 0, y: 0, keyframes: [{ t: 0, dx: 0, dy: 0 }] }), true);
  assert.equal(
    isAnchorPin({ id: 'a', x: 0, y: 0, keyframes: [{ t: 0, dx: 0, dy: 0, rot: 0.2 }] }),
    false,
  );
});

test('ping-pong keyframe time folds the scrub time; loop keeps it', async () => {
  const { getKeyframeTime } = await import('../scripts/token-animation.js');
  assert.equal(getKeyframeTime(0.3, 'loop'), 0.3);
  assert.equal(getKeyframeTime(0.25, 'pingpong'), 0.5);
  assert.equal(getKeyframeTime(0.75, 'pingpong'), 0.5);
  assert.equal(getKeyframeTime(0, 'pingpong'), 0);
  // The apex stays clear of the seam so it never merges with a keyframe at 0.
  const apex = getKeyframeTime(0.5, 'pingpong');
  assert.ok(apex < 1 && apex > 0.95);
  const { loopDistance, KEYFRAME_MERGE } = await import('../scripts/animation.js');
  assert.ok(loopDistance(apex, 0) >= KEYFRAME_MERGE);
});

test('ping-pong: adding keyframes at any time leaves the motion unchanged', async () => {
  const { updateKeyframeAt } = await import('../scripts/token-animation.js');
  const { createPin, samplePinOffset, setKeyframe } = await import('../scripts/animation.js');
  let pin = setKeyframe(createPin({ x: 0, y: 0 }), 0, { dx: 0, dy: 0, ease: 'linear' });
  pin = setKeyframe(pin, 0.5, { dx: 10, dy: -4, ease: 'linear' });
  pin = setKeyframe(pin, 0.8, { dx: 4, dy: 2, ease: 'linear' });
  const grid = Array.from({ length: 41 }, (_, i) => i / 40);
  const before = grid.map((t) => samplePinOffset(pin, t, 'pingpong'));
  for (const t of [0.1, 0.2, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9]) {
    const next = updateKeyframeAt(pin, t, {}, 'pingpong');
    grid.forEach((s, i) => {
      const pose = samplePinOffset(next, s, 'pingpong');
      assert.ok(Math.abs(pose.dx - before[i].dx) < 1e-9, `add ${t}, sample ${s}`);
      assert.ok(Math.abs(pose.dy - before[i].dy) < 1e-9, `add ${t}, sample ${s}`);
    });
  }
  // Reviewer repro: smooth keys 0 -> 0.5; adding at t = 0.25 hits the existing 0.5 key.
  let smooth = setKeyframe(createPin({ x: 0, y: 0 }), 0, { dx: 0, dy: 0 });
  smooth = setKeyframe(smooth, 0.5, { dx: 10, dy: 0 });
  const at = samplePinOffset(smooth, 0.125, 'pingpong').dx;
  const added = updateKeyframeAt(smooth, 0.25, {}, 'pingpong');
  assert.equal(added.keyframes.length, 2);
  assert.equal(samplePinOffset(added, 0.125, 'pingpong').dx, at);
});

test('ping-pong: a drag at scrub time t keyframes getKeyframeTime(t)', async () => {
  const { updateKeyframeAt, getKeyframeAt, getKeyframeTime } =
    await import('../scripts/token-animation.js');
  const { createPin, samplePinOffset, setKeyframe } = await import('../scripts/animation.js');
  let pin = setKeyframe(createPin({ x: 0, y: 0 }), 0, { dx: 0, dy: 0 });
  pin = setKeyframe(pin, 0.9, { dx: 2, dy: 0 });
  const moved = updateKeyframeAt(pin, 0.3, { dx: 7, dy: 1 }, 'pingpong');
  assert.ok(moved.keyframes.some((k) => Math.abs(k.t - getKeyframeTime(0.3, 'pingpong')) < 1e-9));
  assert.equal(samplePinOffset(moved, 0.3, 'pingpong').dx, 7);
  assert.equal(samplePinOffset(moved, 0.7, 'pingpong').dx, 7);
  assert.equal(getKeyframeAt(moved, 0.7, 'pingpong').dx, 7);
  assert.equal(getKeyframeAt(moved, 0.3, 'loop'), null);
});

test('keyframe lookup is seam-aware like setKeyframe merging', async () => {
  const { getKeyframeAt } = await import('../scripts/token-animation.js');
  const pin = { id: 'a', x: 0, y: 0, keyframes: [{ t: 0, dx: 1, dy: 0 }] };
  assert.equal(getKeyframeAt(pin, 0.998)?.dx, 1);
  assert.equal(getKeyframeAt(pin, 0.98), null);
});

test('keyframe markers: once in loop, on both legs in ping-pong', async () => {
  const { getKeyframeMarkerTimes } = await import('../scripts/token-animation.js');
  assert.deepEqual(getKeyframeMarkerTimes(0.4, 'loop'), [0.4]);
  assert.deepEqual(getKeyframeMarkerTimes(0.4, 'pingpong'), [0.2, 0.8]);
  assert.deepEqual(getKeyframeMarkerTimes(0, 'pingpong'), [0]);
});

test('ensurePinArm backfills a missing rotation arm only', async () => {
  const { ensurePinArm } = await import('../scripts/token-animation.js');
  const cutout = { width: 100, height: 200 };
  const old = { id: 'a', x: 0, y: 0, keyframes: [] };
  assert.equal(ensurePinArm(old, cutout).arm, 24);
  assert.equal(old.arm, undefined);
  const armed = { ...old, arm: 7 };
  assert.equal(ensurePinArm(armed, cutout), armed);
  assert.equal(ensurePinArm(old, { width: 0, height: 0 }), old);
});

test('pin presses need 3 px of movement before they drag', async () => {
  const { isPastDragDeadZone } = await import('../scripts/token-animation.js');
  assert.equal(isPastDragDeadZone({ x: 10, y: 10 }, { x: 12, y: 11 }), false);
  assert.equal(isPastDragDeadZone({ x: 10, y: 10 }, { x: 13, y: 10 }), true);
});

test('Escape with the pin tool clears a selection first, then switches to Move', async () => {
  const { getPinToolEscapeAction } = await import('../scripts/token-animation.js');
  assert.equal(getPinToolEscapeAction({ maskTool: 'pin', selectedCount: 2 }), 'clear-selection');
  assert.equal(getPinToolEscapeAction({ maskTool: 'pin', selectedCount: 0 }), 'move');
  assert.equal(getPinToolEscapeAction({ maskTool: 'paint', selectedCount: 2 }), 'move');
});

test('F selects the region tool', async () => {
  const { getMaskShortcut } = await import('../scripts/creator-shortcuts.js');
  assert.equal(getMaskShortcut({ key: 'f' }), 'tool-region');
  assert.equal(getMaskShortcut({ key: 'F' }), 'tool-region');
  assert.equal(getMaskShortcut({ key: 'f', ctrlKey: true }), null);
});

test('the region tool has its own toolbar button', async () => {
  const { getToolButton } = await import('../scripts/creator-shortcuts.js');
  assert.equal(getToolButton('region'), 'region');
});

test('the region brush adds on a drag and removes on a right or Alt drag', async () => {
  const { getStrokeMode } = await import('../scripts/creator-shortcuts.js');
  assert.equal(getStrokeMode({ tool: 'region' }), 'paint');
  assert.equal(getStrokeMode({ tool: 'region', shiftKey: true }), 'paint');
  assert.equal(getStrokeMode({ tool: 'region', button: 2 }), 'erase');
  assert.equal(getStrokeMode({ tool: 'region', altKey: true }), 'erase');
});

test('the region tool pauses playback and shows the unbent art like the mask tools', async () => {
  const { canPlayWithTool, shouldBendPreview } = await import('../scripts/token-animation.js');
  assert.equal(canPlayWithTool('region'), false);
  assert.equal(shouldBendPreview({ maskTool: 'region', pointerMode: null }), false);
});

test('effect region keys: null for the whole figure, the region key when painted', async () => {
  const { getEffectRegionKey } = await import('../scripts/token-creator.js');
  assert.equal(getEffectRegionKey({ id: 'a', type: 'wind', region: null }), null);
  assert.equal(getEffectRegionKey({ id: 'a', type: 'wind', region: 'a' }), 'a');
  assert.equal(getEffectRegionKey({ id: 'a', type: 'wind', region: '' }), null);
  assert.equal(getEffectRegionKey(null), null);
});

test('adding and updating effects replaces the animation and clamps params', async () => {
  const { addEffect, updateEffect } = await import('../scripts/token-creator.js');
  const animation = { duration: 2, fps: 30, mode: 'loop', pins: [], effects: [] };
  const added = addEffect(animation, {
    id: 'w',
    type: 'wind',
    region: null,
    strength: 4,
    scale: 24,
  });
  assert.notEqual(added, animation);
  assert.equal(animation.effects.length, 0);
  assert.deepEqual(
    added.effects.map((effect) => effect.id),
    ['w'],
  );

  // Strength is capped at 18 % of the noise scale so the warp mesh cannot fold.
  const strong = updateEffect(added, 'w', { strength: 30 });
  assert.notEqual(strong.effects[0], added.effects[0]);
  assert.equal(strong.effects[0].strength, 24 * 0.18);
  assert.equal(updateEffect(added, 'missing', { strength: 1 }), added);

  const painted = updateEffect(added, 'w', { region: 'w' });
  assert.equal(painted.effects[0].region, 'w');

  const particles = addEffect(animation, {
    id: 'p',
    type: 'particles',
    region: null,
    kind: 'embers',
    count: 24,
    color: '#123456',
    size: 3,
  });
  const snow = updateEffect(particles, 'p', { kind: 'snow' });
  assert.equal(snow.effects[0].kind, 'snow');
  assert.equal(snow.effects[0].color, null, 'a new kind takes its own default colour');
});

test('removing an effect drops its region', async () => {
  const { removeEffect } = await import('../scripts/token-creator.js');
  const regionA = { id: 'canvas-a' };
  const regionB = { id: 'canvas-b' };
  const animation = {
    duration: 2,
    fps: 30,
    mode: 'loop',
    pins: [],
    effects: [
      { id: 'a', type: 'glow', region: 'a', color: '#8fd3ff', size: 10, pulse: 0.5 },
      { id: 'b', type: 'wind', region: 'b', strength: 4, scale: 24 },
    ],
  };
  const regions = { a: regionA, b: regionB };
  const result = removeEffect({ animation, regions }, 'a');
  assert.deepEqual(
    result.animation.effects.map((effect) => effect.id),
    ['b'],
  );
  assert.deepEqual(Object.keys(result.regions), ['b']);
  assert.equal(result.regions.b, regionB);
  assert.deepEqual(result.removedRegions, ['a']);
  assert.equal(animation.effects.length, 2, 'the old animation is untouched');
  assert.equal(regions.a, regionA, 'the old regions are untouched');

  // A region another effect still uses stays.
  const shared = {
    ...animation,
    effects: [animation.effects[0], { ...animation.effects[1], region: 'a' }],
  };
  const kept = removeEffect({ animation: shared, regions }, 'a');
  assert.equal(kept.regions, regions);
  assert.deepEqual(kept.removedRegions, []);

  const missing = removeEffect({ animation, regions }, 'zzz');
  assert.equal(missing.animation, animation);
  assert.equal(missing.regions, regions);
});

test('effect param controls follow the type, with the wind strength capped by its scale', async () => {
  const { getEffectParamControls } = await import('../scripts/token-creator.js');
  const wind = getEffectParamControls({
    id: 'w',
    type: 'wind',
    region: null,
    strength: 4,
    scale: 100,
  });
  assert.deepEqual(
    wind.map((control) => control.param),
    ['strength', 'scale'],
  );
  assert.equal(wind[0].max, 18);
  assert.equal(wind[0].value, 4);
  const glow = getEffectParamControls({
    id: 'g',
    type: 'glow',
    region: null,
    color: '#ff0000',
    size: 10,
    pulse: 0.5,
  });
  assert.deepEqual(
    glow.map((control) => [control.param, control.input]),
    [
      ['color', 'color'],
      ['size', 'range'],
      ['pulse', 'range'],
    ],
  );
  const particles = getEffectParamControls({
    id: 'p',
    type: 'particles',
    region: null,
    kind: 'snow',
    count: 24,
    color: null,
    size: 3,
  });
  const kind = particles.find((control) => control.param === 'kind');
  assert.equal(kind.input, 'select');
  assert.equal(kind.options.find((option) => option.selected).value, 'snow');
  assert.equal(particles.find((control) => control.param === 'color').value, '#ffffff');
});

test('removing an effect switched back to the whole figure still drops its region', async () => {
  const { removeEffect } = await import('../scripts/token-creator.js');
  const own = { id: 'canvas-a' };
  const other = { id: 'canvas-b' };
  const animation = {
    duration: 2,
    fps: 30,
    mode: 'loop',
    pins: [],
    effects: [
      { id: 'a', type: 'wind', region: null, strength: 4, scale: 24 },
      { id: 'b', type: 'wind', region: 'b', strength: 4, scale: 24 },
    ],
  };
  const result = removeEffect({ animation, regions: { a: own, b: other } }, 'a');
  assert.deepEqual(Object.keys(result.regions), ['b']);
  assert.deepEqual(result.removedRegions, ['a']);

  // Its id-keyed canvas stays while another effect still paints with that key.
  const borrowed = {
    ...animation,
    effects: [animation.effects[0], { ...animation.effects[1], region: 'a' }],
  };
  const kept = removeEffect({ animation: borrowed, regions: { a: own, b: other } }, 'a');
  assert.deepEqual(Object.keys(kept.regions), ['a', 'b']);
  assert.deepEqual(kept.removedRegions, []);
});

test('creator options default every ring effect to off and normalize them defensively', async () => {
  const { normalizeTokenCreatorOptions } = await import('../scripts/token-creator.js');
  const off = { pulse: false, gradient: false, wave: false, spectral: false };
  assert.deepEqual(normalizeTokenCreatorOptions().ringEffects, off);
  assert.deepEqual(normalizeTokenCreatorOptions({ ringEffects: 'junk' }).ringEffects, off);
  assert.deepEqual(
    normalizeTokenCreatorOptions({ ringEffects: { pulse: 1, wave: true, extra: true } })
      .ringEffects,
    { pulse: true, gradient: false, wave: true, spectral: false },
  );
});

test('getCreatorOptionKey accepts flat and whitelisted nested option names only', async () => {
  const { getCreatorOptionKey, normalizeTokenCreatorOptions } =
    await import('../scripts/token-creator.js');
  const options = normalizeTokenCreatorOptions();
  assert.deepEqual(getCreatorOptionKey('ringEffects.pulse', options), {
    group: 'ringEffects',
    key: 'pulse',
  });
  assert.deepEqual(getCreatorOptionKey('popOut', options), { group: 'popOut', key: null });
  assert.equal(getCreatorOptionKey('ringEffects.bogus', options), null);
  assert.equal(getCreatorOptionKey('borderWidth.x', options), null);
  assert.equal(getCreatorOptionKey('ringEffects.pulse.x', options), null);
  assert.equal(getCreatorOptionKey('nope', options), null);
  assert.equal(getCreatorOptionKey('', options), null);
});

test('ring effect checkboxes update creator options through the real handlers', async () => {
  const { handleCreatorInput, handleCreatorChange, normalizeTokenCreatorOptions } =
    await import('../scripts/token-creator.js');
  for (const handler of [handleCreatorInput, handleCreatorChange]) {
    const app = { creatorOptions: normalizeTokenCreatorOptions(), parts: {}, element: null };
    const target = { name: 'ringEffects.pulse', type: 'checkbox', checked: true };
    await handler(app, { target });
    assert.equal(app.creatorOptions.ringEffects.pulse, true);
    assert.equal(app.creatorOptions.ringEffects.wave, false);
  }
});
