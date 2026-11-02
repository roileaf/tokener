import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ART_VIEWS_FLAG_PATH,
  buildArtToggleUpdate,
  buildArtViewsUpdate,
  buildFlipFacingUpdate,
  buildLookUpdate,
  buildSetFacingUpdate,
  getMovementRotation,
  getShownLook,
  listLooks,
  isShowingTopDown,
  readArtViews,
  readTokenArt,
} from '../scripts/art-views.js';
import {
  buildTopDownPrompt,
  getCreatureProfile,
  getDefaultFacing,
  pickAppearance,
} from '../scripts/top-down-prompt.js';
import { cleanCaption } from '../scripts/creature-caption.js';
import { getTopDownStoreKey } from '../scripts/top-down-store.js';
import { tidyAlphaMask } from '../scripts/ai-tools.js';
import { getTokenFrameLayout } from '../scripts/token-composer.js';
import {
  checkTopDownSupport,
  buildRepaintPrompt,
  findSubjectBox,
  fitViewToBox,
  getRepaintCells,
  getDefaultTopDownHighDetail,
  registerLookRedraw,
  registerTopDownLayering,
  registerTopDownMovement,
  formatTopDownChat,
  gaussianNoise,
  getGridIds,
  getTopDownSigmas,
} from '../scripts/top-down.js';

const token = (art, views) => ({
  texture: { src: art.src, scaleX: art.scale ?? 1, scaleY: art.scale ?? 1 },
  ring: { enabled: false, subject: { texture: null, scale: 1 } },
  flags: views ? { 'pf2e-tokener': { artViews: views } } : {},
});
const look = (src, scale = 1) => ({
  src,
  scaleX: scale,
  scaleY: scale,
  ring: false,
  subject: null,
  subjectScale: 1,
});

test('applying top-down art keeps the shown art as the regular look', () => {
  const document = token({ src: 'regular.webp', scale: 1.2 });
  const update = buildArtViewsUpdate(
    document,
    { 'texture.src': 'top.webp', 'texture.scaleX': 1, 'texture.scaleY': 1 },
    { look: 'topDown' },
  );
  assert.deepEqual(update[ART_VIEWS_FLAG_PATH], {
    regular: look('regular.webp', 1.2),
    topDown: look('top.webp'),
    attacking: null,
    casting: null,
    sneaking: null,
    custom: null,
  });
});

test('replacing a shown top-down look keeps its regular look', () => {
  const document = token(
    { src: 'top.webp' },
    { regular: look('regular.webp'), topDown: look('top.webp') },
  );
  const update = buildArtViewsUpdate(document, { 'texture.src': 'top2.webp' }, { look: 'topDown' });
  assert.equal(update[ART_VIEWS_FLAG_PATH].regular.src, 'regular.webp');
  assert.equal(update[ART_VIEWS_FLAG_PATH].topDown.src, 'top2.webp');
});

test('regular art replaces the regular look and leaves tokens without a pair alone', () => {
  const paired = token(
    { src: 'top.webp' },
    { regular: look('old.webp'), topDown: look('top.webp') },
  );
  const update = buildArtViewsUpdate(paired, { 'texture.src': 'new.webp' });
  assert.equal(update[ART_VIEWS_FLAG_PATH].regular.src, 'new.webp');
  assert.equal(update[ART_VIEWS_FLAG_PATH].topDown.src, 'top.webp');
  assert.deepEqual(buildArtViewsUpdate(token({ src: 'a.webp' }), { 'texture.src': 'b.webp' }), {});
});

test('prototype token updates use the prefixed paths', () => {
  const update = buildArtViewsUpdate(
    token({ src: 'regular.webp' }),
    { 'prototypeToken.texture.src': 'top.webp', img: 'portrait.webp' },
    { look: 'topDown', prefix: 'prototypeToken.' },
  );
  assert.equal(update[`prototypeToken.${ART_VIEWS_FLAG_PATH}`].topDown.src, 'top.webp');
});

