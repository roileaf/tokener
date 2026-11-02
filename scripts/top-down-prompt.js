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

const sentencesOf = (text) =>
  plain(text)
    .replace(/@\w+\[[^\]]*\](\{[^}]*\})?/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 12 && sentence.length <= 200);

// Words that say how a creature looks, as opposed to lore, habits or rules.
const LOOK_WORDS =
  /\b(body|bodies|bodied|wings?|winged|scales?|scaled|scaly|fur|furred|feathers?|tentacles?|tendrils?|legs?|legged|limbs?|eyes?|skin|shell|carapace|horns?|horned|claws?|tails?|heads?|headed|tall|massive|enormous|giant|tiny|bulbous|floating|float|made of|covered|shaped|resembl\w*|looks? like|humanoid|serpentine|insect\w*|fungus|fungal|plant|skeleton\w*|skulls?|stone|metal\w*|armou?r\w*|robes?|cloak\w*|mouth|teeth|fangs|maw)\b/gi;

// Only sentences that say what the creature looks like count: lore mentions bodies and wings too.
const DESCRIBES =
  /\b(resembl\w*|looks? like|shaped like|appear\w* (?:as|like)|bodies of|body of|the size of|covered in|sport|in the form of)\b/i;

/**
 * The sentence of an actor's text that best says what the creature looks like, as a phrase, or
 * '' when none does (most bestiary text is lore).
 */
export function pickAppearance(text) {
  let best = '';
  let bestScore = 1;
  for (const sentence of sentencesOf(text)) {
    if (!DESCRIBES.test(sentence)) continue;
    const score = new Set(sentence.toLowerCase().match(LOOK_WORDS) ?? []).size;
    if (score > bestScore) {
      best = sentence;
      bestScore = score;
    }
  }
  return toPhrase(best);
}

/** "The drakauthix is a massive fungus that floats." -> "a massive fungus that floats". */
function toPhrase(sentence) {
  const text = sentence.replace(/[.!?]+$/, '').trim();
  const match = text.match(/^(?:the |an? )?(?:[\w'’-]+ ){0,4}?(?:is|are) ((?:an?|one|some) .+)$/i);
  return match ? match[1] : text;
}

/**
 * What the prompt needs to know about an actor, from its system's data:
 * `{ name, size, kinds, appearance }`. Unknown fields stay null or empty.
 */
export function getCreatureProfile({ name, system, data, footprint = [1, 1] }) {
  const d = data ?? {};
  let size = null;
  let kinds = [];
  let appearance = '';
  switch (system) {
    case 'pf2e':
    case 'sf2e':
      size = sizeWord(d.traits?.size?.value);
      kinds = d.traits?.value ?? [];
      appearance = pickAppearance(d.details?.publicNotes);
      break;
    case 'dnd5e':
      size = sizeWord(d.traits?.size);
      kinds = [d.details?.type?.value, d.details?.type?.subtype, d.details?.type?.custom].filter(
        Boolean,
      );
      appearance = pickAppearance(d.details?.biography?.value);
      break;
    case 'daggerheart':
      size = sizeWord(d.size);
      // Short descriptions of how the adversary looks: taken whole.
      appearance = toPhrase(sentencesOf(d.description)[0] ?? '');
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
      appearance = pickAppearance(d.details?.taxonomy?.description);
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
    appearance,
  };
}

// No body part or item is ever named: the model draws whatever a prompt names. "dragon" drew wings
// on wingless dragons, and listing "wings, tails" drew bat wings on nearly every creature. The
// reference image is the only source of anatomy and equipment.
const LOOK =
  'Keep the same colours, markings, clothing, equipment and design. Flat, even lighting with no shadows at all: ' +
  'no cast shadow, no drop shadow, nothing on the ground. Isolated on a pure solid white background.';

/** A phrase ("a giant spider") as what the image shows; a sentence from a bestiary as it is. */
function describeLooks(looks) {
  if (!looks) return '';
  if (/^(an?|the|one|some|two|three|four|several|many) /i.test(looks))
    return `The reference image shows ${looks[0].toLowerCase()}${looks.slice(1)}.`;
  return `What it looks like: ${looks}.`;
}

/**
 * The top-down editing prompt for a creature profile. `appearance` is a short phrase saying what
 * the creature is ("a large spider-like creature"), from the actor's text, the image or the user:
 * it fixed most creatures the model otherwise turned into a generic figure.
 */
// Which side faces the camera. Front (the face and chest seen from above, facing the bottom of
// the image) showed people far better; Back (head to the top, body behind it) suits beasts and
// flyers, which Front squashed into a creature looking up at the camera.
export const TOP_DOWN_FACINGS = Object.freeze(['front', 'back']);
const VIEWS = Object.freeze({
  front: {
    onto: 'looking straight down onto this exact creature',
    sees: 'We see the top of its head, its face, its shoulders and the front of its body from above. It faces the bottom of the image: its face, chest and the front of its clothing point towards the bottom of the image, and its back is towards the top.',
  },
  back: {
    onto: 'looking straight down at the back of this exact creature',
    sees: 'We see the top of its head and its back. Its head points to the top of the image and the rest of its body extends behind it towards the bottom of the image.',
  },
});

export function buildTopDownPrompt({ name, size, kinds = [], appearance = '', facing = 'front' }) {
  const view = VIEWS[facing] ?? VIEWS.front;
  const kindText = kinds.length ? ` (${kinds.slice(0, 4).join(', ')})` : '';
  const looks = String(appearance ?? '')
    .trim()
    .replace(/[.!?]+$/, '');
  return [
    `Seen from directly above, ${view.onto}, ${name || 'creature'}${kindText}, as a figure on a tabletop battle map.`,
    describeLooks(looks),
    'Show only the one main creature of the reference image, and nothing of its surroundings.',
    view.sees,
    'Keep its body exactly as the reference image shows it, and keep everything it is holding exactly as in the reference.',
    'Add nothing that is not in the reference image.',
    size ? `It is ${SIZE_PHRASES[size]}; give it the build and bulk of that size.` : '',
    LOOK,
  ]
    .filter(Boolean)
    .join(' ');
}
