// Animated clips from the Sequencer database (JB2A and any other module that registers effects)
// played inside an animated token. A clip is decoded once into frames, which are then drawn at a
// pin at each loop time, so the preview and the saved WebM show the same frames.

/** Frames per second a clip is sampled at; JB2A plays at 30, and half that is still smooth. */
const CLIP_FPS = 24;
/** Longest side a clip frame is decoded at; enough for any token output size. */
const CLIP_MAX_SIZE = 512;
/** Catalog words of clips that start at their source (a breath, a ray) rather than surround it. */
const DIRECTED_WORDS = ['cone', 'ray', 'line', 'breath', 'beam', 'bolt', 'blast', 'stream'];
/** Most entries a catalog search returns. */
const SEARCH_LIMIT = 200;

/**
 * The file behind a Sequencer database entry (`Sequencer.Database.getEntry(path)`): a plain
 * file, the shortest of a range-found set (keyed '05ft', '15ft'...) or the first random variant.
 */
export function resolveSequencerFile(entry) {
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry)) return entry.length ? resolveSequencerFile(entry[0]) : null;
  if (!entry || typeof entry !== 'object') return null;
  const { file } = entry;
  if (typeof file === 'string') return file;
  if (Array.isArray(file)) return file.length ? resolveSequencerFile(file[0]) : null;
  if (file && typeof file === 'object') {
    const keys = Object.keys(file).sort(
      (a, b) => (parseFloat(a) || Infinity) - (parseFloat(b) || Infinity),
    );
    for (const key of keys) {
      const resolved = resolveSequencerFile(file[key]);
      if (typeof resolved === 'string') return resolved;
    }
  }
  return null;
}

/** Catalog paths matching every word of `query` (case-insensitive), at most `limit` of them. */
export function searchSequencerEntries(paths, query, limit = SEARCH_LIMIT) {
  const words = String(query ?? '')
    .toLowerCase()
    .split(/[\s.]+/)
    .filter(Boolean);
  const found = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    if (words.every((word) => lower.includes(word))) found.push(path);
    if (found.length >= limit) break;
  }
  return found;
}

/** A short readable name for a catalog path: what follows its module and category. */
export function getSequencerEntryName(path) {
  const parts = String(path ?? '').split('.');
  const rest = parts.length > 3 ? parts.slice(2) : parts.slice(1);
  return rest.join(' ').replace(/_/g, ' ');
}

/**
 * Where a clip sits on its pin: 'start' (its left edge at the pin, pointing along its angle) for
 * cones, rays, breath and the like, 'centre' for everything else.
 */
export function guessClipOrigin(path) {
  const words = String(path ?? '')
    .toLowerCase()
    .split(/[._]/);
  return words.some((word) => DIRECTED_WORDS.some((directed) => word.startsWith(directed)))
    ? 'start'
    : 'centre';
}

/**
 * How a clip of `clipDuration` seconds plays in a token loop of `loopDuration` seconds: a whole
 * number of `repeats`, at the `rate` that makes them fill the loop exactly.
 */
export function getClipTiming(clipDuration, loopDuration) {
  const repeats = Math.max(1, Math.round(loopDuration / clipDuration));
  return { repeats, rate: Math.round(((repeats * clipDuration) / loopDuration) * 1e6) / 1e6 };
}

/** The frame of `clip` (`{ duration, frames }`) shown at loop time `t` (0..1); -1 when empty. */
export function clipFrameIndex(clip, t, loopDuration) {
  const count = clip?.frames?.length ?? 0;
  if (!count || !(clip.duration > 0)) return -1;
  const { rate } = getClipTiming(clip.duration, loopDuration);
  const wrapped = t - Math.floor(t);
  const time = (wrapped * loopDuration * rate) % clip.duration;
  return Math.min(count - 1, Math.floor((time / clip.duration) * count + 1e-9));
}

/**
 * Draws `frame` at (x, y), `width` px wide (its height keeps the frame's shape), turned by
 * `rotation` radians and drawn at `opacity`: centred there, or with `origin` 'start' beginning
 * there (its left edge's middle at the point).
 */
export function drawClipFrame(
  context,
  frame,
  { x, y, width, rotation = 0, opacity = 1, origin = 'centre' },
) {
  const height = (width * frame.height) / frame.width;
  context.save();
  context.globalAlpha *= opacity;
  context.translate(x, y);
  context.rotate(rotation);
  context.drawImage(frame, origin === 'start' ? 0 : -width / 2, -height / 2, width, height);
  context.restore();
}

const clipCache = new Map();

/**
 * Decodes the video at `file` into frames (canvases, longest side at most CLIP_MAX_SIZE) once;
 * later calls share the result. Resolves to `{ duration, frames }`.
 */
export function loadSequencerClip(file, { createCanvas, document = globalThis.document } = {}) {
  if (!clipCache.has(file)) {
    const promise = decodeClip(file, { createCanvas, document }).catch((error) => {
      clipCache.delete(file);
      throw error;
    });
    clipCache.set(file, promise);
  }
  return clipCache.get(file);
}

async function decodeClip(file, { createCanvas, document }) {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = file;
  await waitFor(video, 'loadeddata');
  const duration = Number(video.duration);
  if (!(duration > 0) || !Number.isFinite(duration)) throw new Error(`No duration for ${file}`);
  const scale = Math.min(1, CLIP_MAX_SIZE / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const count = Math.max(1, Math.round(duration * CLIP_FPS));
  const frames = [];
  for (let index = 0; index < count; index += 1) {
    // Sample the middle of each frame's slot, which never lands past the end.
    video.currentTime = ((index + 0.5) / count) * duration;
    await waitFor(video, 'seeked');
    const frame = createCanvas(width, height);
    frame.getContext('2d').drawImage(video, 0, 0, width, height);
    frames.push(frame);
  }
  video.removeAttribute('src');
  video.load();
  return { duration, frames };
}

function waitFor(video, event) {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener(event, done);
      video.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      video.removeEventListener(event, done);
      video.removeEventListener('error', fail);
      reject(new Error(`Could not load ${video.src}`));
    };
    video.addEventListener(event, done);
    video.addEventListener('error', fail);
  });
}
