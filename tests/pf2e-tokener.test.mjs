import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildActorUpdate,
  buildActorRevertUpdate,
  buildPortraitUpdate,
  buildRevertSnapshot,
  buildTokenUpdate,
  buildTokenRevertUpdate,
  buildTokenScalePreviewUpdate,
  pruneStaleDependentTokens,
  REVERT_FLAG_PATH,
  getCanvasZoom,
  getApplyActions,
  getApplyActionsForCandidate,
  getApplyTargets,
  getCandidatePreviewTagGroups,
  getCandidatePreviewSources,
  getLastRevertData,
  getImagePreviewItems,
  getPanelZoomData,
  getPanelSourceFilterOptions,
  getSourceFilterLabel,
  getSourceFilterOptions,
  filterSourceOptionsByQuery,
  getRevertHistoryEntries,
  getTagGroupSearchState,
  getTagFilterOptions,
  getTagListCountLabel,
  buildCandidateSearchQuery,
  getTokenPickerApplicationClass,
  rebuildIndex,
  createActorTokenDocument,
  createCustomFolderCandidates,
  createDatasheetCandidates,
  createFolderCandidates,
  createMappedCandidates,
  dedupeCandidates,
  filterCandidatesBySources,
  filterFavoriteCandidates,
  getFavoriteIds,
  getCustomFolderSettingsApplicationClass,
  getCustomFolderSources,
  getImageTagOverrideExport,
  getImageTagOverridesExport,
  importImageTagOverrides,
  parseImageTagOverrideImport,
  applyImageTagOverrides,
  setImageTagOverrides,
  setCustomFolderImageTags,
  getCandidatesForTokenDocument,
  getPickerCandidatePool,
  getSystemProfile,
  localize,
  normalizeHudElement,
  normalizeSystemPackKey,
  registerCustomFolderSettings,
  registerFavoriteSettings,
  registerImageTagSettings,
  renderTokenHud,
  renderActorDirectoryTokenerEntry,
  renderActorSheetTokenerEntry,
  registerPermissionSettings,
  revertTokenerChangeToOriginal,
  revertTokenerChangeToSnapshot,
  revertLastTokenerChange,
  setTextTooltip,
  searchCandidates,
  state,
  toggleFavoriteCandidate,
  toggleTagFilterTerm,
} from '../scripts/pf2e-tokener.js';
import { openRevertHistoryDialog } from '../scripts/picker-app.js';

const MODULE = {
  id: 'pf2e-tokens-draconic-codex',
  title: 'Pathfinder Tokens: Draconic Codex',
};

function createFakeElement() {
  return {
    children: [],
    className: '',
    dataset: {},
    innerHTML: '',
    listeners: {},
    nodeType: 1,
    append(...children) {
      this.children.push(...children);
    },
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    remove() {
      this.removed = true;
    },
  };
}

function createFakeHudRoot() {
  const root = createFakeElement();
  const target = createFakeElement();
  root.querySelector = (selector) => (selector === '.col.right' ? target : null);
  return { root, target };
}

test('native compendiumArtMappings become searchable token candidates', () => {
  const mapping = {
    'pf2e.pathfinder-bestiary': {
      abc123: {
        name: 'Adult Blue Dragon',
        actor: 'modules/pf2e-tokens-draconic-codex/assets/art/blue.webp',
        token: {
          randomImg: false,
          texture: {
            src: 'modules/pf2e-tokens-draconic-codex/assets/tokens/blue.webp',
            scaleX: 2,
            scaleY: 2,
          },
          ring: {
            enabled: true,
            subject: {
              texture: 'modules/pf2e-tokens-draconic-codex/assets/subjects/blue.webp',
              scale: 2,
            },
          },
        },
      },
    },
  };

  const candidates = createMappedCandidates({ module: MODULE, mapping, sourceType: 'native' });

  assert.equal(candidates.length, 1);
  assert.deepEqual(
    {
      label: candidates[0].label,
      moduleId: candidates[0].moduleId,
      packKey: candidates[0].packKey,
      actorId: candidates[0].actorId,
      tokenSrc: candidates[0].tokenSrc,
      portraitSrc: candidates[0].portraitSrc,
      subjectSrc: candidates[0].subjectSrc,
      scaleX: candidates[0].scaleX,
      scaleY: candidates[0].scaleY,
      subjectScale: candidates[0].subjectScale,
      sourceType: candidates[0].sourceType,
    },
    {
      label: 'Adult Blue Dragon',
      moduleId: 'pf2e-tokens-draconic-codex',
      packKey: 'pf2e.pathfinder-bestiary',
      actorId: 'abc123',
      tokenSrc: 'modules/pf2e-tokens-draconic-codex/assets/tokens/blue.webp',
      portraitSrc: 'modules/pf2e-tokens-draconic-codex/assets/art/blue.webp',
      subjectSrc: 'modules/pf2e-tokens-draconic-codex/assets/subjects/blue.webp',
      scaleX: 2,
      scaleY: 2,
      subjectScale: 2,
      sourceType: 'native',
    },
  );
});

test('system profiles use current system mappings without PF2e legacy flags by default', () => {
  const profile = getSystemProfile('dnd5e');

  assert.equal(profile.id, 'dnd5e');
  assert.deepEqual(profile.nativeMappingKeys, ['dnd5e']);
  assert.deepEqual(profile.legacyMappingFlagKeys, []);
  assert.equal(normalizeSystemPackKey('monsters', { systemId: 'dnd5e' }), 'dnd5e.monsters');
});

test('mapped candidate exact matches use the active system pack prefix', () => {
  const previousGame = globalThis.game;
  globalThis.game = { system: { id: 'dnd5e' } };

  try {
    const candidates = createMappedCandidates({
      module: { id: 'dnd5e-token-pack', title: 'DND5E Token Pack' },
      mapping: {
        monsters: {
          adultBlueDragon: {
            name: 'Adult Blue Dragon',
            token: 'modules/dnd5e-token-pack/tokens/adult-blue-dragon.webp',
          },
        },
      },
    });

    assert.equal(candidates[0].canonicalPackKey, 'dnd5e.monsters');
    assert.deepEqual(
      getCandidatesForTokenDocument(candidates, {
        actor: {
          name: 'Adult Blue Dragon',
          flags: {
            core: {
              sourceId: 'Compendium.dnd5e.monsters.Actor.adultBlueDragon',
            },
          },
        },
      }).map((candidate) => candidate.matchType),
      ['exact'],
    );
  } finally {
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
  }
});

test('old pf2e-art string and object token shapes normalize to candidates', () => {
  const mapping = {
    'pathfinder-bestiary': {
      tiger1: {
        actor: 'modules/pf2e-kingmaker/assets/actor-portraits/tiger.webp',
        token: 'modules/pf2e-kingmaker/assets/actor-tokens/tiger.webp',
      },
      bear1: {
        name: 'Cave Bear',
        token: {
          img: 'modules/pf2e-kingmaker/assets/actor-tokens/bear.webp',
          scale: 1.5,
        },
      },
    },
  };

  const candidates = createMappedCandidates({
    module: { id: 'pf2e-kingmaker', title: 'Pathfinder Kingmaker' },
    mapping,
    sourceType: 'pf2e-art',
  });

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].tokenSrc, 'modules/pf2e-kingmaker/assets/actor-tokens/tiger.webp');
  assert.equal(
    candidates[0].portraitSrc,
    'modules/pf2e-kingmaker/assets/actor-portraits/tiger.webp',
  );
  assert.equal(candidates[1].label, 'Cave Bear');
  assert.equal(candidates[1].scaleX, 1.5);
  assert.equal(candidates[1].scaleY, 1.5);
});

test('actor-only art mappings stay searchable as portrait-only candidates', () => {
  const mapping = {
    'pf2e.pathfinder-bestiary': {
      abc123: {
        name: 'Adult Blue Dragon',
        actor: 'modules/pf2e-tokens-draconic-codex/assets/art/adult-blue-dragon.webp',
      },
    },
  };

  const candidates = createMappedCandidates({ module: MODULE, mapping, sourceType: 'native' });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].label, 'Adult Blue Dragon');
  assert.equal(candidates[0].tokenSrc, '');
  assert.equal(
    candidates[0].portraitSrc,
    'modules/pf2e-tokens-draconic-codex/assets/art/adult-blue-dragon.webp',
  );
  assert.deepEqual(
    getApplyActionsForCandidate(candidates[0]).map((action) => action.action),
    ['portrait'],
  );

  const matches = getCandidatesForTokenDocument(candidates, {
    actor: {
      name: 'Adult Blue Dragon',
      flags: {
        core: {
          sourceId: 'Compendium.pf2e.pathfinder-bestiary.Actor.abc123',
        },
      },
    },
  });

  assert.equal(matches[0].matchType, 'exact');
  assert.equal(matches[0].portraitSrc, candidates[0].portraitSrc);
});

test('gallery datasheets normalize portrait, token, subject, and scale art', () => {
  const datasheet = [
    {
      label: 'Aphorite Kobold Rogue',
      key: 'aphorite-kobold-rogue',
      tags: {
        ancestry: ['kobold', 'aphorite'],
        category: ['humanoid'],
        equipment: ['dagger'],
        family: ['outcast'],
      },
      art: {
        portrait: 'modules/pf2e-tokens-characters/assets/portraits/aphorite-kobold-rogue.webp',
        token: 'modules/pf2e-tokens-characters/assets/tokens/aphorite-kobold-rogue.webp',
        subject: 'modules/pf2e-tokens-characters/assets/subjects/aphorite-kobold-rogue.webp',
        scale: 1,
      },
    },
  ];

  const candidates = createDatasheetCandidates({
    module: {
      id: 'pf2e-tokens-characters',
      title: 'Pathfinder Tokens: Character Gallery',
    },
    datasheet,
  });

  assert.equal(candidates.length, 1);
  assert.deepEqual(
    {
      label: candidates[0].label,
      moduleId: candidates[0].moduleId,
      tokenSrc: candidates[0].tokenSrc,
      portraitSrc: candidates[0].portraitSrc,
      subjectSrc: candidates[0].subjectSrc,
      scaleX: candidates[0].scaleX,
      scaleY: candidates[0].scaleY,
      subjectScale: candidates[0].subjectScale,
      sourceType: candidates[0].sourceType,
      tags: candidates[0].tags,
    },
    {
      label: 'Aphorite Kobold Rogue',
      moduleId: 'pf2e-tokens-characters',
      tokenSrc: 'modules/pf2e-tokens-characters/assets/tokens/aphorite-kobold-rogue.webp',
      portraitSrc: 'modules/pf2e-tokens-characters/assets/portraits/aphorite-kobold-rogue.webp',
      subjectSrc: 'modules/pf2e-tokens-characters/assets/subjects/aphorite-kobold-rogue.webp',
      scaleX: 1,
      scaleY: 1,
      subjectScale: 1,
      sourceType: 'datasheet',
      tags: {
        ancestry: ['kobold', 'aphorite'],
        category: ['humanoid'],
        equipment: ['dagger'],
        family: ['outcast'],
      },
    },
  );
});

test('actor-only datasheet entries stay searchable as portrait-only candidates', () => {
  const candidates = createDatasheetCandidates({
    module: {
      id: 'pf2e-tokens-characters',
      title: 'Pathfinder Tokens: Character Gallery',
    },
    datasheet: [
      {
        label: 'Aphorite Kobold Rogue',
        tags: {
          ancestry: ['kobold'],
        },
        art: {
          portrait: 'modules/pf2e-tokens-characters/assets/portraits/aphorite-kobold-rogue.webp',
        },
      },
    ],
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].tokenSrc, '');
  assert.equal(
    candidates[0].portraitSrc,
    'modules/pf2e-tokens-characters/assets/portraits/aphorite-kobold-rogue.webp',
  );
  assert.equal(searchCandidates(candidates, 'kobold').length, 1);
});

test('search matches gallery tags and returns matched tag chips', () => {
  const candidates = createDatasheetCandidates({
    module: {
      id: 'pf2e-tokens-characters',
      title: 'Pathfinder Tokens: Character Gallery',
    },
    datasheet: [
      {
        label: 'Aldori Swordlord',
        tags: {
          ancestry: ['human'],
          category: ['humanoid'],
          equipment: ['clothing', 'sword'],
          family: ['civilian', 'warrior', 'affluent'],
        },
        art: {
          token: 'modules/pf2e-tokens-characters/assets/tokens/aldori-swordlord.webp',
        },
      },
      {
        label: 'Maagambyan Student',
        tags: {
          ancestry: ['human'],
          category: ['humanoid'],
          equipment: ['clothing', 'focus'],
          features: ['magic'],
          family: ['civilian', 'sage', 'artisan'],
        },
        art: {
          token: 'modules/pf2e-tokens-characters/assets/tokens/maagambyan-student.webp',
        },
      },
    ],
  });

  const broad = searchCandidates(candidates, 'human sword warrior');
  assert.equal(broad.length, 1);
  assert.equal(broad[0].label, 'Aldori Swordlord');
  assert.deepEqual(
    broad[0].matchedTags.map((tag) => `${tag.group}:${tag.value}`),
    ['ancestry:human', 'equipment:sword', 'family:warrior'],
  );

  assert.deepEqual(
    searchCandidates(candidates, 'ancestry:human equipment:focus').map(
      (candidate) => candidate.label,
    ),
    ['Maagambyan Student'],
  );
  assert.deepEqual(
    searchCandidates(candidates, 'tag:magic').map((candidate) => candidate.label),
    ['Maagambyan Student'],
  );
  assert.deepEqual(searchCandidates(candidates, 'equipment:shield'), []);
});

test('search can exclude exact gallery tags', () => {
  const candidates = createDatasheetCandidates({
    module: MODULE,
    datasheet: [
      {
        label: 'Human Duelist',
        tags: {
          ancestry: ['human'],
          equipment: ['sword'],
        },
        art: {
          token: 'modules/pf2e-tokens-test/assets/tokens/human-duelist.webp',
        },
      },
      {
        label: 'Human Gunslinger',
        tags: {
          ancestry: ['human'],
          equipment: ['firearm'],
        },
        art: {
          token: 'modules/pf2e-tokens-test/assets/tokens/human-gunslinger.webp',
        },
      },
    ],
  });

  assert.deepEqual(
    searchCandidates(candidates, 'ancestry:human !equipment:firearm').map(
      (candidate) => candidate.label,
    ),
    ['Human Duelist'],
  );
  assert.deepEqual(
    searchCandidates(candidates, 'ancestry:human -equipment:sword').map(
      (candidate) => candidate.label,
    ),
    ['Human Gunslinger'],
  );
});

test('tag filter options summarize visible gallery tags by group and count', () => {
  const options = getTagFilterOptions([
    {
      tags: {
        ancestry: ['human'],
        equipment: ['sword', 'clothing'],
        family: ['warrior'],
      },
    },
    {
      tags: {
        ancestry: ['human'],
        equipment: ['focus', 'clothing'],
        features: ['magic'],
      },
    },
  ]);

  assert.deepEqual(options.slice(0, 5), [
    { id: 'ancestry:human', group: 'ancestry', value: 'human', count: 2, label: 'Human' },
    {
      id: 'equipment:clothing',
      group: 'equipment',
      value: 'clothing',
      count: 2,
      label: 'Clothing',
    },
    { id: 'equipment:focus', group: 'equipment', value: 'focus', count: 1, label: 'Focus' },
    { id: 'equipment:sword', group: 'equipment', value: 'sword', count: 1, label: 'Sword' },
    { id: 'family:warrior', group: 'family', value: 'warrior', count: 1, label: 'Warrior' },
  ]);
});

test('tag filter options keep every source-scoped datasheet tag without a global cap', () => {
  const candidates = Array.from({ length: 80 }, (_, index) => ({
    tags: {
      equipment: [`tool-${index}`],
    },
  }));

  const options = getTagFilterOptions(candidates);

  assert.equal(options.length, 80);
  assert.ok(options.some((option) => option.id === 'equipment:tool-79'));
});

test('tag group search state reports matching categories and dimmed zero-match categories', () => {
  const ancestry = {
    id: 'ancestry',
    options: [
      { label: 'Human', value: 'human' },
      { label: 'Dwarf', value: 'dwarf' },
    ],
  };
  const equipment = {
    id: 'equipment',
    options: [{ label: 'Clothing', value: 'clothing' }],
  };

  assert.deepEqual(getTagGroupSearchState(ancestry, 'hum'), {
    hasMatches: true,
    isFiltering: true,
    matchedOptionCount: 1,
  });
  assert.deepEqual(getTagGroupSearchState(equipment, 'hum'), {
    hasMatches: false,
    isFiltering: true,
    matchedOptionCount: 0,
  });
  assert.deepEqual(getTagGroupSearchState(ancestry, ''), {
    hasMatches: true,
    isFiltering: false,
    matchedOptionCount: 2,
  });
});

test('tag list count label compares visible tags with the active category only', () => {
  assert.equal(getTagListCountLabel(144, 144, false), '144');
  assert.equal(getTagListCountLabel(1, 144, true), '1 / 144');
});

test('tag filter term toggles exact tag syntax inside the search query', () => {
  const tag = { group: 'equipment', value: 'sword' };

  assert.equal(toggleTagFilterTerm('dragon', tag), 'dragon equipment:sword');
  assert.equal(toggleTagFilterTerm('dragon equipment:sword', tag), 'dragon');
  assert.equal(toggleTagFilterTerm('equipment:sword dragon', tag), 'dragon');
});

test('tag filter terms encode multi-word values for exact tag search', () => {
  const candidates = createDatasheetCandidates({
    module: MODULE,
    datasheet: [
      {
        label: 'Sword Guard',
        tags: {
          equipment: ['long sword'],
        },
        art: {
          token: 'modules/pf2e-tokens-test/assets/tokens/sword-guard.webp',
        },
      },
    ],
  });
  const [tag] = getTagFilterOptions(candidates);

  assert.equal(tag.id, 'equipment:long-sword');
  assert.equal(toggleTagFilterTerm('', tag), 'equipment:long-sword');
  assert.deepEqual(
    searchCandidates(candidates, 'equipment:long-sword').map((candidate) => candidate.label),
    ['Sword Guard'],
  );
});

test('selected tag chips compose hidden candidate query without changing visible search text', () => {
  const query = buildCandidateSearchQuery('Blue Dragon', ['ancestry:human', 'category:humanoid']);

  assert.equal(query, 'Blue Dragon ancestry:human category:humanoid');
});

test('selected excluded tag chips compose hidden candidate query without changing visible search text', () => {
  const query = buildCandidateSearchQuery('Blue Dragon', ['ancestry:human'], ['equipment:firearm']);

  assert.equal(query, 'Blue Dragon ancestry:human !equipment:firearm');
});

test('tag clear helper removes all known exact tag terms from search query', async () => {
  const tags = await import('../scripts/tags.js');
  const options = [
    { group: 'equipment', value: 'sword' },
    { group: 'category', value: 'dragon' },
  ];

  assert.equal(tags.clearTagFilterTerms('blue equipment:sword category:dragon', options), 'blue');
});

test('Foundry index discovers datasheet tags from token module datasheet folders', async () => {
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  state.index = [];
  state.errors = [];
  state.indexing = null;

  const browseCalls = [];
  globalThis.game = {
    modules: new Map([
      [
        'pf2e-tokens-extra',
        {
          id: 'pf2e-tokens-extra',
          title: 'Pathfinder Tokens: Extra',
          flags: {},
        },
      ],
    ]),
  };
  globalThis.foundry = {
    applications: {
      apps: {
        FilePicker: {
          implementation: {
            browse: async (_source, target, options) => {
              browseCalls.push({ target, recursive: options?.recursive });
              if (target === 'modules/pf2e-tokens-extra/assets/datasheet') {
                return {
                  files: ['modules/pf2e-tokens-extra/assets/datasheet/datasheet.json'],
                };
              }
              return { files: [] };
            },
          },
        },
      },
    },
    utils: {
      fetchJsonWithTimeout: async (path) => {
        assert.equal(path, 'modules/pf2e-tokens-extra/assets/datasheet/datasheet.json');
        return [
          {
            label: 'Angel Scout',
            art: {
              token: 'modules/pf2e-tokens-extra/assets/token/angel-scout.webp',
            },
            tags: {
              ancestry: ['angel'],
              category: ['divine'],
              features: ['winged'],
            },
          },
        ];
      },
    },
  };

  try {
    const index = await rebuildIndex();

    assert.equal(index.length, 1);
    assert.equal(index[0].label, 'Angel Scout');
    assert.deepEqual(index[0].tags, {
      ancestry: ['angel'],
      category: ['divine'],
      features: ['winged'],
    });
    assert.ok(
      browseCalls.some(
        (call) =>
          call.target === 'modules/pf2e-tokens-extra/assets/datasheet' && call.recursive === true,
      ),
    );
  } finally {
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousFoundry === undefined) delete globalThis.foundry;
    else globalThis.foundry = previousFoundry;
    state.index = [];
    state.errors = [];
    state.indexing = null;
  }
});