test('the toggle switches looks both ways and keeps scale changes made since', () => {
  const views = { regular: look('regular.webp', 1.5), topDown: look('top.webp') };
  const showingTop = token({ src: 'top.webp', scale: 2 }, views);
  assert.equal(isShowingTopDown(showingTop), true);
  const toRegular = buildArtToggleUpdate(showingTop);
  assert.equal(toRegular['texture.src'], 'regular.webp');
  assert.equal(toRegular['texture.scaleX'], 1.5);
  assert.equal(toRegular[ART_VIEWS_FLAG_PATH].topDown.scaleX, 2);

  const showingRegular = token({ src: 'regular.webp', scale: 1.5 }, views);
  assert.equal(isShowingTopDown(showingRegular), false);
  assert.equal(buildArtToggleUpdate(showingRegular)['texture.src'], 'top.webp');
});

test('art that is neither look counts as the regular one and is kept', () => {
  const document = token(
    { src: 'other.webp' },
    { regular: look('regular.webp'), topDown: look('top.webp') },
  );
  const update = buildArtToggleUpdate(document);
  assert.equal(update['texture.src'], 'top.webp');
  assert.equal(update[ART_VIEWS_FLAG_PATH].regular.src, 'other.webp');
});

test('no toggle without both looks', () => {
  assert.equal(readArtViews(token({ src: 'a.webp' })), null);
  assert.equal(isShowingTopDown(token({ src: 'a.webp' })), null);
  assert.equal(buildArtToggleUpdate(token({ src: 'a.webp' }, { regular: look('a.webp') })), null);
});

