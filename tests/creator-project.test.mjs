import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROJECT_VERSION,
  buildProjectFileName,
  getProjectFlagUpdate,
  parseProject,
  serializeProject,
  shouldLoadProject,
} from '../scripts/creator-project.js';

const fakeCanvas = (name) => ({ name });
const toDataUrl = (canvas) => `data:image/png;base64,${canvas.name}`;

function sampleInput(overrides = {}) {
  return {
    label: 'Dragon',
    output: 'worlds/w/tokener/dragon-20261030-120000.webm',
    options: { frameStyle: 'ring', outputSize: 512, popOut: true },
    token: {
      sourcePath: 'worlds/w/tokener/dragon-20261030-120000-source.png',
      view: { zoom: 1.5, offsetX: -12, offsetY: 7 },
      popOutMask: fakeCanvas('popout'),
      cleanup: { keep: fakeCanvas('keep'), remove: null },
    },
    portrait: {
      sourcePath: 'art/dragon-portrait.png',
      view: { zoom: 1.2, offsetX: 3, offsetY: -4 },
      popOutMask: null,
      cleanup: { keep: null, remove: fakeCanvas('premove') },
    },
    animation: {
      duration: 2.5,
      fps: 30,
      mode: 'pingpong',
      pins: [
        {
          id: 'pin-a',
          x: 10,
          y: 20,
          arm: 30,
          keyframes: [
            { t: 0, dx: 0, dy: 0 },
            { t: 0.5, dx: 4, dy: -2, rot: 0.2, ease: 'linear' },
            { t: 0.75, dx: 1, dy: 1, ease: 'hold' },
          ],
        },
      ],
      effects: [
        { id: 'fx-1', type: 'wind', region: 'r1', strength: 4, scale: 24 },
        { id: 'fx-2', type: 'glow', region: null, color: '#ffaa00', size: 10, pulse: 0.5 },
      ],
    },
    regions: { r1: fakeCanvas('region1'), orphan: fakeCanvas('orphan') },
    toDataUrl,
    now: new Date('2026-10-30T12:00:00Z'),
    ...overrides,
  };
}

test('project file name replaces the token extension', () => {
  assert.equal(
    buildProjectFileName('dragon-20261030-120000.webm'),
    'dragon-20261030-120000.tokener.json',
  );
  assert.equal(
    buildProjectFileName('goblin-20261030-120000.webp'),
    'goblin-20261030-120000.tokener.json',
  );
  assert.equal(buildProjectFileName('plain'), 'plain.tokener.json');
});

test('serialize stores canvases as data URLs and keeps nulls', () => {
  const project = serializeProject(sampleInput());
  assert.equal(project.version, PROJECT_VERSION);
  assert.equal(PROJECT_VERSION, 1);
  assert.equal(project.savedAt, '2026-10-30T12:00:00.000Z');
  assert.equal(project.token.popOutMask, 'data:image/png;base64,popout');
  assert.deepEqual(project.token.cleanup, { keep: 'data:image/png;base64,keep', remove: null });
  assert.deepEqual(project.portrait.cleanup, {
    keep: null,
    remove: 'data:image/png;base64,premove',
  });
});

test('serialize keeps only regions an effect uses', () => {
  const project = serializeProject(sampleInput());
  assert.deepEqual({ ...project.animation.regions }, { r1: 'data:image/png;base64,region1' });
  assert.equal(Object.getPrototypeOf(project.animation.regions), null);
});

test('serialize → JSON → parse round-trips views, options, animation and masks', () => {
  const project = serializeProject(sampleInput());
  const parsed = parseProject(JSON.parse(JSON.stringify(project)));
  assert.ok(parsed);
  assert.deepEqual(parsed, project);
  assert.deepEqual(parsed.token.view, { zoom: 1.5, offsetX: -12, offsetY: 7 });
  assert.deepEqual(parsed.portrait.view, { zoom: 1.2, offsetX: 3, offsetY: -4 });
  assert.deepEqual(parsed.options, { frameStyle: 'ring', outputSize: 512, popOut: true });
  assert.equal(parsed.animation.mode, 'pingpong');
  assert.equal(parsed.animation.duration, 2.5);
  assert.deepEqual(parsed.animation.pins[0].keyframes[1], {
    t: 0.5,
    dx: 4,
    dy: -2,
    rot: 0.2,
    ease: 'linear',
  });
  assert.equal(parsed.animation.pins[0].keyframes[2].ease, 'hold');
  assert.equal(parsed.animation.pins[0].arm, 30);
  assert.deepEqual(
    parsed.animation.effects.map((effect) => [effect.id, effect.type, effect.region]),
    [
      ['fx-1', 'wind', 'r1'],
      ['fx-2', 'glow', null],
    ],
  );
  assert.equal(parsed.animation.regions.r1, 'data:image/png;base64,region1');
});

