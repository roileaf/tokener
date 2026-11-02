// Top-down token prompts from an actor of any system: what the creature is (name, size, kind,
// short description) and how to show it from above. Tested on a sample of every supported
// system's bestiaries.

const SIZE_WORDS = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
const SIZE_CODES = {
  tiny: 0,
  sm: 1,
  small: 1,
  med: 2,
  medium: 2,
  lg: 3,
  large: 3,
  huge: 4,
  grg: 5,
  gargantuan: 5,
};
const SIZE_PHRASES = {
  tiny: 'Tiny (a quarter of one 5-foot square on the map)',
  small: 'Small (one 5-foot square on the map)',
  medium: 'Medium (one 5-foot square on the map)',
  large: 'Large (2 by 2 squares on the map)',
  huge: 'Huge (3 by 3 squares on the map)',
  gargantuan: 'Gargantuan (4 by 4 squares or more on the map)',
};

/** A size word from any system's value, or null. */
function sizeWord(value) {
  const code = SIZE_CODES[String(value ?? '').toLowerCase()];
  return code === undefined ? null : SIZE_WORDS[code];
}

/** A size word from how many grid squares a side covers (1 square = Medium). */
function sizeFromSquares(squares) {
  if (!(squares > 0)) return null;
  if (squares < 1) return 'tiny';
  return SIZE_WORDS[Math.min(5, squares + 1)];
}

/** Crucible's finer grid: a human is 4. */
function sizeFromCrucible(value) {
  if (value <= 2) return 'tiny';
  if (value <= 3) return 'small';
  if (value <= 5) return 'medium';
  if (value <= 7) return 'large';
  if (value <= 11) return 'huge';
  return 'gargantuan';
}

// Traits that say nothing about how a creature looks (alignment, magic tradition, rules tags).
const NOT_LOOKS = new Set([
  'good',
  'evil',
  'lawful',
  'chaotic',
  'neutral',
  'holy',
  'unholy',
  'arcane',
  'divine',
  'occult',
  'primal',
  'mindless',
  'rare',
  'uncommon',
  'unique',
  'common',
  'minion',
  'summoned',
  'troop',
]);

const plain = (html) =>
  String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The first sentence of `text`, if it is short enough to describe the creature. */
function firstSentence(text) {
  const sentence = plain(text).split(/(?<=[.!?])\s/)[0] ?? '';
  return sentence.length >= 8 && sentence.length <= 160 ? sentence : '';
}

/**
 * What the prompt needs to know about an actor, from its system's data:
 * `{ name, size, kinds, description }`. Unknown fields stay null or empty.
 */
export function getCreatureProfile({ name, system, data, footprint = [1, 1] }) {
  const d = data ?? {};
  let size = null;
  let kinds = [];
  let description = '';
  switch (system) {
    case 'pf2e':
    case 'sf2e':
      size = sizeWord(d.traits?.size?.value);
      kinds = d.traits?.value ?? [];
      description = firstSentence(d.details?.blurb);
      break;
    case 'dnd5e':
      size = sizeWord(d.traits?.size);
      kinds = [d.details?.type?.value, d.details?.type?.subtype, d.details?.type?.custom].filter(
        Boolean,
      );
      break;
    case 'daggerheart':
      size = sizeWord(d.size);
      description = firstSentence(d.description);
      break;
    case 'draw-steel': {
      const squares = Number(d.combat?.size?.value) || 1;
      const letter = String(d.combat?.size?.letter ?? '').toUpperCase();
      size =
        squares === 1
          ? ({ T: 'tiny', S: 'small', M: 'medium', L: 'large' }[letter] ?? 'medium')
          : sizeFromSquares(squares);
      kinds = d.monster?.keywords ?? [];
      break;
    }
    case 'crucible': {
      size = sizeFromCrucible(
        (Number(d.details?.taxonomy?.movement?.size) || 4) + (Number(d.movement?.sizeBonus) || 0),
      );
      kinds = [d.details?.taxonomy?.category]
        .filter(Boolean)
        .map((kind) => kind.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
      description = firstSentence(d.details?.taxonomy?.description);
      break;
    }
    default:
      break;
  }
  // Any system: the token's footprint in squares.
  size ??= sizeFromSquares(Math.max(...footprint));
  return {
    // Statblock tags such as "(Adult, Spellcaster)" or "(BB)" are not part of the creature.
    name: String(name ?? '')
      .replace(/\s*\([^)]*\)/g, '')
      .trim(),
    size,
    kinds: [...new Set(kinds.map((kind) => String(kind).toLowerCase()))].filter(
      (kind) => /^[a-z][a-z -]*$/.test(kind) && !NOT_LOOKS.has(kind),
    ),
    description,
  };
}

// No body part or item is ever named: the model draws whatever a prompt names. "dragon" drew wings
// on wingless dragons, and listing "wings, tails" drew bat wings on nearly every creature. The
// reference image is the only source of anatomy and equipment.
const LOOK =
  'Keep the same colours, markings, clothing, equipment and design. Flat, even lighting with no shadows at all: ' +
  'no cast shadow, no drop shadow, nothing on the ground. Isolated on a pure solid white background.';

/** The top-down editing prompt for a creature profile. */
export function buildTopDownPrompt({ name, size, kinds = [], description = '' }) {
  const kindText = kinds.length ? ` (${kinds.slice(0, 4).join(', ')})` : '';
  const what = `${name || 'creature'}${kindText}${description ? `: ${description.replace(/\.$/, '')}` : ''}`;
  return [
    `Seen from directly above, looking straight down at the back of this exact creature, ${what}, as a figure on a tabletop battle map.`,
    'Show only the one main creature of the reference image, and nothing of its surroundings.',
    'We see the top of its head and its back. Its head points to the top of the image and the rest of its body extends behind it towards the bottom of the image.',
    'Keep its body exactly as the reference image shows it, and keep everything it is holding exactly as in the reference.',
    'Add nothing that is not in the reference image.',
    size ? `It is ${SIZE_PHRASES[size]}; give it the build and bulk of that size.` : '',
    LOOK,
  ]
    .filter(Boolean)
    .join(' ');
}
