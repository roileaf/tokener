import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ART_VIEWS_FLAG_PATH,
  buildArtToggleUpdate,
  buildArtViewsUpdate,
  isShowingTopDown,
  readArtViews,
} from '../scripts/art-views.js';
import {
  buildTopDownPrompt,
  getCreatureProfile,
  pickAppearance,
} from '../scripts/top-down-prompt.js';
import { cleanCaption } from '../scripts/creature-caption.js';
import {
  checkTopDownSupport,
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
    { topDown: true },
  );
  assert.deepEqual(update[ART_VIEWS_FLAG_PATH], {
    regular: look('regular.webp', 1.2),
    topDown: look('top.webp'),
  });
});

test('replacing a shown top-down look keeps its regular look', () => {
  const document = token(
    { src: 'top.webp' },
    { regular: look('regular.webp'), topDown: look('top.webp') },
  );
  const update = buildArtViewsUpdate(document, { 'texture.src': 'top2.webp' }, { topDown: true });
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
    { topDown: true, prefix: 'prototypeToken.' },
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
  const showingTop = buildArtViewsUpdate(document, topDown, { topDown: true, paired: regular });
  assert.equal(showingTop[ART_VIEWS_FLAG_PATH].regular.src, 'ring.webp');
  assert.equal(showingTop[ART_VIEWS_FLAG_PATH].regular.ring, true);
  assert.equal(showingTop[ART_VIEWS_FLAG_PATH].topDown.src, 'top.webp');
  assert.equal(showingTop[ART_VIEWS_FLAG_PATH].topDown.ring, false);
  const showingRegular = buildArtViewsUpdate(document, regular, { paired: topDown });
  assert.equal(showingRegular[ART_VIEWS_FLAG_PATH].regular.src, 'ring.webp');
  assert.equal(showingRegular[ART_VIEWS_FLAG_PATH].topDown.src, 'top.webp');
});