test('prompts read size and kind from each system and never name body parts', () => {
  const cases = [
    [
      'pf2e',
      { traits: { size: { value: 'lg' }, value: ['dragon', 'fire', 'evil'] } },
      'Large',
      'dragon, fire',
    ],
    ['dnd5e', { traits: { size: 'huge' }, details: { type: { value: 'giant' } } }, 'Huge', 'giant'],
    ['daggerheart', { size: 'small', description: '<p>A wily spy.</p>' }, 'Small', null],
    [
      'draw-steel',
      { combat: { size: { value: 3, letter: '' } }, monster: { keywords: ['Dragon'] } },
      'Huge',
      'dragon',
    ],
    [
      'crucible',
      { details: { taxonomy: { movement: { size: 8 }, category: 'elementalFire' } } },
      'Huge',
      'elemental fire',
    ],
    ['unknown', {}, 'Large', null],
  ];
  for (const [system, data, size, kinds] of cases) {
    const profile = getCreatureProfile({
      name: 'Red Dragon (Adult, Spellcaster)',
      system,
      data,
      footprint: [2, 2],
    });
    const prompt = buildTopDownPrompt(profile);
    assert.match(prompt, new RegExp(`It is ${size} `), system);
    if (kinds) assert.match(prompt, new RegExp(`\\(${kinds}`), system);
    assert.doesNotMatch(prompt, /\(Adult/);
    assert.doesNotMatch(prompt, /\b(wings?|tails?|arms)\b/i, system);
    assert.match(prompt, /no shadows/);
  }
});

test('the schedule, positions and noise match FLUX.2 editing', () => {
  const sigmas = getTopDownSigmas(1024, 4);
  assert.equal(sigmas.length, 5);
  assert.equal(sigmas[4], 0);
  assert.ok(sigmas[0] > 0.99 && sigmas[0] <= 1);
  for (let index = 1; index < sigmas.length; index += 1)
    assert.ok(sigmas[index] < sigmas[index - 1]);

  const ids = getGridIds(10, 2, 3);
  assert.deepEqual([...ids.slice(4 * 5, 4 * 6)], [10n, 1n, 2n, 0n]);

  assert.deepEqual(gaussianNoise(8, 3), gaussianNoise(8, 3));
  assert.notDeepEqual(gaussianNoise(8, 3), gaussianNoise(8, 4));
  assert.match(formatTopDownChat('Hi'), /^<\|im_start\|>user\nHi<\|im_end\|>/);
});

test('support check rules out GPUs that cannot run the model', async () => {
  const adapter = (features, maxBufferSize, extra = {}) => ({
    requestAdapter: async () => ({
      features: new Set(features),
      limits: { maxBufferSize },
      ...extra,
    }),
  });
  assert.deepEqual(await checkTopDownSupport(undefined), { ok: false, reason: 'webgpu' });
  assert.equal((await checkTopDownSupport({ requestAdapter: async () => null })).reason, 'adapter');
  assert.equal(
    (await checkTopDownSupport(adapter(['shader-f16'], 2 ** 31, { isFallbackAdapter: true })))
      .reason,
    'adapter',
  );
  assert.equal((await checkTopDownSupport(adapter([], 2 ** 31))).reason, 'f16');
  assert.equal((await checkTopDownSupport(adapter(['shader-f16'], 2 ** 28))).reason, 'memory');
  assert.deepEqual(await checkTopDownSupport(adapter(['shader-f16'], 2 ** 31)), {
    ok: true,
    reason: null,
  });
});

test('actor text gives an appearance only from sentences that describe looks', () => {
  assert.equal(
    pickAppearance(
      '<p>The drakauthix prefers to ambush prey. The drakauthix is a massive fungus shaped like a bloated bladder with long tendrils.</p>',
    ),
    'a massive fungus shaped like a bloated bladder with long tendrils',
  );
  // Lore that mentions bodies and wings is not a description.
  assert.equal(
    pickAppearance('Imperial dragons leave serpentine skeletons and wings behind upon death.'),
    '',
  );
  assert.equal(pickAppearance('@Embed[Compendium.dnd5e.content24.JournalEntry.x]'), '');
  const daggerheart = getCreatureProfile({
    name: 'Chaos Skull',
    system: 'daggerheart',
    data: { description: 'A floating humanoid skull animated by scintillating magic.' },
  });
  assert.equal(daggerheart.appearance, 'A floating humanoid skull animated by scintillating magic');
});

test('the appearance goes into the prompt as what the image shows', () => {
  const phrase = buildTopDownPrompt({
    name: 'Skitterling',
    appearance: 'A giant spider-like creature.',
  });
  assert.match(phrase, /The reference image shows a giant spider-like creature\. /);
  const sentence = buildTopDownPrompt({
    name: 'Emriss',
    appearance: 'Girtablilus are scorpion folk',
  });
  assert.match(sentence, /What it looks like: Girtablilus are scorpion folk\. /);
  assert.doesNotMatch(
    buildTopDownPrompt({ name: 'Eagle' }),
    /The reference image shows|What it looks like/,
  );
});

test('captions are cleaned to one short line', () => {
  assert.equal(
    cleanCaption('  "A giant spider\n with eight legs."  '),
    'A giant spider with eight legs',
  );
  assert.equal(cleanCaption(Array(40).fill('word').join(' ')).split(' ').length, 25);
});

test('saving both looks at once stores the other one as given', () => {
  const document = token({ src: 'old.webp' });
  const regular = {
    'texture.src': 'ring.webp',
    'ring.enabled': true,
    'ring.subject.texture': 'ring.webp',
  };
  const topDown = { 'texture.src': 'top.webp', 'ring.enabled': false };
  const showingTop = buildArtViewsUpdate(document, topDown, {
    look: 'topDown',
    others: { regular },
  });
  assert.equal(showingTop[ART_VIEWS_FLAG_PATH].regular.src, 'ring.webp');
  assert.equal(showingTop[ART_VIEWS_FLAG_PATH].regular.ring, true);
  assert.equal(showingTop[ART_VIEWS_FLAG_PATH].topDown.src, 'top.webp');
  assert.equal(showingTop[ART_VIEWS_FLAG_PATH].topDown.ring, false);
  const showingRegular = buildArtViewsUpdate(document, regular, { others: { topDown } });
  assert.equal(showingRegular[ART_VIEWS_FLAG_PATH].regular.src, 'ring.webp');
  assert.equal(showingRegular[ART_VIEWS_FLAG_PATH].topDown.src, 'top.webp');
});

test('the top-down mask clean-up drops faint pixels and specks and keeps a soft margin', () => {
  const width = 20;
  const alpha = new Uint8ClampedArray(width * 20);
  for (let y = 5; y < 15; y += 1) for (let x = 5; x < 15; x += 1) alpha[y * width + x] = 255;
  alpha[6 * width + 4] = 110; // soft edge next to the shape: kept
  alpha[1 * width + 18] = 255; // a lone speck: dropped
  alpha[18 * width + 2] = 60; // faint haze: dropped
  tidyAlphaMask(alpha, width);
  assert.equal(alpha[10 * width + 10], 255);
  assert.equal(alpha[6 * width + 4], 110);
  assert.equal(alpha[1 * width + 18], 0);
  assert.equal(alpha[18 * width + 2], 0);
});

test('top-down prompts face front by default and can show the back', () => {
  const front = buildTopDownPrompt({ name: 'Ezren' });
  assert.match(front, /looking straight down onto this exact creature/);
  assert.match(front, /It faces the bottom of the image/);
  const back = buildTopDownPrompt({ name: 'Eagle', facing: 'back' });
  assert.match(back, /looking straight down at the back of this exact creature/);
  assert.match(back, /Its head points to the top of the image/);
  assert.equal(buildTopDownPrompt({ name: 'Ezren', facing: 'sideways' }), front);
});

test('the default facing is back for beasts and dragons, front for people', () => {
  assert.equal(getDefaultFacing({ name: 'Eagle', kinds: ['beast'] }), 'back');
  assert.equal(getDefaultFacing({ name: 'Young Ice Dragon', kinds: [] }), 'back');
  assert.equal(getDefaultFacing({ name: 'Hydra', kinds: [] }), 'back');
  assert.equal(getDefaultFacing({ name: 'Ezren', kinds: ['human', 'humanoid'] }), 'front');
  assert.equal(getDefaultFacing({ name: 'Dragonborn Knight', kinds: ['humanoid'] }), 'front');
  assert.equal(getDefaultFacing({ name: 'Imp', kinds: ['fiend', 'devil'] }), 'front');
  assert.equal(getDefaultFacing({ name: 'Mystery' }), 'front');
});

test('the subject box covers the main figure, not bystanders, with a margin', () => {
  const width = 100;
  const height = 100;
  const alpha = new Uint8ClampedArray(width * height);
  const fill = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) alpha[y * width + x] = 255;
  };
  fill(40, 20, 60, 80); // main figure, 1200 px
  fill(5, 85, 10, 90); // small bystander, 25 px: left out
  assert.deepEqual(findSubjectBox(alpha, width, height), { x: 35, y: 15, width: 30, height: 70 });
  fill(0, 0, 100, 100);
  assert.equal(findSubjectBox(alpha, width, height), null); // nearly the whole image
  assert.equal(findSubjectBox(new Uint8ClampedArray(16), 4, 4), null);
});

