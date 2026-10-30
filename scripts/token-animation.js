import { hasMotion, samplePins } from './animation.js';
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
