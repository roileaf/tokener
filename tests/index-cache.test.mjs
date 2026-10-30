import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { getIndexSignature, readIndexCache, writeIndexCache } from '../scripts/index-cache.js';
import {
  ensureIndex,
  isIndexReady,
  rebuildIndex,
  state,
  warmIndexInBackground,
} from '../scripts/foundry-index.js';
import { getTokenPickerApplicationClass } from '../scripts/picker-app.js';
import { canUseTokener } from '../scripts/permissions.js';
import { searchCandidates } from '../scripts/candidates.js';
import { getTagFilterOptions } from '../scripts/tags.js';

function createFakeIndexedDB() {
  const stores = new Map();
  const calls = { open: 0, get: 0, put: 0 };
  const request = (operation) => {
    const req = {};
    queueMicrotask(() => {
      try {
        req.result = operation();
        req.onsuccess?.({ target: req });
      } catch (error) {
        req.error = error;
        req.onerror?.({ target: req });
      }
    });
    return req;
  };
  const db = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore: (name) => {
      stores.set(name, new Map());
    },
    transaction: (name) => ({
      objectStore: () => ({
        get: (key) => {
          calls.get += 1;
          return request(() => structuredClone(stores.get(name).get(key)));
        },
        put: (value, key) => {
          calls.put += 1;
          return request(() => {
            stores.get(name).set(key, structuredClone(value));
            return key;
          });
        },
      }),
    }),
    close() {},
  };
  return {
    calls,
    stores,
    open() {
      calls.open += 1;
      const req = {};
      queueMicrotask(() => {
        req.result = db;
        if (!stores.has('index')) req.onupgradeneeded?.({ target: req });
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };
}

function resetIndexState() {
  state.index = [];
  state.errors = [];
  state.indexing = null;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function installFakeFoundry({ moduleVersion = '1.0.0', browseGate = null } = {}) {
  const browseCalls = [];
  globalThis.game = {
    system: { id: 'pf2e' },
    world: { id: 'test-world' },
    user: { isGM: true },
    modules: new Map([
      ['pf2e-tokener', { id: 'pf2e-tokener', title: 'Tokener', version: '9.9.9', active: true }],
      [
        'pf2e-tokens-extra',
        {
          id: 'pf2e-tokens-extra',
          title: 'Pathfinder Tokens: Extra',
          version: moduleVersion,
          active: true,
          flags: {},
        },
      ],
    ]),
    settings: { get: () => undefined },
  };
  globalThis.foundry = {
    applications: {
      apps: {
        FilePicker: {
          implementation: {
            browse: async (_source, target) => {
              browseCalls.push(target);
              if (browseGate) await browseGate;
              if (target === 'modules/pf2e-tokens-extra/assets/datasheet') {
                return { files: ['modules/pf2e-tokens-extra/assets/datasheet/datasheet.json'] };
              }
              return { files: [] };
            },
          },
        },
      },
    },
    utils: {
      fetchJsonWithTimeout: async () => [
        {
          label: 'Angel Scout',
          art: { token: 'modules/pf2e-tokens-extra/assets/token/angel-scout.webp' },
          tags: { ancestry: ['angel'], category: ['divine'] },
        },
      ],
    },
  };
  return browseCalls;
}

function restoreGlobals(saved) {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
}

function saveGlobals() {
  return {
    game: globalThis.game,
    foundry: globalThis.foundry,
    indexedDB: globalThis.indexedDB,
  };
}

test('index signature changes with module versions and custom folders and ignores order', () => {
  const base = {
    systemId: 'pf2e',
    modules: [
      { id: 'a', version: '1.0.0' },
      { id: 'b', version: '2.0.0' },
    ],
    customFolders: '[{"path":"uploads/npcs"}]',
    imageTags: { 'x.webp': { creature: ['dragon'] }, 'y.webp': { creature: ['orc'] } },
    version: '2.3.1',
  };
  const signature = getIndexSignature(base);

  assert.equal(typeof signature, 'string');
  assert.equal(
    getIndexSignature({
      ...base,
      modules: [...base.modules].reverse(),
      imageTags: { 'y.webp': { creature: ['orc'] }, 'x.webp': { creature: ['dragon'] } },
    }),
    signature,
  );
  assert.notEqual(
    getIndexSignature({
      ...base,
      modules: [
        { id: 'a', version: '1.0.1' },
        { id: 'b', version: '2.0.0' },
      ],
    }),
    signature,
  );
  assert.notEqual(getIndexSignature({ ...base, customFolders: '[]' }), signature);
  assert.notEqual(getIndexSignature({ ...base, imageTags: {} }), signature);
  assert.notEqual(getIndexSignature({ ...base, systemId: 'dnd5e' }), signature);
  assert.notEqual(getIndexSignature({ ...base, version: '2.4.0' }), signature);
});

test('index cache round-trips plain candidates and rejects a different signature', async () => {
  const idb = createFakeIndexedDB();
  const candidates = [{ id: 'a', label: 'A', tags: { creature: ['dragon'] }, searchText: 'a' }];

  await writeIndexCache('sig-1', candidates, idb);

  assert.deepEqual(await readIndexCache('sig-1', idb), candidates);
  assert.equal(await readIndexCache('sig-2', idb), null);
  const [record] = [...idb.stores.get('index').values()];
  assert.equal(record.signature, 'sig-1');
  assert.equal(typeof record.savedAt, 'number');
});

test('index cache falls back silently when IndexedDB is unavailable or failing', async () => {
  const throwing = {
    open() {
      throw new Error('blocked');
    },
  };
  const erroring = {
    open() {
      const req = {};
      queueMicrotask(() => req.onerror?.({ target: req }));
      return req;
    },
  };

  assert.equal(await readIndexCache('sig', undefined), null);
  assert.equal(await readIndexCache('sig', throwing), null);
  assert.equal(await readIndexCache('sig', erroring), null);
  await writeIndexCache('sig', [{ id: 'a' }], undefined);
  await writeIndexCache('sig', [{ id: 'a' }], throwing);
  await writeIndexCache('sig', [{ id: 'a' }], erroring);
});

test('rebuildIndex uses a matching cache without browsing and rebuilds on mismatch', async () => {
  const saved = saveGlobals();
  const idb = createFakeIndexedDB();
  globalThis.indexedDB = idb;
  resetIndexState();

  try {
    let browseCalls = installFakeFoundry();
    const fresh = await rebuildIndex();
    assert.ok(browseCalls.length > 0);
    assert.equal(fresh.length, 1);
    const firstRecord = [...idb.stores.get('index').values()][0];
    assert.equal(firstRecord.candidates.length, 1);

    resetIndexState();
    browseCalls = installFakeFoundry();
    globalThis.indexedDB = idb;
    const cached = await rebuildIndex();
    assert.equal(browseCalls.length, 0);
    assert.deepEqual(cached, JSON.parse(JSON.stringify(fresh)));

    // A cached candidate behaves like a fresh one in search and filters.
    assert.deepEqual(
      searchCandidates(cached, 'angel').map((candidate) => candidate.id),
      searchCandidates(fresh, 'angel').map((candidate) => candidate.id),
    );
    assert.deepEqual(
      searchCandidates(cached, 'ancestry:angel').map((candidate) => candidate.id),
      searchCandidates(fresh, 'ancestry:angel').map((candidate) => candidate.id),
    );
    assert.deepEqual(getTagFilterOptions(cached), getTagFilterOptions(fresh));

    resetIndexState();
    browseCalls = installFakeFoundry({ moduleVersion: '1.1.0' });
    await rebuildIndex();
    assert.ok(browseCalls.length > 0);
    const records = [...idb.stores.get('index').values()];
    assert.equal(records.length, 1);
    assert.notEqual(records[0].signature, firstRecord.signature);

    resetIndexState();
    browseCalls = installFakeFoundry({ moduleVersion: '1.1.0' });
    await rebuildIndex({ force: true });
    assert.ok(browseCalls.length > 0, 'forced rescan bypasses the cache');
  } finally {
    restoreGlobals(saved);
    resetIndexState();
  }
});

test('rebuildIndex still builds when IndexedDB throws', async () => {
  const saved = saveGlobals();
  globalThis.indexedDB = {
    open() {
      throw new Error('blocked');
    },
  };
  resetIndexState();

  try {
    installFakeFoundry();
    const index = await rebuildIndex();
    assert.equal(index.length, 1);
    assert.equal(isIndexReady(), true);
  } finally {
    restoreGlobals(saved);
    resetIndexState();
  }
});

test('index timing log is emitted once per build and the cache use is logged', async () => {
  const saved = saveGlobals();
  const previousInfo = console.info;
  const messages = [];
  console.info = (...args) => messages.push(args.join(' '));
  globalThis.indexedDB = createFakeIndexedDB();
  resetIndexState();

  try {
    installFakeFoundry();
    await rebuildIndex();
    const built = messages.filter((message) => /art index built in/.test(message));
    assert.equal(built.length, 1);
    assert.match(
      built[0],
      /^pf2e-tokener \| art index built in \d+ ms \(1 candidates, 1 modules\)$/,
    );

    messages.length = 0;
    resetIndexState();
    await rebuildIndex();
    assert.equal(messages.filter((message) => /art index built in/.test(message)).length, 0);
    assert.deepEqual(
      messages.filter((message) => /loaded from cache/.test(message)),
      ['pf2e-tokener | art index loaded from cache (1 candidates)'],
    );
  } finally {
    console.info = previousInfo;
    restoreGlobals(saved);
    resetIndexState();
  }
});

test('picker renders a loading state while the index builds and re-renders when ready', async () => {
  const saved = saveGlobals();
  delete globalThis.indexedDB;
  resetIndexState();
  let openGate;
  const browseGate = new Promise((resolve) => {
    openGate = resolve;
  });

  try {
    installFakeFoundry({ browseGate });
    class FakeApplicationV2 {}
    const fakeMixin = (Base) => class FakeHandlebarsApplication extends Base {};
    const PickerApplication = getTokenPickerApplicationClass(FakeApplicationV2, fakeMixin);
    const app = new PickerApplication({ tokenDocument: {} });
    const renders = [];
    app.rendered = true;
    app.render = (options) => renders.push(options);

    assert.equal(isIndexReady(), false);
    const loading = await app._prepareContext({});
    assert.equal(loading.loading, true);
    assert.equal(loading.hasResults, false);
    assert.equal(loading.emptyMessage, 'Finding token art…');
    assert.equal(app.selectedSourceIds, null, 'loading does not reset source selection');
    assert.ok(state.indexing, 'opening the picker starts the index build');

    // A second render while still loading does not queue another re-render.
    await app._prepareContext({});
    openGate();
    await state.indexing;
    await flush();

    assert.equal(renders.length, 1);
    assert.deepEqual(renders[0].parts, ['main']);
    const ready = await app._prepareContext({});
    assert.equal(ready.loading, false);
    assert.equal(ready.hasResults, true);
  } finally {
    restoreGlobals(saved);
    resetIndexState();
  }
});

test('picker does not re-render a closed window when the index finishes', async () => {
  const saved = saveGlobals();
  delete globalThis.indexedDB;
  resetIndexState();

  try {
    installFakeFoundry();
    class FakeApplicationV2 {}
    const fakeMixin = (Base) => class FakeHandlebarsApplication extends Base {};
    const PickerApplication = getTokenPickerApplicationClass(FakeApplicationV2, fakeMixin);
    const app = new PickerApplication({ tokenDocument: {} });
    const renders = [];
    app.rendered = false;
    app.render = (options) => renders.push(options);

    await app._prepareContext({});
    await ensureIndex();
    await flush();

    assert.equal(renders.length, 0);
  } finally {
    restoreGlobals(saved);
    resetIndexState();
  }
});

test('picker Rescan button forces a rebuild and shows the loading state', async () => {
  const saved = saveGlobals();
  const idb = createFakeIndexedDB();
  globalThis.indexedDB = idb;
  resetIndexState();

  try {
    installFakeFoundry();
    await rebuildIndex();
    assert.equal(isIndexReady(), true);

    let openGate;
    const browseGate = new Promise((resolve) => {
      openGate = resolve;
    });
    const browseCalls = installFakeFoundry({ browseGate });
    class FakeApplicationV2 {}
    const fakeMixin = (Base) => class FakeHandlebarsApplication extends Base {};
    const PickerApplication = getTokenPickerApplicationClass(FakeApplicationV2, fakeMixin);
    const app = new PickerApplication({ tokenDocument: {} });
    const renders = [];
    const listeners = {};
    app.rendered = true;
    app.render = (options) => renders.push(options);
    app._attachPartListeners('main', {
      dataset: {},
      nodeType: 1,
      addEventListener: (type, listener) => {
        listeners[type] = listener;
      },
      querySelector: () => null,
    });

    await listeners.click({
      target: {
        dataset: { pickerAction: 'rescan-index' },
        closest(selector) {
          return selector === '[data-picker-action="rescan-index"]' ? this : null;
        },
      },
      preventDefault() {},
      stopPropagation() {},
    });

    assert.equal(isIndexReady(), false);
    assert.ok(renders.length >= 1);
    const loading = await app._prepareContext({});
    assert.equal(loading.loading, true);

    openGate();
    await state.indexing;
    await flush();
    assert.ok(browseCalls.length > 0, 'rescan browses even with a matching cache');
    assert.equal(isIndexReady(), true);
    assert.equal((await app._prepareContext({})).loading, false);
  } finally {
    restoreGlobals(saved);
    resetIndexState();
  }
});

test('warm-up schedules ensureIndex through the provided scheduler', async () => {
  const saved = saveGlobals();
  delete globalThis.indexedDB;
  resetIndexState();

  try {
    installFakeFoundry();
    const scheduled = [];
    warmIndexInBackground({ schedule: (callback) => scheduled.push(callback) });
    assert.equal(scheduled.length, 1);
    assert.equal(state.indexing, null, 'warm-up waits for the scheduler');

    scheduled[0]();
    assert.ok(state.indexing);
    await state.indexing;
    assert.equal(isIndexReady(), true);
  } finally {
    restoreGlobals(saved);
    resetIndexState();
  }
});

test('warm-up defaults to requestIdleCallback with a 3 s timeout, else setTimeout', () => {
  const previousIdle = globalThis.requestIdleCallback;
  const previousTimeout = globalThis.setTimeout;
  const calls = [];
  try {
    globalThis.requestIdleCallback = (callback, options) => calls.push(['idle', options]);
    warmIndexInBackground();
    assert.deepEqual(calls, [['idle', { timeout: 3000 }]]);

    calls.length = 0;
    delete globalThis.requestIdleCallback;
    globalThis.setTimeout = (callback, delay) => calls.push(['timeout', delay]);
    warmIndexInBackground();
    assert.deepEqual(calls, [['timeout', 3000]]);
  } finally {
    globalThis.setTimeout = previousTimeout;
    if (previousIdle === undefined) delete globalThis.requestIdleCallback;
    else globalThis.requestIdleCallback = previousIdle;
  }
});

test('Tokener warm-up is limited to users who can use Tokener', () => {
  const previousGame = globalThis.game;
  try {
    globalThis.game = { user: { isGM: true } };
    assert.equal(canUseTokener({ get: () => false }), true);
    globalThis.game = { user: { isGM: false } };
    assert.equal(canUseTokener({ get: () => false }), false);
    assert.equal(canUseTokener({ get: () => true }), true);
  } finally {
    globalThis.game = previousGame;
  }

  const script = fs.readFileSync(new URL('../scripts/pf2e-tokener.js', import.meta.url), 'utf8');
  assert.match(script, /if \(canUseTokener\(\)\) warmIndexInBackground\(\);/);
});

test('picker template and language file expose the loading and rescan strings', () => {
  const template = fs.readFileSync(new URL('../templates/picker.hbs', import.meta.url), 'utf8');
  const en = JSON.parse(fs.readFileSync(new URL('../languages/en.json', import.meta.url), 'utf8'));

  assert.match(template, /data-picker-action='rescan-index'/);
  assert.equal(en['PF2ETokener.HUD.IndexLoading'], 'Finding token art…');
  assert.equal(typeof en['PF2ETokener.HUD.Rescan'], 'string');
  assert.equal(typeof en['PF2ETokener.HUD.RescanTooltip'], 'string');
});