test('top-down framing centres the creature and fills the square the same way', () => {
  const box = { x: 100, y: 60, width: 200, height: 300 };
  const view = fitViewToBox({ imageWidth: 512, imageHeight: 512, box, fill: 0.95 });
  const size = 400;
  const layout = getTokenFrameLayout({
    imageWidth: 512,
    imageHeight: 512,
    size,
    zoom: view.zoom,
    offsetX: view.offsetX * size,
    offsetY: view.offsetY * size,
  });
  const scale = layout.width / 512;
  assert.ok(Math.abs(box.height * scale - 0.95 * size) < 1e-6);
  assert.ok(Math.abs(layout.x + (box.x + box.width / 2) * scale - size / 2) < 1e-6);
  assert.ok(Math.abs(layout.y + (box.y + box.height / 2) * scale - size / 2) < 1e-6);
});

test('troops, swarms and hordes are drawn as one group token', () => {
  const troop = getCreatureProfile({
    name: 'Sylirican Phalanx',
    system: 'pf2e',
    data: { traits: { size: { value: 'grg' }, value: ['human', 'troop'] } },
  });
  assert.equal(troop.group, true);
  assert.equal(
    getCreatureProfile({
      name: 'Rats',
      system: 'dnd5e',
      data: { details: { type: { value: 'beast', swarm: 'tiny' } } },
    }).group,
    true,
  );
  assert.equal(
    getCreatureProfile({ name: 'Mob', system: 'daggerheart', data: { type: 'Horde' } }).group,
    true,
  );
  assert.equal(getCreatureProfile({ name: 'Eagle', system: 'dnd5e', data: {} }).group, false);
  const prompt = buildTopDownPrompt({ ...troop, facing: 'front' });
  assert.match(prompt, /this exact group of creatures/);
  assert.match(prompt, /Show the whole group/);
  assert.doesNotMatch(prompt, /only the one main creature/);
});

