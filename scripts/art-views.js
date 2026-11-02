import { MODULE_ID } from './constants.js';

// A token can keep several looks: its regular art, an AI top-down version and top-down versions
// in other stances, and switch between them from the Token HUD. Each look remembers the texture
// and ring fields it was shown with.
export const ART_VIEWS_FLAG_KEY = 'artViews';
export const ART_VIEWS_FLAG_PATH = `flags.${MODULE_ID}.${ART_VIEWS_FLAG_KEY}`;
/** Every look a token can have, in the order the Token HUD lists them. */
export const LOOK_IDS = Object.freeze(['regular', 'topDown', 'attacking', 'casting', 'sneaking']);
const ART_FIELDS = Object.freeze({
  src: 'texture.src',
  scaleX: 'texture.scaleX',
  scaleY: 'texture.scaleY',
  ring: 'ring.enabled',
  subject: 'ring.subject.texture',
  subjectScale: 'ring.subject.scale',
  // Each look keeps its own turn: a top-down look turns to face its movement, the regular one
  // stays as it was set.
  rotation: 'rotation',
});
/** Where each made look faces in its image: front looks face the bottom, back looks the top. */
const FACING_HEADINGS = Object.freeze({ front: 90, back: 270 });

/** The look a token (or prototype token) shows now, with `update`'s pending changes on top. */
export function readTokenArt(documentLike, update = {}) {
  const art = {};
  for (const [key, path] of Object.entries(ART_FIELDS)) {
    const value = Object.hasOwn(update, path) ? update[path] : readPath(documentLike, path);
    if (value !== undefined) art[key] = value ?? null;
  }
  return art;
}

/** The saved looks by id, or null unless there is a regular look and at least one other. */
export function readArtViews(documentLike) {
  const stored =
    readPath(documentLike?._source, ART_VIEWS_FLAG_PATH) ??
    readPath(documentLike, ART_VIEWS_FLAG_PATH);
  const views = {};
  for (const id of LOOK_IDS) if (stored?.[id]?.src) views[id] = stored[id];
  return views.regular && Object.keys(views).length > 1 ? views : null;
}

/** The saved looks in Token HUD order: `[{ id, art }]` (empty without at least two). */
export function listLooks(documentLike) {
  const views = readArtViews(documentLike);
  return views ? LOOK_IDS.filter((id) => views[id]).map((id) => ({ id, art: views[id] })) : [];
}

/**
 * The look the document shows now. Art that is none of its looks counts as the regular one, so
 * switching away never loses it. Null when it has no looks to switch between.
 */
export function getShownLook(documentLike, views = readArtViews(documentLike)) {
  if (!views) return null;
  const src = readPath(documentLike, 'texture.src');
  return LOOK_IDS.find((id) => id !== 'regular' && views[id]?.src === src) ?? 'regular';
}

/** Whether the document shows a top-down look (null when it has no looks to switch between). */
export function isShowingTopDown(documentLike) {
  const shown = getShownLook(documentLike);
  return shown === null ? null : shown !== 'regular';
}

/**
 * The flag change that goes with applying new art (`update`, Foundry's flat update keys, each
 * prefixed with `prefix`, e.g. `prototypeToken.`), shown as look `look`. `others` (look id ->
 * that look's unprefixed token update) sets every look at once, as the Token Creator does when it
 * saves the regular token with its top-down ones. Without it, a top-down look keeps what was
 * shown before as the regular look, and regular art replaces the regular look of a token that
 * has others.
 */
export function buildArtViewsUpdate(
  documentLike,
  update,
  { look = 'regular', prefix = '', others = null, facings = {} } = {},
) {
  const pending = {};
  for (const [key, value] of Object.entries(update ?? {}))
    if (key.startsWith(prefix)) pending[key.slice(prefix.length)] = value;
  const after = readTokenArt(documentLike, pending);
  const path = `${prefix}${ART_VIEWS_FLAG_PATH}`;
  if (others) {
    const views = { [look]: after };
    for (const [id, otherUpdate] of Object.entries(others))
      views[id] = readTokenArt(documentLike, otherUpdate);
    return { [path]: storedViews(withFacings(views, facings)) };
  }
  const existing = readArtViews(documentLike);
  if (look !== 'regular') {
    const regular =
      existing && getShownLook(documentLike, existing) !== 'regular'
        ? existing.regular
        : readTokenArt(documentLike);
    if (!regular.src || regular.src === after.src) return {};
    return { [path]: storedViews(withFacings({ ...existing, regular, [look]: after }, facings)) };
  }
  if (!existing) return {};
  return { [path]: storedViews({ ...existing, regular: after }) };
}

