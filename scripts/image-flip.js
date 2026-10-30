/**
 * Mirroring for the Token Creator's Flip horizontal / Flip vertical. Everything stored in
 * source-image pixels is mirrored the same way, so a flip keeps the art, masks, regions and
 * pins aligned, and flipping twice restores the original exactly. Pure: canvases come from the
 * injected `createCanvas`.
 */

const AXES = ['x', 'y'];

/** A new canvas holding `canvas` mirrored along `axis` ('x' horizontal, 'y' vertical); null → null. */
export function flipCanvas(canvas, axis, createCanvas) {
  if (!canvas) return null;
  assertAxis(axis);
  const { width, height } = canvas;
  const flipped = createCanvas(width, height);
  const context = flipped.getContext('2d');
  context.imageSmoothingEnabled = false;
  // A ±1 scale with an integer translation copies pixels one to one (no resampling), and stays
  // in the canvas's own premultiplied space, so semi-transparent pixels survive a double flip.
  if (axis === 'x') context.setTransform(-1, 0, 0, 1, width, 0);
  else context.setTransform(1, 0, 0, -1, 0, height);
  context.drawImage(canvas, 0, 0);
  context.setTransform(1, 0, 0, 1, 0, 0);
  return flipped;
}

/**
 * Pins mirrored inside a `width` × `height` source: `x → width − x` (or `y → height − y`),
 * keyframe offsets negated along the axis, and rotation reversed (a mirror turns clockwise
 * into counter-clockwise). The rotation arm is symmetric, so it is kept.
 */
export function flipPins(pins, axis, { width, height }) {
  assertAxis(axis);
  if (!Array.isArray(pins)) return [];
  const key = axis === 'x' ? 'dx' : 'dy';
  return pins.map((pin) => ({
    ...pin,
    ...(axis === 'x' ? { x: width - pin.x } : { y: height - pin.y }),
    keyframes: (pin.keyframes ?? []).map((frame) => {
      const out = { ...frame, [key]: negate(frame[key]) };
      if (frame.rot !== undefined) out.rot = negate(frame.rot);
      return out;
    }),
  }));
}

/** The frame offset mirrored along `axis` (offsets are measured from the centre). */
export function flipView(view, axis) {
  assertAxis(axis);
  const key = axis === 'x' ? 'offsetX' : 'offsetY';
  return { ...view, [key]: negate(view?.[key]) };
}

/** `{ x, y }` booleans for a stored flip; anything else is "not flipped". */
export function normalizeFlip(flip) {
  return { x: flip?.x === true, y: flip?.y === true };
}

/** `flip` with `axis` toggled. */
export function toggleFlip(flip, axis) {
  assertAxis(axis);
  const current = normalizeFlip(flip);
  return { ...current, [axis]: !current[axis] };
}

/** Negates without producing -0, so a flipped zero still compares equal to zero. */
function negate(value) {
  const number = Number(value) || 0;
  return number === 0 ? 0 : -number;
}

function assertAxis(axis) {
  if (!AXES.includes(axis)) throw new Error(`Unknown flip axis: ${axis}`);
}