test('a token saved with stances lists every look and switches to any of them', () => {
  const regular = { 'texture.src': 'ring.webp', 'ring.enabled': true };
  const document = token({ src: 'old.webp' });
  const flag = buildArtViewsUpdate(document, regular, {
    others: {
      topDown: { 'texture.src': 'top.webp', 'ring.enabled': false },
      casting: { 'texture.src': 'casting.webp', 'ring.enabled': false },
    },
  })[ART_VIEWS_FLAG_PATH];
  assert.equal(flag.attacking, null);
  const saved = token({ src: 'ring.webp' }, flag);
  assert.deepEqual(
    listLooks(saved).map(({ id }) => id),
    ['regular', 'topDown', 'casting'],
  );
  assert.equal(getShownLook(saved), 'regular');
  const toCasting = buildLookUpdate(saved, 'casting');
  assert.equal(toCasting['texture.src'], 'casting.webp');
  assert.equal(toCasting['ring.enabled'], false);
  assert.equal(buildLookUpdate(saved, 'regular'), null); // already shown
  assert.equal(buildLookUpdate(saved, 'sneaking'), null); // never made
  const showingCasting = token({ src: 'casting.webp' }, toCasting[ART_VIEWS_FLAG_PATH]);
  assert.equal(getShownLook(showingCasting), 'casting');
  assert.equal(buildLookUpdate(showingCasting, 'regular')['texture.src'], 'ring.webp');
});

test('stances change the pose only, without naming parts or items', () => {
  const asis = buildTopDownPrompt({ name: 'Ezren' });
  const casting = buildTopDownPrompt({ name: 'Ezren', stance: 'casting' });
  assert.match(asis, /Keep its body exactly as the reference image shows it/);
  assert.match(casting, /change its pose: it is casting a spell/);
  assert.match(casting, /Add no creatures, body parts or items/);
  assert.doesNotMatch(casting, /Keep its body exactly/);
  assert.doesNotMatch(
    buildTopDownPrompt({ name: 'X', stance: 'sneaking' }),
    /\b(wings?|tails?|swords?)\b/,
  );
  assert.match(
    buildTopDownPrompt({ name: 'Rats', group: true, stance: 'attacking' }),
    /they are in the middle of an attack/,
  );
  assert.equal(buildTopDownPrompt({ name: 'Ezren', stance: 'dancing' }), asis);
});

test('tokens showing a top-down look turn towards where they move', () => {
  const views = (facing) => ({
    regular: look('ring.webp'),
    topDown: { ...look('top.webp'), facing },
  });
  const at = (src, facing, extra = {}) => ({
    ...token({ src }, views(facing)),
    x: 100,
    y: 100,
    ...extra,
  });
  const front = at('top.webp', 'front');
  // A front look faces the bottom of its image: moving down needs no turn, right turns it 270.
  assert.equal(getMovementRotation(front, { y: 200 }), 0);
  assert.equal(getMovementRotation(front, { x: 200 }), 270);
  assert.equal(getMovementRotation(front, { y: 0 }), 180);
  assert.equal(getMovementRotation(front, { x: 0 }), 90);
  // A back look faces the top: moving up needs no turn.
  assert.equal(getMovementRotation(at('top.webp', 'back'), { y: 0 }), 0);
  assert.equal(getMovementRotation(at('top.webp', 'back'), { x: 200 }), 90);
  assert.equal(getMovementRotation(front, { x: 200, y: 200 }), 315);
  // Left alone: no move, regular look, unknown facing, locked rotation.
  assert.equal(getMovementRotation(front, { elevation: 5 }), null);
  assert.equal(getMovementRotation(at('ring.webp', 'front'), { x: 200 }), null);
  assert.equal(getMovementRotation(at('top.webp', undefined), { x: 200 }), null);
  assert.equal(
    getMovementRotation(at('top.webp', 'front', { lockRotation: true }), { x: 200 }),
    null,
  );
});

test('switching looks keeps the rotation and facing of each look', () => {
  const saved = {
    ...token(
      { src: 'top.webp' },
      {
        regular: { ...look('ring.webp'), rotation: 45 },
        topDown: { ...look('top.webp'), facing: 'front' },
      },
    ),
    rotation: 270,
  };
  const update = buildLookUpdate(saved, 'regular');
  assert.equal(update.rotation, 0);
  assert.equal(update[ART_VIEWS_FLAG_PATH].topDown.rotation, 270);
  assert.equal(update[ART_VIEWS_FLAG_PATH].topDown.facing, 'front');
});

