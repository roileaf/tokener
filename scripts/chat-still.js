import { STILL_FLAG_PATH } from './actions.js';

// PF2e shows the speaker's token in chat cards, but only when the token is an image: an animated
// (WebM) token falls back to the actor portrait. Tokener saves a still frame next to each animated
// token, which is shown instead: trimmed to the creature and fitted whole in the circle, without
// the ring enlargement PF2e gives ring tokens (breakout art would spill out and fade).
const FIT_MARGIN = 0.06;
const fittedStills = new Map();

/** The still image saved for the token `document` shows now, or null. */
export function getTokenStill(document) {
  const still = readPath(document, STILL_FLAG_PATH);
  const src = readPath(document, 'texture.src');
  return still?.image && still.src === src ? still.image : null;
}

/**
 * The square whose inscribed circle holds every opaque pixel of `alpha` (width x height), centred
 * on their box, with `margin` (share of its side) to spare: `{ x, y, size }`, or null when nothing
 * is opaque. Chat portraits are round, so a square that only boxes the art would clip its corners.
 */
export function getFittedSquare(
  alpha,
  width,
  height,
  { threshold = 16, margin = FIT_MARGIN } = {},
) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] < threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  if (maxX < 0) return null;
  const cx = (minX + maxX + 1) / 2;
  const cy = (minY + maxY + 1) / 2;
  let reach = 0;
  for (let y = minY; y <= maxY; y += 1)
    for (let x = minX; x <= maxX; x += 1) {
      if (alpha[y * width + x] < threshold) continue;
      // The pixel's far corner from the centre.
      const dx = Math.max(Math.abs(x - cx), Math.abs(x + 1 - cx));
      const dy = Math.max(Math.abs(y - cy), Math.abs(y + 1 - cy));
      reach = Math.max(reach, dx * dx + dy * dy);
    }
  const size = Math.ceil(2 * Math.sqrt(reach) * (1 + margin * 2));
  return { x: Math.round(cx - size / 2), y: Math.round(cy - size / 2), size };
}

/** `src` trimmed to its creature as a data URL (cached per image), or `src` when it cannot be. */
function fitStill(src) {
  if (!fittedStills.has(src))
    fittedStills.set(
      src,
      (async () => {
        try {
          const image = new Image();
          image.src = src;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0);
          const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
          const alpha = new Uint8ClampedArray(width * height);
          for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = data[pixel * 4 + 3];
          const square = getFittedSquare(alpha, width, height);
          if (!square) return src;
          const fitted = document.createElement('canvas');
          fitted.width = fitted.height = Math.min(square.size, 256);
          fitted
            .getContext('2d')
            .drawImage(
              image,
              square.x,
              square.y,
              square.size,
              square.size,
              0,
              0,
              fitted.width,
              fitted.height,
            );
          return fitted.toDataURL('image/webp');
        } catch {
          return src;
        }
      })(),
    );
  return fittedStills.get(src);
}

/**
 * Swaps the actor portrait PF2e put in a chat card's header for the speaker token's still, fitted
 * whole in the circle. `fit` (src -> Promise of the image to show) is replaceable for tests.
 */
export function showChatStill(message, html, { fit = fitStill } = {}) {
  const portrait = html?.querySelector?.('header.message-header .portrait.actor-image');
  const img = portrait?.querySelector('img');
  if (!img) return false;
  const document = message?.token ?? message?.actor?.prototypeToken;
  const still = getTokenStill(document);
  if (!still) return false;
  img.style.transform = '';
  img.style.maskImage = '';
  portrait.classList.replace('actor-image', 'token');
  return Promise.resolve(fit(still)).then((src) => {
    img.src = src;
    return true;
  });
}

export function registerChatStill(hooks = globalThis.Hooks) {
  hooks?.on?.('renderChatMessageHTML', (message, html) => {
    showChatStill(message, html);
  });
}

function readPath(object, path) {
  let value = object;
  for (const key of path.split('.')) {
    if (value === null || value === undefined) return undefined;
    value = value[key];
  }
  return value;
}
