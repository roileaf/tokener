/**
 * Animated WebP from still WebP frames, with no encoder of our own: the browser encodes every
 * frame with `canvas.toBlob('image/webp')`, and this module only moves bytes. Each still's image
 * chunks (`ALPH` + `VP8 `, or `VP8L`) are copied, undecoded, into an `ANMF` frame chunk inside a
 * `RIFF WEBP` container with `VP8X` (animation + alpha) and `ANIM` (transparent, loops forever).
 */

const IMAGE_CHUNKS = new Set(['ALPH', 'VP8 ', 'VP8L']);
const VP8X_ALPHA = 0x10;
const VP8X_ANIMATION = 0x02;
/** ANMF flags: bit 1 set = do not blend with the previous frame; bit 0 clear = no disposal. */
const ANMF_NO_BLEND = 0x02;
const MAX_UINT24 = 0xffffff;

function fourCC(bytes, offset) {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function readU24(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readU32(bytes, offset) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function isRiffWebp(bytes) {
  return bytes?.length >= 12 && fourCC(bytes, 0) === 'RIFF' && fourCC(bytes, 8) === 'WEBP';
}

/** Every top-level chunk of a WebP file: its id, payload, and the full chunk bytes (padded). */
function readChunks(bytes) {
  if (!isRiffWebp(bytes)) throw new Error('Not a RIFF WebP file.');
  const end = Math.min(bytes.length, 8 + readU32(bytes, 4));
  const chunks = [];
  let offset = 12;
  while (offset + 8 <= end) {
    const id = fourCC(bytes, offset);
    const size = readU32(bytes, offset + 4);
    const payloadEnd = offset + 8 + size;
    if (payloadEnd > end) throw new Error(`Truncated WebP chunk ${id}.`);
    const next = Math.min(end, payloadEnd + (size % 2));
    chunks.push({
      id,
      payload: bytes.subarray(offset + 8, payloadEnd),
      bytes: bytes.subarray(offset, next),
    });
    offset = next;
  }
  return chunks;
}

/** Width and height read from a VP8 (lossy key frame) or VP8L (lossless) bitstream header. */
function readBitstreamSize(id, payload) {
  if (id === 'VP8L' && payload.length >= 5 && payload[0] === 0x2f) {
    const bits = readU32(payload, 1);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
      alpha: Boolean((bits >>> 28) & 1),
    };
  }
  if (
    id === 'VP8 ' &&
    payload.length >= 10 &&
    payload[3] === 0x9d &&
    payload[4] === 0x01 &&
    payload[5] === 0x2a
  )
    return {
      width: (payload[6] | (payload[7] << 8)) & 0x3fff,
      height: (payload[8] | (payload[9] << 8)) & 0x3fff,
      alpha: false,
    };
  return null;
}

/**
 * The image chunks of a still WebP (simple `VP8 ` / `VP8L`, or extended `VP8X` with optional
 * `ICCP` / `ALPH` / metadata), copied as full padded chunks, ready to wrap in an `ANMF` frame.
 */
export function extractWebpFrameChunks(bytes) {
  const all = readChunks(bytes);
  const chunks = all.filter((chunk) => IMAGE_CHUNKS.has(chunk.id));
  const image = chunks.find((chunk) => chunk.id === 'VP8 ' || chunk.id === 'VP8L');
  if (!image) throw new Error('WebP has no image data.');
  if (all.some((chunk) => chunk.id === 'ANIM' || chunk.id === 'ANMF'))
    throw new Error('WebP is already animated.');
  const header = readBitstreamSize(image.id, image.payload);
  const vp8x = all.find((chunk) => chunk.id === 'VP8X' && chunk.payload.length >= 10);
  const width = vp8x ? readU24(vp8x.payload, 4) + 1 : header?.width;
  const height = vp8x ? readU24(vp8x.payload, 7) + 1 : header?.height;
  const hasAlpha =
    chunks.some((chunk) => chunk.id === 'ALPH') ||
    Boolean(vp8x && vp8x.payload[0] & VP8X_ALPHA) ||
    Boolean(header?.alpha);
  return {
    width,
    height,
    hasAlpha,
    chunks: chunks.map((chunk) => new Uint8Array(chunk.bytes)),
  };
}

function u24(value) {
  const clamped = Math.max(0, Math.min(MAX_UINT24, Math.round(value)));
  return [clamped & 0xff, (clamped >> 8) & 0xff, (clamped >> 16) & 0xff];
}

function u32(value) {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
}

function ascii(text) {
  return [...text].map((char) => char.charCodeAt(0));
}

/** Concatenates byte arrays into one. */
function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function chunk(id, payloadParts) {
  const payload = concat(payloadParts);
  const parts = [Uint8Array.from([...ascii(id), ...u32(payload.length)]), payload];
  if (payload.length % 2) parts.push(new Uint8Array(1));
  return concat(parts);
}

/**
 * An animated WebP of `width` x `height` playing `frames` (each from `extractWebpFrameChunks`,
 * drawn at 0,0 for `durationMs`, replacing the previous frame) in an endless loop.
 */
export function muxAnimatedWebp({ width, height, frames, durationMs }) {
  if (!frames?.length) throw new Error('An animated WebP needs at least one frame.');
  const vp8x = chunk('VP8X', [
    Uint8Array.from([VP8X_ANIMATION | VP8X_ALPHA, 0, 0, 0, ...u24(width - 1), ...u24(height - 1)]),
  ]);
  // Background colour 0 (transparent), loop count 0 (forever).
  const anim = chunk('ANIM', [new Uint8Array(6)]);
  const anmf = frames.map((frame) =>
    chunk('ANMF', [
      Uint8Array.from([
        ...u24(0),
        ...u24(0),
        ...u24(width - 1),
        ...u24(height - 1),
        ...u24(durationMs),
        ANMF_NO_BLEND,
      ]),
      ...frame.chunks,
    ]),
  );
  const body = concat([Uint8Array.from(ascii('WEBP')), vp8x, anim, ...anmf]);
  return concat([Uint8Array.from([...ascii('RIFF'), ...u32(body.length)]), body]);
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob ?? null), 'image/webp', quality),
  );
}