test('a shared portrait stays null and the portrait view is still kept', () => {
  const project = serializeProject(
    sampleInput({ portrait: null, portraitView: { zoom: 2, offsetX: 1, offsetY: 2 } }),
  );
  assert.equal(project.portrait, null);
  const parsed = parseProject(JSON.stringify(project));
  assert.equal(parsed.portrait, null);
  assert.deepEqual(parsed.portraitView, { zoom: 2, offsetX: 1, offsetY: 2 });
});

test('parseProject accepts a JSON string', () => {
  const project = serializeProject(sampleInput());
  assert.deepEqual(parseProject(JSON.stringify(project)), project);
});

test('parseProject rejects wrong versions and garbage', () => {
  const project = serializeProject(sampleInput());
  assert.equal(parseProject({ ...project, version: 2 }), null);
  assert.equal(parseProject({ ...project, version: undefined }), null);
  assert.equal(parseProject({ ...project, token: { ...project.token, sourcePath: '' } }), null);
  assert.equal(parseProject({ ...project, token: null }), null);
  assert.equal(parseProject(null), null);
  assert.equal(parseProject(42), null);
  assert.equal(parseProject([]), null);
  assert.equal(parseProject('not json'), null);
});

test('parseProject drops malformed masks, regions and effects', () => {
  const project = serializeProject(sampleInput());
  const parsed = parseProject({
    ...project,
    token: { ...project.token, popOutMask: 'javascript:alert(1)', view: { zoom: 'x' } },
    animation: {
      ...project.animation,
      effects: [...project.animation.effects, { type: 'nope' }],
      regions: { r1: 'http://evil/x.png' },
    },
  });
  assert.equal(parsed.token.popOutMask, null);
  assert.deepEqual(parsed.token.view, { zoom: 1, offsetX: 0, offsetY: 0 });
  assert.equal(parsed.animation.effects.length, 2);
  assert.deepEqual({ ...parsed.animation.regions }, {});
});

test('parseProject sanitizes crafted effect ids and region keys', () => {
  const project = serializeProject(sampleInput());
  const region = 'data:image/png;base64,x';
  const raw = JSON.parse(JSON.stringify(project));
  raw.animation.effects = [
    { id: 'ok_1', type: 'glow', region: 'ok_1' },
    { id: 'x"] *', type: 'wind', region: 'x"] *' },
    { id: 'f', type: 'flicker', region: 'f' },
  ];
  // As JSON.parse reads a crafted file: `__proto__` is an own key there.
  raw.animation.regions = JSON.parse(
    JSON.stringify({ ok_1: region, 'x"] *': region, constructor: region }).replace(
      '{',
      `{"__proto__":"${region}",`,
    ),
  );
  const parsed = parseProject(raw);
  assert.deepEqual(
    parsed.animation.effects.map((effect) => [effect.id, effect.region]),
    [
      ['ok_1', 'ok_1'],
      ['fx-1', null],
      ['f', null],
    ],
  );
  const { regions } = parsed.animation;
  assert.equal(Object.getPrototypeOf(regions), null);
  assert.deepEqual(Object.keys(regions).sort(), ['__proto__', 'constructor', 'ok_1']);
  assert.equal(regions.constructor, region);
  // Still plain data: nothing leaked into Object.prototype.
  assert.equal({}.ok_1, undefined);
});

test('project flag update stores the project path and the output it belongs to', () => {
  assert.deepEqual(getProjectFlagUpdate({ path: 'a/x.tokener.json', output: 'a/x.webm' }), {
    'flags.pf2e-tokener.project': { path: 'a/x.tokener.json', output: 'a/x.webm' },
  });
});

