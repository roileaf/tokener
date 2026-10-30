import { analyseSubject, findProtrusions } from './auto-compose.js';
import {
  applyPreset,
  createPin,
  KEYFRAME_MERGE,
  loopDistance,
  samplePinOffset,
} from './animation.js';
import { getRotationArm, getPresetAmplitude } from './token-animation.js';
import { getTokenFrameLayout } from './token-composer.js';

// Auto animate: places pins on the head, chest, base and any protruding tips of the cut-out and
// gives them an idle loop. Works on a plain alpha grid so it can be tested without a browser.

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
  if (!analysis) return { pins: [], selectedPinIds: [] };
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
  let pins = applyPreset([headPin, chestPin, ...anchors, ...tipPins], bodyIds, 'breathe', {
    mode,
  });
  // Bob, Flap and Sway are layered over Breathe, not written in its place; anchors stay still.
  pins = layerPreset(pins, [headPin.id], 'bob', amplitude * HEAD_BOB_SHARE, mode);
  if (tipPins.length === 2) {
    pins = layerPreset(
      pins,
      tipPins.map((pin) => pin.id),
      'flap',
      amplitude,
      mode,
    );
  } else if (tipPins.length === 1) {
    pins = layerPreset(pins, [tipPins[0].id], 'sway', amplitude, mode);
  }
  // Nothing stays selected: a preset clicked next would otherwise land on every pin at once.
  return { pins, selectedPinIds: [] };
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

function layerPreset(pins, ids, preset, amplitude, mode) {
  const bare = pins.map((pin) => ({ ...pin, keyframes: [] }));
  const added = new Map(
    applyPreset(bare, ids, preset, { amplitude, mode }).map((pin) => [pin.id, pin.keyframes]),
  );
  return pins.map((pin) =>
    ids.includes(pin.id)
      ? { ...pin, keyframes: layerPresetKeyframes(pin.keyframes, added.get(pin.id), mode) }
      : pin,
  );
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