test('an animated look never sets a video as the ring subject', () => {
  const saved = token(
    { src: 'top.webp' },
    {
      regular: { ...look('dragon.webm'), ring: true, subject: 'dragon.webm' },
      topDown: look('top.webp'),
    },
  );
  assert.equal(buildLookUpdate(saved, 'regular')['ring.subject.texture'], '');
  // Foundry fills the prepared subject from the token video; the look keeps the stored one.
  const prepared = {
    ...saved,
    texture: { src: 'dragon.webm' },
    ring: { enabled: true, subject: { texture: 'dragon.webm' } },
    _source: {
      ...saved,
      texture: { src: 'dragon.webm' },
      ring: { enabled: true, subject: { texture: '' } },
    },
  };
  assert.equal(readTokenArt(prepared).subject, '');
});

test('a token showing a top-down look draws solid over others at its elevation', () => {
  const handlers = {};
  registerTopDownLayering({ on: (name, fn) => (handlers[name] = fn) });
  const views = { regular: look('ring.webp'), topDown: look('top.webp') };
  const topDown = {
    mesh: { sort: 3 },
    document: { ...token({ src: 'top.webp' }, views), sort: 3 },
  };
  handlers.refreshToken(topDown);
  assert.ok(topDown.mesh.sort > 1e6);
  assert.equal(topDown.mesh.sort % 1e7, 3); // keeps its own order among top-down tokens
  assert.equal(topDown.mesh.occludedAlpha, 1); // solid over tokens you control
  const regular = {
    mesh: { sort: 3 },
    document: { ...token({ src: 'ring.webp' }, views), sort: 3 },
  };
  handlers.refreshToken(regular);
  assert.equal(regular.mesh.sort, 3);
});

test('a token whose art and ring change together is redrawn', () => {
  const handlers = {};
  registerLookRedraw({ on: (name, fn) => (handlers[name] = fn) });
  const flags = [];
  const document = { object: { renderFlags: { set: (value) => flags.push(value) } } };
  handlers.updateToken(document, { texture: { src: 'top.webm' }, ring: { enabled: false } });
  assert.deepEqual(flags, [{ redraw: true }]);
  handlers.updateToken(document, { texture: { src: 'other.webm' } }); // ring unchanged
  handlers.updateToken({}, { texture: { src: 'a.webm' }, ring: { enabled: true } }); // not drawn
  assert.equal(flags.length, 1);
});

test('high detail is on by default for Large and bigger creatures', () => {
  const tokenOf = (size) => ({
    actor: { name: 'X', system: { traits: { size: { value: size }, value: [] } } },
  });
  assert.equal(getDefaultTopDownHighDetail(tokenOf('med'), { systemId: 'pf2e' }), false);
  assert.equal(getDefaultTopDownHighDetail(tokenOf('sm'), { systemId: 'pf2e' }), false);
  assert.equal(getDefaultTopDownHighDetail(tokenOf('lg'), { systemId: 'pf2e' }), true);
  assert.equal(getDefaultTopDownHighDetail(tokenOf('grg'), { systemId: 'pf2e' }), true);
  // Any system: from the token footprint when the system gives no size.
  assert.equal(getDefaultTopDownHighDetail({ width: 3, height: 3 }, { systemId: 'other' }), true);
});

