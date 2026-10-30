import test from 'node:test';
import assert from 'node:assert/strict';

import { playRingVideo, registerRingVideoPlayback } from '../scripts/ring-video.js';

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
