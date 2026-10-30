import { analyseSubject, findProtrusions } from './auto-compose.js';
import { applyPreset, createPin } from './animation.js';
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

/**
 * `alpha` is the grid from getAlphaGrid ({ alpha, width, height, scale }); the pins come back in
 * source-image pixels. `view`, `clipRadius` and `gridSize` describe the token framing used to find
 * protruding parts.
 */
export function buildAutoRig({ alpha, cutoutWidth, cutoutHeight, view, clipRadius, gridSize }) {
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

  const tipPins = findTips({ alpha, view, clipRadius, gridSize, head, make, toSourceX, toSourceY });

  const moving = [headPin, chestPin, ...tipPins];
  const movingIds = moving.map((pin) => pin.id);
  const amplitude = getPresetAmplitude('bob', size);
  let pins = [headPin, chestPin, ...anchors, ...tipPins];
  pins = applyPreset(pins, movingIds, 'breathe');
  pins = applyPreset(pins, [headPin.id], 'bob', { amplitude: amplitude * HEAD_BOB_SHARE });
  if (tipPins.length === 2) {
    pins = applyPreset(
      pins,
      tipPins.map((pin) => pin.id),
      'flap',
      { amplitude },
    );
  } else if (tipPins.length === 1) {
    pins = applyPreset(pins, [tipPins[0].id], 'sway', { amplitude });
  }
  return { pins, selectedPinIds: pins.map((pin) => pin.id) };
}

function findTips({ alpha, view, clipRadius, gridSize, head, make, toSourceX, toSourceY }) {
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
    .slice(0, MAX_TIPS)
    .map(({ point }) => make(point.x * toSourceX, point.y * toSourceY));
}