test('Foundry index reads native compendium art mappings for the active system', async () => {
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  state.index = [];
  state.errors = [];
  state.indexing = null;

  globalThis.game = {
    system: { id: 'dnd5e' },
    modules: new Map([
      [
        'dnd5e-token-pack',
        {
          id: 'dnd5e-token-pack',
          title: 'DND5E Token Pack',
          flags: {
            compendiumArtMappings: {
              dnd5e: {
                mapping: 'modules/dnd5e-token-pack/mapping.json',
              },
            },
          },
        },
      ],
    ]),
  };
  globalThis.foundry = {
    applications: {
      apps: {
        FilePicker: {
          implementation: {
            browse: async () => ({ files: [] }),
          },
        },
      },
    },
    utils: {
      fetchJsonWithTimeout: async (path) => {
        assert.equal(path, 'modules/dnd5e-token-pack/mapping.json');
        return {
          monsters: {
            adultBlueDragon: {
              name: 'Adult Blue Dragon',
              token: 'modules/dnd5e-token-pack/tokens/adult-blue-dragon.webp',
            },
          },
        };
      },
    },
  };

  try {
    const index = await rebuildIndex();

    assert.equal(index.length, 1);
    assert.equal(index[0].label, 'Adult Blue Dragon');
    assert.equal(index[0].canonicalPackKey, 'dnd5e.monsters');
    assert.equal(index[0].sourceType, 'native');
  } finally {
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousFoundry === undefined) delete globalThis.foundry;
    else globalThis.foundry = previousFoundry;
    state.index = [];
    state.errors = [];
    state.indexing = null;
  }
});

test('Foundry index folder-scans active modules by evidence instead of token-like names', async () => {
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  state.index = [];
  state.errors = [];
  state.indexing = null;

  const browseCalls = [];
  globalThis.game = {
    modules: new Map([
      [
        'drakkenheim-monsters',
        {
          id: 'drakkenheim-monsters',
          title: 'Drakkenheim Monsters',
          flags: {},
        },
      ],
      [
        'utility-tools',
        {
          id: 'utility-tools',
          title: 'Utility Tools',
          flags: {},
        },
      ],
    ]),
  };
  globalThis.foundry = {
    applications: {
      apps: {
        FilePicker: {
          implementation: {
            browse: async (_source, target, options) => {
              browseCalls.push({ target, recursive: options?.recursive });
              if (target === 'modules/drakkenheim-monsters/assets/tokens') {
                return {
                  files: ['modules/drakkenheim-monsters/assets/tokens/contaminated-ogre.webp'],
                };
              }
              return { files: [] };
            },
          },
        },
      },
    },
  };

  try {
    const index = await rebuildIndex();

    assert.deepEqual(
      index.map((candidate) => ({
        label: candidate.label,
        moduleId: candidate.moduleId,
        tokenSrc: candidate.tokenSrc,
      })),
      [
        {
          label: 'Contaminated Ogre',
          moduleId: 'drakkenheim-monsters',
          tokenSrc: 'modules/drakkenheim-monsters/assets/tokens/contaminated-ogre.webp',
        },
      ],
    );
    assert.ok(browseCalls.some((call) => call.target === 'modules/utility-tools/assets/tokens'));
  } finally {
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousFoundry === undefined) delete globalThis.foundry;
    else globalThis.foundry = previousFoundry;
    state.index = [];
    state.errors = [];
    state.indexing = null;
  }
});

test('Foundry index finds tokens and portraits under pictures/ folders of localized modules', async () => {
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  state.index = [];
  state.errors = [];
  state.indexing = null;

  globalThis.game = {
    modules: new Map([['pf2e-zda', { id: 'pf2e-zda', title: 'Zeitalter der Asche', flags: {} }]]),
  };
  globalThis.foundry = {
    applications: {
      apps: {
        FilePicker: {
          implementation: {
            browse: async (_source, target) =>
              target === 'modules/pf2e-zda/pictures'
                ? {
                    files: [
                      'modules/pf2e-zda/pictures/tokens/ghoul.webp',
                      'modules/pf2e-zda/pictures/portraits/ghoul.webp',
                      'modules/pf2e-zda/pictures/book-of-the-dead/tokens/mummy.webp',
                      'modules/pf2e-zda/pictures/book-of-the-dead/portraits/mummy.webp',
                      'modules/pf2e-zda/pictures/map-handout.webp',
                    ],
                  }
                : { files: [] },
          },
        },
      },
    },
  };

  try {
    const index = await rebuildIndex();
    assert.deepEqual(
      index.map((candidate) => ({
        tokenSrc: candidate.tokenSrc,
        portraitSrc: candidate.portraitSrc,
      })),
      [
        {
          tokenSrc: 'modules/pf2e-zda/pictures/tokens/ghoul.webp',
          portraitSrc: 'modules/pf2e-zda/pictures/portraits/ghoul.webp',
        },
        {
          tokenSrc: 'modules/pf2e-zda/pictures/book-of-the-dead/tokens/mummy.webp',
          portraitSrc: 'modules/pf2e-zda/pictures/book-of-the-dead/portraits/mummy.webp',
        },
      ],
    );
  } finally {
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousFoundry === undefined) delete globalThis.foundry;
    else globalThis.foundry = previousFoundry;
    state.index = [];
    state.errors = [];
    state.indexing = null;
  }
});

test('Foundry index scans modules concurrently while preserving candidate order', async () => {
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  state.index = [];
  state.errors = [];
  state.indexing = null;
  let active = 0;
  let maxActive = 0;
  const modules = Array.from({ length: 8 }, (_, index) => ({
    id: `art-pack-${index}`,
    title: `Art Pack ${index}`,
    flags: {},
  }));
  globalThis.game = { modules: new Map(modules.map((module) => [module.id, module])) };
  globalThis.foundry = {
    applications: {
      apps: {
        FilePicker: {
          implementation: {
            browse: async (_source, target) => {
              active += 1;
              maxActive = Math.max(maxActive, active);
              await new Promise((resolve) => setTimeout(resolve, 2));
              active -= 1;
              const match = target.match(/^modules\/(art-pack-\d+)\/assets\/tokens$/);
              return { files: match ? [`${target}/${match[1]}.webp`] : [] };
            },
          },
        },
      },
    },
  };

  try {
    const index = await rebuildIndex();

    assert.ok(maxActive > 1, `Expected concurrent module scans; max active was ${maxActive}`);
    assert.ok(maxActive <= 4, `Module scan concurrency exceeded limit: ${maxActive}`);
    assert.deepEqual(
      index.map((candidate) => candidate.moduleId),
      modules.map((module) => module.id),
    );
  } finally {
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousFoundry === undefined) delete globalThis.foundry;
    else globalThis.foundry = previousFoundry;
    state.index = [];
    state.errors = [];
    state.indexing = null;
  }
});

test('Foundry index discovers datasheets from monster and adventure modules', async () => {
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  state.index = [];
  state.errors = [];
  state.indexing = null;

  globalThis.game = {
    modules: new Map([
      [
        'drakkenheim-monsters',
        {
          id: 'drakkenheim-monsters',
          title: 'Drakkenheim Monsters',
          flags: {},
        },
      ],
    ]),
  };
  globalThis.foundry = {
    applications: {
      apps: {
        FilePicker: {
          implementation: {
            browse: async (_source, target) => {
              if (target === 'modules/drakkenheim-monsters/data') {
                return {
                  files: ['modules/drakkenheim-monsters/data/monster-datasheet.json'],
                };
              }
              return { files: [] };
            },
          },
        },
      },
    },
    utils: {
      fetchJsonWithTimeout: async (path) => {
        assert.equal(path, 'modules/drakkenheim-monsters/data/monster-datasheet.json');
        return [
          {
            label: 'Haze Hulk',
            art: {
              token: 'modules/drakkenheim-monsters/assets/tokens/haze-hulk.webp',
            },
            tags: {
              category: ['monster'],
            },
          },
        ];
      },
    },
  };

  try {
    const index = await rebuildIndex();

    assert.equal(index.length, 1);
    assert.equal(index[0].label, 'Haze Hulk');
    assert.equal(index[0].sourceType, 'datasheet');
    assert.deepEqual(index[0].tags, { category: ['monster'] });
  } finally {
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousFoundry === undefined) delete globalThis.foundry;
    else globalThis.foundry = previousFoundry;
    state.index = [];
    state.errors = [];
    state.indexing = null;
  }
});

test('Foundry index adds custom folders as source-scoped token art', async () => {
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  state.index = [];
  state.errors = [];
  state.indexing = null;

  const browseCalls = [];
  globalThis.game = {
    modules: new Map(),
    settings: {
      get: (_moduleId, key) =>
        key === 'customFolders' ? 'world-token-art\nMy NPCs | uploads/npcs' : undefined,
    },
  };
  globalThis.foundry = {
    applications: {
      apps: {
        FilePicker: {
          implementation: {
            browse: async (_source, target, options) => {
              browseCalls.push({ target, recursive: options?.recursive });
              if (target === 'world-token-art') {
                return {
                  files: ['world-token-art/red-dragon.webp', 'world-token-art/readme.txt'],
                };
              }
              if (target === 'uploads/npcs') {
                return {
                  files: ['uploads/npcs/old_merchant.png'],
                };
              }
              return { files: [] };
            },
          },
        },
      },
    },
  };

  try {
    const index = await rebuildIndex();

    assert.deepEqual(
      index.map((candidate) => ({
        label: candidate.label,
        moduleId: candidate.moduleId,
        moduleTitle: candidate.moduleTitle,
        sourceType: candidate.sourceType,
        tokenSrc: candidate.tokenSrc,
      })),
      [
        {
          label: 'Red Dragon',
          moduleId: 'custom-folder:world-token-art',
          moduleTitle: 'World Token Art',
          sourceType: 'custom-folder',
          tokenSrc: 'world-token-art/red-dragon.webp',
        },
        {
          label: 'Old Merchant',
          moduleId: 'custom-folder:uploads/npcs',
          moduleTitle: 'My NPCs',
          sourceType: 'custom-folder',
          tokenSrc: 'uploads/npcs/old_merchant.png',
        },
      ],
    );
    assert.deepEqual(getPanelSourceFilterOptions(index), [
      { id: 'custom-folder:uploads/npcs', title: 'My NPCs', count: 1 },
      { id: 'custom-folder:world-token-art', title: 'World Token Art', count: 1 },
    ]);
    assert.ok(
      browseCalls.some((call) => call.target === 'world-token-art' && call.recursive === true),
    );
  } finally {
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousFoundry === undefined) delete globalThis.foundry;
    else globalThis.foundry = previousFoundry;
    state.index = [];
    state.errors = [];
    state.indexing = null;
  }
});

test('folder candidates only include token-looking image files', () => {
  const files = [
    'modules/fantasy-token-collection-dragon-01/resources/images/banner.webp',
    'modules/fantasy-token-collection-dragon-01/resources/tokens/Black-Dragon-Angry.webp',
    'modules/fantasy-token-collection-dragon-01/resources/tokens/Black-Dragon-Aura.webp',
    'modules/fantasy-token-collection-dragon-01/resources/tokens/readme.txt',
  ];

  const candidates = createFolderCandidates({
    module: {
      id: 'fantasy-token-collection-dragon-01',
      title: 'Fantasy Token Collection - Dragon 01',
    },
    files,
  });

  assert.deepEqual(
    candidates.map((candidate) => candidate.label),
    ['Black Dragon Angry', 'Black Dragon Aura'],
  );
});

test('folder candidates infer actor and subject images from sibling art folders', () => {
  const files = [
    'modules/pf2e-ap207-the-resurrection-flood/assets/tokens/achex-weak-peryton.webp',
    'modules/pf2e-ap207-the-resurrection-flood/assets/art/achex-weak-peryton.webp',
    'modules/pf2e-ap207-the-resurrection-flood/assets/subjects/achex-weak-peryton.webp',
  ];

  const candidates = createFolderCandidates({
    module: {
      id: 'pf2e-ap207-the-resurrection-flood',
      title: 'Triumph of the Tusk 1 of 3: The Resurrection Flood',
    },
    files,
  });

  assert.equal(candidates.length, 1);
  assert.equal(
    candidates[0].portraitSrc,
    'modules/pf2e-ap207-the-resurrection-flood/assets/art/achex-weak-peryton.webp',
  );
  assert.equal(
    candidates[0].subjectSrc,
    'modules/pf2e-ap207-the-resurrection-flood/assets/subjects/achex-weak-peryton.webp',
  );
});

test('folder duplicates merge into mapped art so previews keep actor images', () => {
  const module = {
    id: 'pf2e-tokens-monster-core-2',
    title: 'Pathfinder Tokens: Monster Core 2',
  };
  const mapping = {
    'pf2e.monster-core-2': {
      phaseAdult: {
        name: 'Dragon Adult Phase',
        actor: 'modules/pf2e-tokens-monster-core-2/assets/art/dragon-adult-phase.webp',
        token: {
          texture: {
            src: 'modules/pf2e-tokens-monster-core-2/assets/tokens/dragon-adult-phase.webp',
            scaleX: 2,
            scaleY: 2,
          },
          ring: {
            enabled: true,
            subject: {
              texture: 'modules/pf2e-tokens-monster-core-2/assets/subjects/dragon-adult-phase.webp',
              scale: 2,
            },
          },
        },
      },
    },
  };
  const folderCandidates = createFolderCandidates({
    module,
    files: ['modules/pf2e-tokens-monster-core-2/assets/tokens/dragon-adult-phase.webp'],
  });
  const mappedCandidates = createMappedCandidates({ module, mapping });

  const candidates = dedupeCandidates([...folderCandidates, ...mappedCandidates]);

  assert.equal(candidates.length, 1);
  assert.equal(
    candidates[0].portraitSrc,
    'modules/pf2e-tokens-monster-core-2/assets/art/dragon-adult-phase.webp',
  );
  assert.equal(
    candidates[0].subjectSrc,
    'modules/pf2e-tokens-monster-core-2/assets/subjects/dragon-adult-phase.webp',
  );
  assert.equal(candidates[0].scaleX, 2);
  assert.equal(candidates[0].scaleY, 2);
  assert.equal(candidates[0].subjectScale, 2);
  assert.equal(candidates[0].sourceType, 'native');
});

test('dedupe keeps portrait-only candidates instead of dropping them', () => {
  const candidates = dedupeCandidates([
    {
      id: 'portrait-only',
      label: 'Adult Blue Dragon',
      moduleId: 'pf2e-tokens-draconic-codex',
      moduleTitle: 'Pathfinder Tokens: Draconic Codex',
      portraitSrc: 'modules/pf2e-tokens-draconic-codex/assets/art/adult-blue-dragon.webp',
      searchText: 'adult blue dragon',
      tokenSrc: '',
    },
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(
    candidates[0].portraitSrc,
    'modules/pf2e-tokens-draconic-codex/assets/art/adult-blue-dragon.webp',
  );
});

test('candidate lookup ranks exact source before same-name and broad search', () => {
  const index = [
    {
      id: 'exact',
      label: 'Adult Blue Dragon',
      moduleId: 'a',
      moduleTitle: 'A',
      packKey: 'pf2e.pathfinder-bestiary',
      actorId: 'abc123',
      tokenSrc: 'exact.webp',
      searchText: 'adult blue dragon exact',
    },
    {
      id: 'name',
      label: 'Adult Blue Dragon',
      moduleId: 'b',
      moduleTitle: 'B',
      tokenSrc: 'name.webp',
      searchText: 'adult blue dragon name',
    },
    {
      id: 'broad',
      label: 'Blue Dragon Wyrmling',
      moduleId: 'c',
      moduleTitle: 'C',
      tokenSrc: 'broad.webp',
      searchText: 'blue dragon wyrmling broad',
    },
  ];
  const tokenDocument = {
    actor: {
      id: 'world-actor',
      name: 'Adult Blue Dragon',
      flags: {
        core: {
          sourceId: 'Compendium.pf2e.pathfinder-bestiary.Actor.abc123',
        },
      },
    },
  };

  const candidates = getCandidatesForTokenDocument(index, tokenDocument, 'blue');

  assert.deepEqual(
    candidates.map((candidate) => candidate.id),
    ['exact', 'name', 'broad'],
  );
  assert.equal(candidates[0].matchType, 'exact');
  assert.equal(candidates[1].matchType, 'name');
  assert.equal(candidates[2].matchType, 'search');
});

test('candidate lookup uses base actor source for unlinked token documents', () => {
  const index = [
    {
      id: 'exact',
      label: 'Adult Blue Dragon',
      moduleId: 'a',
      moduleTitle: 'A',
      packKey: 'pf2e.pathfinder-bestiary',
      actorId: 'abc123',
      tokenSrc: 'exact.webp',
      searchText: 'adult blue dragon exact',
    },
  ];
  const tokenDocument = {
    actor: {
      name: 'Renamed Scene Token',
    },
    baseActor: {
      name: 'Adult Blue Dragon',
      flags: {
        core: {
          sourceId: 'Compendium.pf2e.pathfinder-bestiary.Actor.abc123',
        },
      },
    },
  };

  const candidates = getCandidatesForTokenDocument(index, tokenDocument, 'blue');

  assert.equal(candidates[0].id, 'exact');
  assert.equal(candidates[0].matchType, 'exact');
});

test('search matches normalized labels and module titles', () => {
  const index = [
    {
      id: 'a',
      label: 'Black Dragon Angry',
      moduleTitle: 'Fantasy Token Collection - Dragon 01',
      tokenSrc: 'black.webp',
      searchText: 'black dragon angry fantasy token collection dragon 01',
    },
  ];

  assert.equal(searchCandidates(index, 'black angry').length, 1);
  assert.equal(searchCandidates(index, 'collection dragon').length, 1);
  assert.equal(searchCandidates(index, 'skeleton').length, 0);
});

test('source filter options are unique sorted modules with counts', () => {
  const options = getSourceFilterOptions([
    { moduleId: 'b', moduleTitle: 'Bestiary Tokens' },
    { moduleId: 'a', moduleTitle: 'Adventure Tokens' },
    { moduleId: 'b', moduleTitle: 'Bestiary Tokens' },
  ]);

  assert.deepEqual(options, [
    { id: 'a', title: 'Adventure Tokens', count: 1 },
    { id: 'b', title: 'Bestiary Tokens', count: 2 },
  ]);
});

test('source search filters source options by normalized source title', () => {
  const options = [
    { id: 'bestiary', title: 'Pathfinder Tokens: Bestiaries', count: 10 },
    { id: 'draconic', title: 'Pathfinder Tokens: Draconic Codex', count: 2 },
    { id: 'npc-core', title: 'Pathfinder Tokens: NPC Core', count: 7 },
  ];

  assert.deepEqual(
    filterSourceOptionsByQuery(options, '').map((option) => option.id),
    ['bestiary', 'draconic', 'npc-core'],
  );
  assert.deepEqual(
    filterSourceOptionsByQuery(options, 'draconic').map((option) => option.id),
    ['draconic'],
  );
  assert.deepEqual(
    filterSourceOptionsByQuery(options, 'tokens npc').map((option) => option.id),
    ['npc-core'],
  );
  assert.deepEqual(filterSourceOptionsByQuery(options, 'missing'), []);
});

test('panel source filter options use full index instead of selected token candidates', () => {
  const index = [
    {
      id: 'exact',
      label: 'Adult Blue Dragon',
      moduleId: 'bestiary',
      moduleTitle: 'Bestiary Tokens',
      packKey: 'pf2e.pathfinder-bestiary',
      actorId: 'abc123',
      tokenSrc: 'exact.webp',
      searchText: 'adult blue dragon',
    },
    {
      id: 'name',
      label: 'Adult Blue Dragon',
      moduleId: 'draconic',
      moduleTitle: 'Draconic Codex',
      tokenSrc: 'name.webp',
      searchText: 'adult blue dragon',
    },
    {
      id: 'unrelated',
      label: 'Aphorite Kobold Rogue',
      moduleId: 'characters',
      moduleTitle: 'Character Gallery',
      tokenSrc: 'kobold.webp',
      searchText: 'aphorite kobold rogue character gallery',
    },
  ];
  const tokenDocument = {
    actor: {
      name: 'Adult Blue Dragon',
      flags: {
        core: {
          sourceId: 'Compendium.pf2e.pathfinder-bestiary.Actor.abc123',
        },
      },
    },
  };

  const tokenScopedOptions = getSourceFilterOptions(
    getCandidatesForTokenDocument(index, tokenDocument, ''),
  );

  assert.deepEqual(
    tokenScopedOptions.map((option) => option.id),
    ['bestiary', 'draconic'],
  );
  assert.deepEqual(
    getPanelSourceFilterOptions(index).map((option) => option.id),
    ['bestiary', 'characters', 'draconic'],
  );
});

test('HUD source menu is built from full index', () => {
  const script = fs.readFileSync(new URL('../scripts/picker-app.js', import.meta.url), 'utf8');

  assert.match(script, /const sourceOptions = getPanelSourceFilterOptions\(index\);/);
  assert.doesNotMatch(
    script,
    /getSourceFilterOptions\(getCandidatesForTokenDocument\(index, tokenDocument, ""\)\)/,
  );
});

test('source-only picker filtering browses all matching art with a render cap', () => {
  const index = [
    ...Array.from({ length: 130 }, (_, index) => ({
      id: `a-${index}`,
      label: `A Token ${String(index).padStart(3, '0')}`,
      moduleId: 'source-a',
      moduleTitle: 'Source A',
      tokenSrc: `modules/source-a/tokens/a-${index}.webp`,
      searchText: `a token ${index} source a source-a`,
    })),
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `b-${index}`,
      label: `B Token ${String(index).padStart(3, '0')}`,
      moduleId: 'source-b',
      moduleTitle: 'Source B',
      tokenSrc: `modules/source-b/tokens/b-${index}.webp`,
      searchText: `b token ${index} source b source-b`,
    })),
  ];
  const sourceOptions = getPanelSourceFilterOptions(index);
  const result = getPickerCandidatePool(
    index,
    {
      excludedTagIds: new Set(),
      favoritesOnly: false,
      resultLimit: 120,
      searchQuery: '',
      selectedSourceIds: new Set(['source-a']),
      selectedTagIds: new Set(),
      tokenDocument: {},
    },
    {
      favoriteIds: new Set(),
      sourceOptions,
    },
  );

  assert.equal(result.browseMode, true);
  assert.equal(result.total, 130);
  assert.equal(result.candidates.length, 120);
  assert.equal(result.hasMore, true);
  assert.ok(result.candidates.every((candidate) => candidate.moduleId === 'source-a'));
});

