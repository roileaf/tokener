import { DEFAULT_ANIMATION, hasMotion, samplePinOffset, samplePins } from './animation.js';
import { buildWarpGrid, warpImageData } from './puppet-warp.js';
import { getTokenFrameLayout } from './token-composer.js';

/** Largest edge, in pixels, of a saved animated token: VP9 + per-frame warps get slow beyond it. */
export const MAX_ANIMATED_SIZE = 512;

/** Share of the token size always kept around the art while bending, so edges never open up. */
const MIN_BEND_MARGIN = 0.1;

/** Draws `image` at `layout`, shifted by `margin`, into a (size + 2 margin) square canvas. */
function drawLayout(image, layout, size, margin, createCanvas) {
  const canvas = createCanvas(size + margin * 2, size + margin * 2);
  canvas
    .getContext('2d')
    .drawImage(image, layout.x + margin, layout.y + margin, layout.width, layout.height);
  return canvas;
}

/** Warps a padded canvas and keeps its centre `size` x `size` square. */
function warpCanvas(canvas, grid, size, margin, createCanvas) {
  const full = canvas.width;
  const source = canvas.getContext('2d').getImageData(0, 0, full, full);
  const warped = createCanvas(full, full);
  const warpedContext = warped.getContext('2d');
  const target = warpedContext.createImageData(full, full);
  warpImageData(source, grid, target);
  warpedContext.putImageData(target, 0, 0);
  if (!margin) return warped;
  const out = createCanvas(size, size);
  out.getContext('2d').drawImage(warped, -margin, -margin);
  return out;
}

/** Plain size x size art at the token layout (no motion). */
function drawStill(image, layout, size, createCanvas) {
  return drawLayout(image, layout, size, 0, createCanvas);
}

/**
 * Padding (token pixels) drawn around the art before warping: the largest pin or rotated control point offset at any
 * keyframe, and at least a tenth of the token, so art from outside the token edge can slide in.
 */
export function getBendMargin(pins, scale, size) {
  let largest = 0;
  for (const pin of pins ?? [])
    for (const key of pin.keyframes ?? []) {
      // A satellite at `arm` from the pin travels at most 2 arm sin(rot / 2) <= arm min(2, |rot|).
      const swing = (pin.arm ?? 0) * Math.min(2, Math.abs(key.rot ?? 0));
      largest = Math.max(
        largest,
        (Math.abs(key.dx) + swing) * scale,
        (Math.abs(key.dy) + swing) * scale,
      );
    }
  return Math.ceil(Math.max(size * MIN_BEND_MARGIN, largest));
}

/**
 * Bends the token art (and its pop-out image) at loop time `t` in token space, so the frame or
 * ring drawn afterwards stays still. `view.offsetX/Y` are fractions of `size`, as in `app.view`.
 * Returns size x size canvases that draw at an identity layout. The art is warped on a padded
 * canvas, so parts that overflow the token (cover layouts) move in instead of leaving gaps.
 */
export function bendTokenArt({ cutout, popOutImage, view, size, animation, t, createCanvas }) {
  const imageWidth = cutout.width;
  const imageHeight = cutout.height;
  const layout = getTokenFrameLayout({
    imageWidth,
    imageHeight,
    size,
    zoom: view?.zoom,
    offsetX: (view?.offsetX ?? 0) * size,
    offsetY: (view?.offsetY ?? 0) * size,
  });
  if (!hasMotion(animation))
    return {
      art: drawStill(cutout, layout, size, createCanvas),
      popOut: popOutImage ? drawStill(popOutImage, layout, size, createCanvas) : null,
    };

  const scale = layout.width / Math.max(1, imageWidth);
  const margin = getBendMargin(animation.pins, scale, size);
  const full = size + margin * 2;
  const { rest, moved } = samplePins(animation.pins, t, animation.mode);
  const toPadded = (point) => ({
    x: layout.x + margin + point.x * scale,
    y: layout.y + margin + point.y * scale,
  });
  const grid = buildWarpGrid({
    width: full,
    height: full,
    rest: rest.map(toPadded),
    moved: moved.map(toPadded),
  });
  const bend = (image) =>
    warpCanvas(
      drawLayout(image, layout, size, margin, createCanvas),
      grid,
      size,
      margin,
      createCanvas,
    );
  return { art: bend(cutout), popOut: popOutImage ? bend(popOutImage) : null };
}

