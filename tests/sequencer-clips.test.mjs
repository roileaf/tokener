import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from 'canvas';

import {
  clipFrameIndex,
  drawClipFrame,
  getClipTiming,
  getSequencerEntryName,
  guessClipOrigin,
  resolveSequencerFile,
  searchSequencerEntries,
} from '../scripts/sequencer-clips.js';
import { createEffect, normalizeEffects, isEffectActive } from '../scripts/animation-effects.js';
import { renderAnimationFrame } from '../scripts/token-animation.js';

test('a Sequencer entry resolves to one file however the database stores it', () => {
  assert.equal(resolveSequencerFile({ file: 'modules/a/b.webm' }), 'modules/a/b.webm');
  // Range-found entries keep one file per distance; the shortest is the token's size.
  assert.equal(
    resolveSequencerFile({ file: { '30ft': 'b30.webm', '05ft': 'b05.webm', '15ft': 'b15.webm' } }),
    'b05.webm',
  );
  // Random variants come as a list.
  assert.equal(resolveSequencerFile([{ file: 'one.webm' }, { file: 'two.webm' }]), 'one.webm');
  assert.equal(resolveSequencerFile({ file: ['x.webm', 'y.webm'] }), 'x.webm');
  assert.equal(resolveSequencerFile('plain.webm'), 'plain.webm');
  assert.equal(resolveSequencerFile(false), null);
  assert.equal(resolveSequencerFile({ file: { a: 42 } }), null);
});

test('searching the Sequencer catalog matches every word, in any order', () => {
  const paths = [
    'jb2a.breath_weapons.fire.cone.orange.02',
    'jb2a.breath_weapons.cold.cone.blue',
    'jb2a.flames.01.orange',
    'jb2a.smoke.puff.ring.01.white',
  ];
  assert.deepEqual(searchSequencerEntries(paths, 'fire breath'), [
    'jb2a.breath_weapons.fire.cone.orange.02',
  ]);
  assert.deepEqual(searchSequencerEntries(paths, 'ORANGE'), [
    'jb2a.breath_weapons.fire.cone.orange.02',
    'jb2a.flames.01.orange',
  ]);
  assert.equal(searchSequencerEntries(paths, '').length, 4);
  assert.equal(searchSequencerEntries(paths, 'o', 2).length, 2, 'capped');
  assert.equal(
    getSequencerEntryName('jb2a.breath_weapons.fire.cone.orange.02'),
    'fire cone orange 02',
  );
});

test('a clip repeats a whole number of times per token loop, so the loop has no seam', () => {
  // A 1.6 s clip in a 2 s loop plays once, slowed to fill it.
  assert.deepEqual(getClipTiming(1.6, 2), { repeats: 1, rate: 0.8 });
  // A 0.9 s clip in a 2 s loop plays twice, a little slower.
  assert.deepEqual(getClipTiming(0.9, 2), { repeats: 2, rate: 0.9 });
  const clip = { duration: 1, frames: new Array(10) };
  assert.equal(clipFrameIndex(clip, 0, 2), 0);
  assert.equal(clipFrameIndex(clip, 0.25, 2), 5, 'half way through the first repeat');
  assert.equal(clipFrameIndex(clip, 0.5, 2), 0, 'the second repeat starts');
  assert.equal(clipFrameIndex(clip, 0.999, 2), 9);
  assert.equal(clipFrameIndex({ duration: 0, frames: [] }, 0.5, 2), -1);
});

test('a clip frame is drawn centred on its anchor, scaled, turned and faded', () => {
  const frame = createCanvas(20, 10);
  const frameContext = frame.getContext('2d');
  frameContext.fillStyle = '#ff0000';
  frameContext.fillRect(0, 0, 20, 10);
  const canvas = createCanvas(100, 100);
  const context = canvas.getContext('2d');
  drawClipFrame(context, frame, { x: 50, y: 50, width: 40, rotation: 0, opacity: 1 });
  const alpha = (x, y) => context.getImageData(x, y, 1, 1).data[3];
  assert.equal(alpha(50, 50), 255);
  assert.equal(alpha(31, 50), 255);
  assert.equal(alpha(50, 41), 255, '20 px tall: half the width, as the frame');
  assert.equal(alpha(50, 35), 0);
  const turned = createCanvas(100, 100);
  drawClipFrame(turned.getContext('2d'), frame, {
    x: 50,
    y: 50,
    width: 40,
    rotation: Math.PI / 2,
    opacity: 0.5,
  });
  const at = (x, y) => turned.getContext('2d').getImageData(x, y, 1, 1).data[3];
  assert.ok(Math.abs(at(50, 35) - 128) <= 1, 'turned upright and half faded');
  assert.equal(at(35, 50), 0);
});