/**
 * The update that switches a token to look `id`, or null when it has no such look or shows it
 * already. The look being left is saved as it is now, so scale changes made since are kept.
 */
export function buildLookUpdate(documentLike, id) {
  const views = readArtViews(documentLike);
  const target = views?.[id];
  const shown = getShownLook(documentLike, views);
  if (!target || shown === id) return null;
  const update = {};
  for (const [key, path] of Object.entries(ART_FIELDS))
    if (Object.hasOwn(target, key)) update[path] = target[key];
  // The regular look is never turned: top-down looks turn to face their movement, it does not.
  if (id === 'regular') update.rotation = 0;
  update[ART_VIEWS_FLAG_PATH] = storedViews({
    ...views,
    [shown]: { ...views[shown], ...readTokenArt(documentLike) },
  });
  return update;
}

/**
 * The rotation that turns a token showing a top-down look towards where `changes` moves it, or
 * null (no move, a regular look, a look with no known facing, or a token whose rotation is
 * locked). Foundry rotates clockwise from the image as drawn; a front look faces the bottom of
 * its image, a back look the top.
 */
export function getMovementRotation(documentLike, changes, facing = getLookFacing(documentLike)) {
  const views = readArtViews(documentLike);
  const shown = getShownLook(documentLike, views);
  const heading = FACING_HEADINGS[facing];
  if (!heading || shown === 'regular' || documentLike?.lockRotation) return null;
  const dx = Number(changes?.x ?? documentLike.x) - Number(documentLike.x);
  const dy = Number(changes?.y ?? documentLike.y) - Number(documentLike.y);
  if (!dx && !dy) return null;
  const rotation = (Math.atan2(dy, dx) * 180) / Math.PI - heading;
  return Math.round(((rotation % 360) + 360) % 360);
}

/**
 * The rotation that makes a look facing `facing` point along the last step of `points` (positions
 * `{ x, y }` in order, the token's size unchanged), or null when it never moves. Always the same
 * for the same path, so updates that repeat it never turn the token further.
 */
export function getRotationAlong(points, facing) {
  const heading = FACING_HEADINGS[facing];
  if (!heading) return null;
  const path = points.filter(Boolean);
  for (let index = path.length - 1; index > 0; index -= 1) {
    const dx = Number(path[index].x) - Number(path[index - 1].x);
    const dy = Number(path[index].y) - Number(path[index - 1].y);
    if (!dx && !dy) continue;
    const rotation = (Math.atan2(dy, dx) * 180) / Math.PI - heading;
    return Math.round(((rotation % 360) + 360) % 360);
  }
  return null;
}

/** The facing recorded for the shown look, or null (a regular look, or none recorded). */
export function getLookFacing(documentLike) {
  const views = readArtViews(documentLike);
  const shown = getShownLook(documentLike, views);
  if (!views || shown === 'regular') return null;
  return FACING_HEADINGS[views[shown].facing] ? views[shown].facing : null;
}

/** `views` with each look's facing (`facings`: look id -> 'front' | 'back') recorded on it. */
function withFacings(views, facings) {
  const out = { ...views };
  for (const [id, facing] of Object.entries(facings ?? {}))
    if (out[id] && FACING_HEADINGS[facing]) out[id] = { ...out[id], facing };
  return out;
}

/** Between the regular look and the top-down one (or the first other look there is). */
export function buildArtToggleUpdate(documentLike) {
  const views = readArtViews(documentLike);
  if (!views) return null;
  if (getShownLook(documentLike, views) !== 'regular')
    return buildLookUpdate(documentLike, 'regular');
  return buildLookUpdate(documentLike, views.topDown ? 'topDown' : listLooks(documentLike)[1].id);
}

/** Every look id set, missing ones to null, so a stored look that is gone is cleared too. */
function storedViews(views) {
  return Object.fromEntries(LOOK_IDS.map((id) => [id, views[id]?.src ? views[id] : null]));
}

function readPath(object, path) {
  let value = object;
  for (const key of path.split('.')) {
    if (value === null || value === undefined) return undefined;
    value = value[key];
  }
  return value;
}
