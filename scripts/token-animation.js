import { DEFAULT_ANIMATION, hasMotion, samplePinOffset, samplePins } from './animation.js';
import { buildWarpGrid, warpImageData } from './puppet-warp.js';
import { getTokenFrameLayout } from './token-composer.js';

/** Draws `image` into a size x size canvas at the token layout. */
function drawLayout(image, layout, size, createCanvas) {
  const canvas = createCanvas(size, size);
  canvas.getContext('2d').drawImage(image, layout.x, layout.y, layout.width, layout.height);
  return canvas;
}

function warpCanvas(canvas, grid, size, createCanvas) {
  const context = canvas.getContext('2d');
  const source = context.getImageData(0, 0, size, size);
  const out = createCanvas(size, size);
  const outContext = out.getContext('2d');
  const target = outContext.createImageData(size, size);
  warpImageData(source, grid, target);
  outContext.putImageData(target, 0, 0);
  return out;
}

/**
 * Bends the token art (and its pop-out image) at loop time `t` in token space, so the frame or
 * ring drawn afterwards stays still. `view.offsetX/Y` are fractions of `size`, as in `app.view`.
 * Returns size x size canvases that draw at an identity layout.
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
  let art = drawLayout(cutout, layout, size, createCanvas);
  let popOut = popOutImage ? drawLayout(popOutImage, layout, size, createCanvas) : null;
  if (!hasMotion(animation)) return { art, popOut };

  const scale = layout.width / Math.max(1, imageWidth);
  const { rest, moved } = samplePins(animation.pins, t);
  const toToken = (point) => ({ x: layout.x + point.x * scale, y: layout.y + point.y * scale });
  const grid = buildWarpGrid({
    width: size,
    height: size,
    rest: rest.map(toToken),
    moved: moved.map(toToken),
  });
  art = warpCanvas(art, grid, size, createCanvas);
  if (popOut) popOut = warpCanvas(popOut, grid, size, createCanvas);
  return { art, popOut };
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