const PROJECT_PATH = 'worlds/w/tokener/dragon.tokener.json';
const OUTPUT = 'worlds/w/tokener/dragon.webm';
const flagged = (output, src, extra = {}) => ({
  _source: {
    texture: { src },
    flags: { 'pf2e-tokener': { project: { path: PROJECT_PATH, output } } },
  },
  ...extra,
});

test('shouldLoadProject loads when the flag output is the saved token art', () => {
  assert.deepEqual(shouldLoadProject(flagged(OUTPUT, OUTPUT)), { path: PROJECT_PATH });
  // `_source` wins over a derived texture (e.g. an effect overriding the art for a moment).
  assert.deepEqual(
    shouldLoadProject(flagged(OUTPUT, OUTPUT, { texture: { src: 'icons/override.webp' } })),
    { path: PROJECT_PATH },
  );
});

test('shouldLoadProject ignores stale and missing flags', () => {
  // Reverted or replaced by other art: the flag still points at the old output.
  assert.equal(shouldLoadProject(flagged(OUTPUT, 'art/goblin.webp')), null);
  assert.equal(shouldLoadProject({ _source: { texture: { src: OUTPUT }, flags: {} } }), null);
  assert.equal(shouldLoadProject({ texture: { src: OUTPUT } }), null);
  assert.equal(
    shouldLoadProject({
      _source: {
        texture: { src: OUTPUT },
        flags: { 'pf2e-tokener': { project: { path: '', output: OUTPUT } } },
      },
    }),
    null,
  );
  assert.equal(shouldLoadProject(null), null);
  assert.equal(shouldLoadProject(undefined), null);
});

test('shouldLoadProject reads the prototype token for actor-only opens', () => {
  const prototypeToken = flagged(OUTPUT, OUTPUT);
  const proxy = {
    isTokenerActorProxy: true,
    flags: {}, // the actor's own flags never carry the project link
    get prototypeToken() {
      return prototypeToken;
    },
    get texture() {
      return prototypeToken._source.texture;
    },
  };
  assert.deepEqual(shouldLoadProject(proxy), { path: PROJECT_PATH });
  // A plain prototype token object (no `_source`) works too.
  const plain = {
    isTokenerActorProxy: true,
    prototypeToken: {
      texture: { src: OUTPUT },
      flags: { 'pf2e-tokener': { project: { path: PROJECT_PATH, output: OUTPUT } } },
    },
  };
  assert.deepEqual(shouldLoadProject(plain), { path: PROJECT_PATH });
  const stale = { isTokenerActorProxy: true, prototypeToken: flagged(OUTPUT, 'art/new.webp') };
  assert.equal(shouldLoadProject(stale), null);
});

