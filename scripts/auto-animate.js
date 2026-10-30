import { analyseSubject, findProtrusions } from './auto-compose.js';
import {
  applyPreset,
  createPin,
  KEYFRAME_MERGE,
  loopDistance,
  PINGPONG_MAX_KEY,
  samplePinOffset,
} from './animation.js';
import { getRotationArm, getPresetAmplitude } from './token-animation.js';
import { getTokenFrameLayout } from './token-composer.js';

// Auto animate: places pins on the head, chest, base and any protruding tips of the cut-out and
// gives them an idle loop. Works on a plain alpha grid so it can be tested without a browser.
// Each tip moves by what it is, read from where it points as seen from the chest: a crest (a
// horn, a raised weapon) sways, a wing flaps and a tail swings, and the parts lag behind the body
// by different amounts so the figure does not move in lockstep.

const CHEST_DROP = 1.6;
const ANCHOR_SHARES = [0.25, 0.75];
const HEAD_BOB_SHARE = 0.6;
const MAX_TIPS = 2;
const MIN_TIP_AREA = 2;
// Tips this close (in head radii) to the head belong to the head, not to a held item.
const HEAD_CLEARANCE = 1.2;
// Tips closer than this share of the figure's longest side are two pieces of one part (a wing cut
// by the frame twice), so only the farther one gets a pin.
const MIN_TIP_SPACING = 0.15;
// A tip pointing this steeply up (unit y below minus this) is a crest; this steeply down, a tail.
const CREST_SLOPE = 0.7;
const TAIL_SLOPE = 0.4;
const CREST_SWAY = 0.7;
const FLAP_PULL = 0.3;
// Share of the loop each part trails the chest's breath by; the head follows a little behind.
const HEAD_LAG = 0.08;
const ROLE_LAG = { crest: 0.1, wing: 0, tail: 0.25 };
// A second crest or tail trails the first by this much more; wings beat together.
const SAME_ROLE_LAG = 0.12;
// Tips farther from the chest than half the figure's longest side move more, nearer ones less.
const MIN_REACH = 0.75;
const MAX_REACH = 1.5;
// The longest ping-pong hold before a lagging part starts to move.
const PINGPONG_MAX_HOLD = 0.9;

/**
 * `alpha` is the grid from getAlphaGrid ({ alpha, width, height, scale }); the pins come back in
 * source-image pixels. `view`, `clipRadius` and `gridSize` describe the token framing used to find
 * protruding parts. `mode` is the playback mode the keyframes are shaped for (see applyPreset).
 */
export function buildAutoRig({
  alpha,
  cutoutWidth,
  cutoutHeight,
  view,
  clipRadius,
  gridSize,
  mode = 'loop',
}) {
  const analysis = analyseSubject(alpha);
  if (!analysis) return { pins: [], selectedPinIds: [], parts: null };
  const size = { width: cutoutWidth, height: cutoutHeight };
  const toSourceX = cutoutWidth / alpha.width;
  const toSourceY = cutoutHeight / alpha.height;
  const arm = getRotationArm(size);
  const make = (x, y) => createPin({ x: Math.round(x), y: Math.round(y), arm });

  const { bounds, head } = analysis;
  const bottom = bounds.y + bounds.height;
  const headPin = make(head.x * toSourceX, head.y * toSourceY);
  const chestY = Math.min(head.y + CHEST_DROP * head.radius, bottom);
  const chestPin = make(head.x * toSourceX, chestY * toSourceY);
  const anchors = ANCHOR_SHARES.map((share) =>
    make((bounds.x + bounds.width * share) * toSourceX, bottom * toSourceY),
  );

  const spacing = MIN_TIP_SPACING * Math.max(bounds.width, bounds.height);
  const tipPins = findTips({
    alpha,
    view,
    clipRadius,
    gridSize,
    head,
    spacing,
    make,
    toSourceX,
    toSourceY,
  });

  const amplitude = getPresetAmplitude('bob', size);
  const bodyIds = [headPin.id, chestPin.id];
  const breathing = applyPreset([headPin, chestPin], bodyIds, 'breathe', { mode });
  // The head's bob is layered over its breath, a beat behind it; anchors stay still.
  const bob = delayedKeyframes(
    { dx: 0, dy: 0 },
    { dx: 0, dy: -amplitude * HEAD_BOB_SHARE },
    HEAD_LAG,
    mode,
  );
  // The head breathes and bobs; its button is Bob, the motion it shows most.
  const headBobbing = {
    ...breathing[0],
    keyframes: layerPresetKeyframes(breathing[0].keyframes, bob, mode),
    preset: 'bob',
  };
  const reachUnit = (Math.max(bounds.width * toSourceX, bounds.height * toSourceY) || 1) / 2;
  const tips = animateTips(tipPins, chestPin, { amplitude, reachUnit, mode });
  // Nothing stays selected: a preset clicked next would otherwise land on every pin at once.
  // `parts` names the pins whose whole part AI tools may cut out and move (see auto-parts.js).
  return {
    pins: [headBobbing, breathing[1], ...anchors, ...tips],
    selectedPinIds: [],
    parts: {
      chestId: chestPin.id,
      anchorIds: anchors.map((pin) => pin.id),
      tipIds: tips.map((pin) => pin.id),
    },
  };
}