test('top-down looks turn with Foundry v14 movement, and with plain updates on older versions', () => {
  const handlers = {};
  registerTopDownMovement({ on: (name, fn) => (handlers[name] = fn) });
  const previousGame = globalThis.game;
  globalThis.game = { user: { id: 'u1' }, settings: { get: () => true } };
  try {
    const tokenWith = (facing, extra = {}) => ({
      id: 't1',
      x: 100,
      y: 100,
      rotation: 0,
      ...token(
        { src: 'top.webp' },
        { regular: look('ring.webp'), topDown: { ...look('top.webp'), facing } },
      ),
      ...extra,
    });
    // v14: the turn comes from the move's own path, the same however often an update repeats it.
    const move = {
      origin: { x: 100, y: 100 },
      passed: {
        waypoints: [
          { x: 200, y: 100 },
          { x: 200, y: 100, intermediate: true },
          { x: 200, y: 300 },
        ],
      },
    };
    const back = { rotation: 90 };
    handlers.preUpdateToken(tokenWith('back'), back, { _movement: { t1: move } }, 'u1');
    assert.equal(back.rotation, 180); // last step goes down; a back look faces the top
    handlers.preUpdateToken(tokenWith('back'), back, { _movement: { t1: move } }, 'u1');
    assert.equal(back.rotation, 180);
    const front = {};
    handlers.preUpdateToken(tokenWith('front'), front, { _movement: { t1: move } }, 'u1');
    assert.equal(front.rotation, 0);
    const still = { rotation: 33 };
    handlers.preUpdateToken(
      tokenWith('front'),
      still,
      { _movement: { t1: { origin: { x: 1, y: 1 }, passed: { waypoints: [{ x: 1, y: 1 }] } } } },
      'u1',
    );
    assert.equal(still.rotation, 33);
    // Older Foundry: a plain x/y update is turned here.
    const plain = { x: 200 };
    handlers.preUpdateToken(tokenWith('front'), plain, {}, 'u1');
    assert.equal(plain.rotation, 270);
    // Left alone: locked rotation, regular look, another user's update.
    const locked = { x: 200 };
    handlers.preUpdateToken(tokenWith('front', { lockRotation: true }), locked, {}, 'u1');
    assert.equal(locked.rotation, undefined);
    const regular = { x: 200 };
    handlers.preUpdateToken(
      { ...tokenWith('front'), texture: { src: 'ring.webp' } },
      regular,
      {},
      'u1',
    );
    assert.equal(regular.rotation, undefined);
    const other = { x: 200 };
    handlers.preUpdateToken(tokenWith('front'), other, {}, 'u2');
    assert.equal(other.rotation, undefined);
  } finally {
    globalThis.game = previousGame;
  }
});

test('a look that walks backwards is turned around', () => {
  const showing = {
    ...token({ src: 'top.webp' }, { regular: look('ring.webp'), topDown: look('top.webp') }),
    rotation: 270,
  };
  // No facing recorded: the guess (back here) flips to front, and the shown token turns now.
  const flipped = buildFlipFacingUpdate(showing, 'topDown', 'back');
  assert.equal(flipped[ART_VIEWS_FLAG_PATH].topDown.facing, 'front');
  assert.equal(flipped.rotation, 90);
  const recorded = token(
    { src: 'ring.webp' },
    { regular: look('ring.webp'), topDown: { ...look('top.webp'), facing: 'front' } },
  );
  const back = buildFlipFacingUpdate(recorded, 'topDown');
  assert.equal(back[ART_VIEWS_FLAG_PATH].topDown.facing, 'back');
  assert.equal(back.rotation, undefined); // not shown: nothing to turn now
  assert.equal(buildFlipFacingUpdate(recorded, 'regular'), null);
  assert.equal(buildFlipFacingUpdate(recorded, 'casting'), null);
});

test('a facing fixed on a token can be recorded on the actor default token', () => {
  const prototype = token(
    { src: 'ring.webp' },
    { regular: look('ring.webp'), topDown: look('top.webp') },
  );
  const update = buildSetFacingUpdate(prototype, 'topDown', 'front', {
    src: 'top.webp',
    prefix: 'prototypeToken.',
  });
  assert.equal(update[`prototypeToken.${ART_VIEWS_FLAG_PATH}`].topDown.facing, 'front');
  // Not when the default token's look is other art, or already faces that way.
  assert.equal(buildSetFacingUpdate(prototype, 'topDown', 'front', { src: 'other.webp' }), null);
  const recorded = token(
    { src: 'ring.webp' },
    { regular: look('ring.webp'), topDown: { ...look('top.webp'), facing: 'front' } },
  );
  assert.equal(buildSetFacingUpdate(recorded, 'topDown', 'front'), null);
});

test('top-down tokens are kept per actor and portrait image, flips included', () => {
  assert.equal(
    getTopDownStoreKey({ ownerUuid: 'Actor.a', source: { path: 'art/x.webp' } }),
    'Actor.a|art/x.webp|',
  );
  assert.equal(
    getTopDownStoreKey({
      ownerUuid: 'Actor.a',
      source: { path: 'art/x.webp', flip: { x: true, y: true } },
    }),
    'Actor.a|art/x.webp|xy',
  );
  // An upload or paste has no path to find it by again.
  assert.equal(getTopDownStoreKey({ ownerUuid: 'Actor.a', source: { path: null } }), null);
  assert.equal(getTopDownStoreKey({ ownerUuid: null, source: { path: 'art/x.webp' } }), null);
});

