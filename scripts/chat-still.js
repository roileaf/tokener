import { STILL_FLAG_PATH } from './actions.js';

// PF2e shows the speaker's token in chat cards, but only when the token is an image: an animated
// (WebM) token falls back to the actor portrait. Tokener saves a still frame next to each animated
// token, which is shown instead, sized the way PF2e sizes still tokens.
const RING_SUBJECT_SHARE = 0.7936514;

/** The still image saved for the token `document` shows now, or null. */
export function getTokenStill(document) {
  const still = readPath(document, STILL_FLAG_PATH);
  const src = readPath(document, 'texture.src');
  return still?.image && still.src === src ? still.image : null;
}

/** Swaps the actor portrait PF2e put in a chat card's header for the speaker token's still. */
export function showChatStill(message, html) {
  const portrait = html?.querySelector?.('header.message-header .portrait.actor-image');
  const img = portrait?.querySelector('img');
  if (!img) return false;
  const document = message?.token ?? message?.actor?.prototypeToken;
  const still = getTokenStill(document);
  if (!still) return false;
  const ring = readPath(document, 'ring.enabled') ? 1 / RING_SUBJECT_SHARE : 1;
  const scale = Math.max(1, Math.abs(Number(readPath(document, 'texture.scaleX')) || 1)) * ring;
  img.src = still;
  img.style.transform = `scale(${scale})`;
  // As PF2e does: art enlarged past the frame fades out towards the edge.
  if (scale > 1.2) {
    const solid = 100 - Math.floor(((scale - 0.7) / scale) * 100);
    const faded = 100 - Math.floor(((scale - 1.15) / scale) * 100);
    img.style.maskImage = `radial-gradient(circle at center, black ${solid}%, rgba(0, 0, 0, 0.2) ${faded}%)`;
  }
  portrait.classList.replace('actor-image', 'token');
  return true;
}

export function registerChatStill(hooks = globalThis.Hooks) {
  hooks?.on?.('renderChatMessageHTML', (message, html) => showChatStill(message, html));
}

function readPath(object, path) {
  let value = object;
  for (const key of path.split('.')) {
    if (value === null || value === undefined) return undefined;
    value = value[key];
  }
  return value;
}