/** A creator app double with a status line: the shape `loadCreatorProject` touches. */
function createFakeCreatorApp(normalizeTokenCreatorOptions) {
  const status = {
    textContent: '',
    isError: false,
    classList: {
      toggle(name, value) {
        if (name === 'is-error') status.isError = Boolean(value);
      },
    },
  };
  const root = {
    nodeType: 1,
    dataset: {},
    querySelector: (selector) => (selector === '.pf2e-tokener-creator-status' ? status : null),
    querySelectorAll: () => [],
    matches: () => false,
    setAttribute() {},
  };
  const workspace = () => ({
    source: null,
    autoCutout: null,
    cutout: null,
    cleanup: { keep: null, remove: null },
    cutoutToken: 0,
  });
  const app = {
    parts: { main: root },
    status,
    creatorOptions: normalizeTokenCreatorOptions({ backgroundMode: 'none' }),
    view: { zoom: 1, offsetX: 0, offsetY: 0 },
    portraitView: { zoom: 1, offsetX: 0, offsetY: 0 },
    viewport: { scale: 1, panX: 0, panY: 0 },
    editTarget: 'token',
    workspaces: { token: workspace(), portrait: null },
    popOutMask: null,
    maskTool: null,
    _maskVersion: 0,
    _maskHistory: { undo: [], redo: [] },
    animation: { duration: 2, fps: 24, mode: 'loop', pins: [], effects: [] },
    animationTime: 0,
    selectedPinIds: [],
    effectRegions: {},
    selectedEffectId: null,
    _regionVersion: 0,
    animationPlaying: false,
    _animationFrame: null,
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
  return app;
}

async function withCanvasDocument(callback) {
  const { createCanvas } = await import('canvas');
  const previous = globalThis.document;
  globalThis.document = { createElement: () => createCanvas(1, 1) };
  try {
    return await callback();
  } finally {
    globalThis.document = previous;
  }
}

function savedProject(overrides = {}) {
  return serializeProject(
    sampleInput({
      token: {
        sourcePath: 'worlds/w/tokener/dragon-source.png',
        view: { zoom: 1.5, offsetX: -12, offsetY: 7 },
        popOutMask: fakeCanvas('popout'),
        cleanup: { keep: null, remove: fakeCanvas('remove') },
      },
      portrait: null,
      portraitView: { zoom: 2, offsetX: 0.1, offsetY: -0.2 },
      ...overrides,
    }),
  );
}

test('a project whose source image is gone leaves the creator empty with a status', async () => {
  const { loadCreatorProject, normalizeTokenCreatorOptions } =
    await import('../scripts/token-creator.js');
  await withCanvasDocument(async () => {
    const app = createFakeCreatorApp(normalizeTokenCreatorOptions);
    const loaded = await loadCreatorProject(app, PROJECT_PATH, {
      fetchJson: async () => JSON.parse(JSON.stringify(savedProject())),
      loadImage: async (src) => {
        throw new Error(`404 ${src}`);
      },
    });
    assert.equal(loaded, false);
    assert.match(app.status.textContent, /saved project/i);
    assert.equal(app.workspaces.token.source, null);
    assert.equal(app.workspaces.token.cutout, null);
    assert.equal(app.workspaces.portrait, null);
    assert.deepEqual(app.view, { zoom: 1, offsetX: 0, offsetY: 0 });
    assert.equal(app.popOutMask, null);
    assert.deepEqual(app.animation.pins, []);
  });
});

test('a missing or invalid project file fails the same way', async () => {
  const { loadCreatorProject, normalizeTokenCreatorOptions } =
    await import('../scripts/token-creator.js');
  await withCanvasDocument(async () => {
    const fetchers = [
      async () => {
        throw new Error('404');
      },
      async () => ({ version: 99 }),
      async () => 'not json',
    ];
    for (const fetchJson of fetchers) {
      const app = createFakeCreatorApp(normalizeTokenCreatorOptions);
      const loaded = await loadCreatorProject(app, PROJECT_PATH, {
        fetchJson,
        loadImage: async () => {
          throw new Error('never reached');
        },
      });
      assert.equal(loaded, false);
      assert.match(app.status.textContent, /saved project/i);
      assert.equal(app.workspaces.token.source, null);
    }
  });
});

test('loading a project restores workspaces, views, options, masks, animation and regions', async () => {
  const { createCanvas } = await import('canvas');
  const { loadCreatorProject, normalizeTokenCreatorOptions } =
    await import('../scripts/token-creator.js');
  await withCanvasDocument(async () => {
    const source = createCanvas(40, 20);
    source.getContext('2d').fillStyle = '#ff0000';
    source.getContext('2d').fillRect(0, 0, 40, 20);
    const mask = () => {
      const canvas = createCanvas(40, 20);
      canvas.getContext('2d').fillRect(0, 0, 10, 20);
      return canvas;
    };
    const masks = { popout: mask(), remove: mask(), region1: mask() };
    const project = savedProject({
      options: { backgroundMode: 'none', frameStyle: 'ring', popOut: true, breakoutRoom: 20 },
    });
    const app = createFakeCreatorApp(normalizeTokenCreatorOptions);
    app.selectedPinIds = ['old'];
    app.animationTime = 0.4;
    app._previewBend = { key: 'old' };
    const loaded = await loadCreatorProject(app, PROJECT_PATH, {
      fetchJson: async () => JSON.parse(JSON.stringify(project)),
      loadImage: async (src) => {
        if (src === 'worlds/w/tokener/dragon-source.png') return source;
        const name = /base64,(\w+)$/.exec(src)?.[1];
        if (masks[name]) return masks[name];
        throw new Error(`unexpected ${src}`);
      },
    });
    assert.equal(loaded, true);
    const token = app.workspaces.token;
    assert.equal(token.source.path, 'worlds/w/tokener/dragon-source.png');
    assert.equal(token.source.canvas.width, 40);
    assert.ok(token.autoCutout, 'the background removal ran again');
    assert.notEqual(token.cutout, token.autoCutout, 'saved touch-ups applied over the cut-out');
    assert.equal(token.cleanup.remove.width, 40);
    assert.equal(token.cleanup.keep, null);
    // The removed area (left 10 px) is transparent, the rest is kept.
    const pixels = token.cutout.getContext('2d').getImageData(0, 0, 40, 20).data;
    assert.equal(pixels[3], 0);
    assert.equal(pixels[(5 * 40 + 30) * 4 + 3], 255);
    assert.equal(app.workspaces.portrait, null);
    assert.deepEqual(app.view, { zoom: 1.5, offsetX: -12, offsetY: 7 });
    assert.deepEqual(app.portraitView, { zoom: 2, offsetX: 0.1, offsetY: -0.2 });
    assert.equal(app.creatorOptions.frameStyle, 'ring');
    assert.equal(app.creatorOptions.popOut, true);
    assert.equal(app.popOutMask.width, 40);
    assert.equal(app.animation.mode, 'pingpong');
    assert.equal(app.animation.pins.length, 1);
    assert.deepEqual(
      app.animation.effects.map((effect) => effect.id),
      ['fx-1', 'fx-2'],
    );
    assert.equal(app.animation.regions, undefined);
    assert.deepEqual(Object.keys(app.effectRegions), ['r1']);
    assert.equal(app.effectRegions.r1.width, 40);
    assert.equal(app.effectRegions.r1.height, 20);
    assert.deepEqual(app.selectedPinIds, []);
    assert.equal(app.selectedEffectId, null);
    assert.equal(app.animationTime, 0);
    assert.equal(app._previewBend, null);
    assert.equal(app.editTarget, 'token');
    assert.match(app.status.textContent, /saved project/i);
  });
});

test('a background removal that fails on load keeps its error on the status line', async () => {
  const { createCanvas } = await import('canvas');
  const { loadCreatorProject, normalizeTokenCreatorOptions } =
    await import('../scripts/token-creator.js');
  await withCanvasDocument(async () => {
    const source = createCanvas(40, 20);
    const mask = () => createCanvas(40, 20);
    const app = createFakeCreatorApp(normalizeTokenCreatorOptions);
    const loadImage = async (src) => (src.startsWith('data:') ? mask() : source);
    const failure = 'Background removal failed; using the original image. (boom)';
    const loaded = await loadCreatorProject(app, PROJECT_PATH, {
      fetchJson: async () => JSON.parse(JSON.stringify(savedProject())),
      loadImage,
      updateCutouts: async () => [failure, null],
    });
    assert.equal(loaded, true);
    assert.match(app.status.textContent, /Background removal failed/);
    assert.match(app.status.textContent, /still open/);
    assert.equal(app.status.isError, true);

    const fine = createFakeCreatorApp(normalizeTokenCreatorOptions);
    await loadCreatorProject(fine, PROJECT_PATH, {
      fetchJson: async () => JSON.parse(JSON.stringify(savedProject())),
      loadImage,
      updateCutouts: async () => [null],
    });
    assert.equal(fine.status.textContent, 'Editing the saved project.');
    assert.equal(fine.status.isError, false);
  });
});

test('a new token image drops effects with their painted regions and region undo steps', async () => {
  const { createCanvas } = await import('canvas');
  const { clearAnimationPins, normalizeTokenCreatorOptions } =
    await import('../scripts/token-creator.js');
  const app = createFakeCreatorApp(normalizeTokenCreatorOptions);
  const region = createCanvas(40, 20);
  region.getContext('2d').fillRect(0, 0, 10, 10);
  app.animation = {
    duration: 3,
    fps: 30,
    mode: 'pingpong',
    pins: [{ id: 'p', x: 1, y: 1, keyframes: [{ t: 0, dx: 2, dy: 0 }] }],
    effects: [{ id: 'fx', type: 'glow', region: 'fx', color: '#ffffff', size: 4, pulse: 0 }],
  };
  app.effectRegions = { fx: region };
  app.selectedEffectId = 'fx';
  app.selectedPinIds = ['p'];
  const maskStep = { layer: 'popout' };
  app._maskHistory = {
    undo: [maskStep, { layer: 'region', regionKey: 'fx', effectId: 'fx' }],
    redo: [{ layer: 'region', regionKey: 'fx', effectId: 'fx' }],
  };
  app._previewBend = { key: 'old' };
  clearAnimationPins(app);
  assert.deepEqual(app.animation, {
    duration: 3,
    fps: 30,
    mode: 'pingpong',
    pins: [],
    effects: [],
  });
  assert.deepEqual(app.effectRegions, {});
  assert.equal(app.selectedEffectId, null);
  assert.deepEqual(app.selectedPinIds, []);
  assert.deepEqual(app._maskHistory, { undo: [maskStep], redo: [] });
  assert.equal(app._regionVersion, 1);
  assert.equal(app._previewBend, null);
});

test('serialize → parse keeps each workspace flip, defaulting to no flip', () => {
  const input = sampleInput();
  input.token.flip = { x: true, y: false };
  input.portrait.flip = { x: false, y: true };
  const project = serializeProject(input);
  assert.deepEqual(project.token.flip, { x: true, y: false });
  assert.deepEqual(project.portrait.flip, { x: false, y: true });
  const parsed = parseProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(parsed.token.flip, { x: true, y: false });
  assert.deepEqual(parsed.portrait.flip, { x: false, y: true });

  const plain = serializeProject(sampleInput());
  assert.deepEqual(plain.token.flip, { x: false, y: false });
  const legacy = JSON.parse(JSON.stringify(plain));
  delete legacy.token.flip;
  legacy.portrait.flip = { x: 'yes', y: null };
  const parsedLegacy = parseProject(legacy);
  assert.deepEqual(parsedLegacy.token.flip, { x: false, y: false });
  assert.deepEqual(parsedLegacy.portrait.flip, { x: false, y: false });
});

/** A 40×20 image whose left and right halves differ, so a mirror is visible. */
function asymmetricCanvas(createCanvas) {
  const canvas = createCanvas(40, 20);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ff0000';
  context.fillRect(0, 0, 40, 20);
  context.fillStyle = '#0000ff';
  context.fillRect(0, 0, 8, 6);
  return canvas;
}

const readPixels = (canvas) =>
  Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data);

