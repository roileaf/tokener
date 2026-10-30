import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeAnimatedWebp,
  extractWebpFrameChunks,
  muxAnimatedWebp,
} from '../scripts/webp-anim.js';

const ascii = (text) => [...text].map((char) => char.charCodeAt(0));
const u32 = (value) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, value >>> 24];
const u24 = (value) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];

/** One RIFF chunk: FourCC, little-endian size, payload, a pad byte when the size is odd. */
function chunk(fourCC, payload) {
  return [...ascii(fourCC), ...u32(payload.length), ...payload, ...(payload.length % 2 ? [0] : [])];
}

function riff(chunks) {
  const body = [...ascii('WEBP'), ...chunks.flat()];
  return new Uint8Array([...ascii('RIFF'), ...u32(body.length), ...body]);
}

/** A fake lossless bitstream: signature, 14-bit width-1, 14-bit height-1, alpha bit, then junk. */
function vp8lPayload(width, height, alpha) {
  const bits = (width - 1) | ((height - 1) << 14) | ((alpha ? 1 : 0) << 28);
  return [0x2f, ...u32(bits >>> 0), 0xaa, 0xbb];
}

/** A fake lossy key frame: 3-byte tag, start code, 14-bit width / height, then junk. */
function vp8Payload(width, height) {
  return [
    0x10,
    0x02,
    0x00,
    0x9d,
    0x01,
    0x2a,
    width & 0xff,
    width >> 8,
    height & 0xff,
    height >> 8,
    7,
    8,
  ];
}

/** Reads the RIFF chunk list back, checking the container size and the padding of every chunk. */
function parseRiff(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  assert.equal(text(0), 'RIFF');
  assert.equal(view.getUint32(4, true), bytes.length - 8, 'RIFF size covers everything after it');
  assert.equal(text(8), 'WEBP');
  const chunks = [];
  let offset = 12;
  while (offset < bytes.length) {
    const size = view.getUint32(offset + 4, true);
    chunks.push({ id: text(offset), size, payload: bytes.subarray(offset + 8, offset + 8 + size) });
    if (size % 2) assert.equal(bytes[offset + 8 + size], 0, 'odd chunks end with a zero pad byte');
    offset += 8 + size + (size % 2);
  }
  assert.equal(offset, bytes.length, 'chunks fill the file exactly');
  return chunks;
}

const readU24 = (payload, offset) =>
  payload[offset] | (payload[offset + 1] << 8) | (payload[offset + 2] << 16);

test('extracts the image chunk of a simple lossless WebP with its size and alpha', () => {
  const payload = vp8lPayload(3, 2, true);
  const result = extractWebpFrameChunks(riff([chunk('VP8L', payload)]));
  assert.equal(result.width, 3);
  assert.equal(result.height, 2);
  assert.equal(result.hasAlpha, true);
  assert.equal(result.chunks.length, 1);
  assert.deepEqual([...result.chunks[0]], chunk('VP8L', payload));
});

test('extracts a simple lossy WebP without alpha', () => {
  const payload = vp8Payload(5, 4);
  const result = extractWebpFrameChunks(riff([chunk('VP8 ', payload)]));
  assert.equal(result.width, 5);
  assert.equal(result.height, 4);
  assert.equal(result.hasAlpha, false);
  assert.deepEqual(
    result.chunks.map((entry) => [...entry]),
    [chunk('VP8 ', payload)],
  );
});

test('extracts ALPH + VP8 from an extended WebP and skips VP8X, ICCP and metadata', () => {
  const alpha = [1, 2, 3];
  const image = vp8Payload(6, 3);
  const vp8x = [0x10, 0, 0, 0, ...u24(5), ...u24(2)];
  const result = extractWebpFrameChunks(
    riff([
      chunk('VP8X', vp8x),
      chunk('ICCP', [9, 9]),
      chunk('ALPH', alpha),
      chunk('VP8 ', image),
      chunk('EXIF', [4]),
    ]),
  );
  assert.equal(result.width, 6);
  assert.equal(result.height, 3);
  assert.equal(result.hasAlpha, true);
  assert.deepEqual(
    result.chunks.map((entry) => [...entry]),
    [chunk('ALPH', alpha), chunk('VP8 ', image)],
  );
});