/** The edge of the saved WebM: the chosen output size, capped at `MAX_ANIMATED_SIZE`. */
export function getAnimatedOutputSize(outputSize) {
  return Math.min(Number(outputSize) || MAX_ANIMATED_SIZE, MAX_ANIMATED_SIZE);
}

/** Preview playback runs under Move and the pin tool; mask and touch-up tools edit the still art. */
export function canPlayWithTool(maskTool) {
  return !maskTool || maskTool === 'pin';
}

/**
 * Whether the preview shows the bent art: not while a mask or touch-up tool is active, nor while
 * a modifier/right-button stroke would paint the pop-out mask under Move (`pointerMode` set),
 * because the mask overlay and brush map to the still art.
 */
export function shouldBendPreview({ maskTool, pointerMode }) {
  return canPlayWithTool(maskTool) && !pointerMode;
}

/** Breathe scales pins about their centre, so it needs at least two pins to do anything useful. */
export function isPresetAvailable(pins, selectedPinId, preset) {
  if (preset === 'breathe' && (pins?.length ?? 0) < 2) return false;
  return getPresetTargets(pins, selectedPinId, preset).length > 0;
}

/**
 * How the token is saved: an animated WebM loop only when some pin moves and this browser can
 * encode one; otherwise the usual still image.
 */
export function getAnimatedSavePlan({ animation, canEncode }) {
  return canEncode && hasMotion(animation) ? 'animated' : 'still';
}

/** A fresh animation for a newly loaded token image: pins belong to the old art, the loop length stays. */
export function resetAnimationForNewSource(animation) {
  return { ...DEFAULT_ANIMATION, ...(animation ?? {}), pins: [] };
}

/** True when a pin never moves, so it holds the art still around it. */
export function isAnchorPin(pin) {
  return !pin.keyframes?.some((k) => k.dx !== 0 || k.dy !== 0);
}

/**
 * Maps pins (source-image pixels) to preview points at loop time `t`, using the preview `layout`
 * of the cut-out (`getPreviewLayout`). Each point says whether it is selected or an anchor.
 */
export function getPinPreviewPoints({ pins, layout, cutoutWidth, t = 0, selectedId = null }) {
  const scale = layout.width / Math.max(1, cutoutWidth);
  return (pins ?? []).map((pin) => {
    const { dx, dy } = samplePinOffset(pin, t);
    return {
      id: pin.id,
      x: layout.x + (pin.x + dx) * scale,
      y: layout.y + (pin.y + dy) * scale,
      selected: pin.id === selectedId,
      anchor: isAnchorPin(pin),
    };
  });
}

/**
 * Which pins a preset writes: Bob and Sway move the selected pin only (none when nothing is
 * selected); Breathe scales every pin about their shared centre.
 */
export function getPresetTargets(pins, selectedPinId, preset) {
  const list = pins ?? [];
  if (preset === 'breathe') return list.map((pin) => pin.id);
  return list.some((pin) => pin.id === selectedPinId) ? [selectedPinId] : [];
}

/** Dragging a pin without keyframes moves where it rests; otherwise it sets its offset now. */
export function getPinDragMode(pin) {
  return pin?.keyframes?.length ? 'keyframe' : 'rest';
}

/**
 * Pin hit radius in token-space preview pixels for a radius given in screen (CSS) pixels: the
 * preview canvas may be drawn smaller or larger than its pixel size, and the viewport may zoom.
 */
export function getPinHitRadius({ radius, viewportScale = 1, canvasWidth, clientWidth }) {
  const cssScale = clientWidth > 0 && canvasWidth > 0 ? canvasWidth / clientWidth : 1;
  return (radius * cssScale) / (viewportScale || 1);
}
