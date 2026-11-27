import test from 'node:test';
import assert from 'node:assert/strict';

import { createActorTokenDocument } from '../scripts/actor-entry.js';
import { applyCreatedTokenCandidate } from '../scripts/picker-app.js';

// The Token Creator can be opened straight from a character sheet, with no picker window open.
test('applying a created token works when no picker window is open', async () => {
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const updates = [];
  const notices = [];
  globalThis.game = { user: { isGM: true }, settings: { get: () => undefined } };
  globalThis.ui = {
    notifications: {
      info: (message) => notices.push(['info', message]),
      error: (message) => notices.push(['error', message]),
    },
  };
  try {
    const actor = {
      id: 'a1',
      name: 'Bat',
      img: 'old-portrait.webp',
      flags: {},
      prototypeToken: { texture: { src: 'old-token.webp' }, flags: {} },
      update: async (update) => updates.push(update),
    };
    const candidate = {
      id: 'created',
      tokenSrc: 'tokener/bat.webp',
      portraitSrc: 'tokener/bat.webp',
    };

    await applyCreatedTokenCandidate('actor', candidate, createActorTokenDocument(actor));

    assert.equal(updates.length > 0, true, 'the actor was updated');
    assert.deepEqual(
      notices.map(([level]) => level),
      ['info'],
    );
  } finally {
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
  }
});