/**
 * Encodes `canvases` (all the same size) as one looping animated WebP at `fps`. `canvases` may be
 * an array or an (async) iterable that redraws one canvas per frame, since each frame is encoded
 * before the next is asked for. Resolves to null when the browser cannot encode WebP (`toBlob`
 * gives PNG, or anything that is not a RIFF WebP). `scope.onFrame(done, total)` reports progress
 * (`total` is `canvases.length` or `scope.total`); every `scope.yieldEvery` frames (default 4),
 * `await scope.yield()` lets the UI breathe.
 */
export async function encodeAnimatedWebp(canvases, { fps, quality }, scope = {}) {
  const frames = [];
  const total = canvases.length ?? scope.total ?? 0;
  let size = null;
  let index = 0;
  for await (const canvas of canvases) {
    scope.onFrame?.(index, total);
    size ??= { width: canvas.width, height: canvas.height };
    const blob = await canvasToBlob(canvas, quality);
    if (!blob || (blob.type && blob.type !== 'image/webp')) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!isRiffWebp(bytes)) return null;
    frames.push(extractWebpFrameChunks(bytes));
    index += 1;
    if (scope.yield && index % (scope.yieldEvery ?? 4) === 0) await scope.yield();
  }
  scope.onFrame?.(index, index);
  if (!frames.length) return null;
  const bytes = muxAnimatedWebp({
    width: size.width ?? frames[0].width,
    height: size.height ?? frames[0].height,
    frames,
    durationMs: Math.round(1000 / fps),
  });
  return new Blob([bytes], { type: 'image/webp' });
}