const pixelAt = (canvas, x, y) => Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data);

/** Loads a one-workspace project whose token has a pop-out mask, a removed area, pins and a region. */
async function loadFlipFixture(app, loadCreatorProject, createCanvas, source) {
  const mask = (x) => {
    const canvas = createCanvas(40, 20);
    canvas.getContext('2d').fillRect(x, 0, 6, 20);
    return canvas;
  };
  const masks = { popout: mask(2), remove: mask(30), region1: mask(12) };
  const project = savedProject({ options: { backgroundMode: 'none', popOut: true } });
  const loaded = await loadCreatorProject(app, PROJECT_PATH, {
    fetchJson: async () => JSON.parse(JSON.stringify(project)),
    loadImage: async (src) => {
      if (src === 'worlds/w/tokener/dragon-source.png') return source;
      const name = /base64,(\w+)$/.exec(src)?.[1];
      if (masks[name]) return masks[name];
      throw new Error(`unexpected ${src}`);
    },
  });
  assert.equal(loaded, true);
}

function captureFlipState(app) {
  const token = app.workspaces.token;
  return {
    source: readPixels(token.source.canvas),
    autoCutout: readPixels(token.autoCutout),
    cutout: readPixels(token.cutout),
    remove: readPixels(token.cleanup.remove),
    popOut: readPixels(app.popOutMask),
    region: readPixels(app.effectRegions.r1),
    pins: structuredClone(app.animation.pins),
    view: { ...app.view },
    portraitView: { ...app.portraitView },
  };
}

