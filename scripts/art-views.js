import { MODULE_ID } from './constants.js';

// A token can keep two looks, its regular art and an AI top-down version, and switch between them
// from the Token HUD. Each look remembers the texture and ring fields it was shown with.
export const ART_VIEWS_FLAG_KEY = 'artViews';
export const ART_VIEWS_FLAG_PATH = `flags.${MODULE_ID}.${ART_VIEWS_FLAG_KEY}`;
const ART_FIELDS = Object.freeze({
  src: 'texture.src',
  scaleX: 'texture.scaleX',
  scaleY: 'texture.scaleY',
  ring: 'ring.enabled',
  subject: 'ring.subject.texture',
  subjectScale: 'ring.subject.scale',
});

/** The look a token (or prototype token) shows now, with `update`'s pending changes on top. */
export function readTokenArt(documentLike, update = {}) {
  const art = {};
  for (const [key, path] of Object.entries(ART_FIELDS)) {
    const value = Object.hasOwn(update, path) ? update[path] : readPath(documentLike, path);
    if (value !== undefined) art[key] = value ?? null;
  }
  return art;
}

/** The two saved looks, or null unless both are there. */
export function readArtViews(documentLike) {
  const views =
    readPath(documentLike?._source, ART_VIEWS_FLAG_PATH) ??
    readPath(documentLike, ART_VIEWS_FLAG_PATH);
  return views?.regular?.src && views?.topDown?.src ? views : null;
}

/** Whether the document shows its top-down look (null when it has no pair of looks). */
export function isShowingTopDown(documentLike) {
  const views = readArtViews(documentLike);
  if (!views) return null;
  return readPath(documentLike, 'texture.src') === views.topDown.src;
}

/**
 * The flag change that goes with applying new art (`update`, Foundry's flat update keys, each
 * prefixed with `prefix`, e.g. `prototypeToken.`): top-down art keeps what was shown before as
 * the regular look; regular art replaces the regular look of a token that has a top-down one.
 */
export function buildArtViewsUpdate(documentLike, update, { topDown = false, prefix = '' } = {}) {
  const pending = {};
  for (const [key, value] of Object.entries(update ?? {}))
    if (key.startsWith(prefix)) pending[key.slice(prefix.length)] = value;
  const after = readTokenArt(documentLike, pending);
  const existing = readArtViews(documentLike);
  const path = `${prefix}${ART_VIEWS_FLAG_PATH}`;
  if (topDown) {
    // Replacing one top-down look with another keeps the regular look it was paired with.
    const regular =
      existing && isShowingTopDown(documentLike) ? existing.regular : readTokenArt(documentLike);
    if (!regular.src || regular.src === after.src) return {};
    return { [path]: { regular, topDown: after } };
  }
  if (!existing) return {};
  return { [path]: { regular: after, topDown: existing.topDown } };
}

/**
 * The update that switches a token to its other look, or null when it has no pair. The look
 * being left is saved as it is now, so scale changes made since are kept. Art that is neither
 * look counts as the regular one, so switching to top-down never loses it.
 */
export function buildArtToggleUpdate(documentLike) {
  const views = readArtViews(documentLike);
  if (!views) return null;
  const current = readTokenArt(documentLike);
  const showingTopDown = current.src === views.topDown.src;
  const target = showingTopDown ? views.regular : views.topDown;
  const update = {};
  for (const [key, path] of Object.entries(ART_FIELDS))
    if (Object.hasOwn(target, key)) update[path] = target[key];
  update[ART_VIEWS_FLAG_PATH] = showingTopDown
    ? { regular: views.regular, topDown: current }
    : { regular: current, topDown: views.topDown };
  return update;
}

function readPath(object, path) {
  let value = object;
  for (const key of path.split('.')) {
    if (value === null || value === undefined) return undefined;
    value = value[key];
  }
  return value;
}
