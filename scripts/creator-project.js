/**
 * Token Creator projects: everything needed to reopen a created token and keep editing it,
 * saved next to the token as `<token file stem>.tokener.json`. Pure: canvases are turned into
 * data URLs by the injected `toDataUrl`, so this module never touches the DOM.
 */
import { normalizeAnimation } from './animation.js';
import { isSafeEffectKey, normalizeEffects } from './animation-effects.js';
import { MODULE_ID } from './constants.js';
import { normalizeFlip } from './image-flip.js';

export const PROJECT_VERSION = 1;
export const PROJECT_FLAG_KEY = 'project';
export const PROJECT_FLAG_PATH = `flags.${MODULE_ID}.${PROJECT_FLAG_KEY}`;
const PROJECT_EXTENSION = '.tokener.json';
const DEFAULT_VIEW = Object.freeze({ zoom: 1, offsetX: 0, offsetY: 0 });

/** `dragon-….webm` / `dragon-….webp` → `dragon-….tokener.json`. */
export function buildProjectFileName(tokenFileName) {
  const name = String(tokenFileName ?? '');
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}${PROJECT_EXTENSION}`;
}

/**
 * The project object for one save. `token` / `portrait` are workspace descriptors
 * `{ sourcePath, view, flip, popOutMask, cleanup: { keep, remove } }` whose masks are canvases
 * (or null) and `flip` is `{ x, y }` (how the source at `sourcePath` is mirrored; the masks are
 * stored already mirrored); `portrait` is null while the portrait shares the token's image. Only regions an
 * effect still uses are kept.
 */
export function serializeProject({
  label,
  output,
  options,
  token,
  portrait = null,
  portraitView,
  animation,
  regions,
  toDataUrl,
  now = new Date(),
}) {
  const encode = (canvas) => (canvas ? toDataUrl(canvas) : null);
  const workspace = (descriptor) =>
    descriptor
      ? {
          sourcePath: descriptor.sourcePath ?? null,
          view: normalizeView(descriptor.view),
          flip: normalizeFlip(descriptor.flip),
          popOutMask: encode(descriptor.popOutMask),
          cleanup: {
            keep: encode(descriptor.cleanup?.keep),
            remove: encode(descriptor.cleanup?.remove),
          },
        }
      : null;
  const normalized = normalizeProjectAnimation(animation);
  const used = new Set(normalized.effects.map((effect) => effect.region).filter(Boolean));
  const storedRegions = Object.create(null);
  for (const [key, canvas] of Object.entries(regions ?? {})) {
    if (used.has(key) && canvas) storedRegions[key] = toDataUrl(canvas);
  }
  return {
    version: PROJECT_VERSION,
    savedAt: now.toISOString(),
    label: label ?? '',
    output,
    options: { ...(options ?? {}) },
    token: workspace(token),
    portrait: workspace(portrait),
    portraitView: normalizeView(portraitView ?? portrait?.view),
    animation: { ...normalized, regions: storedRegions },
  };
}

/**
 * Reads a project (object or JSON text). Returns null for anything that is not a version 1
 * project with a token source path; malformed masks, views, effects and regions are dropped
 * or reset rather than failing the whole project.
 */
export function parseProject(json) {
  let raw = json;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isPlainObject(raw) || raw.version !== PROJECT_VERSION) return null;
  const token = parseWorkspace(raw.token);
  if (!token) return null;
  const animation = isPlainObject(raw.animation) ? raw.animation : {};
  // Region keys become object keys and selector values: no prototype, and only `[\w-]` keys
  // (normalizeEffects applies the same rule to effect ids and regions).
  const regions = Object.create(null);
  if (isPlainObject(animation.regions)) {
    for (const [key, value] of Object.entries(animation.regions)) {
      if (isSafeEffectKey(key) && isImageDataUrl(value)) regions[key] = value;
    }
  }
  return {
    version: PROJECT_VERSION,
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
    label: typeof raw.label === 'string' ? raw.label : '',
    output: typeof raw.output === 'string' ? raw.output : '',
    options: isPlainObject(raw.options) ? { ...raw.options } : {},
    token,
    portrait: parseWorkspace(raw.portrait),
    portraitView: normalizeView(raw.portraitView),
    animation: { ...normalizeProjectAnimation(animation), regions },
  };
}

/** The document update that links a token (or prototype token) to its saved project. */
export function getProjectFlagUpdate({ path, output }) {
  return { [PROJECT_FLAG_PATH]: { path, output } };
}

/**
 * The project to reopen for a token (or, for actor-only opens, the actor's prototype token):
 * `{ path }` only while the project flag's `output` is still the document's saved art. Revert
 * and later art changes leave the flag behind, and this check is what keeps it harmless.
 * Persisted `_source` data is read first so temporary overrides never decide.
 */
export function shouldLoadProject(documentLike) {
  if (!documentLike) return null;
  const target = documentLike.isTokenerActorProxy ? documentLike.prototypeToken : documentLike;
  if (!target) return null;
  const link =
    target._source?.flags?.[MODULE_ID]?.[PROJECT_FLAG_KEY] ??
    target.flags?.[MODULE_ID]?.[PROJECT_FLAG_KEY];
  const src = target._source?.texture?.src ?? target.texture?.src;
  if (!isPlainObject(link) || typeof link.path !== 'string' || !link.path) return null;
  if (typeof src !== 'string' || !src || link.output !== src) return null;
  return { path: link.path };
}

function normalizeProjectAnimation(animation) {
  const normalized = normalizeAnimation(animation);
  return { ...normalized, effects: normalizeEffects(normalized.effects) };
}

function parseWorkspace(value) {
  if (!isPlainObject(value)) return null;
  if (typeof value.sourcePath !== 'string' || !value.sourcePath) return null;
  const cleanup = isPlainObject(value.cleanup) ? value.cleanup : {};
  return {
    sourcePath: value.sourcePath,
    view: normalizeView(value.view),
    flip: normalizeFlip(value.flip),
    popOutMask: dataUrlOrNull(value.popOutMask),
    cleanup: { keep: dataUrlOrNull(cleanup.keep), remove: dataUrlOrNull(cleanup.remove) },
  };
}

function normalizeView(view) {
  const zoom = Number(view?.zoom);
  const offsetX = Number(view?.offsetX);
  const offsetY = Number(view?.offsetY);
  return {
    zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : DEFAULT_VIEW.zoom,
    offsetX: Number.isFinite(offsetX) ? offsetX : DEFAULT_VIEW.offsetX,
    offsetY: Number.isFinite(offsetY) ? offsetY : DEFAULT_VIEW.offsetY,
  };
}

function isImageDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image/');
}

function dataUrlOrNull(value) {
  return isImageDataUrl(value) ? value : null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