/** What a tip is, from its direction seen from the chest: 'crest' (up), 'tail' (down) or 'wing'. */
export function classifyTip(tip, chest) {
  const dx = tip.x - chest.x;
  const dy = tip.y - chest.y;
  const length = Math.hypot(dx, dy) || 1;
  if (dy / length < -CREST_SLOPE) return 'crest';
  if (dy / length > TAIL_SLOPE) return 'tail';
  return 'wing';
}

/** Gives each tip pin the motion of its role, scaled by its reach and lagging by role. */
function animateTips(tips, chest, { amplitude, reachUnit, mode }) {
  const seen = { crest: 0, wing: 0, tail: 0 };
  return tips.map((tip) => {
    const role = classifyTip(tip, chest);
    const dx = tip.x - chest.x;
    const dy = tip.y - chest.y;
    const length = Math.hypot(dx, dy) || 1;
    const reach = Math.min(MAX_REACH, Math.max(MIN_REACH, length / reachUnit));
    const swing = amplitude * reach;
    let from;
    let to;
    if (role === 'crest') {
      from = { dx: -swing * CREST_SWAY, dy: 0 };
      to = { dx: swing * CREST_SWAY, dy: 0 };
    } else if (role === 'wing') {
      from = { dx: 0, dy: 0 };
      to = { dx: Math.sign(-dx) * swing * FLAP_PULL, dy: swing };
    } else {
      // A tail swings across its own length.
      const nx = -dy / length;
      const ny = dx / length;
      from = { dx: -nx * swing, dy: -ny * swing };
      to = { dx: nx * swing, dy: ny * swing };
    }
    const lag = ROLE_LAG[role] + (role === 'wing' ? 0 : seen[role] * SAME_ROLE_LAG);
    seen[role] += 1;
    const moved = { ...tip, keyframes: delayedKeyframes(from, to, lag, mode) };
    // A crest sways and a wing flaps like those presets; a tail's swing is no preset of its own.
    const preset = { crest: 'sway', wing: 'flap' }[role];
    return preset ? { ...moved, preset } : moved;
  });
}

/**
 * Keyframes going from `from` to `to` and back, starting `lag` of the loop late. In ping-pong the
 * part holds `from` for a while instead, so it still reaches `to` at the apex.
 */
function delayedKeyframes(from, to, lag, mode) {
  const key = (t, value) => ({ t, dx: value.dx, dy: value.dy });
  if (mode === 'pingpong') {
    const hold = Math.min(PINGPONG_MAX_HOLD, 2 * lag);
    const keys = [key(0, from)];
    if (hold >= KEYFRAME_MERGE) keys.push(key(hold, from));
    keys.push(key(PINGPONG_MAX_KEY, to));
    return keys;
  }
  if (lag < KEYFRAME_MERGE) return [key(0, from), key(0.5, to)];
  return [key(lag, from), key(lag + 0.5, to)];
}

/**
 * Sums two keyframe tracks. Keyframes within the merge tolerance combine; otherwise both are kept,
 * each with the other track sampled at that time so the sum is right everywhere. In ping-pong a
 * track holds its last key instead of wrapping back to its first one.
 */
export function layerPresetKeyframes(base, added, mode = 'loop') {
  const times = [...base.map((key) => key.t)];
  for (const key of added) {
    if (!times.some((t) => loopDistance(t, key.t) < KEYFRAME_MERGE)) times.push(key.t);
  }
  times.sort((a, b) => a - b);
  const baseTrack = { keyframes: base };
  const addedTrack = { keyframes: added };
  // A ping-pong keyframe time u is played at scrub time u / 2 on the way out.
  const at = (t) => (mode === 'pingpong' ? t / 2 : t);
  return times.map((t) => {
    const one = samplePinOffset(baseTrack, at(t), mode);
    const two = samplePinOffset(addedTrack, at(t), mode);
    const key = { t, dx: one.dx + two.dx, dy: one.dy + two.dy };
    const rot = one.rot + two.rot;
    if (rot) key.rot = rot;
    return key;
  });
}

function findTips({
  alpha,
  view,
  clipRadius,
  gridSize,
  head,
  spacing,
  make,
  toSourceX,
  toSourceY,
}) {
  const layout = getTokenFrameLayout({
    imageWidth: alpha.width,
    imageHeight: alpha.height,
    size: gridSize,
    zoom: view.zoom,
    offsetX: view.offsetX * gridSize,
    offsetY: view.offsetY * gridSize,
  });
  const center = gridSize / 2;
  const toGrid = (point) => ({
    x: ((point.x - layout.x) * alpha.width) / layout.width,
    y: ((point.y - layout.y) * alpha.height) / layout.height,
  });
  const { pieces } = findProtrusions({ alpha, view, clipRadius, gridSize });
  return pieces
    .filter((piece) => !piece.inBottomArc && piece.area >= MIN_TIP_AREA)
    .map((piece) => ({
      piece,
      point: toGrid(piece.tip),
      distance: Math.hypot(piece.tip.x - center, piece.tip.y - center),
    }))
    .filter(
      ({ point }) => Math.hypot(point.x - head.x, point.y - head.y) > head.radius * HEAD_CLEARANCE,
    )
    .sort((a, b) => b.distance - a.distance)
    .reduce((kept, tip) => {
      const apart = kept.every(
        (other) => Math.hypot(other.point.x - tip.point.x, other.point.y - tip.point.y) >= spacing,
      );
      return apart && kept.length < MAX_TIPS ? [...kept, tip] : kept;
    }, [])
    .map(({ point }) => make(point.x * toSourceX, point.y * toSourceY));
}