test('rejects bytes that are not a WebP still', () => {
  assert.throws(() => extractWebpFrameChunks(new Uint8Array([0x89, 0x50, 0x4e, 0x47])));
  assert.throws(() => extractWebpFrameChunks(riff([chunk('VP8X', new Array(10).fill(0))])));
});

test('muxes frames into an animated WebP that parses back', () => {
  const frameA = extractWebpFrameChunks(riff([chunk('VP8L', vp8lPayload(4, 3, true))]));
  const frameB = extractWebpFrameChunks(
    riff([
      chunk('VP8X', [0x10, 0, 0, 0, ...u24(3), ...u24(2)]),
      chunk('ALPH', [7, 7, 7]),
      chunk('VP8 ', vp8Payload(4, 3)),
    ]),
  );
  const bytes = muxAnimatedWebp({ width: 4, height: 3, frames: [frameA, frameB], durationMs: 67 });
  const chunks = parseRiff(bytes);
  assert.deepEqual(
    chunks.map((entry) => entry.id),
    ['VP8X', 'ANIM', 'ANMF', 'ANMF'],
  );

  const vp8x = chunks[0].payload;
  assert.equal(chunks[0].size, 10);
  assert.equal(vp8x[0] & 0x02, 0x02, 'animation flag');
  assert.equal(vp8x[0] & 0x10, 0x10, 'alpha flag');
  assert.equal(readU24(vp8x, 4) + 1, 4);
  assert.equal(readU24(vp8x, 7) + 1, 3);

  const anim = chunks[1].payload;
  assert.equal(chunks[1].size, 6);
  assert.deepEqual([...anim.subarray(0, 4)], [0, 0, 0, 0], 'transparent background');
  assert.equal(anim[4] | (anim[5] << 8), 0, 'loops forever');

  for (const [index, frame] of [frameA, frameB].entries()) {
    const anmf = chunks[2 + index].payload;
    assert.equal(readU24(anmf, 0), 0);
    assert.equal(readU24(anmf, 3), 0);
    assert.equal(readU24(anmf, 6) + 1, 4);
    assert.equal(readU24(anmf, 9) + 1, 3);
    assert.equal(readU24(anmf, 12), 67);
    assert.equal(anmf[15], 0x02, 'no blending, no disposal');
    const carried = [...anmf.subarray(16)];
    assert.deepEqual(
      carried,
      frame.chunks.flatMap((entry) => [...entry]),
      'frame bytes preserved',
    );
  }
});

test('muxed frame chunks with odd payloads stay padded inside ANMF', () => {
  // A 7-byte VP8L payload is padded to 8, so the ANMF payload is 16 + 8 + 8 bytes.
  const frame = extractWebpFrameChunks(riff([chunk('VP8L', vp8lPayload(2, 2, false))]));
  const chunks = parseRiff(
    muxAnimatedWebp({ width: 2, height: 2, frames: [frame], durationMs: 100 }),
  );
  assert.equal(chunks[2].size, 16 + 16);
  assert.equal(chunks[2].size % 2, 0);
});

function fakeCanvas(blob) {
  return { toBlob: (callback) => callback(blob), width: 4, height: 3 };
}

test('encodes canvases into one animated WebP blob at the frame rate', async () => {
  const still = new Blob([riff([chunk('VP8L', vp8lPayload(4, 3, true))])], { type: 'image/webp' });
  const progress = [];
  const blob = await encodeAnimatedWebp(
    [fakeCanvas(still), fakeCanvas(still), fakeCanvas(still)],
    { fps: 15, quality: 0.85 },
    { onFrame: (done, total) => progress.push([done, total]) },
  );
  assert.equal(blob.type, 'image/webp');
  const chunks = parseRiff(new Uint8Array(await blob.arrayBuffer()));
  const frames = chunks.filter((entry) => entry.id === 'ANMF');
  assert.equal(frames.length, 3);
  assert.equal(readU24(frames[0].payload, 12), 67);
  assert.deepEqual(progress.at(-1), [3, 3]);
});

test('returns null when the browser exports PNG instead of WebP', async () => {
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
  assert.equal(await encodeAnimatedWebp([fakeCanvas(png)], { fps: 15, quality: 0.85 }), null);
  // A blob labelled WebP that is not a RIFF WebP is not trusted either.
  const fake = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' });
  assert.equal(await encodeAnimatedWebp([fakeCanvas(fake)], { fps: 15, quality: 0.85 }), null);
});