test('flipping the token mirrors the art, masks, regions, pins and view; twice restores it', async () => {
  const { createCanvas } = await import('canvas');
  const { flipWorkspace, loadCreatorProject, normalizeTokenCreatorOptions } =
    await import('../scripts/token-creator.js');
  await withCanvasDocument(async () => {
    const app = createFakeCreatorApp(normalizeTokenCreatorOptions);
    await loadFlipFixture(app, loadCreatorProject, createCanvas, asymmetricCanvas(createCanvas));
    const before = captureFlipState(app);
    app._maskHistory = { undo: [{ layer: 'popout' }], redo: [] };
    app._previewBend = { key: 'old' };

    assert.equal(flipWorkspace(app, 'x'), true);
    const token = app.workspaces.token;
    assert.deepEqual(token.source.flip, { x: true, y: false });
    // The blue corner moved from the top-left to the top-right, in every layer alike.
    assert.deepEqual(pixelAt(token.source.canvas, 39, 0), [0, 0, 255, 255]);
    assert.deepEqual(pixelAt(token.source.canvas, 0, 0), [255, 0, 0, 255]);
    // The removed strip (x 30–35) is now at x 4–9: transparent in the cut-out.
    assert.equal(pixelAt(token.cutout, 6, 10)[3], 0);
    assert.equal(pixelAt(token.cutout, 32, 10)[3], 255);
    assert.equal(pixelAt(app.popOutMask, 35, 10)[3], 255);
    assert.equal(pixelAt(app.popOutMask, 3, 10)[3], 0);
    assert.equal(pixelAt(app.effectRegions.r1, 25, 10)[3], 255);
    assert.equal(pixelAt(app.effectRegions.r1, 13, 10)[3], 0);
    assert.equal(app.animation.pins[0].x, 30);
    assert.equal(app.animation.pins[0].keyframes[1].dx, -4);
    assert.equal(app.animation.pins[0].keyframes[1].rot, -0.2);
    assert.deepEqual(app.view, { zoom: 1.5, offsetX: 12, offsetY: 7 });
    assert.deepEqual(app.portraitView, { zoom: 2, offsetX: -0.1, offsetY: -0.2 });
    assert.deepEqual(app._maskHistory, { undo: [], redo: [] });
    assert.equal(app._previewBend, null);

    flipWorkspace(app, 'x');
    assert.deepEqual(captureFlipState(app), before);
    assert.deepEqual(app.workspaces.token.source.flip, { x: false, y: false });

    flipWorkspace(app, 'y');
    flipWorkspace(app, 'y');
    assert.deepEqual(captureFlipState(app), before);
  });
});