test('picker falls back to browsing all indexed art when the current token has no matches', () => {
  const index = [
    {
      id: 'dnd-a',
      label: 'Skeleton Warrior',
      moduleId: 'dnd-tokens',
      moduleTitle: 'DND Tokens',
      tokenSrc: 'modules/dnd-tokens/tokens/skeleton-warrior.webp',
      searchText: 'skeleton warrior dnd tokens dnd-tokens',
    },
    {
      id: 'dnd-b',
      label: 'Zombie Brute',
      moduleId: 'dnd-tokens',
      moduleTitle: 'DND Tokens',
      tokenSrc: 'modules/dnd-tokens/tokens/zombie-brute.webp',
      searchText: 'zombie brute dnd tokens dnd-tokens',
    },
  ];
  const sourceOptions = getPanelSourceFilterOptions(index);
  const result = getPickerCandidatePool(
    index,
    {
      excludedTagIds: new Set(),
      favoritesOnly: false,
      resultLimit: 120,
      searchQuery: '',
      selectedSourceIds: new Set(['dnd-tokens']),
      selectedTagIds: new Set(),
      tokenDocument: {
        actor: {
          name: 'Guard Captain',
          flags: { core: { sourceId: 'Compendium.dnd5e.monsters.Actor.guardCaptain' } },
        },
      },
    },
    {
      favoriteIds: new Set(),
      sourceOptions,
    },
  );

  assert.equal(result.browseMode, true);
  assert.equal(result.total, 2);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.id),
    ['dnd-a', 'dnd-b'],
  );
});

test('source filter accepts multiple selected modules and can treat empty as none for HUD clear all', () => {
  const candidates = [
    { id: 'a', moduleId: 'bestiary' },
    { id: 'b', moduleId: 'draconic' },
    { id: 'c', moduleId: 'npc-core' },
  ];

  assert.deepEqual(
    filterCandidatesBySources(candidates, []).map((candidate) => candidate.id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    filterCandidatesBySources(candidates, ['bestiary', 'npc-core']).map(
      (candidate) => candidate.id,
    ),
    ['a', 'c'],
  );
  assert.deepEqual(
    filterCandidatesBySources(candidates, [], { emptyMeansAll: false }).map(
      (candidate) => candidate.id,
    ),
    [],
  );
});

test('source filter label summarizes all, none, one, or multiple selected sources', () => {
  const options = [
    { id: 'bestiary', title: 'Bestiary Tokens', count: 8 },
    { id: 'draconic', title: 'Draconic Codex', count: 3 },
    { id: 'npc-core', title: 'NPC Core', count: 2 },
  ];

  assert.equal(getSourceFilterLabel(options, []), 'All sources');
  assert.equal(getSourceFilterLabel(options, [], { emptyMeansAll: false }), 'No sources');
  assert.equal(getSourceFilterLabel(options, ['draconic']), 'Draconic Codex');
  assert.equal(getSourceFilterLabel(options, ['bestiary', 'npc-core']), '2 sources');
  assert.equal(
    getSourceFilterLabel(options, ['bestiary', 'draconic', 'npc-core'], { emptyMeansAll: false }),
    'All sources',
  );
});

test('favorite settings register as client preferences and normalize stored ids', () => {
  const calls = [];
  const settings = {
    register: (...args) => calls.push(args),
    get: () => ({ ids: ['b', 'a', 'a', '', null] }),
  };

  registerFavoriteSettings(settings);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'pf2e-tokener');
  assert.equal(calls[0][1], 'favorites');
  assert.equal(calls[0][2].scope, 'client');
  assert.equal(calls[0][2].config, false);
  assert.deepEqual([...getFavoriteIds(settings)], ['b', 'a']);
});

test('custom folder settings register as world paths and normalize source entries', () => {
  const calls = [];
  const settings = {
    register: (...args) => calls.push(args),
    get: () => 'world-token-art; My NPCs | uploads/npcs\nworld-token-art',
  };

  registerCustomFolderSettings(settings);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'pf2e-tokener');
  assert.equal(calls[0][1], 'customFolders');
  assert.equal(calls[0][2].scope, 'world');
  assert.equal(calls[0][2].config, true);
  assert.equal(calls[0][2].type, String);
  assert.deepEqual(getCustomFolderSources(settings), [
    {
      id: 'custom-folder:world-token-art',
      path: 'world-token-art',
      title: 'World Token Art',
    },
    {
      id: 'custom-folder:uploads/npcs',
      path: 'uploads/npcs',
      title: 'My NPCs',
    },
  ]);
});

test('custom folder settings use a folder-picker submenu when Foundry forms are available', () => {
  const previousFoundry = globalThis.foundry;
  const calls = [];
  const menuCalls = [];
  class FakeApplicationV2 {}
  class FakeDialogV2 {}
  globalThis.foundry = {
    applications: {
      api: {
        ApplicationV2: FakeApplicationV2,
        DialogV2: FakeDialogV2,
      },
    },
  };
  const settings = {
    register: (...args) => calls.push(args),
    registerMenu: (...args) => menuCalls.push(args),
    get: () => '',
  };

  try {
    registerCustomFolderSettings(settings);

    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], 'customFolders');
    assert.equal(calls[0][2].config, false);
    assert.equal(menuCalls.length, 1);
    assert.equal(menuCalls[0][1], 'customFoldersMenu');
    assert.equal(menuCalls[0][2].restricted, true);
    assert.equal(menuCalls[0][2].type, getCustomFolderSettingsApplicationClass());
    assert.ok(menuCalls[0][2].type.prototype instanceof FakeApplicationV2);
    assert.match(menuCalls[0][2].type.prototype.openDialog.toString(), /DialogV2Class\.input/);
  } finally {
    if (previousFoundry === undefined) delete globalThis.foundry;
    else globalThis.foundry = previousFoundry;
  }
});

