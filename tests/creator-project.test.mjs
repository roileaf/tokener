import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROJECT_VERSION,
  buildProjectFileName,
  getProjectFlagUpdate,
  parseProject,
  serializeProject,
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
  assert.deepEqual(project.animation.regions, { r1: 'data:image/png;base64,region1' });
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
  assert.deepEqual(parsed.animation.regions, {});
});

test('project flag update stores the project path and the output it belongs to', () => {
  assert.deepEqual(getProjectFlagUpdate({ path: 'a/x.tokener.json', output: 'a/x.webm' }), {
    'flags.pf2e-tokener.project': { path: 'a/x.tokener.json', output: 'a/x.webm' },
  });
});