test('a portrait sharing the token image flips both; its own image flips only the portrait', async () => {
  const { createCanvas } = await import('canvas');
  const { flipWorkspace, loadCreatorProject, normalizeTokenCreatorOptions } =
    await import('../scripts/token-creator.js');
  await withCanvasDocument(async () => {
    // Linked ("Same as token"): Portrait mode flips the shared image and so the token too.
    const linked = createFakeCreatorApp(normalizeTokenCreatorOptions);
    await loadFlipFixture(linked, loadCreatorProject, createCanvas, asymmetricCanvas(createCanvas));
    linked.editTarget = 'portrait';
    flipWorkspace(linked, 'x');
    assert.deepEqual(linked.workspaces.token.source.flip, { x: true, y: false });
    assert.equal(linked.animation.pins[0].x, 30);
    assert.deepEqual(linked.view, { zoom: 1.5, offsetX: 12, offsetY: 7 });
    assert.deepEqual(linked.portraitView, { zoom: 2, offsetX: -0.1, offsetY: -0.2 });

    // A separate portrait that still shares the token's source object: both workspaces flip.
    const cloned = createFakeCreatorApp(normalizeTokenCreatorOptions);
    await loadFlipFixture(cloned, loadCreatorProject, createCanvas, asymmetricCanvas(createCanvas));
    const tokenWorkspace = cloned.workspaces.token;
    cloned.workspaces.portrait = {
      ...tokenWorkspace,
      cleanup: { keep: null, remove: null },
      cutout: tokenWorkspace.autoCutout,
      cutoutToken: 0,
    };
    cloned.editTarget = 'portrait';
    flipWorkspace(cloned, 'y');
    assert.equal(cloned.workspaces.portrait.source, cloned.workspaces.token.source);
    assert.deepEqual(cloned.workspaces.token.source.flip, { x: false, y: true });
    assert.equal(cloned.workspaces.portrait.autoCutout, cloned.workspaces.token.autoCutout);
    assert.equal(cloned.animation.pins[0].y, 0);

    // The portrait's own image: only the portrait and its framing flip.
    const own = createFakeCreatorApp(normalizeTokenCreatorOptions);
    await loadFlipFixture(own, loadCreatorProject, createCanvas, asymmetricCanvas(createCanvas));
    const portraitCanvas = asymmetricCanvas(createCanvas);
    own.workspaces.portrait = {
      source: { canvas: portraitCanvas, path: 'art/p.png', file: null, label: 'p' },
      autoCutout: portraitCanvas,
      cutout: portraitCanvas,
      cleanup: { keep: null, remove: null },
      cutoutToken: 0,
    };
    const tokenBefore = captureFlipState(own);
    own.editTarget = 'portrait';
    flipWorkspace(own, 'x');
    assert.deepEqual(own.workspaces.portrait.source.flip, { x: true, y: false });
    assert.deepEqual(pixelAt(own.workspaces.portrait.cutout, 39, 0), [0, 0, 255, 255]);
    assert.deepEqual(
      { ...captureFlipState(own), portraitView: tokenBefore.portraitView },
      tokenBefore,
      'the token workspace, pins, regions and token view are untouched',
    );
    assert.deepEqual(own.portraitView, { zoom: 2, offsetX: -0.1, offsetY: -0.2 });
  });
});