test('custom folder settings template uses Foundry folder file picker buttons', () => {
  const template = fs.readFileSync(
    new URL('../templates/custom-folders.hbs', import.meta.url),
    'utf8',
  );
  const script = fs.readFileSync(new URL('../scripts/custom-folders.js', import.meta.url), 'utf8');

  assert.match(template, /data-type=['"]folder['"]/);
  assert.match(template, /data-target=['"]folders\./);
  assert.match(template, /data-folder-browser/);
  assert.match(script, /openCustomFolderBrowser/);
  assert.match(script, /pf2e-tokener-folder-browser-images/);
  assert.doesNotMatch(script, /new FilePicker/);
  assert.match(template, /data-folder-tag-group/);
  assert.match(template, /data-folder-tag-id/);
  assert.match(template, /name=['"]{{inputName}}['"]/);
  assert.doesNotMatch(template, /name=['"]folders\.{{index}}\.tags['"]/);
  assert.match(template, /data-folder-action=['"]add['"]/);
  assert.match(template, /data-folder-action=['"]remove['"]/);
});

test('custom folder settings dialog renders selectable indexed tag categories', async () => {
  const previousFoundry = globalThis.foundry;
  const previousGame = globalThis.game;
  let dialogConfig;
  class FakeApplicationV2 {}
  class FakeDialogV2 {
    static input(config) {
      dialogConfig = config;
      return Promise.resolve(null);
    }
  }
  globalThis.foundry = {
    applications: {
      api: {
        ApplicationV2: FakeApplicationV2,
        DialogV2: FakeDialogV2,
      },
      handlebars: {
        renderTemplate: async (_template, context) => JSON.stringify(context),
      },
    },
  };
  globalThis.game = {
    modules: new Map([
      [
        'pf2e-tokener',
        {
          api: {
            ensureIndex: async () => state.index,
          },
        },
      ],
    ]),
    settings: {
      get: (_moduleId, key) =>
        key === 'customFolders'
          ? JSON.stringify([
              {
                path: 'uploads/npcs',
                tags: {
                  category: ['npc'],
                },
              },
            ])
          : undefined,
    },
  };
  state.index = [
    {
      id: 'dragon',
      label: 'Dragon',
      tags: {
        category: ['npc'],
        creature: ['dragon'],
      },
    },
    {
      id: 'sword',
      label: 'Sword',
      tags: {
        equipment: ['sword'],
      },
    },
  ];

  try {
    const CustomFolders = getCustomFolderSettingsApplicationClass(FakeApplicationV2, FakeDialogV2);
    await new CustomFolders().openDialog();
    const context = JSON.parse(dialogConfig.content);
    const [folder] = context.folders;

    assert.deepEqual(
      folder.tagGroups.map((group) => ({
        id: group.id,
        selected: group.selected,
        options: group.options.map((option) => ({
          checked: option.checked,
          id: option.id,
        })),
      })),
      [
        {
          id: 'category',
          selected: true,
          options: [{ checked: true, id: 'category:npc' }],
        },
        {
          id: 'equipment',
          selected: false,
          options: [{ checked: false, id: 'equipment:sword' }],
        },
        {
          id: 'creature',
          selected: false,
          options: [{ checked: false, id: 'creature:dragon' }],
        },
      ],
    );
  } finally {
    state.index = [];
    if (previousFoundry === undefined) delete globalThis.foundry;
    else globalThis.foundry = previousFoundry;
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
  }
});

test('custom folder settings preserve per-image tags when saving folder rows', async () => {
  const previousFoundry = globalThis.foundry;
  const previousGame = globalThis.game;
  const previousFormData = globalThis.FormData;
  let dialogConfig;
  let stored = JSON.stringify([
    {
      path: 'uploads/npcs',
      title: 'My NPCs',
      imageTags: {
        'uploads/npcs/old_merchant.webp': {
          creature: ['merchant'],
        },
      },
      tags: {
        category: ['npc'],
      },
    },
  ]);
  class FakeApplicationV2 {}
  class FakeDialogV2 {
    static input(config) {
      dialogConfig = config;
      return Promise.resolve(null);
    }
  }
  class FakeFormData {
    constructor(form) {
      this.form = form;
    }

    entries() {
      return this.form.values[Symbol.iterator]();
    }
  }
  globalThis.FormData = FakeFormData;
  globalThis.foundry = {
    applications: {
      api: {
        ApplicationV2: FakeApplicationV2,
        DialogV2: FakeDialogV2,
      },
      handlebars: {
        renderTemplate: async () => '<div></div>',
      },
    },
  };
  globalThis.game = {
    modules: new Map([
      [
        'pf2e-tokener',
        {
          api: {
            ensureIndex: async () => [],
          },
        },
      ],
    ]),
    settings: {
      get: () => stored,
      set: async (_moduleId, key, value) => {
        assert.equal(key, 'customFolders');
        stored = value;
        return value;
      },
    },
  };

  try {
    const CustomFolders = getCustomFolderSettingsApplicationClass(FakeApplicationV2, FakeDialogV2);
    await new CustomFolders().openDialog();
    await dialogConfig.ok.callback(null, {
      form: {
        values: [
          ['folders.0.title', 'My Renamed NPCs'],
          ['folders.0.path', 'uploads/npcs'],
          ['folders.0.tagIds', 'category:npc'],
        ],
      },
    });

    const [source] = getCustomFolderSources(globalThis.game.settings);
    assert.equal(source.title, 'My Renamed NPCs');
    assert.deepEqual(source.imageTags, {
      'uploads/npcs/old_merchant.webp': {
        creature: ['merchant'],
      },
    });
  } finally {
    if (previousFoundry === undefined) delete globalThis.foundry;
    else globalThis.foundry = previousFoundry;
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousFormData === undefined) delete globalThis.FormData;
    else globalThis.FormData = previousFormData;
  }
});

test('custom folder tag selector CSS uses compact grouped controls', () => {
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');
  const template = fs.readFileSync(
    new URL('../templates/custom-folders.hbs', import.meta.url),
    'utf8',
  );

  assert.match(template, /pf2e-tokener-custom-folder-add/);
  assert.match(template, /pf2e-tokener-custom-folder-tag-summary/);
  assert.match(template, /pf2e-tokener-custom-folder-tag-label/);
  assert.match(
    css,
    /\.pf2e-tokener-custom-folder-tag-groups\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(180px,\s*1fr\)\);/,
  );
  assert.match(css, /\.pf2e-tokener-custom-folder-tag-group summary::before\s*\{/);
  assert.match(
    css,
    /\.pf2e-tokener-custom-folder-tags input\[type=['"]checkbox['"]\]\s*\{[^}]*width:\s*14px;/,
  );
  assert.match(css, /\.pf2e-tokener-custom-folder-add\s*\{[^}]*justify-self:\s*start;/);
});

test('custom folders accept source tags and apply them to folder candidates', () => {
  const settings = {
    get: () =>
      JSON.stringify([
        {
          path: 'uploads/npcs',
          title: 'My NPCs',
          tags: {
            category: ['npc'],
            creature: 'merchant',
          },
        },
      ]),
  };

  const [source] = getCustomFolderSources(settings);
  const [candidate] = createCustomFolderCandidates({
    source,
    files: ['uploads/npcs/old_merchant.png'],
  });

  assert.deepEqual(source.tags, {
    category: ['npc'],
    creature: ['merchant'],
  });
  assert.deepEqual(candidate.tags, {
    category: ['npc'],
    creature: ['merchant'],
  });
  assert.deepEqual(searchCandidates([candidate], 'category:npc')[0].tags, candidate.tags);
});

test('custom folder structures pair related art and add searchable folder tags', () => {
  const [candidate] = createCustomFolderCandidates({
    source: {
      id: 'custom-folder:uploads/custom-art',
      path: 'uploads/custom-art',
      title: 'Custom Art',
    },
    files: [
      'uploads/custom-art/tokens/npcs/merchants/old_merchant.webp',
      'uploads/custom-art/portraits/npcs/merchants/old_merchant.webp',
      'uploads/custom-art/subjects/npcs/merchants/old_merchant.webp',
      'uploads/custom-art/portraits/npcs/merchants/shopkeeper.webp',
    ],
  });

  assert.equal(candidate.tokenSrc, 'uploads/custom-art/tokens/npcs/merchants/old_merchant.webp');
  assert.equal(
    candidate.portraitSrc,
    'uploads/custom-art/portraits/npcs/merchants/old_merchant.webp',
  );
  assert.equal(
    candidate.subjectSrc,
    'uploads/custom-art/subjects/npcs/merchants/old_merchant.webp',
  );
  assert.deepEqual(candidate.tags, {
    folder: ['npcs', 'merchants'],
  });
  assert.equal(searchCandidates([candidate], 'folder:merchants')[0].id, candidate.id);
});

test('custom folders can use separate token, portrait, and dynamic subject paths', () => {
  const settings = {
    get: () =>
      JSON.stringify([
        {
          title: 'Drakkenheim Monsters',
          tokenPath: 'modules/drakkenheim-monsters/assets/tokens/dynamic',
          portraitPath: 'modules/drakkenheim-monsters/assets/art/monsters',
        },
      ]),
  };

  const [source] = getCustomFolderSources(settings);
  const [candidate] = createCustomFolderCandidates({
    source,
    files: [
      'modules/drakkenheim-monsters/assets/tokens/dynamic/haze-hulk.webp',
      'modules/drakkenheim-monsters/assets/art/monsters/haze-hulk.webp',
    ],
  });

  assert.equal(source.path, 'modules/drakkenheim-monsters/assets/tokens/dynamic');
  assert.equal(source.portraitPath, 'modules/drakkenheim-monsters/assets/art/monsters');
  assert.equal(
    candidate.tokenSrc,
    'modules/drakkenheim-monsters/assets/tokens/dynamic/haze-hulk.webp',
  );
  assert.equal(
    candidate.portraitSrc,
    'modules/drakkenheim-monsters/assets/art/monsters/haze-hulk.webp',
  );
  assert.equal(
    candidate.subjectSrc,
    'modules/drakkenheim-monsters/assets/art/monsters/haze-hulk.webp',
  );
  assert.deepEqual(buildTokenUpdate(candidate), {
    'texture.src': 'modules/drakkenheim-monsters/assets/tokens/dynamic/haze-hulk.webp',
    'texture.scaleX': 1,
    'texture.scaleY': 1,
    randomImg: false,
    'ring.enabled': true,
    'ring.subject.texture': 'modules/drakkenheim-monsters/assets/art/monsters/haze-hulk.webp',
    'ring.subject.scale': 1,
  });
  assert.equal(
    buildActorUpdate(candidate).img,
    'modules/drakkenheim-monsters/assets/art/monsters/haze-hulk.webp',
  );
});

test('custom folder image tags are saved per image and merged with folder tags', async () => {
  let stored = JSON.stringify([
    {
      path: 'uploads/npcs',
      title: 'My NPCs',
      tags: {
        category: ['npc'],
      },
    },
  ]);
  const settings = {
    get: () => stored,
    set: async (_moduleId, key, value) => {
      assert.equal(key, 'customFolders');
      stored = value;
      return value;
    },
  };

  await setCustomFolderImageTags(
    'uploads/npcs/old_merchant.webp',
    {
      creature: ['merchant'],
      tag: ['portrait'],
    },
    settings,
  );

  const [source] = getCustomFolderSources(settings);
  const [candidate] = createCustomFolderCandidates({
    source,
    files: ['uploads/npcs/old_merchant.webp'],
  });

  assert.deepEqual(source.imageTags, {
    'uploads/npcs/old_merchant.webp': {
      creature: ['merchant'],
      tag: ['portrait'],
    },
  });
  assert.deepEqual(candidate.tags, {
    category: ['npc'],
    creature: ['merchant'],
    tag: ['portrait'],
  });
  assert.deepEqual(searchCandidates([candidate], 'creature:merchant')[0].tags, candidate.tags);
});

test('GM image tag overrides apply to any source without replacing original tags', async () => {
  let stored = {};
  const settings = {
    get: () => stored,
    set: async (_moduleId, key, value) => {
      assert.equal(key, 'imageTags');
      stored = value;
      return value;
    },
  };
  const [nativeCandidate] = createMappedCandidates({
    module: MODULE,
    mapping: {
      actors: {
        'Compendium.pf2e.pathfinder-bestiary.Actor.Adult Blue Dragon': {
          img: 'modules/pf2e-tokens-bestiaries/portraits/dragon.webp',
          token: {
            img: 'modules/pf2e-tokens-bestiaries/tokens/dragon.webp',
          },
        },
      },
    },
    sourceType: 'native',
  });

  await setImageTagOverrides(
    'modules/pf2e-tokens-bestiaries/tokens/dragon.webp',
    { custom: ['boss'] },
    settings,
  );
  const [tagged] = applyImageTagOverrides([nativeCandidate], settings);

  assert.equal(tagged.imageTagsEditable, true);
  assert.equal(tagged.imageTagPath, 'modules/pf2e-tokens-bestiaries/tokens/dragon.webp');
  assert.deepEqual(tagged.originalTags, nativeCandidate.tags);
  assert.deepEqual(tagged.imageTagOverrides, { custom: ['boss'] });
  assert.deepEqual(tagged.tags, { custom: ['boss'] });
  assert.equal(searchCandidates([tagged], 'custom:boss')[0].id, tagged.id);
});

test('image tag overrides can be exported and imported as normalized JSON', async () => {
  let stored = {
    'uploads/NPCs/Boss.webp': {
      Custom: ['Boss', 'Boss'],
      empty: [],
    },
  };
  const settings = {
    get: () => stored,
    set: async (_moduleId, key, value) => {
      assert.equal(key, 'imageTags');
      stored = value;
      return value;
    },
  };

  assert.equal(
    getImageTagOverridesExport(settings),
    JSON.stringify(
      {
        'uploads/NPCs/Boss.webp': {
          custom: ['boss'],
        },
      },
      null,
      2,
    ),
  );

  await importImageTagOverrides(
    JSON.stringify({
      'uploads/NPCs/Merchant.webp': {
        Creature: ['Merchant'],
        tag: 'Shopkeeper',
      },
    }),
    settings,
  );

  assert.deepEqual(stored, {
    'uploads/NPCs/Merchant.webp': {
      creature: ['merchant'],
      tag: ['shopkeeper'],
    },
  });

  await importImageTagOverrides(
    JSON.stringify({
      image: 'uploads/NPCs/Boss.webp',
      tags: {
        Custom: ['Boss'],
      },
    }),
    settings,
  );

  assert.deepEqual(stored, {
    'uploads/NPCs/Boss.webp': {
      custom: ['boss'],
    },
  });
  await assert.rejects(
    () =>
      importImageTagOverrides(
        JSON.stringify({
          tags: {
            Custom: ['No Path'],
          },
        }),
        settings,
      ),
    /Invalid image tag JSON/,
  );
  await assert.rejects(() => importImageTagOverrides('{', settings), /Invalid image tag JSON/);
});

test('single image tag JSON only carries custom tags for the edited image', () => {
  const imagePath = 'uploads/NPCs/Boss.webp';

  assert.equal(
    getImageTagOverrideExport({
      Custom: ['Boss', 'Boss'],
      empty: [],
    }),
    JSON.stringify(
      {
        tags: {
          custom: ['boss'],
        },
      },
      null,
      2,
    ),
  );

  assert.doesNotMatch(getImageTagOverrideExport({ Custom: ['Boss'] }), /"image"/);
  assert.deepEqual(
    parseImageTagOverrideImport(
      JSON.stringify({
        image: 'uploads/other.webp',
        tags: {
          Creature: ['Merchant'],
        },
      }),
      imagePath,
    ),
    {
      creature: ['merchant'],
    },
  );
  assert.deepEqual(
    parseImageTagOverrideImport(
      JSON.stringify({
        [imagePath]: {
          Custom: ['Boss'],
        },
        'uploads/other.webp': {
          custom: ['ignore-me'],
        },
      }),
      imagePath,
    ),
    {
      custom: ['boss'],
    },
  );
  assert.deepEqual(parseImageTagOverrideImport(JSON.stringify({ Custom: ['Boss'] }), imagePath), {
    custom: ['boss'],
  });
  assert.throws(() => parseImageTagOverrideImport('{', imagePath), /Invalid image tag JSON/);
});

test('image tag settings expose a restricted import export menu when Foundry forms are available', () => {
  const previousFoundry = globalThis.foundry;
  const calls = [];
  const menuCalls = [];
  class FakeApplicationV2 {}
  class FakeDialogV2 {}
  globalThis.foundry = {
    applications: {
      api: {
        ApplicationV2: FakeApplicationV2,
        DialogV2: FakeDialogV2,
      },
    },
  };
  const settings = {
    register: (...args) => calls.push(args),
    registerMenu: (...args) => menuCalls.push(args),
  };

  try {
    registerImageTagSettings(settings);

    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], 'imageTags');
    assert.equal(calls[0][2].config, false);
    assert.equal(menuCalls.length, 1);
    assert.equal(menuCalls[0][1], 'imageTagsMenu');
    assert.equal(menuCalls[0][2].restricted, true);
    assert.match(menuCalls[0][2].type.prototype.openDialog.toString(), /importImageTagOverrides/);
    assert.match(
      fs.readFileSync(new URL('../scripts/image-tags.js', import.meta.url), 'utf8'),
      /data-image-tags-export/,
    );
  } finally {
    if (previousFoundry === undefined) delete globalThis.foundry;
    else globalThis.foundry = previousFoundry;
  }
});

test('picker template renders edit tags for all indexed image cards', () => {
  const template = fs.readFileSync(new URL('../templates/picker.hbs', import.meta.url), 'utf8');

  assert.match(template, /{{#if imageTagsEditable}}/);
  assert.match(template, /data-custom-image-tags-candidate-id=['"]{{viewId}}['"]/);
});

test('picker template renders per-card token and dynamic ring scale slider controls', () => {
  const template = fs.readFileSync(new URL('../templates/picker.hbs', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');

  assert.match(template, /{{#if hasScaleControls}}/);
  assert.match(template, /{{#each scaleControls}}/);
  assert.match(template, /class=['"]pf2e-tokener-scale-slider['"]/);
  assert.match(template, /data-scale-target=['"]{{target}}['"]/);
  assert.match(template, /data-scale-value=['"]{{target}}['"]/);
  assert.match(template, /data-scale-reset=['"]{{target}}['"]/);
  assert.doesNotMatch(template, /pf2e-tokener-scale-slider[\s\S]{0,500}data-tooltip/);
  assert.match(css, /\.pf2e-tokener-scale-control\s*\{/);
  assert.match(css, /\.pf2e-tokener-scale-slider\s*\{/);
  assert.match(css, /\.pf2e-tokener-scale-reset\s*\{/);
});

test('custom image tag dialog shows selected tags and supports chip removal', () => {
  const picker = fs.readFileSync(new URL('../scripts/picker-app.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');

  assert.match(picker, /pf2e-tokener-custom-image-tags-selected/);
  assert.match(picker, /pf2e-tokener-custom-image-tags-create/);
  assert.match(picker, /data-custom-image-tag-action="add"/);
  assert.match(picker, /data-custom-image-tag-action="export-json"/);
  assert.match(picker, /data-custom-image-tag-action="import-json"/);
  assert.match(picker, /data-custom-image-tags-json/);
  assert.match(picker, /addCustomImageTag/);
  assert.match(picker, /exportCustomImageTags/);
  assert.match(picker, /importCustomImageTags/);
  assert.match(picker, /getImageTagOverrideExport/);
  assert.match(picker, /parseImageTagOverrideImport/);
  assert.match(picker, /downloadImageTagJson/);
  assert.match(picker, /renderCustomImageHiddenTagInputs/);
  assert.match(picker, /data-custom-image-tag-remove/);
  assert.match(picker, /candidate\.originalTags/);
  assert.match(picker, /getEditableCheckedImageTagIds/);
  assert.match(picker, /disabled/);
  assert.match(picker, /updateCustomImageSelectedTags/);
  assert.match(picker, /new Set\(tagsToIds\(candidate\.imageTagOverrides\)\)/);
  assert.match(css, /\.pf2e-tokener-custom-image-tags-selected\s*\{/);
  assert.match(css, /\.pf2e-tokener-custom-image-tags-create\s*\{/);
  assert.match(css, /\.pf2e-tokener-custom-image-tags-json\s*\{/);
  assert.match(css, /\.pf2e-tokener-custom-image-tags-chip\s*\{/);
  assert.match(css, /\.pf2e-tokener-custom-image-tags-chip:disabled\s*\{/);
});

test('tag changes preserve picker scroll during refresh', () => {
  const picker = fs.readFileSync(new URL('../scripts/picker-app.js', import.meta.url), 'utf8');

  assert.match(picker, /function capturePickerScroll/);
  assert.match(picker, /function restorePickerScroll/);
  assert.match(picker, /\.pf2e-tokener-tag-groups/);
  assert.match(picker, /tagGroupsTop/);
  assert.match(picker, /restorePickerScroll\(app, root\)/);
  assert.match(picker, /renderMainPart\(app, \{ preserveScroll: true \}\)/);
  assert.match(picker, /toggleExcludedTag[\s\S]*renderMainPart\(app, \{ preserveScroll: true \}\)/);
  assert.match(picker, /toggleIncludedTag[\s\S]*renderMainPart\(app, \{ preserveScroll: true \}\)/);
});

test('applying token art preserves picker result scroll during refresh', () => {
  const picker = fs.readFileSync(new URL('../scripts/picker-app.js', import.meta.url), 'utf8');

  assert.match(
    picker,
    /applyCandidateAction[\s\S]*renderMainPart\(activePicker, \{ preserveScroll: true \}\)/,
  );
});

test('token scale slider previews scene token scale and reuses preview revert snapshot', () => {
  const picker = fs.readFileSync(new URL('../scripts/picker-app.js', import.meta.url), 'utf8');

  assert.match(picker, /\.pf2e-tokener-scale-slider/);
  assert.match(picker, /handleScaleSliderInput/);
  assert.match(picker, /buildTokenScalePreviewUpdate/);
  assert.match(picker, /_scalePreviewSnapshots/);
  assert.match(picker, /buildApplyRevertSnapshot/);
  assert.match(picker, /closestTarget\(target, '.pf2e-tokener-scale-control'\)/);
  assert.match(picker, /SCALE_TARGET_TOKEN/);
  assert.match(picker, /SCALE_TARGET_RING/);
  assert.match(picker, /function hasDynamicRingScaleControl\(candidate\)/);
  assert.doesNotMatch(
    picker,
    /function hasDynamicRingScaleControl[\s\S]*readDocumentValue\(tokenDocument, 'ring\.subject\.texture'\)/,
  );
  assert.match(picker, /handleScaleResetClick/);
  assert.match(picker, /dataScaleReset/);
  assert.match(
    picker,
    /buildTokenUpdate\(candidate, \{ scale, ringScale, document: tokenDocument \}\)/,
  );
  assert.match(picker, /buildActorUpdate\(candidate, \{ scale, ringScale, actor \}\)/);
});

test('token scale sliders default to the current scene token scale before candidate metadata', async () => {
  class FakeApplicationV2 {}
  const fakeMixin = (BaseApplication) => class FakeHandlebarsApplication extends BaseApplication {};
  const PickerApplication = getTokenPickerApplicationClass(FakeApplicationV2, fakeMixin);
  state.index = [
    {
      id: 'double-scale-art',
      label: 'Double Scale Art',
      moduleId: 'custom',
      moduleTitle: 'Custom',
      scaleX: 1,
      scaleY: 1,
      searchText: 'double scale art custom',
      tokenSrc: 'uploads/tokens/double.webp',
    },
  ];

  try {
    const app = new PickerApplication({
      tokenDocument: {
        texture: {
          scaleX: 2,
          scaleY: 2,
        },
      },
    });
    const context = await app._prepareContext({});
    const [card] = context.sections[0].candidates;

    assert.equal(card.scaleControls[0].target, 'token');
    assert.equal(card.scaleControls[0].value, '2');
  } finally {
    state.index = [];
  }
});

test('actor picker proxy defaults token scale to actor prototype token and hides scene token actions', async () => {
  class FakeApplicationV2 {}
  const fakeMixin = (BaseApplication) => class FakeHandlebarsApplication extends BaseApplication {};
  const PickerApplication = getTokenPickerApplicationClass(FakeApplicationV2, fakeMixin);
  const actor = {
    id: 'actor1',
    name: 'Guard Captain',
    prototypeToken: {
      texture: {
        src: 'actors/guard-token.webp',
        scaleX: 1.75,
        scaleY: 1.75,
      },
    },
  };
  const tokenDocument = createActorTokenDocument(actor);
  state.index = [
    {
      id: 'guard-token',
      label: 'Guard Token',
      moduleId: 'custom',
      moduleTitle: 'Custom',
      scaleX: 1,
      scaleY: 1,
      searchText: 'guard token custom',
      tokenSrc: 'uploads/tokens/guard.webp',
    },
  ];

  try {
    const app = new PickerApplication({ tokenDocument });
    const context = await app._prepareContext({});
    const [card] = context.sections[0].candidates;

    assert.equal(card.scaleControls[0].value, '1.75');
    assert.deepEqual(
      card.actions.map((action) => action.action),
      ['actor', 'portrait'],
    );
  } finally {
    state.index = [];
  }
});

test('player-owned token picker only offers the selected token action', async () => {
  const previousGame = globalThis.game;
  class FakeApplicationV2 {}
  const fakeMixin = (BaseApplication) => class FakeHandlebarsApplication extends BaseApplication {};
  const PickerApplication = getTokenPickerApplicationClass(FakeApplicationV2, fakeMixin);
  state.index = [
    {
      id: 'guard-token',
      label: 'Guard Token',
      moduleId: 'custom',
      moduleTitle: 'Custom',
      scaleX: 1,
      scaleY: 1,
      searchText: 'guard token custom',
      tokenSrc: 'uploads/tokens/guard.webp',
      portraitSrc: 'uploads/portraits/guard.webp',
    },
  ];

  try {
    globalThis.game = {
      user: { id: 'player1', isGM: false },
      settings: { get: () => true },
    };
    const app = new PickerApplication({
      tokenDocument: {
        canUserModify: (user, action) => user.id === 'player1' && action === 'update',
      },
    });
    const context = await app._prepareContext({});
    const [card] = context.sections[0].candidates;

    assert.deepEqual(
      card.actions.map((action) => action.action),
      ['token'],
    );
  } finally {
    state.index = [];
    globalThis.game = previousGame;
  }
});

test('actor picker proxy writes token updates through the actor prototype token', async () => {
  const updates = [];
  const actor = {
    prototypeToken: {
      texture: {
        src: 'old.webp',
        scaleX: 2,
        scaleY: 2,
      },
    },
    async update(update) {
      updates.push(update);
    },
  };
  const tokenDocument = createActorTokenDocument(actor);

  assert.equal(tokenDocument.get('texture.scaleX'), 2);
  await tokenDocument.update({
    'texture.src': 'new.webp',
    'texture.scaleX': 1.5,
    [REVERT_FLAG_PATH]: { label: 'Old Art' },
  });

  assert.deepEqual(updates, [
    {
      'prototypeToken.texture.src': 'new.webp',
      'prototypeToken.texture.scaleX': 1.5,
      [REVERT_FLAG_PATH]: { label: 'Old Art' },
    },
  ]);
});

test('actor sheet Tokener entry renders a top-left image button instead of right-click hook', () => {
  const actorEntry = fs.readFileSync(new URL('../scripts/actor-entry.js', import.meta.url), 'utf8');
  const sheetFunction = actorEntry.slice(
    actorEntry.indexOf('export function renderActorSheetTokenerEntry'),
    actorEntry.indexOf('export function renderActorDirectoryTokenerEntry'),
  );
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');

  assert.match(actorEntry, /pf2e-tokener-actor-sheet-button/);
  assert.match(actorEntry, /installActorSheetTokenerButton/);
  assert.match(actorEntry, /dataset\.tooltip/);
  assert.match(actorEntry, /addEventListener\?\.\('click'/);
  assert.match(actorEntry, /openTokenPickerForActor\(actor\)/);
  assert.doesNotMatch(sheetFunction, /contextmenu/);
  assert.match(css, /\.pf2e-tokener-actor-sheet-image-host\s*\{/);
  assert.match(css, /\.pf2e-tokener-actor-sheet-button\s*\{/);
  assert.match(css, /top:\s*4px;/);
  assert.match(css, /left:\s*4px;/);
});

test('favorite candidate helper toggles ids and filters candidates', async () => {
  let stored = { ids: ['dragon'] };
  const settings = {
    get: () => stored,
    set: async (_moduleId, _key, value) => {
      stored = value;
    },
  };
  const candidates = [
    { id: 'dragon', label: 'Dragon' },
    { id: 'kobold', label: 'Kobold' },
  ];

  await toggleFavoriteCandidate(candidates[1], settings);

  assert.deepEqual(stored, { ids: ['dragon', 'kobold'] });
  assert.deepEqual(
    filterFavoriteCandidates(candidates, getFavoriteIds(settings)).map((candidate) => candidate.id),
    ['dragon', 'kobold'],
  );

  await toggleFavoriteCandidate(candidates[0], settings);

  assert.deepEqual(stored, { ids: ['kobold'] });
  assert.deepEqual(
    filterFavoriteCandidates(candidates, getFavoriteIds(settings)).map((candidate) => candidate.id),
    ['kobold'],
  );
});

test('token update preserves dynamic ring fields when subject art exists', () => {
  const update = buildTokenUpdate({
    tokenSrc: 'modules/pkg/assets/tokens/dragon.webp',
    subjectSrc: 'modules/pkg/assets/subjects/dragon.webp',
    scaleX: 2,
    scaleY: 2,
    subjectScale: 2,
  });

  assert.deepEqual(update, {
    'texture.src': 'modules/pkg/assets/tokens/dragon.webp',
    'texture.scaleX': 2,
    'texture.scaleY': 2,
    'ring.enabled': true,
    'ring.subject.texture': 'modules/pkg/assets/subjects/dragon.webp',
    'ring.subject.scale': 2,
    randomImg: false,
  });
});

test('token update applies separate token and dynamic ring scale overrides', () => {
  const update = buildTokenUpdate(
    {
      tokenSrc: 'modules/pkg/assets/tokens/dragon.webp',
      subjectSrc: 'modules/pkg/assets/subjects/dragon.webp',
      scaleX: 2,
      scaleY: 2,
      subjectScale: 2,
    },
    { scale: 1.35, ringScale: 0.85 },
  );

  assert.equal(update['texture.scaleX'], 1.35);
  assert.equal(update['texture.scaleY'], 1.35);
  assert.equal(update['ring.subject.scale'], 0.85);
});

test('token update applies linked scale override to normal token scale', () => {
  const update = buildTokenUpdate(
    {
      tokenSrc: 'modules/pkg/assets/tokens/dragon.webp',
      scaleX: 2,
      scaleY: 2,
    },
    { scale: 1.35 },
  );

  assert.equal(update['texture.scaleX'], 1.35);
  assert.equal(update['texture.scaleY'], 1.35);
  assert.equal(update['ring.enabled'], false);
});

test('actor update applies separate token and dynamic ring scale overrides', () => {
  const update = buildActorUpdate(
    {
      tokenSrc: 'modules/pkg/assets/tokens/dragon.webp',
      portraitSrc: 'modules/pkg/assets/art/dragon.webp',
      subjectSrc: 'modules/pkg/assets/subjects/dragon.webp',
      scaleX: 2,
      scaleY: 2,
      subjectScale: 2,
    },
    { scale: 0.85, ringScale: 1.4 },
  );

  assert.equal(update['prototypeToken.texture.scaleX'], 0.85);
  assert.equal(update['prototypeToken.texture.scaleY'], 0.85);
  assert.equal(update['prototypeToken.ring.subject.scale'], 1.4);
});

test('invalid linked scale override falls back to candidate scale', () => {
  const update = buildTokenUpdate(
    {
      tokenSrc: 'modules/pkg/assets/tokens/dragon.webp',
      subjectSrc: 'modules/pkg/assets/subjects/dragon.webp',
      scaleX: 1.2,
      scaleY: 1.2,
      subjectScale: 1.4,
    },
    { scale: '' },
  );

  assert.equal(update['texture.scaleX'], 1.2);
  assert.equal(update['texture.scaleY'], 1.2);
  assert.equal(update['ring.subject.scale'], 1.4);
});

test('token scale preview update changes selected normal token scale only', () => {
  assert.deepEqual(
    buildTokenScalePreviewUpdate(
      {
        tokenSrc: 'modules/pkg/assets/tokens/dragon.webp',
      },
      1.45,
    ),
    {
      'texture.scaleX': 1.45,
      'texture.scaleY': 1.45,
    },
  );
});

test('token scale preview update changes candidate dynamic token scale only for token target', () => {
  assert.deepEqual(
    buildTokenScalePreviewUpdate(
      {
        tokenSrc: 'modules/pkg/assets/tokens/dragon.webp',
        subjectSrc: 'modules/pkg/assets/subjects/dragon.webp',
      },
      1.45,
      undefined,
      { target: 'token' },
    ),
    {
      'texture.scaleX': 1.45,
      'texture.scaleY': 1.45,
    },
  );
});

test('token scale preview update changes candidate dynamic ring scale only for ring target', () => {
  assert.deepEqual(
    buildTokenScalePreviewUpdate(
      {
        tokenSrc: 'modules/pkg/assets/tokens/dragon.webp',
        subjectSrc: 'modules/pkg/assets/subjects/dragon.webp',
      },
      1.45,
      undefined,
      { target: 'ring' },
    ),
    {
      'ring.subject.scale': 1.45,
    },
  );
});

test('token scale preview update changes existing dynamic subject scale without candidate subject art', () => {
  assert.deepEqual(
    buildTokenScalePreviewUpdate(
      {
        tokenSrc: 'modules/pkg/assets/tokens/dragon-ring.webp',
      },
      0.8,
      {
        ring: {
          enabled: true,
          subject: {
            texture: 'modules/pkg/assets/subjects/current-dragon.webp',
            scale: 1.4,
          },
        },
      },
      { target: 'ring' },
    ),
    {
      'ring.subject.scale': 0.8,
    },
  );
});

test('token scale preview update skips dynamic ring target when no ring is used', () => {
  assert.deepEqual(
    buildTokenScalePreviewUpdate(
      {
        tokenSrc: 'modules/pkg/assets/tokens/dragon.webp',
      },
      0.8,
      undefined,
      { target: 'ring' },
    ),
    {},
  );
});

test('token update disables dynamic ring when no subject art exists', () => {
  const update = buildTokenUpdate({
    tokenSrc: 'modules/pkg/resources/tokens/dragon.webp',
  });

  assert.deepEqual(update, {
    'texture.src': 'modules/pkg/resources/tokens/dragon.webp',
    'texture.scaleX': 1,
    'texture.scaleY': 1,
    'ring.enabled': false,
    randomImg: false,
  });
});

test('token and revert updates omit dynamic ring fields when the system profile disables rings', () => {
  const profile = { supportsDynamicTokenRing: false };

  assert.deepEqual(
    buildTokenUpdate(
      {
        label: 'Dragon',
        tokenSrc: 'modules/pkg/assets/tokens/dragon.webp',
        subjectSrc: 'modules/pkg/assets/subjects/dragon.webp',
      },
      { profile },
    ),
    {
      'texture.src': 'modules/pkg/assets/tokens/dragon.webp',
      'texture.scaleX': 1,
      'texture.scaleY': 1,
      randomImg: false,
    },
  );
  assert.deepEqual(
    buildTokenRevertUpdate(
      {
        token: {
          texture: { src: 'old-token.webp', scaleX: 1.2, scaleY: 1.3 },
          randomImg: false,
          ring: { enabled: true, subject: { texture: 'old-subject.webp', scale: 1.4 } },
        },
      },
      { profile },
    ),
    {
      'texture.src': 'old-token.webp',
      'texture.scaleX': 1.2,
      'texture.scaleY': 1.3,
      randomImg: false,
    },
  );
});

test('actor update writes prototype token fields and portrait only', () => {
  const update = buildActorUpdate({
    tokenSrc: 'modules/pkg/assets/tokens/dragon.webp',
    portraitSrc: 'modules/pkg/assets/art/dragon.webp',
    subjectSrc: 'modules/pkg/assets/subjects/dragon.webp',
    scaleX: 2,
    scaleY: 2,
    subjectScale: 2,
  });

  assert.deepEqual(update, {
    'prototypeToken.texture.src': 'modules/pkg/assets/tokens/dragon.webp',
    'prototypeToken.texture.scaleX': 2,
    'prototypeToken.texture.scaleY': 2,
    'prototypeToken.ring.enabled': true,
    'prototypeToken.ring.subject.texture': 'modules/pkg/assets/subjects/dragon.webp',
    'prototypeToken.ring.subject.scale': 2,
    'prototypeToken.randomImg': false,
    img: 'modules/pkg/assets/art/dragon.webp',
  });
});

test('portrait update preserves the prototype token source from Foundry automatic portrait syncing', () => {
  const actor = {
    prototypeToken: {
      texture: {
        src: 'systems/pf2e/icons/default-icons/npc.svg',
      },
    },
  };

  assert.deepEqual(
    buildPortraitUpdate(
      {
        tokenSrc: 'modules/pkg/assets/tokens/herbalist.webp',
        portraitSrc: 'modules/pkg/assets/portraits/herbalist.webp',
      },
      actor,
    ),
    {
      img: 'modules/pkg/assets/portraits/herbalist.webp',
      'prototypeToken.texture.src': 'systems/pf2e/icons/default-icons/npc.svg',
    },
  );
});

test('revert snapshot captures previous token, actor, and portrait art before applying changes', () => {
  const tokenDocument = {
    texture: {
      src: 'old-token.webp',
      scaleX: 0.75,
      scaleY: 0.8,
    },
    randomImg: true,
    ring: {
      enabled: true,
      subject: {
        texture: 'old-subject.webp',
        scale: 1.25,
      },
    },
    actor: {
      img: 'old-portrait.webp',
      prototypeToken: {
        texture: {
          src: 'old-prototype-token.webp',
          scaleX: 1.5,
          scaleY: 1.25,
        },
        randomImg: false,
        ring: {
          enabled: false,
          subject: {
            texture: '',
            scale: 1,
          },
        },
      },
    },
  };

  const snapshot = buildRevertSnapshot({
    action: 'both',
    candidate: {
      label: 'New Dragon',
      portraitSrc: 'new-portrait.webp',
      tokenSrc: 'new-token.webp',
    },
    tokenDocument,
  });

  assert.equal(snapshot.action, 'both');
  assert.equal(snapshot.label, 'New Dragon');
  assert.deepEqual(snapshot.token, {
    texture: {
      src: 'old-token.webp',
      scaleX: 0.75,
      scaleY: 0.8,
    },
    randomImg: true,
    ring: {
      enabled: true,
      effects: 1,
      subject: {
        texture: 'old-subject.webp',
        scale: 1.25,
      },
    },
  });
  assert.deepEqual(snapshot.actor.texture, {
    src: 'old-prototype-token.webp',
    scaleX: 1.5,
    scaleY: 1.25,
  });
  assert.deepEqual(snapshot.portrait, {
    img: 'old-portrait.webp',
  });
});

test('revert updates restore token, actor prototype token, and actor portrait fields', () => {
  const snapshot = {
    token: {
      texture: {
        src: 'old-token.webp',
        scaleX: 0.75,
        scaleY: 0.8,
      },
      randomImg: true,
      ring: {
        enabled: false,
        subject: {
          texture: '',
          scale: 1,
        },
      },
    },
    actor: {
      texture: {
        src: 'old-prototype-token.webp',
        scaleX: 1.5,
        scaleY: 1.25,
      },
      randomImg: false,
      ring: {
        enabled: true,
        subject: {
          texture: 'old-prototype-subject.webp',
          scale: 1.4,
        },
      },
    },
    portrait: {
      img: 'old-portrait.webp',
    },
  };

  assert.deepEqual(buildTokenRevertUpdate(snapshot), {
    'texture.src': 'old-token.webp',
    'texture.scaleX': 0.75,
    'texture.scaleY': 0.8,
    randomImg: true,
    'ring.enabled': false,
    'ring.subject.texture': '',
    'ring.subject.scale': 1,
  });
  assert.deepEqual(buildActorRevertUpdate(snapshot), {
    'prototypeToken.texture.src': 'old-prototype-token.webp',
    'prototypeToken.texture.scaleX': 1.5,
    'prototypeToken.texture.scaleY': 1.25,
    'prototypeToken.randomImg': false,
    'prototypeToken.ring.enabled': true,
    'prototypeToken.ring.subject.texture': 'old-prototype-subject.webp',
    'prototypeToken.ring.subject.scale': 1.4,
    img: 'old-portrait.webp',
  });
});

test('portrait-only revert preserves the current prototype token source', () => {
  const snapshot = {
    portrait: {
      img: 'old-portrait.webp',
    },
  };
  const actor = {
    prototypeToken: {
      texture: {
        src: 'current-token.webp',
      },
    },
  };

  assert.deepEqual(buildActorRevertUpdate(snapshot, { actor }), {
    img: 'old-portrait.webp',
    'prototypeToken.texture.src': 'current-token.webp',
  });
});

test('last revert data can be read from selected token or actor flags', () => {
  const tokenSnapshot = { action: 'token', time: 1, token: { texture: { src: 'old-token.webp' } } };
  const actorSnapshot = { action: 'portrait', time: 2, portrait: { img: 'old-portrait.webp' } };

  assert.equal(
    getLastRevertData({
      flags: {
        'pf2e-tokener': {
          lastRevert: tokenSnapshot,
        },
      },
      actor: {
        flags: {
          'pf2e-tokener': {
            lastRevert: actorSnapshot,
          },
        },
      },
    }),
    actorSnapshot,
  );
  assert.equal(
    getLastRevertData({
      actor: {
        flags: {
          'pf2e-tokener': {
            lastRevert: actorSnapshot,
          },
        },
      },
    }),
    actorSnapshot,
  );
});

test('revert history pops newest token snapshot until original art is restored', async () => {
  const originalSnapshot = {
    action: 'token',
    label: 'Red Dragon',
    time: 1,
    token: {
      texture: { src: 'original-token.webp', scaleX: 1, scaleY: 1 },
      randomImg: true,
      ring: { enabled: false, subject: { texture: '', scale: 1 } },
    },
  };
  const redSnapshot = {
    action: 'token',
    label: 'Blue Dragon',
    time: 2,
    token: {
      texture: { src: 'red-token.webp', scaleX: 1.2, scaleY: 1.2 },
      randomImg: false,
      ring: { enabled: true, subject: { texture: 'red-subject.webp', scale: 1.4 } },
    },
  };
  const updates = [];
  const tokenDocument = {
    flags: {
      'pf2e-tokener': {
        lastRevert: [originalSnapshot, redSnapshot],
      },
    },
    async update(update) {
      updates.push(update);
      this.flags['pf2e-tokener'].lastRevert = update[REVERT_FLAG_PATH];
    },
  };

  assert.equal(getLastRevertData(tokenDocument), redSnapshot);
  assert.equal(await revertLastTokenerChange(tokenDocument), true);
  assert.deepEqual(updates[0], {
    'texture.src': 'red-token.webp',
    'texture.scaleX': 1.2,
    'texture.scaleY': 1.2,
    randomImg: false,
    'ring.enabled': true,
    'ring.subject.texture': 'red-subject.webp',
    'ring.subject.scale': 1.4,
    [REVERT_FLAG_PATH]: [originalSnapshot],
  });

  assert.equal(getLastRevertData(tokenDocument), originalSnapshot);
  assert.equal(await revertLastTokenerChange(tokenDocument), true);
  assert.deepEqual(updates[1], {
    'texture.src': 'original-token.webp',
    'texture.scaleX': 1,
    'texture.scaleY': 1,
    randomImg: true,
    'ring.enabled': false,
    'ring.subject.texture': '',
    'ring.subject.scale': 1,
    [REVERT_FLAG_PATH]: null,
  });
  assert.equal(getLastRevertData(tokenDocument), null);
});

test('revert history can jump to a specific token snapshot and discard newer history', async () => {
  const originalSnapshot = {
    action: 'token',
    label: 'Red Dragon',
    time: 1,
    token: {
      texture: { src: 'original-token.webp', scaleX: 1, scaleY: 1 },
      randomImg: true,
      ring: { enabled: false, subject: { texture: '', scale: 1 } },
    },
  };
  const redSnapshot = {
    action: 'token',
    label: 'Blue Dragon',
    time: 2,
    token: {
      texture: { src: 'red-token.webp', scaleX: 1.2, scaleY: 1.2 },
      randomImg: false,
      ring: { enabled: true, subject: { texture: 'red-subject.webp', scale: 1.4 } },
    },
  };
  const blueSnapshot = {
    action: 'token',
    label: 'Green Dragon',
    time: 3,
    token: {
      texture: { src: 'blue-token.webp', scaleX: 0.9, scaleY: 0.9 },
      randomImg: false,
      ring: { enabled: true, subject: { texture: 'blue-subject.webp', scale: 1.1 } },
    },
  };
  const updates = [];
  const tokenDocument = {
    flags: {
      'pf2e-tokener': {
        lastRevert: [originalSnapshot, redSnapshot, blueSnapshot],
      },
    },
    async update(update) {
      updates.push(update);
      this.flags['pf2e-tokener'].lastRevert = update[REVERT_FLAG_PATH];
    },
  };

  assert.deepEqual(
    getRevertHistoryEntries(tokenDocument).map((entry) => entry.snapshot),
    [blueSnapshot, redSnapshot, originalSnapshot],
  );
  assert.equal(await revertTokenerChangeToSnapshot(tokenDocument, redSnapshot), true);
  assert.deepEqual(updates[0], {
    'texture.src': 'red-token.webp',
    'texture.scaleX': 1.2,
    'texture.scaleY': 1.2,
    randomImg: false,
    'ring.enabled': true,
    'ring.subject.texture': 'red-subject.webp',
    'ring.subject.scale': 1.4,
    [REVERT_FLAG_PATH]: [originalSnapshot],
  });
  assert.deepEqual(tokenDocument.flags['pf2e-tokener'].lastRevert, [originalSnapshot]);
});

test('revert history reset restores the original token snapshot', async () => {
  const originalSnapshot = {
    action: 'token',
    label: 'Red Dragon',
    time: 1,
    token: {
      texture: { src: 'original-token.webp', scaleX: 1, scaleY: 1 },
      randomImg: true,
      ring: { enabled: false, subject: { texture: '', scale: 1 } },
    },
  };
  const laterSnapshot = {
    action: 'token',
    label: 'Blue Dragon',
    time: 2,
    token: {
      texture: { src: 'later-token.webp', scaleX: 1.2, scaleY: 1.2 },
      randomImg: false,
      ring: { enabled: true, subject: { texture: 'later-subject.webp', scale: 1.4 } },
    },
  };
  const updates = [];
  const tokenDocument = {
    flags: {
      'pf2e-tokener': {
        lastRevert: [originalSnapshot, laterSnapshot],
      },
    },
    async update(update) {
      updates.push(update);
      this.flags['pf2e-tokener'].lastRevert = update[REVERT_FLAG_PATH];
    },
  };

  assert.equal(await revertTokenerChangeToOriginal(tokenDocument), true);
  assert.deepEqual(updates[0], {
    'texture.src': 'original-token.webp',
    'texture.scaleX': 1,
    'texture.scaleY': 1,
    randomImg: true,
    'ring.enabled': false,
    'ring.subject.texture': '',
    'ring.subject.scale': 1,
    [REVERT_FLAG_PATH]: null,
  });
});

test('revert history dialog restores the selected token snapshot', async () => {
  const previousFoundry = globalThis.foundry;
  const previousUi = globalThis.ui;
  const originalSnapshot = {
    action: 'token',
    label: 'Red Dragon',
    time: 1,
    token: {
      texture: { src: 'original-token.webp', scaleX: 1, scaleY: 1 },
      randomImg: true,
      ring: { enabled: false, subject: { texture: '', scale: 1 } },
    },
  };
  const redSnapshot = {
    action: 'token',
    label: 'Blue Dragon',
    time: 2,
    token: {
      texture: { src: 'red-token.webp', scaleX: 1.2, scaleY: 1.2 },
      randomImg: false,
      ring: { enabled: true, subject: { texture: 'red-subject.webp', scale: 1.4 } },
    },
  };
  const blueSnapshot = {
    action: 'token',
    label: 'Green Dragon',
    time: 3,
    token: {
      texture: { src: 'blue-token.webp', scaleX: 0.9, scaleY: 0.9 },
      randomImg: false,
      ring: { enabled: true, subject: { texture: 'blue-subject.webp', scale: 1.1 } },
    },
  };
  const updates = [];
  let dialogClosed = false;
  let onReverted = false;
  const tokenDocument = {
    flags: {
      'pf2e-tokener': {
        lastRevert: [originalSnapshot, redSnapshot, blueSnapshot],
      },
    },
    async update(update) {
      updates.push(update);
      this.flags['pf2e-tokener'].lastRevert = update[REVERT_FLAG_PATH];
    },
  };

  try {
    globalThis.ui = { notifications: { info() {}, error() {} } };
    globalThis.foundry = {
      applications: {
        api: {
          DialogV2: {
            input: async (options) => {
              assert.match(options.content, /pf2e-tokener-revert-history-image/);
              assert.match(options.content, /src="blue-token\.webp"/);
              assert.match(options.content, /Blue Token/);
              assert.match(options.content, /src="red-token\.webp"/);
              assert.match(options.content, /Red Token/);
              const listeners = {};
              const root = {
                dataset: {},
                nodeType: 1,
                addEventListener: (type, listener) => {
                  listeners[type] = listener;
                },
              };
              options.render(null, {
                element: root,
                close: () => {
                  dialogClosed = true;
                },
              });
              await listeners.click({
                target: {
                  dataset: { revertIndex: '1' },
                  closest: (selector) =>
                    selector === '[data-revert-index]' ? { dataset: { revertIndex: '1' } } : null,
                },
                preventDefault() {},
              });
            },
          },
        },
      },
    };

    assert.equal(
      await openRevertHistoryDialog(tokenDocument, {
        onReverted: () => {
          onReverted = true;
        },
      }),
      true,
    );
    assert.deepEqual(updates[0], {
      'texture.src': 'red-token.webp',
      'texture.scaleX': 1.2,
      'texture.scaleY': 1.2,
      randomImg: false,
      'ring.enabled': true,
      'ring.subject.texture': 'red-subject.webp',
      'ring.subject.scale': 1.4,
      [REVERT_FLAG_PATH]: [originalSnapshot],
    });
    assert.equal(dialogClosed, true);
    assert.equal(onReverted, true);
  } finally {
    globalThis.foundry = previousFoundry;
    globalThis.ui = previousUi;
  }
});

test('HUD apply actions include separate token, actor, portrait, and both choices', () => {
  assert.deepEqual(
    getApplyActions().map((action) => action.action),
    ['token', 'actor', 'portrait', 'both'],
  );
});

test('HUD apply actions include user-facing tooltips', () => {
  assert.deepEqual(
    getApplyActions().map((action) => action.tooltip),
    [
      'Update only the selected token on this scene.',
      'Update the actor portrait and default token art.',
      'Update only the actor portrait.',
      'Update the selected token and the actor default token art.',
    ],
  );
});

test('candidate apply actions only show buttons backed by usable image data', () => {
  assert.deepEqual(
    getApplyActionsForCandidate({ tokenSrc: 'token.webp', portraitSrc: 'portrait.webp' }).map(
      (action) => action.action,
    ),
    ['token', 'actor', 'portrait', 'both'],
  );
  assert.deepEqual(
    getApplyActionsForCandidate({ tokenSrc: 'token.webp' }).map((action) => action.action),
    ['token', 'actor', 'portrait', 'both'],
  );
  assert.deepEqual(
    getApplyActionsForCandidate({ portraitSrc: 'portrait.webp' }).map((action) => action.action),
    ['portrait'],
  );
  assert.deepEqual(
    getApplyActionsForCandidate({}).map((action) => action.action),
    [],
  );
});

test('candidate preview sources fall back across token, portrait, and subject art', () => {
  assert.deepEqual(
    getCandidatePreviewSources({
      tokenSrc: 'token.webp',
      portraitSrc: 'portrait.webp',
      subjectSrc: 'subject.webp',
    }),
    ['token.webp', 'portrait.webp', 'subject.webp'],
  );
  assert.deepEqual(
    getCandidatePreviewSources({
      tokenSrc: 'shared.webp',
      portraitSrc: 'shared.webp',
      subjectSrc: 'subject.webp',
    }),
    ['shared.webp', 'subject.webp'],
  );
  assert.deepEqual(getCandidatePreviewSources({}), []);
});

test('apply target helper keeps Actor separate from selected Token', () => {
  assert.deepEqual(getApplyTargets('token'), { token: true, actor: false, portrait: false });
  assert.deepEqual(getApplyTargets('actor'), { token: false, actor: true, portrait: false });
  assert.deepEqual(getApplyTargets('portrait'), { token: false, actor: false, portrait: true });
  assert.deepEqual(getApplyTargets('both'), { token: true, actor: true, portrait: false });
});

test('HUD adapter accepts HTMLElement and jQuery-like wrappers', () => {
  const element = { nodeType: 1 };
  assert.equal(normalizeHudElement(element), element);
  assert.equal(normalizeHudElement([element]), element);
  assert.equal(normalizeHudElement({ 0: element, length: 1 }), element);
});

test('player-owned Token HUD button stays hidden when player access setting is disabled', () => {
  const previousDocument = globalThis.document;
  const previousGame = globalThis.game;
  const { root, target } = createFakeHudRoot();

  try {
    globalThis.document = { createElement: createFakeElement };
    globalThis.game = {
      user: { id: 'player1', isGM: false },
      settings: { get: () => false },
    };

    renderTokenHud(
      {
        object: {
          document: {
            canUserModify: (user, action) => user.id === 'player1' && action === 'update',
          },
        },
      },
      root,
    );

    assert.equal(
      target.children.some((child) => child.className.includes('pf2e-tokener-button')),
      false,
    );
  } finally {
    globalThis.document = previousDocument;
    globalThis.game = previousGame;
  }
});

test('Token HUD button renders for players who can update the token when enabled', () => {
  const previousDocument = globalThis.document;
  const previousGame = globalThis.game;
  const { root, target } = createFakeHudRoot();

  try {
    globalThis.document = { createElement: createFakeElement };
    globalThis.game = {
      user: { id: 'player1', isGM: false },
      settings: { get: () => true },
    };

    renderTokenHud(
      {
        object: {
          document: {
            canUserModify: (user, action) => user.id === 'player1' && action === 'update',
          },
        },
      },
      root,
    );

    assert.equal(
      target.children.some((child) => child.className.includes('pf2e-tokener-button')),
      true,
    );
  } finally {
    globalThis.document = previousDocument;
    globalThis.game = previousGame;
  }
});

test('actor sheet Tokener button stays hidden for player-owned actors', () => {
  const previousGame = globalThis.game;
  const host = createFakeElement();
  const image = createFakeElement();
  const root = createFakeElement();
  const addedClasses = [];
  const actor = {
    canUserModify: (user, action) => user.id === 'player1' && action === 'update',
  };

  try {
    globalThis.game = {
      user: { id: 'player1', isGM: false },
      settings: { get: () => true },
    };
    root.ownerDocument = { createElement: createFakeElement };
    root.querySelector = () => image;
    image.closest = () => host;
    host.querySelector = () => null;
    host.classList = {
      add: (className) => addedClasses.push(className),
    };

    renderActorSheetTokenerEntry({ actor }, root);

    assert.deepEqual(addedClasses, []);
    assert.equal(
      host.children.some((child) => child.className.includes('pf2e-tokener-actor-sheet-button')),
      false,
    );
  } finally {
    globalThis.game = previousGame;
  }
});

test('actor directory Tokener listener stays GM-only', () => {
  const previousGame = globalThis.game;
  const root = createFakeElement();
  const actor = {
    canUserModify: (user, action) => user.id === 'player1' && action === 'update',
  };

  try {
    globalThis.game = {
      user: { id: 'player1', isGM: false },
      settings: { get: () => true },
      actors: {
        get: (id) => (id === 'actor1' ? actor : null),
      },
    };

    renderActorDirectoryTokenerEntry(null, root);

    assert.equal(root.dataset.pf2eTokenerActorDirectoryBound, undefined);
    assert.equal(typeof root.listeners.contextmenu, 'undefined');
  } finally {
    globalThis.game = previousGame;
  }
});

test('player Tokener access setting registers as GM-configurable world setting', () => {
  const calls = [];
  const settings = {
    register: (...args) => calls.push(args),
  };

  registerPermissionSettings(settings);

  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'pf2e-tokener');
  assert.equal(calls[0][1], 'allowPlayerOwnedTokens');
  assert.equal(calls[0][2].scope, 'world');
  assert.equal(calls[0][2].config, true);
  assert.equal(calls[0][2].type, Boolean);
  assert.equal(calls[0][2].default, false);
  assert.equal(calls[1][1], 'showTokenHudButton');
  assert.equal(calls[1][2].scope, 'client');
  assert.equal(calls[1][2].default, true);
});

test('Token HUD button is removed when the user hides it', () => {
  const previousDocument = globalThis.document;
  const previousGame = globalThis.game;
  const { root, target } = createFakeHudRoot();
  const hud = { object: { document: { canUserModify: () => true } } };
  let show = true;
  root.querySelectorAll = (selector) =>
    selector === '.pf2e-tokener-button'
      ? target.children
          .filter((child) => child.className.includes('pf2e-tokener-button'))
          .map((child) => ({
            remove: () => target.children.splice(target.children.indexOf(child), 1),
          }))
      : [];

  try {
    globalThis.document = { createElement: createFakeElement };
    globalThis.game = {
      user: { id: 'gm', isGM: true },
      settings: { get: (_module, key) => (key === 'showTokenHudButton' ? show : false) },
    };
    renderTokenHud(hud, root);
    const hasButton = () =>
      target.children.some((child) => child.className.includes('pf2e-tokener-button'));
    assert.equal(hasButton(), true);

    show = false;
    renderTokenHud(hud, root);
    assert.equal(hasButton(), false);
  } finally {
    globalThis.document = previousDocument;
    globalThis.game = previousGame;
  }
});

test('GM Token HUD button opens ApplicationV2 picker instead of HUD child panel', async () => {
  const previousDocument = globalThis.document;
  const previousFoundry = globalThis.foundry;
  const previousGame = globalThis.game;
  const { root, target } = createFakeHudRoot();
  const tokenDocument = {
    actor: { testUserPermission: () => true },
    canUserModify: () => true,
  };
  const instances = [];
  let mixinCalled = false;

  class FakeApplicationV2 {
    constructor(options) {
      this.options = options;
      instances.push(this);
    }

    render(force) {
      this.force = force;
      return Promise.resolve(this);
    }
  }

  const fakeMixin = (BaseApplication) => {
    mixinCalled = true;
    return class FakeHandlebarsApplication extends BaseApplication {};
  };

  try {
    globalThis.document = { createElement: createFakeElement };
    globalThis.foundry = {
      applications: {
        api: {
          ApplicationV2: FakeApplicationV2,
          HandlebarsApplicationMixin: fakeMixin,
        },
      },
    };
    globalThis.game = { user: { id: 'gm1', isGM: true } };

    renderTokenHud({ object: { document: tokenDocument } }, root);
    const button = target.children.find((child) => child.className.includes('pf2e-tokener-button'));
    await button.listeners.click({
      preventDefault() {},
      stopPropagation() {},
    });

    assert.equal(instances.length, 1);
    assert.equal(mixinCalled, true);
    assert.equal(instances[0].tokenDocument, tokenDocument);
    assert.equal(instances[0].force, true);
    assert.equal(
      root.children.some((child) => child.className.includes('pf2e-tokener-panel')),
      false,
    );
  } finally {
    globalThis.document = previousDocument;
    globalThis.foundry = previousFoundry;
    globalThis.game = previousGame;
  }
});

test('Token HUD button highlights when Tokener override can be reverted', () => {
  const previousDocument = globalThis.document;
  const previousGame = globalThis.game;
  const { root, target } = createFakeHudRoot();
  const tokenDocument = {
    canUserModify: () => true,
    flags: {
      'pf2e-tokener': {
        lastRevert: {
          token: {
            texture: { src: 'old.webp', scaleX: 1, scaleY: 1 },
            randomImg: false,
            ring: { enabled: false, subject: { texture: '', scale: 1 } },
          },
        },
      },
    },
  };

  try {
    globalThis.document = { createElement: createFakeElement };
    globalThis.game = { user: { id: 'gm1', isGM: true } };

    renderTokenHud({ object: { document: tokenDocument } }, root);
    const button = target.children.find((child) => child.className.includes('pf2e-tokener-button'));

    assert.match(button.className, /is-overridden/);
    assert.equal(button.dataset.tooltip, 'Tokener - right-click to revert last change.');
  } finally {
    globalThis.document = previousDocument;
    globalThis.game = previousGame;
  }
});

test('right-clicking active Token HUD button reverts last Tokener change', async () => {
  const previousDocument = globalThis.document;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const { root, target } = createFakeHudRoot();
  const tokenUpdates = [];
  const actorUpdates = [];
  const messages = [];
  const snapshot = {
    action: 'both',
    label: 'Dragon',
    token: {
      texture: { src: 'old-token.webp', scaleX: 1.2, scaleY: 1.3 },
      randomImg: false,
      ring: { enabled: true, subject: { texture: 'old-subject.webp', scale: 1.4 } },
    },
    actor: {
      texture: { src: 'old-prototype.webp', scaleX: 0.9, scaleY: 0.8 },
      randomImg: false,
      ring: { enabled: false, subject: { texture: '', scale: 1 } },
    },
    portrait: { img: 'old-portrait.webp' },
    time: 10,
  };
  const tokenDocument = {
    actor: {
      flags: {
        'pf2e-tokener': {
          lastRevert: snapshot,
        },
      },
      async update(update) {
        actorUpdates.push(update);
        this.flags['pf2e-tokener'].lastRevert = update[REVERT_FLAG_PATH];
      },
    },
    canUserModify: () => true,
    flags: {
      'pf2e-tokener': {
        lastRevert: snapshot,
      },
    },
    async update(update) {
      tokenUpdates.push(update);
      this.flags['pf2e-tokener'].lastRevert = update[REVERT_FLAG_PATH];
    },
  };

  try {
    globalThis.document = { createElement: createFakeElement };
    globalThis.game = { user: { id: 'gm1', isGM: true } };
    globalThis.ui = {
      notifications: {
        info: (message) => messages.push(message),
        error: (message) => messages.push(message),
      },
    };

    renderTokenHud({ object: { document: tokenDocument } }, root);
    const button = target.children.find((child) => child.className.includes('pf2e-tokener-button'));
    await button.listeners.contextmenu({
      preventDefault() {},
      stopPropagation() {},
    });

    assert.deepEqual(tokenUpdates, [
      {
        'texture.src': 'old-token.webp',
        'texture.scaleX': 1.2,
        'texture.scaleY': 1.3,
        randomImg: false,
        'ring.enabled': true,
        'ring.subject.texture': 'old-subject.webp',
        'ring.subject.scale': 1.4,
        [REVERT_FLAG_PATH]: null,
      },
    ]);
    assert.deepEqual(actorUpdates, [
      {
        'prototypeToken.texture.src': 'old-prototype.webp',
        'prototypeToken.texture.scaleX': 0.9,
        'prototypeToken.texture.scaleY': 0.8,
        'prototypeToken.randomImg': false,
        'prototypeToken.ring.enabled': false,
        'prototypeToken.ring.subject.texture': '',
        'prototypeToken.ring.subject.scale': 1,
        img: 'old-portrait.webp',
        [REVERT_FLAG_PATH]: null,
      },
    ]);
    assert.deepEqual(messages, ['Tokener: previous art restored.']);
    assert.doesNotMatch(button.className, /is-overridden/);
    assert.equal(button.dataset.tooltip, 'Tokener');
  } finally {
    globalThis.document = previousDocument;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
  }
});

test('Token HUD right-click opens history dialog when multiple revert entries exist', () => {
  const hud = fs.readFileSync(new URL('../scripts/hud.js', import.meta.url), 'utf8');

  assert.match(hud, /getRevertHistoryEntries/);
  assert.match(hud, /openRevertHistoryDialog/);
});

test('shift-right-clicking Token HUD button reverts original history entry', async () => {
  const previousDocument = globalThis.document;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const { root, target } = createFakeHudRoot();
  const originalSnapshot = {
    action: 'token',
    label: 'Original',
    time: 1,
    token: {
      texture: { src: 'original-token.webp', scaleX: 1, scaleY: 1 },
      randomImg: true,
      ring: { enabled: false, subject: { texture: '', scale: 1 } },
    },
  };
  const laterSnapshot = {
    action: 'token',
    label: 'Later',
    time: 2,
    token: {
      texture: { src: 'later-token.webp', scaleX: 1.5, scaleY: 1.5 },
      randomImg: false,
      ring: { enabled: true, subject: { texture: 'later-subject.webp', scale: 1.25 } },
    },
  };
  const updates = [];
  const messages = [];
  const tokenDocument = {
    canUserModify: () => true,
    flags: {
      'pf2e-tokener': {
        lastRevert: [originalSnapshot, laterSnapshot],
      },
    },
    async update(update) {
      updates.push(update);
      this.flags['pf2e-tokener'].lastRevert = update[REVERT_FLAG_PATH];
    },
  };

  try {
    globalThis.document = { createElement: createFakeElement };
    globalThis.game = { user: { id: 'gm1', isGM: true } };
    globalThis.ui = {
      notifications: {
        info: (message) => messages.push(message),
        error: (message) => messages.push(message),
      },
    };

    renderTokenHud({ object: { document: tokenDocument } }, root);
    const button = target.children.find((child) => child.className.includes('pf2e-tokener-button'));
    await button.listeners.contextmenu({
      shiftKey: true,
      preventDefault() {},
      stopPropagation() {},
    });

    assert.deepEqual(updates, [
      {
        'texture.src': 'original-token.webp',
        'texture.scaleX': 1,
        'texture.scaleY': 1,
        randomImg: true,
        'ring.enabled': false,
        'ring.subject.texture': '',
        'ring.subject.scale': 1,
        [REVERT_FLAG_PATH]: null,
      },
    ]);
    assert.deepEqual(messages, ['Tokener: previous art restored.']);
    assert.doesNotMatch(button.className, /is-overridden/);
  } finally {
    globalThis.document = previousDocument;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
  }
});

test('Token picker ApplicationV2 uses Handlebars template parts', () => {
  let mixinCalled = false;
  class FakeApplicationV2 {}
  const fakeMixin = (BaseApplication) => {
    mixinCalled = true;
    return class FakeHandlebarsApplication extends BaseApplication {};
  };

  const PickerApplication = getTokenPickerApplicationClass(FakeApplicationV2, fakeMixin);

  assert.equal(mixinCalled, true);
  assert.equal(PickerApplication.PARTS.main.template, 'modules/pf2e-tokener/templates/picker.hbs');
  assert.match(PickerApplication.prototype._prepareContext.toString(), /preparePickerContext/);
  assert.match(PickerApplication.prototype._onRender.toString(), /activatePickerListeners/);
  assert.equal(typeof PickerApplication.prototype._attachPartListeners, 'function');
  assert.match(
    PickerApplication.prototype._attachPartListeners.toString(),
    /activatePickerListeners\(this, html\)/,
  );
  assert.match(
    fs.readFileSync(new URL('../scripts/picker-app.js', import.meta.url), 'utf8'),
    /dataset\.pf2eTokenerBound/,
  );
});

test('Token picker search input starts empty instead of using the token name', () => {
  class FakeApplicationV2 {}
  const fakeMixin = (BaseApplication) => class FakeHandlebarsApplication extends BaseApplication {};
  const PickerApplication = getTokenPickerApplicationClass(FakeApplicationV2, fakeMixin);
  const app = new PickerApplication({
    tokenDocument: {
      actor: { name: 'Blue Dragon (Adult)' },
    },
  });

  assert.equal(app.searchQuery, '');
});

test('Token picker grid size setting defaults to 54px and clamps stored values', async () => {
  const {
    DEFAULT_PICKER_GRID_SIZE,
    MAX_PICKER_GRID_SIZE,
    MIN_PICKER_GRID_SIZE,
    getPickerGridMinSize,
    getPickerGridSize,
    normalizePickerGridSize,
    registerPickerGridSizeSetting,
    setPickerGridSize,
  } = await import('../scripts/grid-size.js');
  const registered = [];
  const writes = [];
  const settings = {
    get: () => 91,
    register: (...args) => registered.push(args),
    set: async (...args) => writes.push(args),
  };

  registerPickerGridSizeSetting(settings);
  await setPickerGridSize(500, settings);

  assert.equal(DEFAULT_PICKER_GRID_SIZE, 54);
  assert.equal(MIN_PICKER_GRID_SIZE, 40);
  assert.equal(MAX_PICKER_GRID_SIZE, 200);
  assert.equal(normalizePickerGridSize(91), 92);
  assert.equal(getPickerGridSize(settings), 92);
  assert.equal(getPickerGridMinSize(DEFAULT_PICKER_GRID_SIZE), 104);
  assert.deepEqual(registered[0].slice(0, 2), ['pf2e-tokener', 'pickerGridSize']);
  assert.equal(registered[0][2].scope, 'client');
  assert.equal(registered[0][2].config, false);
  assert.equal(registered[0][2].default, DEFAULT_PICKER_GRID_SIZE);
  assert.deepEqual(writes[0], ['pf2e-tokener', 'pickerGridSize', MAX_PICKER_GRID_SIZE]);
});

test('Token picker source controls use delegated listeners across part re-renders', () => {
  class FakeApplicationV2 {}
  const fakeMixin = (BaseApplication) => class FakeHandlebarsApplication extends BaseApplication {};
  const PickerApplication = getTokenPickerApplicationClass(FakeApplicationV2, fakeMixin);
  const app = new PickerApplication({});
  const listeners = {};
  const renders = [];
  const root = {
    dataset: {},
    nodeType: 1,
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
    querySelector: () => null,
  };

  app.selectedSourceIds = new Set();
  app.sourceOptions = [{ id: 'bestiary' }, { id: 'draconic' }];
  app.render = (options) => renders.push(options);

  app._attachPartListeners('main', root);
  app._attachPartListeners('main', root);

  listeners.click({
    target: {
      dataset: { sourceAction: 'all' },
      closest(selector) {
        return selector === '[data-source-action]' ? this : null;
      },
    },
    preventDefault() {},
    stopPropagation() {},
  });

  assert.deepEqual([...app.selectedSourceIds], ['bestiary', 'draconic']);

  listeners.click({
    target: {
      dataset: { sourceAction: 'clear' },
      closest(selector) {
        return selector === '[data-source-action]' ? this : null;
      },
    },
    preventDefault() {},
    stopPropagation() {},
  });

  assert.deepEqual([...app.selectedSourceIds], []);

  listeners.click({
    target: {
      dataset: { sourceId: 'bestiary' },
      closest(selector) {
        return selector === '.pf2e-tokener-source-option[data-source-id]' ? this : null;
      },
    },
    preventDefault() {},
    stopPropagation() {},
  });

  assert.deepEqual([...app.selectedSourceIds], ['bestiary']);

  listeners.click({
    target: {
      dataset: { sourceId: 'bestiary' },
      closest(selector) {
        return selector === '.pf2e-tokener-source-option[data-source-id]' ? this : null;
      },
    },
    preventDefault() {},
    stopPropagation() {},
  });

  assert.deepEqual([...app.selectedSourceIds], []);
  assert.deepEqual(renders, [
    { parts: ['main'] },
    { parts: ['main'] },
    { parts: ['main'] },
    { parts: ['main'] },
  ]);
});

test('Token HUD button stays hidden for players without token or actor ownership', () => {
  const previousDocument = globalThis.document;
  const previousGame = globalThis.game;
  const { root, target } = createFakeHudRoot();

  try {
    globalThis.document = { createElement: createFakeElement };
    globalThis.game = { user: { id: 'player1', isGM: false } };

    renderTokenHud(
      {
        object: {
          document: {
            actor: {
              testUserPermission: () => false,
            },
            canUserModify: () => false,
          },
        },
      },
      root,
    );

    assert.equal(
      target.children.some((child) => child.className.includes('pf2e-tokener-button')),
      false,
    );
  } finally {
    globalThis.document = previousDocument;
    globalThis.game = previousGame;
  }
});

test('module manifest declares English localization file', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../module.json', import.meta.url), 'utf8'));

  assert.deepEqual(manifest.languages, [
    {
      lang: 'en',
      name: 'English',
      path: 'languages/en.json',
    },
  ]);
});

test('module manifest is system agnostic while keeping the stable module id', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../module.json', import.meta.url), 'utf8'));

  assert.equal(manifest.id, 'pf2e-tokener');
  assert.equal(manifest.title, 'Tokener');
  assert.doesNotMatch(manifest.description, /PF2e|Pathfinder/i);
  assert.equal(manifest.relationships?.systems, undefined);
});

test('ready hook no longer skips non-PF2e systems', () => {
  const script = fs.readFileSync(new URL('../scripts/pf2e-tokener.js', import.meta.url), 'utf8');

  assert.doesNotMatch(script, /system\?\.id\s*!==\s*['"]pf2e['"]/);
  assert.doesNotMatch(
    script,
    /hooks\.once\('ready', async \(\) => \{[\s\S]*?await rebuildIndex\(\)/,
  );
  assert.match(script, /installApi\(\);/);
  assert.match(script, /'renderActorSheet'/);
  assert.match(script, /hooks\.on\(hook, renderActorSheetTokenerEntry\)/);
  assert.match(script, /'renderNPCSheetPF2e'/);
  assert.match(script, /hooks\.on\('renderActorDirectory', renderActorDirectoryTokenerEntry\)/);
});

test('release archive zip command has valid shell continuations', () => {
  const workflow = fs.readFileSync(
    new URL('../.github/workflows/main.yml', import.meta.url),
    'utf8',
  );
  const lines = workflow.split(/\r?\n/);

  assert.equal(lines.filter((line) => /\\\s+$/.test(line)).length, 0);
  assert.match(workflow, /\sstyles\/\s*\\$/m);
  assert.match(workflow, /\slanguages\/\s*\\$/m);
  assert.match(workflow, /\smodels\/\s*$/m);
  assert.match(
    workflow,
    /"compatibility": \{ "minimum": "13", "verified": "14", "maximum": "14" \}/,
  );
});

test('English localization file contains Token HUD strings', () => {
  const translations = JSON.parse(
    fs.readFileSync(new URL('../languages/en.json', import.meta.url), 'utf8'),
  );

  assert.equal(translations['PF2ETokener.HUD.Tooltip'], 'Tokener');
  assert.equal(
    translations['PF2ETokener.HUD.RevertButtonTooltip'],
    'Tokener - right-click to revert last change.',
  );
  assert.equal(translations['PF2ETokener.HUD.ActorSheetButtonTooltip'], 'Open Tokener');
  assert.equal(translations['PF2ETokener.HUD.SearchPlaceholder'], 'Search tokens');
  assert.equal(translations['PF2ETokener.HUD.AllSources'], 'All sources');
  assert.equal(translations['PF2ETokener.HUD.NoSources'], 'No sources');
  assert.equal(translations['PF2ETokener.HUD.SourcesSelected'], '{count} sources');
  assert.equal(translations['PF2ETokener.HUD.SelectAllSources'], 'Select all');
  assert.equal(translations['PF2ETokener.HUD.ClearSources'], 'Clear all');
  assert.equal(translations['PF2ETokener.HUD.SourceSearchPlaceholder'], 'Search sources');
  assert.equal(translations['PF2ETokener.HUD.Filters'], 'Filters');
  assert.equal(translations['PF2ETokener.HUD.Tags'], 'Tags');
  assert.equal(translations['PF2ETokener.HUD.TagSearchPlaceholder'], 'Search tags');
  assert.equal(translations['PF2ETokener.HUD.ClearTags'], 'Clear tags');
  assert.equal(translations['PF2ETokener.HUD.ResetTags'], undefined);
  assert.equal(translations['PF2ETokener.HUD.IncludeTag'], 'Include tag');
  assert.equal(translations['PF2ETokener.HUD.ExcludeTag'], 'Exclude tag');
  assert.equal(translations['PF2ETokener.HUD.Favorites'], 'Favorites');
  assert.equal(translations['PF2ETokener.HUD.FavoritesTooltip'], 'Show only favorite token art.');
  assert.equal(translations['PF2ETokener.HUD.AddFavorite'], 'Add favorite');
  assert.equal(translations['PF2ETokener.HUD.RemoveFavorite'], 'Remove favorite');
  assert.equal(translations['PF2ETokener.HUD.EditCustomImageTags'], 'Edit image tags');
  assert.equal(translations['PF2ETokener.HUD.SaveImageTags'], 'Save tags');
  assert.equal(
    translations['PF2ETokener.HUD.CustomImageTagsHint'],
    'Choose GM tags to add to this image. Original source tags are read-only.',
  );
  assert.equal(translations['PF2ETokener.HUD.SelectedImageTags'], 'Selected tags');
  assert.equal(translations['PF2ETokener.HUD.ImageTagsJson'], 'Import / export JSON');
  assert.equal(
    translations['PF2ETokener.HUD.ImageTagsJsonHint'],
    'Per-image JSON uses only GM-added tags. Source tags stay read-only.',
  );
  assert.equal(translations['PF2ETokener.HUD.ExportImageTags'], 'Export JSON');
  assert.equal(translations['PF2ETokener.HUD.ImportImageTags'], 'Import JSON');
  assert.equal(translations['PF2ETokener.HUD.GridSize'], 'Size');
  assert.equal(translations['PF2ETokener.HUD.GridSizeTooltip'], 'Adjust token art grid size.');
  assert.equal(translations['PF2ETokener.HUD.ShowMore'], 'Show more');
  assert.equal(translations['PF2ETokener.HUD.BestMatches'], 'Best matches');
  assert.equal(translations['PF2ETokener.HUD.SearchResults'], 'Search results');
  assert.equal(translations['PF2ETokener.HUD.Current'], 'Current');
  assert.equal(translations['PF2ETokener.HUD.RingScale'], 'Ring');
  assert.equal(
    translations['PF2ETokener.HUD.RingScaleTooltip'],
    'Preview dynamic ring scale. Lower values make the ring larger.',
  );
  assert.equal(translations['PF2ETokener.HUD.ResetScale'], 'Reset scale');
  assert.equal(translations['PF2ETokener.HUD.ResetRingScale'], 'Reset ring scale');
  assert.equal(translations['PF2ETokener.HUD.RevertLast'], 'Revert last');
  assert.equal(
    translations['PF2ETokener.HUD.RevertTooltip'],
    'Restore the art from before the last Tokener change.',
  );
  assert.equal(
    translations['PF2ETokener.HUD.RevertHistoryTooltip'],
    'Restore this art from Tokener history.',
  );
  assert.equal(translations['PF2ETokener.HUD.RevertHistory'], 'Tokener history');
  assert.equal(translations['PF2ETokener.HUD.Close'], 'Close');
  assert.equal(translations['PF2ETokener.Actions.Token'], 'Token');
  assert.equal(translations['PF2ETokener.Actions.Actor'], 'Actor');
  assert.equal(translations['PF2ETokener.Actions.Portrait'], 'Portrait');
  assert.equal(translations['PF2ETokener.Actions.Both'], 'Both');
  assert.equal(
    translations['PF2ETokener.ActionTooltips.Token'],
    'Update only the selected token on this scene.',
  );
  assert.equal(
    translations['PF2ETokener.ActionTooltips.Actor'],
    'Update the actor portrait and default token art.',
  );
  assert.equal(
    translations['PF2ETokener.ActionTooltips.Portrait'],
    'Update only the actor portrait.',
  );
  assert.equal(
    translations['PF2ETokener.ActionTooltips.Both'],
    'Update the selected token and the actor default token art.',
  );
  assert.equal(translations['PF2ETokener.Notifications.Applied'], 'Tokener: token art applied.');
  assert.equal(
    translations['PF2ETokener.Notifications.ApplyFailed'],
    'Tokener: failed to apply token art.',
  );
  assert.equal(
    translations['PF2ETokener.Notifications.Reverted'],
    'Tokener: previous art restored.',
  );
  assert.equal(
    translations['PF2ETokener.Notifications.RevertFailed'],
    'Tokener: failed to restore previous art.',
  );
  assert.equal(translations['PF2ETokener.Settings.Favorites.Name'], 'Favorite token art');
  assert.equal(
    translations['PF2ETokener.Settings.Favorites.Hint'],
    'Token art marked as favorites in Tokener.',
  );
  assert.equal(
    translations['PF2ETokener.Settings.PlayerOwned.Name'],
    'Allow player-owned token access',
  );
  assert.match(translations['PF2ETokener.Settings.PlayerOwned.Hint'], /tokens they can update/);
});

test('localize uses Foundry i18n and falls back when unavailable', () => {
  assert.equal(localize('HUD.SearchPlaceholder', 'Search tokens'), 'Search tokens');

  const previousGame = globalThis.game;
  globalThis.game = {
    i18n: {
      localize: (key) => (key === 'PF2ETokener.HUD.SearchPlaceholder' ? 'Localized search' : key),
    },
  };

  try {
    assert.equal(localize('HUD.SearchPlaceholder', 'Search tokens'), 'Localized search');
    assert.equal(localize('HUD.Missing', 'Fallback'), 'Fallback');
  } finally {
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
  }
});

test('token grid does not stretch sibling cards when one card opens actions', () => {
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');
  const gridRule = css.match(/#token-hud \.pf2e-tokener-grid\s*\{[^}]+\}/)?.[0] ?? '';

  assert.match(gridRule, /align-items:\s*start;/);
});

test('token picker exposes live grid size controls and CSS variables', () => {
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');
  const picker = fs.readFileSync(new URL('../scripts/picker-app.js', import.meta.url), 'utf8');
  const template = fs.readFileSync(new URL('../templates/picker.hbs', import.meta.url), 'utf8');

  assert.match(picker, /gridSize:\s*preparePickerGridSizeView\(app\.gridSize\)/);
  assert.match(picker, /handlePickerGridSizeInput\(app,\s*target\)/);
  assert.match(template, /style='--pf2e-tokener-art-size: {{gridSize\.value}}px;/);
  assert.match(template, /--pf2e-tokener-grid-min-size: {{gridSize\.gridMin}}px;'/);
  assert.match(template, /class='pf2e-tokener-grid-size'/);
  assert.match(template, /data-grid-size-input/);
  assert.match(template, /data-grid-size-value/);
  assert.doesNotMatch(css, /grid-template-rows:\s*54px 0 auto auto auto;/);
  assert.match(
    css,
    /grid-template-rows:\s*var\(--pf2e-tokener-art-size,\s*54px\) 0 auto auto auto;/,
  );
  assert.match(css, /width:\s*var\(--pf2e-tokener-art-size,\s*54px\);/);
  assert.match(css, /height:\s*var\(--pf2e-tokener-art-size,\s*54px\);/);
  assert.match(
    css,
    /grid-template-columns:\s*repeat\(\s*auto-fill,\s*minmax\(var\(--pf2e-tokener-grid-min-size,\s*104px\),\s*1fr\)\s*\);/,
  );
});

test('truncated text helper sets Foundry tooltip attributes only', () => {
  const attributes = {};
  let removedTitle = false;
  const element = {
    dataset: {},
    title: 'stale native title',
    removeAttribute: (key) => {
      if (key === 'title') {
        removedTitle = true;
        delete element.title;
      }
    },
    setAttribute: (key, value) => {
      attributes[key] = value;
    },
  };

  setTextTooltip(element, 'Pathfinder Tokens: Monster Core');

  assert.equal(removedTitle, true);
  assert.equal(element.title, undefined);
  assert.equal(element.dataset.tooltip, 'Pathfinder Tokens: Monster Core');
  assert.equal(element.dataset.tooltipDirection, 'UP');
  assert.equal(attributes['aria-label'], 'Pathfinder Tokens: Monster Core');
});

test('token card typography fits compact thumbnail cells', () => {
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');
  const picker = fs.readFileSync(new URL('../scripts/picker-app.js', import.meta.url), 'utf8');
  const template = fs.readFileSync(new URL('../templates/picker.hbs', import.meta.url), 'utf8');
  const labelRule = css.match(/#token-hud \.pf2e-tokener-label\s*\{[^}]+\}/)?.[0] ?? '';
  const toolbarRule =
    css.match(
      /#token-hud \.pf2e-tokener-toolbar input,\s*#token-hud \.pf2e-tokener-source-button\s*\{[^}]+\}/,
    )?.[0] ?? '';

  assert.match(labelRule, /font-size:\s*12px;/);
  assert.match(labelRule, /-webkit-line-clamp:\s*2;/);
  assert.match(labelRule, /white-space:\s*normal;/);
  assert.match(toolbarRule, /font-size:\s*15px;/);
  assert.match(picker, /cardTooltip:\s*getCandidateCardTooltip\(candidate\)/);
  assert.match(picker, /function getCandidateCardTooltip\(candidate\)/);
  assert.doesNotMatch(picker, /subtitle:\s*getDefaultSearchQuery\(app\.tokenDocument\)/);
  assert.doesNotMatch(picker, /function getDefaultSearchQuery/);
  assert.match(template, /data-tooltip='{{cardTooltip}}'/);
  assert.doesNotMatch(template, />{{subtitle}}<\/div>/);
  assert.doesNotMatch(template, /data-tooltip='{{moduleTitle}}'/);
  assert.doesNotMatch(template, /\btitle=/);
  assert.doesNotMatch(template, />{{moduleTitle}}<\/div>/);
});

test('hidden current badge keeps token card labels in the visible grid row', () => {
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');
  const badgeRules = [
    ...css.matchAll(/(?:#token-hud|\.pf2e-tokener-app) \.pf2e-tokener-badge\s*\{[^}]+\}/g),
  ].map((match) => match[0]);
  const currentBadgeRules = [
    ...css.matchAll(
      /(?:#token-hud|\.pf2e-tokener-app) \.pf2e-tokener-card\.is-current \.pf2e-tokener-badge\s*\{[^}]+\}/g,
    ),
  ].map((match) => match[0]);

  assert.equal(badgeRules.length, 2);
  assert.equal(currentBadgeRules.length, 2);
  for (const rule of badgeRules) {
    assert.doesNotMatch(rule, /display:\s*none;/);
    assert.match(rule, /visibility:\s*hidden;/);
    assert.match(rule, /opacity:\s*0;/);
  }
  for (const rule of currentBadgeRules) {
    assert.match(rule, /visibility:\s*visible;/);
    assert.match(rule, /opacity:\s*1;/);
    assert.doesNotMatch(rule, /display:\s*block;/);
  }
});

test('token cards hide missing preview images and empty action rows', () => {
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');
  const picker = fs.readFileSync(new URL('../scripts/picker-app.js', import.meta.url), 'utf8');
  const template = fs.readFileSync(new URL('../templates/picker.hbs', import.meta.url), 'utf8');
  const unavailableRule =
    css.match(/\.pf2e-tokener-app \.pf2e-tokener-card\.is-unavailable\s*\{[^}]+\}/)?.[0] ?? '';

  assert.match(picker, /previewSrc:/);
  assert.match(picker, /hasActions:/);
  assert.match(picker, /getApplyActionsForCandidate\(candidate\)/);
  assert.match(template, /{{#if previewSrc}}/);
  assert.match(template, /src='{{previewSrc}}'/);
  assert.match(template, /data-preview-src='{{previewSrc}}'/);
  assert.doesNotMatch(template, /src='{{tokenSrc}}'/);
  assert.match(template, /{{#if hasActions}}/);
  assert.match(
    picker,
    /addEventListener\?\.\('error', \(event\) => handlePickerImageError\(app, event\), true\)/,
  );
  assert.match(picker, /getCandidatePreviewSources/);
  assert.match(unavailableRule, /cursor:\s*default;/);
});

test('matched gallery tags render as compact token card chips', () => {
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');
  const tagsRule = css.match(/#token-hud \.pf2e-tokener-tags\s*\{[^}]+\}/)?.[0] ?? '';
  const tagRule = css.match(/#token-hud \.pf2e-tokener-tag\s*\{[^}]+\}/)?.[0] ?? '';

  assert.match(tagsRule, /display:\s*flex;/);
  assert.match(tagsRule, /flex-wrap:\s*wrap;/);
  assert.match(tagsRule, /max-height:\s*28px;/);
  assert.match(tagRule, /font-size:\s*9px;/);
  assert.match(tagRule, /text-overflow:\s*ellipsis;/);
});

test('section headings are readable above result grids', () => {
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');
  const headingRule = css.match(/#token-hud \.pf2e-tokener-section h4\s*\{[^}]+\}/)?.[0] ?? '';

  assert.match(headingRule, /font-size:\s*14px;/);
  assert.match(headingRule, /margin:\s*2px 0 8px;/);
});

test('source filter CSS uses checkbox popover instead of native select', () => {
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');
  const template = fs.readFileSync(new URL('../templates/picker.hbs', import.meta.url), 'utf8');
  const filterRule = css.match(/#token-hud \.pf2e-tokener-source-filter\s*\{[^}]+\}/)?.[0] ?? '';
  const menuRule = css.match(/#token-hud \.pf2e-tokener-source-menu\s*\{[^}]+\}/)?.[0] ?? '';
  const optionRule = css.match(/#token-hud \.pf2e-tokener-source-option\s*\{[^}]+\}/)?.[0] ?? '';
  const checkRule = css.match(/#token-hud \.pf2e-tokener-source-check\s*\{[^}]+\}/)?.[0] ?? '';
  const checkedRule =
    css.match(
      /#token-hud \.pf2e-tokener-source-option\.is-selected \.pf2e-tokener-source-check\s*\{[^}]+\}/,
    )?.[0] ?? '';
  const checkmarkRule =
    css.match(
      /#token-hud \.pf2e-tokener-source-option\.is-selected \.pf2e-tokener-source-check::after\s*\{[^}]+\}/,
    )?.[0] ?? '';
  const appCheckedRule =
    css.match(
      /\.pf2e-tokener-app \.pf2e-tokener-source-option\.is-selected \.pf2e-tokener-source-check\s*\{[^}]+\}/,
    )?.[0] ?? '';
  const hoverRule =
    css.match(
      /#token-hud \.pf2e-tokener-source-option:hover,\s*#token-hud \.pf2e-tokener-source-option:focus-visible\s*\{[^}]+\}/,
    )?.[0] ?? '';
  const countRule =
    css.match(/#token-hud \.pf2e-tokener-source-option-count\s*\{[^}]+\}/)?.[0] ?? '';

  assert.match(template, /<button[\s\S]+class=['"]{{className}}['"]/);
  assert.match(template, /data-source-id=['"]{{id}}['"]/);
  assert.match(template, /aria-pressed=['"]{{ariaPressed}}['"]/);
  assert.doesNotMatch(template, /type=['"]checkbox['"]/);
  assert.match(
    template,
    /<span class=['"]pf2e-tokener-source-check['"] aria-hidden=['"]true['"]><\/span>/,
  );
  assert.match(filterRule, /position:\s*relative;/);
  assert.match(menuRule, /position:\s*absolute;/);
  assert.match(menuRule, /max-height:\s*min\(320px, calc\(100vh - 120px\)\);/);
  assert.match(menuRule, /overflow-y:\s*auto;/);
  assert.match(optionRule, /grid-template-columns:\s*16px minmax\(0, 1fr\) auto;/);
  assert.match(optionRule, /min-height:\s*28px;/);
  assert.match(optionRule, /padding:\s*2px 4px;/);
  assert.match(optionRule, /font-size:\s*11px;/);
  assert.match(optionRule, /text-align:\s*left;/);
  assert.match(checkRule, /width:\s*16px;/);
  assert.match(checkRule, /height:\s*16px;/);
  assert.match(checkedRule, /background:\s*#8fb9d6;/);
  assert.match(appCheckedRule, /background:\s*#8fb9d6;/);
  assert.match(checkmarkRule, /transform:\s*rotate\(45deg\);/);
  assert.match(hoverRule, /background:\s*rgba\(143, 185, 214, 0\.08\);/);
  assert.match(countRule, /justify-self:\s*end;/);
  assert.match(countRule, /border-radius:\s*999px;/);
  assert.match(countRule, /background:\s*rgba\(255, 255, 255, 0\.06\);/);
});

test('source drawer includes search input above source controls', () => {
  const picker = fs.readFileSync(new URL('../scripts/picker-app.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');
  const template = fs.readFileSync(new URL('../templates/picker.hbs', import.meta.url), 'utf8');
  const sourceSearchRule =
    css.match(/\.pf2e-tokener-app \.pf2e-tokener-source-search\s*\{[^}]+\}/)?.[0] ?? '';

  assert.match(template, /class=['"]pf2e-tokener-source-search['"]/);
  assert.match(template, /value=['"]{{source\.filterQuery}}['"]/);
  assert.match(template, /placeholder=['"]{{source\.searchPlaceholder}}['"]/);
  assert.match(picker, /sourceFilterQuery/);
  assert.match(picker, /filterSourceOptionsByQuery\(options, app\.sourceFilterQuery\)/);
  assert.match(picker, /\.pf2e-tokener-source-search/);
  assert.match(sourceSearchRule, /height:\s*28px;/);
  assert.match(sourceSearchRule, /width:\s*100%;/);
});

test('source popover is not clipped by the token picker panel', () => {
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');
  const panelRule = css.match(/#token-hud \.pf2e-tokener-panel\s*\{[^}]+\}/)?.[0] ?? '';
  const contentRule = css.match(/#token-hud \.pf2e-tokener-content\s*\{[^}]+\}/)?.[0] ?? '';

  assert.match(panelRule, /overflow:\s*visible;/);
  assert.match(contentRule, /overflow:\s*auto;/);
});

test('canvas zoom helper reads stage scale and clamps panel inverse scale', () => {
  assert.equal(getCanvasZoom({ stage: { scale: { x: 0.5 } } }), 0.5);
  assert.equal(getCanvasZoom({ app: { stage: { scale: { x: 2 } } } }), 2);
  assert.equal(getCanvasZoom({ stage: { scale: { x: 0 } } }), 1);

  assert.deepEqual(getPanelZoomData({ stage: { scale: { x: 0.5 } } }), {
    zoom: 0.5,
    inverse: 2,
  });
  assert.deepEqual(getPanelZoomData({ stage: { scale: { x: 8 } } }), {
    zoom: 8,
    inverse: 0.5,
  });
});

test('token picker panel CSS uses canvas zoom variables', () => {
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');
  const panelRule = css.match(/#token-hud \.pf2e-tokener-panel\s*\{[^}]+\}/)?.[0] ?? '';

  assert.match(panelRule, /left:\s*calc\(64px \* var\(--pf2e-tokener-inverse-zoom, 1\)\);/);
  assert.match(panelRule, /transform:\s*scale\(var\(--pf2e-tokener-inverse-zoom, 1\)\);/);
  assert.match(panelRule, /transform-origin:\s*top left;/);
});

test('Token HUD button has visible override active state styling', () => {
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');
  const activeRule =
    css.match(/#token-hud \.pf2e-tokener-button\.is-overridden\s*\{[^}]+\}/)?.[0] ?? '';
  const markerRule =
    css.match(/#token-hud \.pf2e-tokener-button\.is-overridden::after\s*\{[^}]+\}/)?.[0] ?? '';

  assert.match(activeRule, /color:\s*#d6b56d;/);
  assert.match(activeRule, /box-shadow:/);
  assert.match(markerRule, /background:\s*#d6b56d;/);
});

test('ApplicationV2 token picker CSS is scoped outside the Token HUD', () => {
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');
  const picker = fs.readFileSync(new URL('../scripts/picker-app.js', import.meta.url), 'utf8');
  const template = fs.readFileSync(new URL('../templates/picker.hbs', import.meta.url), 'utf8');
  const appPanelRule = css.match(/\.pf2e-tokener-app \.pf2e-tokener-panel\s*\{[^}]+\}/)?.[0] ?? '';
  const appContentRule =
    css.match(/\.pf2e-tokener-app \.pf2e-tokener-content\s*\{[^}]+\}/)?.[0] ?? '';
  const windowContentRule = css.match(/\.pf2e-tokener-app \.window-content\s*\{[^}]+\}/)?.[0] ?? '';
  const sourceMenuRule =
    css.match(/\.pf2e-tokener-app \.pf2e-tokener-source-menu\s*\{[^}]+\}/)?.[0] ?? '';

  assert.match(appPanelRule, /position:\s*relative;/);
  assert.match(appPanelRule, /transform:\s*none;/);
  assert.match(windowContentRule, /background:\s*rgba\(18,\s*20,\s*23,\s*0\.94\);/);
  assert.match(appContentRule, /overflow:\s*auto;/);
  assert.doesNotMatch(appContentRule, /max-height:\s*100%;/);
  assert.match(appContentRule, /max-height:\s*min\(604px, calc\(100vh - 144px\)\);/);
  assert.match(template, /class=['"]{{source\.menuClassName}}['"]/);
  assert.match(sourceMenuRule, /position:\s*static;/);
  assert.match(sourceMenuRule, /width:\s*100%;/);
  assert.doesNotMatch(picker, /positionFloatingSourceMenu/);
  assert.doesNotMatch(picker, /getFloatingMenuPlacement/);
});

test('ApplicationV2 token picker keeps search, source, tags, and revert controls in a left sidebar', () => {
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');
  const picker = fs.readFileSync(new URL('../scripts/picker-app.js', import.meta.url), 'utf8');
  const template = fs.readFileSync(new URL('../templates/picker.hbs', import.meta.url), 'utf8');
  const layoutRule = css.match(/\.pf2e-tokener-app \.pf2e-tokener-layout\s*\{[^}]+\}/)?.[0] ?? '';
  const sidebarRule = css.match(/\.pf2e-tokener-app \.pf2e-tokener-sidebar\s*\{[^}]+\}/)?.[0] ?? '';
  const contentRule = css.match(/\.pf2e-tokener-app \.pf2e-tokener-content\s*\{[^}]+\}/)?.[0] ?? '';

  assert.match(picker, /width:\s*720/);
  assert.match(template, /class=['"]pf2e-tokener-layout['"]/);
  assert.match(template, /class=['"]pf2e-tokener-sidebar['"]/);
  assert.ok(
    template.indexOf("class='pf2e-tokener-sidebar'") <
      template.indexOf("class='pf2e-tokener-content'"),
  );
  assert.match(layoutRule, /grid-template-columns:\s*minmax\(210px,\s*240px\) minmax\(0,\s*1fr\);/);
  assert.match(sidebarRule, /align-content:\s*start;/);
  assert.match(contentRule, /min-height:\s*0;/);
  assert.match(template, /data-revert-action=['"]last['"]/);
  assert.match(template, /data-favorites-filter=['"]toggle['"]/);
});

test('ApplicationV2 token picker opens a revert history dialog instead of inline entries', () => {
  const template = fs.readFileSync(new URL('../templates/picker.hbs', import.meta.url), 'utf8');
  const picker = fs.readFileSync(new URL('../scripts/picker-app.js', import.meta.url), 'utf8');

  assert.doesNotMatch(template, /pf2e-tokener-revert-history/);
  assert.doesNotMatch(template, /data-revert-index/);
  assert.match(picker, /getRevertHistoryEntries/);
  assert.match(picker, /openRevertHistoryDialog/);
  assert.match(picker, /revertTokenerChangeToOriginal/);
  assert.match(picker, /data-revert-action="last"/);
  assert.match(picker, /handleRevertControlContextMenu/);
});

test('favorite controls render on token cards and in the sidebar filter row', () => {
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');
  const picker = fs.readFileSync(new URL('../scripts/picker-app.js', import.meta.url), 'utf8');
  const template = fs.readFileSync(new URL('../templates/picker.hbs', import.meta.url), 'utf8');
  const filterRowRule =
    css.match(/\.pf2e-tokener-app \.pf2e-tokener-filter-row\s*\{[^}]+\}/)?.[0] ?? '';
  const cardFavoriteRule =
    css.match(/\.pf2e-tokener-app \.pf2e-tokener-favorite-toggle\s*\{[^}]+\}/)?.[0] ?? '';
  const activeFavoriteRule =
    css.match(/\.pf2e-tokener-app \.pf2e-tokener-favorite-toggle\.is-active\s*\{[^}]+\}/)?.[0] ??
    '';

  assert.match(picker, /favoritesOnly/);
  assert.match(picker, /toggleFavoriteCandidate\(candidate\)/);
  assert.match(picker, /filterFavoriteCandidates/);
  assert.match(template, /pf2e-tokener-filter-row/);
  assert.match(template, /data-favorites-filter=['"]toggle['"]/);
  assert.match(template, /data-favorite-candidate-id=['"]{{viewId}}['"]/);
  assert.match(template, /aria-pressed=['"]{{favoriteAriaPressed}}['"]/);
  assert.match(filterRowRule, /grid-template-columns:\s*1fr;/);
  assert.match(cardFavoriteRule, /position:\s*absolute;/);
  assert.match(cardFavoriteRule, /top:\s*4px;/);
  assert.match(activeFavoriteRule, /color:\s*#d6b56d;/);
});

test('accordion tag filter UI supports include and exclude chips', () => {
  const picker = fs.readFileSync(new URL('../scripts/picker-app.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');
  const template = fs.readFileSync(new URL('../templates/picker.hbs', import.meta.url), 'utf8');
  const filterToolsRule =
    css.match(/\.pf2e-tokener-app \.pf2e-tokener-filter-tools\s*\{[^}]+\}/)?.[0] ?? '';
  const tagFacetRule =
    css.match(/\.pf2e-tokener-app \.pf2e-tokener-tag-facet\s*\{[^}]+\}/)?.[0] ?? '';
  const tagChipRule =
    css.match(/\.pf2e-tokener-app \.pf2e-tokener-tag-chip\s*\{[^}]+\}/)?.[0] ?? '';
  const excludedRule =
    css.match(/\.pf2e-tokener-app \.pf2e-tokener-tag-chip\.is-excluded\s*\{[^}]+\}/)?.[0] ?? '';

  assert.match(picker, /prepareTagFilterView/);
  assert.match(picker, /excludedTagIds/);
  assert.match(picker, /selectedExcludedTagIds/);
  assert.match(template, /pf2e-tokener-tag-filter/);
  assert.match(template, /pf2e-tokener-filter-panel/);
  assert.match(template, /pf2e-tokener-filter-tools/);
  assert.match(template, /pf2e-tokener-tag-search/);
  assert.match(template, /<details class=['"]pf2e-tokener-tag-facet {{className}}['"]/);
  assert.match(template, /pf2e-tokener-tag-chip/);
  assert.match(template, /data-tag-action=['"]clear['"]/);
  assert.doesNotMatch(template, /data-tag-action=['"]reset['"]/);
  assert.doesNotMatch(template, /pf2e-tokener-filter-reset/);
  assert.match(template, /data-tag-id=['"]{{id}}['"]/);
  assert.match(template, /data-tag-exclude-id=['"]{{id}}['"]/);
  assert.match(picker, /selectedTagIds/);
  assert.match(picker, /getTagGroupSearchState\(group, tagFilter\)/);
  assert.match(
    picker,
    /buildCandidateSearchQuery\(app\?\.searchQuery, selectedTagIds, excludedTagIds\)/,
  );
  assert.doesNotMatch(picker, /app\.searchQuery = toggleTagFilterTerm/);
  assert.match(filterToolsRule, /grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(tagFacetRule, /border:\s*1px solid/);
  assert.match(tagChipRule, /border-left:\s*0;/);
  assert.match(excludedRule, /border-color:\s*rgba\(201,\s*106,\s*95/);
});

test('tag filter panel uses PF2e Tokener filter styling instead of Character Gallery styling', () => {
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');
  const template = fs.readFileSync(new URL('../templates/picker.hbs', import.meta.url), 'utf8');
  const translations = JSON.parse(
    fs.readFileSync(new URL('../languages/en.json', import.meta.url), 'utf8'),
  );
  const panelRule =
    css.match(/\.pf2e-tokener-app \.pf2e-tokener-filter-panel\s*\{[^}]+\}/)?.[0] ?? '';
  const toolsRule =
    css.match(/\.pf2e-tokener-app \.pf2e-tokener-filter-tools\s*\{[^}]+\}/)?.[0] ?? '';
  const facetRule = css.match(/\.pf2e-tokener-app \.pf2e-tokener-tag-facet\s*\{[^}]+\}/)?.[0] ?? '';
  const facetRuleBody =
    css.match(/\.pf2e-tokener-app \.pf2e-tokener-tag-facet::before\s*\{[^}]+\}/)?.[0] ?? '';
  const chipRule = css.match(/\.pf2e-tokener-app \.pf2e-tokener-tag-chip\s*\{[^}]+\}/)?.[0] ?? '';
  const includedRule =
    css.match(/\.pf2e-tokener-app \.pf2e-tokener-tag-chip\.is-included\s*\{[^}]+\}/)?.[0] ?? '';

  assert.equal(translations['PF2ETokener.HUD.Filters'], 'Filters');
  assert.match(template, /pf2e-tokener-filter-panel/);
  assert.match(template, /pf2e-tokener-filter-tools/);
  assert.doesNotMatch(template, /pf2e-tokener-tag-header/);
  assert.match(panelRule, /background:\s*linear-gradient/);
  assert.match(toolsRule, /grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(facetRule, /position:\s*relative;/);
  assert.match(facetRuleBody, /background:\s*#6fa8c8;/);
  assert.match(chipRule, /border-left:\s*0;/);
  assert.doesNotMatch(chipRule, /#d6b56d/);
  assert.match(includedRule, /border-color:\s*rgba\(111,\s*168,\s*200/);
});

test('filter panel keeps search above a scrollable tag category list', () => {
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');
  const template = fs.readFileSync(new URL('../templates/picker.hbs', import.meta.url), 'utf8');
  const tagGroupsRules = [
    ...css.matchAll(/\.pf2e-tokener-app \.pf2e-tokener-tag-groups\s*\{[^}]+\}/g),
  ].map((match) => match[0]);
  const finalTagGroupsRule = tagGroupsRules.at(-1) ?? '';
  const filterPanelRule =
    css.match(/\.pf2e-tokener-app \.pf2e-tokener-filter-panel\s*\{[^}]+\}/)?.[0] ?? '';
  const tagFacetRule =
    css.match(/\.pf2e-tokener-app \.pf2e-tokener-tag-facet\s*\{[^}]+\}/)?.[0] ?? '';
  const tagOptionsRules = [
    ...css.matchAll(/\.pf2e-tokener-app \.pf2e-tokener-tag-options\s*\{[^}]+\}/g),
  ].map((match) => match[0]);
  const finalTagOptionsRule = tagOptionsRules.at(-1) ?? '';

  assert.ok(
    template.indexOf("class='pf2e-tokener-filter-tools'") <
      template.indexOf("class='pf2e-tokener-tag-groups'"),
  );
  assert.match(filterPanelRule, /min-height:\s*0;/);
  assert.match(finalTagGroupsRule, /grid-row:\s*auto;/);
  assert.match(finalTagGroupsRule, /max-height:\s*min\(300px, calc\(100vh - 390px\)\);/);
  assert.match(finalTagGroupsRule, /overflow-y:\s*auto;/);
  assert.match(tagFacetRule, /display:\s*block;/);
  assert.match(tagFacetRule, /overflow:\s*visible;/);
  assert.match(finalTagOptionsRule, /overflow:\s*visible;/);
});

test('picker result paging renders show more when filters match more than the render cap', () => {
  const picker = fs.readFileSync(new URL('../scripts/picker-app.js', import.meta.url), 'utf8');
  const template = fs.readFileSync(new URL('../templates/picker.hbs', import.meta.url), 'utf8');

  assert.match(picker, /resultLimit/);
  assert.match(picker, /data-results-action/);
  assert.match(template, /data-results-action=['"]more['"]/);
  assert.match(template, /{{paging\.showMoreLabel}}/);
});

test('image preview helper returns actor and token panes side by side', () => {
  const items = getImagePreviewItems({
    portraitSrc: 'actor.webp',
    tokenSrc: 'token.webp',
  });

  assert.deepEqual(items, [
    {
      kind: 'actor',
      label: 'Actor image',
      src: 'actor.webp',
      available: true,
    },
    {
      kind: 'token',
      label: 'Token image',
      src: 'token.webp',
      available: true,
    },
  ]);
});

test('image preview helper groups associated tags for display', () => {
  assert.deepEqual(
    getCandidatePreviewTagGroups({
      tags: {
        ancestry: ['human'],
        category: ['humanoid'],
        equipment: ['clothing', 'firearm'],
      },
    }),
    [
      { label: 'Category', values: ['HUMANOID'] },
      { label: 'Ancestry', values: ['HUMAN'] },
      { label: 'Equipment', values: ['CLOTHING', 'FIREARM'] },
    ],
  );
  assert.deepEqual(getCandidatePreviewTagGroups({}), []);
});

test('image preview helper hides missing image panes', () => {
  const items = getImagePreviewItems({
    tokenSrc: 'token.webp',
  });

  assert.deepEqual(items, [
    {
      kind: 'token',
      label: 'Token image',
      src: 'token.webp',
      available: true,
    },
  ]);
});

test('image preview helper can use dynamic subject art when token art is unavailable', () => {
  assert.deepEqual(
    getImagePreviewItems({
      subjectSrc: 'subject.webp',
    }),
    [
      {
        kind: 'subject',
        label: 'Token subject',
        src: 'subject.webp',
        available: true,
      },
    ],
  );
});

test('picker image failure keeps the candidate map aligned with surviving preview art', () => {
  const picker = fs.readFileSync(new URL('../scripts/picker-app.js', import.meta.url), 'utf8');

  assert.match(picker, /app\._candidateMap\.set\(card\.dataset\.candidateId, availableCandidate\)/);
});

test('picker image failure retargets image tags to the surviving preview art', () => {
  const picker = fs.readFileSync(new URL('../scripts/picker-app.js', import.meta.url), 'utf8');

  assert.match(
    picker,
    /imageTagPath:\s*getCandidatePreviewSources\(availableCandidate\)\[0\]\s*\?\?\s*availableCandidate\.imageTagPath/,
  );
});

test('English localization file contains image preview strings', () => {
  const translations = JSON.parse(
    fs.readFileSync(new URL('../languages/en.json', import.meta.url), 'utf8'),
  );

  assert.equal(translations['PF2ETokener.Preview.ActorImage'], 'Actor image');
  assert.equal(translations['PF2ETokener.Preview.TokenImage'], 'Token image');
  assert.equal(translations['PF2ETokener.Preview.SubjectImage'], 'Token subject');
  assert.equal(translations['PF2ETokener.Preview.ImageUnavailable'], 'Image failed to load.');
  assert.equal(translations['PF2ETokener.Preview.NoImages'], 'No image available.');
  assert.equal(translations['PF2ETokener.Preview.Close'], 'Close preview');
  assert.equal(translations['PF2ETokener.Preview.ActorUnavailable'], 'No actor image available.');
});

test('image preview CSS is fullscreen and side by side', () => {
  const css = fs.readFileSync(new URL('../styles/pf2e-tokener.css', import.meta.url), 'utf8');
  const preview = fs.readFileSync(new URL('../scripts/preview.js', import.meta.url), 'utf8');
  const overlayRule = css.match(/\.pf2e-tokener-preview\s*\{[^}]+\}/)?.[0] ?? '';
  const panesRule = css.match(/\.pf2e-tokener-preview-panes\s*\{[^}]+\}/)?.[0] ?? '';
  const singlePanesRule =
    css.match(/\.pf2e-tokener-preview-panes\.is-single\s*\{[^}]+\}/)?.[0] ?? '';
  const singleFrameRule =
    css.match(
      /\.pf2e-tokener-preview-panes\.is-single \.pf2e-tokener-preview-frame\s*\{[^}]+\}/,
    )?.[0] ?? '';
  const imageRule = css.match(/\.pf2e-tokener-preview-frame img\s*\{[^}]+\}/)?.[0] ?? '';
  const errorRule = css.match(/\.pf2e-tokener-preview-error\s*\{[^}]+\}/)?.[0] ?? '';
  const tagsRule = css.match(/\.pf2e-tokener-preview-tags\s*\{[^}]+\}/)?.[0] ?? '';
  const tagRowRule = css.match(/\.pf2e-tokener-preview-tag-row\s*\{[^}]+\}/)?.[0] ?? '';
  const tagValuesRule = css.match(/\.pf2e-tokener-preview-tag-values\s*\{[^}]+\}/)?.[0] ?? '';

  assert.match(overlayRule, /position:\s*fixed;/);
  assert.match(overlayRule, /inset:\s*0;/);
  assert.match(panesRule, /grid-template-columns:\s*repeat\(auto-fit, minmax\(320px, 1fr\)\);/);
  assert.match(singlePanesRule, /justify-content:\s*center;/);
  assert.match(singlePanesRule, /grid-template-columns:\s*minmax\(0,\s*min\(720px,\s*100%\)\);/);
  assert.match(singleFrameRule, /aspect-ratio:\s*1\s*\/\s*1;/);
  assert.match(imageRule, /width:\s*100%;/);
  assert.match(imageRule, /height:\s*100%;/);
  assert.match(imageRule, /object-position:\s*center;/);
  assert.match(errorRule, /text-align:\s*center;/);
  assert.match(tagsRule, /justify-self:\s*center;/);
  assert.match(tagsRule, /width:\s*min\(640px,\s*100%\);/);
  assert.match(tagRowRule, /grid-template-columns:\s*90px minmax\(0,\s*1fr\);/);
  assert.match(tagValuesRule, /justify-content:\s*start;/);
  assert.match(preview, /panes\.classList\.toggle\('is-single', items\.length === 1\)/);
  assert.match(preview, /showPreviewImageError/);
  assert.doesNotMatch(preview, /classList\.add\('is-hidden'\)/);
});

test('pruneStaleDependentTokens drops unpersisted token documents from actor dependents', () => {
  const persisted = { id: 'token-a' };
  const ephemeral = { id: 'token-a' };
  const orphan = { id: 'token-b' };
  const scene = { tokens: new Map([['token-a', persisted]]) };
  const dependents = new Set([persisted, ephemeral, orphan]);
  const actor = { _dependentTokens: new Map([[scene, dependents]]) };

  assert.equal(pruneStaleDependentTokens(actor), 2);
  assert.deepEqual([...dependents], [persisted]);
  assert.equal(pruneStaleDependentTokens(actor), 0);
  assert.equal(pruneStaleDependentTokens(null), 0);
  assert.equal(pruneStaleDependentTokens({}), 0);
});

test('actor updates prune stale dependent tokens before writing', async () => {
  const persisted = { id: 'token-a' };
  const ephemeral = { id: 'token-a' };
  const scene = { tokens: new Map([['token-a', persisted]]) };
  const dependents = new Set([persisted, ephemeral]);
  const calls = [];
  const actor = {
    id: 'actor-1',
    img: 'old-portrait.webp',
    prototypeToken: { texture: { src: 'old-token.webp', scaleX: 1, scaleY: 1 } },
    flags: {},
    _dependentTokens: new Map([[scene, dependents]]),
    async update(update) {
      calls.push({ update, dependents: [...dependents] });
    },
  };

  const proxy = createActorTokenDocument(actor);
  await proxy.update({ 'texture.src': 'new-token.webp' });
  assert.deepEqual(calls[0].dependents, [persisted]);

  dependents.add(ephemeral);
  await revertTokenerChangeToSnapshot(
    { actor, flags: {} },
    { action: 'portrait', portrait: { img: 'old-portrait.webp' } },
  );
  assert.deepEqual(calls[1].dependents, [persisted]);
});

test('animated ring tokens use the token video as the ring subject', async () => {
  const { buildCreatedTokenCandidate } = await import('../scripts/token-composer.js');
  const candidate = buildCreatedTokenCandidate({
    label: 'D',
    tokenSrc: 'd.webm',
    subjectSrc: 'd.webm',
    animated: true,
    breakoutScale: 1.25,
  });
  assert.equal(candidate.subjectSrc, undefined);
  assert.equal(candidate.ringFromToken, true);
  const update = buildTokenUpdate(candidate, { scale: 1 });
  assert.equal(update['ring.enabled'], true);
  assert.equal(update['ring.subject.texture'], '');
  assert.equal(update['ring.subject.scale'], 1.25);
  assert.equal(update['texture.scaleX'], 1.25);
});

test('animated ring tokens keep ring colours and honour a ring scale override', async () => {
  const { buildCreatedTokenCandidate } = await import('../scripts/token-composer.js');
  const candidate = buildCreatedTokenCandidate({
    label: 'E',
    tokenSrc: 'e.webm',
    subjectSrc: 'e.webm',
    ringColors: { ring: '#ff0000', background: '#00ff00' },
    animated: true,
    breakoutScale: 1.25,
  });
  assert.equal(candidate.ringFromToken, true);
  const update = buildTokenUpdate(candidate, { scale: 1, ringScale: 1.6 });
  assert.equal(update['ring.enabled'], true);
  assert.equal(update['ring.subject.texture'], '');
  assert.equal(update['ring.subject.scale'], 1.6);
  assert.equal(update['ring.colors.ring'], '#ff0000');
  assert.equal(update['ring.colors.background'], '#00ff00');
});

test('getRingEffectsMask folds the ring effect toggles into Foundry bit flags', async () => {
  const { getRingEffectsMask } = await import('../scripts/token-composer.js');
  assert.equal(getRingEffectsMask({}), 1);
  assert.equal(getRingEffectsMask(), 1);
  assert.equal(getRingEffectsMask({ pulse: true }), 3);
  assert.equal(getRingEffectsMask({ gradient: true }), 5);
  assert.equal(getRingEffectsMask({ wave: true }), 9);
  assert.equal(getRingEffectsMask({ spectral: true }), 17);
  assert.equal(getRingEffectsMask({ pulse: true, gradient: true, wave: true, spectral: true }), 31);
});

test('ring effects are written for still and animated ring candidates only', async () => {
  const { buildCreatedTokenCandidate } = await import('../scripts/token-composer.js');
  const still = buildCreatedTokenCandidate({
    label: 'S',
    tokenSrc: 's.webp',
    subjectSrc: 's.webp',
    ringEffects: { pulse: true, wave: true },
  });
  assert.equal(still.ringEffects, 11);
  assert.equal(buildTokenUpdate(still, { scale: 1 })['ring.effects'], 11);

  const animated = buildCreatedTokenCandidate({
    label: 'A',
    tokenSrc: 'a.webm',
    subjectSrc: 'a.webm',
    animated: true,
    ringEffects: { spectral: true },
  });
  assert.equal(animated.ringEffects, 17);
  assert.equal(buildTokenUpdate(animated, { scale: 1 })['ring.effects'], 17);

  const plain = buildCreatedTokenCandidate({
    label: 'P',
    tokenSrc: 'p.webp',
    ringEffects: { pulse: true },
  });
  assert.equal(plain.ringEffects, undefined);
  assert.equal('ring.effects' in buildTokenUpdate(plain, { scale: 1 }), false);
});

test('created tokens with a saved project write the project flag on token and prototype', async () => {
  const { buildCreatedTokenCandidate } = await import('../scripts/token-composer.js');
  const candidate = buildCreatedTokenCandidate({
    label: 'D',
    tokenSrc: 'w/tokener/d.webm',
    projectSrc: 'w/tokener/d.tokener.json',
  });
  assert.equal(candidate.projectSrc, 'w/tokener/d.tokener.json');
  const project = { path: 'w/tokener/d.tokener.json', output: 'w/tokener/d.webm' };
  assert.deepEqual(buildTokenUpdate(candidate)['flags.pf2e-tokener.project'], project);
  assert.deepEqual(
    buildActorUpdate(candidate, { actor: { prototypeToken: {} } })[
      'prototypeToken.flags.pf2e-tokener.project'
    ],
    project,
  );

  const without = buildCreatedTokenCandidate({ label: 'P', tokenSrc: 'p.webp' });
  assert.equal('projectSrc' in without, false);
  assert.equal('flags.pf2e-tokener.project' in buildTokenUpdate(without), false);
});

test('revert state captures and restores ring.effects', () => {
  const snapshot = buildRevertSnapshot({
    action: 'token',
    candidate: { label: 'X', tokenSrc: 'x.webp' },
    tokenDocument: {
      texture: { src: 'old.webp', scaleX: 1, scaleY: 1 },
      ring: { enabled: true, effects: 19, subject: { texture: 's.webp', scale: 1 } },
    },
  });
  assert.equal(snapshot.token.ring.effects, 19);
  assert.equal(buildTokenRevertUpdate(snapshot)['ring.effects'], 19);

  const bare = buildRevertSnapshot({
    action: 'token',
    candidate: { label: 'X', tokenSrc: 'x.webp' },
    tokenDocument: { texture: { src: 'old.webp' }, ring: { enabled: false } },
  });
  assert.equal(bare.token.ring.effects, 1);
});
