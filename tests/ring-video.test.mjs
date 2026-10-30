import test from 'node:test';
import assert from 'node:assert/strict';

import {
  playRingVideo,
  registerCreatedTokenSubjectPath,
  registerRingVideoPlayback,
} from '../scripts/ring-video.js';

function makeToken({ enabled = true, video } = {}) {
  return {
    document: { ring: { enabled } },
    mesh: { texture: { baseTexture: { resource: { source: video } } } },
  };
}

function makeHelper() {
  const calls = [];
  return { calls, play: (video, options) => calls.push({ video, options }) };
}

test('a paused ring-subject video is started muted', () => {
  const video = { tagName: 'VIDEO', paused: true };
  const helper = makeHelper();
  assert.equal(playRingVideo(makeToken({ video }), helper), true);
  assert.deepEqual(helper.calls, [{ video, options: { volume: 0 } }]);
});

test('playing videos, images and ring-less tokens are left alone', () => {
  const helper = makeHelper();
  assert.equal(
    playRingVideo(makeToken({ video: { tagName: 'VIDEO', paused: false } }), helper),
    false,
  );
  assert.equal(
    playRingVideo(makeToken({ video: { tagName: 'IMG', paused: true } }), helper),
    false,
  );
  assert.equal(
    playRingVideo(makeToken({ enabled: false, video: { tagName: 'VIDEO', paused: true } }), helper),
    false,
  );
  assert.equal(playRingVideo({ document: { ring: { enabled: true } } }, helper), false);
  assert.equal(playRingVideo(null, helper), false);
  assert.equal(helper.calls.length, 0);
});

test('playback is registered on drawToken and refreshToken', () => {
  const names = [];
  registerRingVideoPlayback({ on: (name) => names.push(name) });
  assert.deepEqual(names, ['drawToken', 'refreshToken']);
});

test('the created token folder is registered as holding its own ring subjects', () => {
  const ring = { subjectPaths: {} };
  assert.equal(registerCreatedTokenSubjectPath('/worlds/kingmaker/tokener/', ring), true);
  assert.deepEqual(ring.subjectPaths, {
    'worlds/kingmaker/tokener/': 'worlds/kingmaker/tokener/',
  });
});

test('an existing subject mapping for the folder is kept', () => {
  const ring = { subjectPaths: { 'worlds/w/tokener/': 'worlds/w/subjects/' } };
  registerCreatedTokenSubjectPath('worlds/w/tokener', ring);
  assert.equal(ring.subjectPaths['worlds/w/tokener/'], 'worlds/w/subjects/');
});

test('registering needs a folder and the ring config', () => {
  assert.equal(registerCreatedTokenSubjectPath('', { subjectPaths: {} }), false);
  assert.equal(registerCreatedTokenSubjectPath('worlds/w/tokener', undefined), false);
  const ring = {};
  assert.equal(registerCreatedTokenSubjectPath('worlds/w/tokener', ring), true);
  assert.deepEqual(ring.subjectPaths, { 'worlds/w/tokener/': 'worlds/w/tokener/' });
});