test('a flipped project reopens with the same cut-out, masks, regions and pins', async () => {
  const { createCanvas } = await import('canvas');
  const {
    flipWorkspace,
    loadCreatorProject,
    normalizeTokenCreatorOptions,
    serializeProjectSnapshot,
    snapshotProjectState,
  } = await import('../scripts/token-creator.js');
  await withCanvasDocument(async () => {
    const original = asymmetricCanvas(createCanvas);
    const app = createFakeCreatorApp(normalizeTokenCreatorOptions);
    await loadFlipFixture(app, loadCreatorProject, createCanvas, original);
    flipWorkspace(app, 'x');
    flipWorkspace(app, 'y');
    const before = captureFlipState(app);

    const stored = new Map();
    const project = serializeProjectSnapshot(snapshotProjectState(app), {
      tokenPath: app.workspaces.token.source.path,
      output: 'worlds/w/tokener/dragon.webm',
      toDataUrl: (canvas) => {
        const url = `data:image/png;base64,m${stored.size}`;
        stored.set(url, canvas);
        return url;
      },
    });
    assert.deepEqual(project.token.flip, { x: true, y: true });

    const reopened = createFakeCreatorApp(normalizeTokenCreatorOptions);
    const loaded = await loadCreatorProject(reopened, PROJECT_PATH, {
      fetchJson: async () => JSON.parse(JSON.stringify(project)),
      // The source is loaded by path, unflipped, exactly as it is on disk.
      loadImage: async (src) => {
        if (src === 'worlds/w/tokener/dragon-source.png') return original;
        if (stored.has(src)) return stored.get(src);
        throw new Error(`unexpected ${src}`);
      },
    });
    assert.equal(loaded, true);
    assert.deepEqual(reopened.workspaces.token.source.flip, { x: true, y: true });
    assert.deepEqual(captureFlipState(reopened), before);
  });
});

test('a source without a path is saved already flipped, so its project flip is none', async () => {
  const { createCanvas } = await import('canvas');
  const { flipWorkspace, normalizeTokenCreatorOptions, snapshotProjectState } =
    await import('../scripts/token-creator.js');
  await withCanvasDocument(async () => {
    const app = createFakeCreatorApp(normalizeTokenCreatorOptions);
    const canvas = asymmetricCanvas(createCanvas);
    app.workspaces.token.source = { canvas, path: null, file: {}, label: 'pasted' };
    app.workspaces.token.autoCutout = canvas;
    app.workspaces.token.cutout = canvas;
    flipWorkspace(app, 'x');
    assert.deepEqual(app.workspaces.token.source.flip, { x: true, y: false });
    assert.deepEqual(snapshotProjectState(app).token.flip, { x: false, y: false });
  });
});
