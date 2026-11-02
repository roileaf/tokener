import { STILL_FLAG_PATH } from './actions.js';

// PF2e shows the speaker's token in chat cards, but only when the token is an image: an animated
// (WebM) token falls back to the actor portrait. Tokener saves a still of the creature next to
// each animated token, which is shown instead: trimmed to the creature so it fills PF2e's square,
// without the ring enlargement and faded edge PF2e gives ring tokens.
const FIT_MARGIN = 0.04;
const fittedStills = new Map();

/** The still image saved for the token `document` shows now, or null. */
export function getTokenStill(document) {
  const still = readPath(document, STILL_FLAG_PATH);
  const src = readPath(document, 'texture.src');
  return still?.image && still.src === src ? still.image : null;
}

/**
 * The box around the opaque pixels of `alpha` (width x height), widened by `margin` (share of its
 * longer side) and kept inside the image: `{ x, y, width, height }`, or null when nothing is
 * opaque.
 */
export function getCreatureBox(alpha, width, height, { threshold = 16, margin = FIT_MARGIN } = {}) {
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
  const pad = Math.round(Math.max(maxX - minX + 1, maxY - minY + 1) * margin);
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  return {
    x,
    y,
    width: Math.min(width, maxX + 1 + pad) - x,
    height: Math.min(height, maxY + 1 + pad) - y,
  };
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
          const box = getCreatureBox(alpha, width, height);
          if (!box) return src;
          const scale = Math.min(1, 256 / Math.max(box.width, box.height));
          const fitted = document.createElement('canvas');
          fitted.width = Math.max(1, Math.round(box.width * scale));
          fitted.height = Math.max(1, Math.round(box.height * scale));
          fitted
            .getContext('2d')
            .drawImage(
              image,
              box.x,
              box.y,
              box.width,
              box.height,
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
 * Swaps the actor portrait PF2e put in a chat card's header for the speaker token's still,
 * trimmed to the creature. `fit` (src -> Promise of the image to show) is replaceable for tests.
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
  // PF2e's token class fits the image whole (its portrait class crops it).
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
