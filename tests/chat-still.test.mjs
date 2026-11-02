import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTokenUpdate, STILL_FLAG_PATH } from '../scripts/actions.js';
import { buildLookUpdate } from '../scripts/art-views.js';
import { getFittedSquare, getTokenStill, showChatStill } from '../scripts/chat-still.js';
import { buildCreatedTokenCandidate } from '../scripts/token-composer.js';

const still = (src, image) => ({ 'pf2e-tokener': { still: { src, image } } });

function chatCard() {
  const img = { src: 'actor.webp', style: {} };
  const classes = new Set(['portrait', 'actor-image']);
  const portrait = {
    querySelector: (selector) => (selector === 'img' ? img : null),
    classList: {
      replace: (from, to) => classes.delete(from) && classes.add(to),
    },
  };
  const html = {
    querySelector: (selector) =>
      selector === 'header.message-header .portrait.actor-image' ? portrait : null,
  };
  return { html, img, classes };
}

test('an animated created token records its still image', () => {
  const candidate = buildCreatedTokenCandidate({
    label: 'Dragon',
    tokenSrc: 'tokener/dragon.webm',
    stillSrc: 'tokener/dragon-still.webp',
  });
  const update = buildTokenUpdate(candidate);
  assert.deepEqual(update[STILL_FLAG_PATH], {
    src: 'tokener/dragon.webm',
    image: 'tokener/dragon-still.webp',
  });
  const plain = buildTokenUpdate(
    buildCreatedTokenCandidate({ label: 'Dragon', tokenSrc: 'tokener/dragon.webp' }),
  );
  assert.equal(STILL_FLAG_PATH in plain, false);
});

test('a still only counts while its video is the token image', () => {
  const document = {
    texture: { src: 'dragon.webm' },
    flags: still('dragon.webm', 'dragon-still.webp'),
  };
  assert.equal(getTokenStill(document), 'dragon-still.webp');
  assert.equal(getTokenStill({ ...document, texture: { src: 'other.webm' } }), null);
  assert.equal(getTokenStill({ texture: { src: 'dragon.webm' } }), null);
});

test('chat cards show the speaker token still, fitted, instead of the portrait', async () => {
  const { html, img, classes } = chatCard();
  img.style.transform = 'scale(1.26)';
  const token = {
    texture: { src: 'dragon.webm', scaleX: 1 },
    ring: { enabled: true },
    flags: still('dragon.webm', 'dragon-still.webp'),
  };
  const fit = async (src) => `fitted:${src}`;
  assert.equal(await showChatStill({ token }, html, { fit }), true);
  assert.equal(img.src, 'fitted:dragon-still.webp');
  assert.equal(img.style.transform, ''); // no ring enlargement
  assert.ok(classes.has('token') && !classes.has('actor-image'));

  // No still for this token: the portrait stays.
  const other = chatCard();
  assert.equal(showChatStill({ token: { texture: { src: 'x.webm' } } }, other.html), false);
  assert.equal(other.img.src, 'actor.webp');
});

test('a still is trimmed to a square whose circle holds its creature', () => {
  // A 10 x 10 image with an opaque 4 x 2 block at (2, 6).
  const alpha = new Uint8ClampedArray(100);
  for (let y = 6; y < 8; y += 1) for (let x = 2; x < 6; x += 1) alpha[y * 10 + x] = 255;
  assert.deepEqual(getFittedSquare(alpha, 10, 10, { margin: 0 }), { x: 2, y: 5, size: 5 });
  assert.deepEqual(getFittedSquare(alpha, 10, 10, { margin: 0.25 }), { x: 1, y: 4, size: 7 });
  assert.equal(getFittedSquare(new Uint8ClampedArray(100), 10, 10), null);
});

test('switching looks brings the shown look still along', () => {
  const look = (src, image) => ({
    src,
    scaleX: 1,
    scaleY: 1,
    ring: false,
    subject: null,
    subjectScale: 1,
    still: image ? { src, image } : null,
  });
  const document = {
    texture: { src: 'regular.webm', scaleX: 1, scaleY: 1 },
    ring: { enabled: true, subject: { texture: '', scale: 1 } },
    flags: {
      'pf2e-tokener': {
        still: { src: 'regular.webm', image: 'regular-still.webp' },
        artViews: {
          regular: look('regular.webm', 'regular-still.webp'),
          topDown: look('top.webm', 'top-still.webp'),
        },
      },
    },
  };
  const update = buildLookUpdate(document, 'topDown');
  assert.deepEqual(update[STILL_FLAG_PATH], { src: 'top.webm', image: 'top-still.webp' });
});