test('a Sequencer effect keeps its file, pin and placement, clamped', () => {
  const effect = createEffect('sequencer');
  assert.equal(effect.type, 'sequencer');
  assert.equal(effect.clip, 'frame');
  assert.equal(isEffectActive(effect, {}), false, 'no file picked yet');
  const [normalized] = normalizeEffects([
    {
      ...effect,
      id: 'fx1',
      path: 'jb2a.breath_weapons.fire.cone.orange.02',
      file: 'modules/jb2a_patreon/Library/Generic/Breath_Weapon/Fire_600x600.webm',
      pin: 'pin-1',
      size: 9,
      angle: 400,
      offsetX: 0.2,
      offsetY: -3,
      opacity: 0.5,
      clip: 'free',
      region: 'nope',
    },
  ]);
  assert.equal(
    normalized.file,
    'modules/jb2a_patreon/Library/Generic/Breath_Weapon/Fire_600x600.webm',
  );
  assert.equal(normalized.path, 'jb2a.breath_weapons.fire.cone.orange.02');
  assert.equal(normalized.pin, 'pin-1');
  assert.equal(normalized.size, 2);
  assert.equal(normalized.angle, 180);
  assert.equal(normalized.offsetY, -1);
  assert.equal(normalized.clip, 'free');
  assert.equal(normalized.region, null, 'a clip has no painted region');
  assert.equal(isEffectActive(normalized, {}), true);
  // Files from elsewhere or climbing out of the data folder are dropped.
  for (const file of ['https://evil.example/x.webm', '../secret.webm', '/abs.webm', 'a.js'])
    assert.equal(normalizeEffects([{ ...effect, file }])[0].file, '', file);
});

test('a clip on a pin is drawn where the pin is, inside the frame unless set free', () => {
  const size = 64;
  const cutout = createCanvas(size, size);
  cutout.getContext('2d').fillStyle = '#000';
  const frame = createCanvas(8, 8);
  frame.getContext('2d').fillStyle = '#00ff00';
  frame.getContext('2d').fillRect(0, 0, 8, 8);
  const clips = new Map([['fx.webm', { duration: 1, frames: [frame] }]]);
  const pin = { id: 'p', x: 56, y: 32, arm: 0, keyframes: [] };
  const render = (clip) => {
    const canvas = createCanvas(size, size);
    renderAnimationFrame({
      context: canvas.getContext('2d'),
      size,
      t: 0.2,
      art: { cutout, popOutImage: null, regions: {} },
      view: { zoom: 1, offsetX: 0, offsetY: 0 },
      animation: {
        duration: 2,
        fps: 30,
        mode: 'loop',
        pins: [pin],
        effects: [
          {
            ...createEffect('sequencer'),
            file: 'fx.webm',
            pin: 'p',
            size: 0.25,
            clip,
          },
        ],
      },
      createCanvas,
      drawFrame: () => {},
      effectClip: { x: size / 2, y: size / 2, radius: 20 },
      clips,
    });
    return (x, y) => [...canvas.getContext('2d').getImageData(x, y, 1, 1).data];
  };
  const free = render('free');
  assert.deepEqual(free(56, 32), [0, 255, 0, 255], 'centred on the pin');
  assert.equal(free(56, 22)[3], 0, '16 px wide');
  const framed = render('frame');
  assert.equal(framed(56, 32)[3], 0, 'outside the opening it is clipped away');
  assert.equal(framed(50, 32)[3], 255, 'inside the opening it shows');
});

test('cones, rays and breath start at their pin; other clips centre on it', () => {
  assert.equal(guessClipOrigin('jb2a.breath_weapons02.loop.cone.fire.orange.01'), 'start');
  assert.equal(guessClipOrigin('jb2a.scorching_ray.01.orange'), 'start');
  assert.equal(guessClipOrigin('jb2a.flames.01.orange'), 'centre');
  assert.equal(guessClipOrigin('jb2a.smoke.puff.ring.01.white'), 'centre');

  const frame = createCanvas(20, 10);
  frame.getContext('2d').fillStyle = '#ff0000';
  frame.getContext('2d').fillRect(0, 0, 20, 10);
  const canvas = createCanvas(100, 100);
  const context = canvas.getContext('2d');
  drawClipFrame(context, frame, { x: 50, y: 50, width: 40, origin: 'start' });
  const alpha = (x, y) => context.getImageData(x, y, 1, 1).data[3];
  assert.equal(alpha(51, 50), 255, 'it begins at the anchor');
  assert.equal(alpha(88, 50), 255, 'and runs its width ahead');
  assert.equal(alpha(48, 50), 0, 'nothing behind the anchor');
});