test('a custom stance uses the pose as written and allows what it asks for', () => {
  const prompt = buildTopDownPrompt({
    name: 'Dragon',
    stance: 'custom',
    pose: 'rearing up, wings raised.',
  });
  assert.match(prompt, /change its pose: rearing up, wings raised\. /);
  assert.match(prompt, /Add no other creatures\./);
  assert.doesNotMatch(prompt, /Add no creatures, body parts or items/);
  // No pose written: the picture's own pose.
  assert.equal(
    buildTopDownPrompt({ name: 'Dragon', stance: 'custom', pose: '  ' }),
    buildTopDownPrompt({ name: 'Dragon' }),
  );
});

test('a painted area maps to the latent cells it covers, grown by one cell', () => {
  const size = 64;
  const alpha = new Uint8ClampedArray(size * size);
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) alpha[y * size + x] = 255;
  const cells = getRepaintCells(alpha, size, size, 4, 4);
  // The painted top-left cell, and its neighbours.
  assert.deepEqual([...cells], [1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(
    [...getRepaintCells(new Uint8ClampedArray(size * size), size, size, 4, 4)],
    Array(16).fill(0),
  );
});

test('the repaint prompt asks for the change and to keep the rest', () => {
  const prompt = buildRepaintPrompt('a second, smaller pair of wings.');
  assert.match(prompt, /^A second, smaller pair of wings\. Change only that/);
  assert.match(prompt, /keep the rest of the creature/);
  assert.match(prompt, /white background/);
});

test('the top-down rig locks the body and moves the head, tail and wings', async () => {
  const { buildTopDownRig } = await import('../scripts/auto-animate.js');
  // A cross seen from above: body down the middle, wings left and right, head at the bottom.
  const width = 200;
  const height = 200;
  const data = new Uint8ClampedArray(width * height * 4);
  const fill = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y += 1)
      for (let x = x0; x < x1; x += 1) data[(y * width + x) * 4 + 3] = 255;
  };
  fill(90, 10, 110, 190); // body, tail at the top, head at the bottom
  fill(10, 60, 190, 80); // wings
  const rig = buildTopDownRig({ data: { data, width, height }, facing: 'front' });
  const byPreset = Object.fromEntries(
    rig.pins.map((pin) => [pin.preset ?? (pin.lock ? 'lock' : ''), pin]),
  );
  assert.ok(byPreset.lock, 'the middle is locked');
  assert.equal(byPreset.lock.keyframes.length, 0);
  assert.ok(byPreset.bob.y > 150, 'the head pin is at the bottom, where a front look faces');
  assert.ok(byPreset.sway.y < 40, 'the tail pin is at the top');
  const wings = rig.pins.filter((pin) => pin.preset === 'flap');
  assert.equal(wings.length, 2);
  assert.ok(wings.some((pin) => pin.x < 30) && wings.some((pin) => pin.x > 170));
  // Facing the top: head and tail swap ends.
  const back = buildTopDownRig({ data: { data, width, height }, facing: 'back' });
  assert.ok(back.pins.find((pin) => pin.preset === 'bob').y < 50);
});

test('a locked pin holds still and keeps its lock through saving', async () => {
  const { normalizeAnimation } = await import('../scripts/animation.js');
  const { holdGrid } = await import('../scripts/token-animation.js');
  const animation = normalizeAnimation({
    pins: [
      { id: 'a', x: 1, y: 2, keyframes: [], lock: true },
      { id: 'b', x: 3, y: 4, keyframes: [], lock: 'yes' },
    ],
  });
  assert.equal(animation.pins[0].lock, true);
  assert.equal(animation.pins[1].lock, undefined);
  // Nodes under a full-weight hold go back to rest; half weight halfway; none untouched.
  const grid = {
    gx: new Float32Array([10, 10, 10]),
    gy: new Float32Array([0, 0, 0]),
    cols: 3,
    rows: 1,
    step: 4,
  };
  const held = holdGrid(grid, [{ w: new Float32Array([1, 0.5, 0]) }]);
  assert.deepEqual([...held.gx], [0, 7, 10]);
});
