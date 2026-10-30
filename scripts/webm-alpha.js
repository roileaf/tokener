// Transparent WebM loops: colour + alpha as two VP9 streams (Chrome's VideoEncoder rejects
// `alpha: 'keep'`), muxed into one WebM with the alpha stream in BlockAdditions.

const CODEC = 'vp09.00.10.08';

const EBML = {
  id(hex) {
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
    return new Uint8Array(bytes);
  },
  size(value) {
    // 8-byte sizes keep the writer simple; players accept any valid length.
    const out = new Uint8Array(8);
    let rest = value;
    for (let i = 7; i >= 1; i--) {
      out[i] = rest % 256;
      rest = Math.floor(rest / 256);
    }
    out[0] = 0x01;
    return out;
  },
  uint(value) {
    const bytes = [];
    let rest = value;
    do {
      bytes.unshift(rest % 256);
      rest = Math.floor(rest / 256);
    } while (rest > 0);
    return new Uint8Array(bytes);
  },
  float(value) {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setFloat64(0, value);
    return out;
  },
  text: (value) => new TextEncoder().encode(value),
  concat(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  },
  element(id, ...children) {
    const body = EBML.concat(children);
    return EBML.concat([EBML.id(id), EBML.size(body.length), body]);
  },
};

/** True when this context can run the WebCodecs VP9 encoder. */
export function canEncodeAnimation(scope = globalThis) {
  return Boolean(
    scope.isSecureContext &&
    typeof scope.VideoEncoder === 'function' &&
    typeof scope.VideoFrame === 'function',
  );
}

/**
 * Resolves true only when WebCodecs exists here and the browser says it can encode the VP9 profile
 * the loop uses. Never rejects: any failure counts as unsupported.
 */
export async function probeAnimationSupport(scope = globalThis) {
  if (!canEncodeAnimation(scope)) return false;
  try {
    const result = await scope.VideoEncoder.isConfigSupported?.({
      codec: CODEC,
      width: 64,
      height: 64,
      bitrate: 32768,
      framerate: 30,
    });
    return Boolean(result?.supported);
  } catch {
    return false;
  }
}

/**
 * Mux VP9 chunks into a WebM with alpha. Each frame is `{ color, alpha?, key }` placed at
 * `round(index * frameMs)`. Block timecodes are int16 ms, so loops must stay under ~32 s.
 */
export function muxAlphaWebm({ width, height, frames, frameMs, durationMs }) {
  const E = EBML;
  const header = E.element(
    '1a45dfa3',
    E.element('4286', E.uint(1)),
    E.element('42f7', E.uint(1)),
    E.element('42f2', E.uint(4)),
    E.element('42f3', E.uint(8)),
    E.element('4282', E.text('webm')),
    E.element('4287', E.uint(4)),
    E.element('4285', E.uint(2)),
  );
  const info = E.element(
    '1549a966',
    E.element('2ad7b1', E.uint(1_000_000)),
    E.element('4d80', E.text('pf2e-tokener')),
    E.element('5741', E.text('pf2e-tokener')),
    E.element('4489', E.float(durationMs)),
  );
  const tracks = E.element(
    '1654ae6b',
    E.element(
      'ae',
      E.element('d7', E.uint(1)),
      E.element('73c5', E.uint(1)),
      E.element('83', E.uint(1)),
      E.element('86', E.text('V_VP9')),
      E.element('55ee', E.uint(1)),
      E.element(
        'e0',
        E.element('b0', E.uint(width)),
        E.element('ba', E.uint(height)),
        E.element('53c0', E.uint(1)),
      ),
    ),
  );

  const groups = frames.map((frame, index) => {
    const time = Math.round(index * frameMs);
    const block = new Uint8Array(4 + frame.color.length);
    block[0] = 0x81; // track 1
    new DataView(block.buffer).setInt16(1, time);
    block[3] = 0x00;
    block.set(frame.color, 4);
    const parts = [E.element('a1', block)];
    if (!frame.key) parts.push(E.element('fb', E.uint(0))); // any ReferenceBlock marks a delta frame
    if (index === frames.length - 1)
      parts.push(E.element('9b', E.uint(Math.round(durationMs - time))));
    if (frame.alpha)
      parts.push(
        E.element(
          '75a1',
          E.element('a6', E.element('ee', E.uint(1)), E.element('a5', frame.alpha)),
        ),
      );
    return E.element('a0', ...parts);
  });
  const cluster = E.element('1f43b675', E.element('e7', E.uint(0)), ...groups);
  const clusterPosition = info.length + tracks.length;
  const cues = E.element(
    '1c53bb6b',
    E.element(
      'bb',
      E.element('b3', E.uint(0)),
      E.element('b7', E.element('f7', E.uint(1)), E.element('f1', E.uint(clusterPosition))),
    ),
  );
  const segment = E.element('18538067', info, tracks, cluster, cues);
  return E.concat([header, segment]);
}

/** Frames allowed to wait in an encoder before the next one is held back. */
const MAX_ENCODE_QUEUE = 8;
/** Fallback poll while waiting on the queue, in case no `dequeue` event arrives. */
const QUEUE_POLL_MS = 10;

/** Waits until `encoder` has room for another frame (or the session stops). */
async function waitForEncoderQueue(encoder, isStopped) {
  while ((encoder.encodeQueueSize ?? 0) > MAX_ENCODE_QUEUE && !isStopped()) {
    await new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        encoder.removeEventListener?.('dequeue', done);
        resolve();
      };
      const timer = setTimeout(done, QUEUE_POLL_MS);
      encoder.addEventListener?.('dequeue', done);
    });
  }
}

/**
 * Encodes one stream. `session.stopped` is set when the sibling stream failed, so this one stops
 * early; the encoder and any open frame are always closed, also on errors.
 */
async function encodeStream(makeFrames, { frameUs, encoderConfig }, scope, session) {
  const chunks = new Array(makeFrames.length);
  let failure = null;
  const encoder = new scope.VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks[Math.round(chunk.timestamp / frameUs)] = { data, key: chunk.type === 'key' };
    },
    error: (error) => {
      failure = error;
    },
  });
  const isStopped = () => Boolean(failure || session.stopped);
  let frame = null;
  try {
    encoder.configure(encoderConfig);
    for (const [index, makeFrame] of makeFrames.entries()) {
      await waitForEncoderQueue(encoder, isStopped);
      if (failure) throw failure;
      if (session.stopped) throw new Error('Animation encoding stopped');
      frame = makeFrame(index * frameUs);
      encoder.encode(frame, { keyFrame: index === 0 });
      frame.close();
      frame = null;
    }
    try {
      await encoder.flush();
    } catch (error) {
      throw failure ?? error;
    }
    if (failure) throw failure;
    return chunks;
  } finally {
    frame?.close();
    if (encoder.state !== 'closed') {
      try {
        encoder.close();
      } catch {
        // Already closed by an encoder error.
      }
    }
  }
}

/**
 * Runs both streams together. When one fails the other is told to stop, both encoders are closed,
 * and the first error is rethrown.
 */
async function encodeStreams(jobs) {
  const session = { stopped: false, error: null };
  const results = await Promise.allSettled(
    jobs.map((job) =>
      job(session).catch((error) => {
        if (!session.stopped) session.error = error;
        session.stopped = true;
        throw error;
      }),
    ),
  );
  if (session.error) throw session.error;
  return results.map((result) => result.value);
}

/** Pairs colour and alpha chunks per frame; a missing chunk of either stream is an error. */
function pairChunks(color, alpha, count) {
  const frames = [];
  for (let index = 0; index < count; index++) {
    if (!color[index]) throw new Error(`Missing encoded frame ${index}`);
    if (!alpha[index]) throw new Error(`Missing encoded alpha frame ${index}`);
    frames.push({ color: color[index].data, key: color[index].key, alpha: alpha[index].data });
  }
  return frames;
}

/** Copy RGBA rows into a (possibly larger) transparent buffer of `width` x `height`. */
function padRgba(image, width, height) {
  if (image.width === width && image.height === height) return image.data;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < Math.min(image.height, height); y++) {
    const row = image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4);
    out.set(row.subarray(0, Math.min(row.length, width * 4)), y * width * 4);
  }
  return out;
}

/**
 * Encode ImageData-like frames into a looping transparent VP9 WebM. Odd `width`/`height` are
 * padded up to even (extra edge pixels are transparent). `bitrate` is the colour stream's bits/s;
 * the alpha stream gets a quarter of it. VideoEncoder/VideoFrame come from `scope` for testing.
 */
export async function encodeAlphaWebm(
  { frames, width, height, fps, durationMs, bitrate },
  scope = globalThis,
) {
  const evenWidth = width + (width % 2);
  const evenHeight = height + (height % 2);
  const frameUs = 1_000_000 / fps;
  const rendered = frames.map((image) => padRgba(image, evenWidth, evenHeight));
  const base = {
    codec: CODEC,
    width: evenWidth,
    height: evenHeight,
    framerate: fps,
    latencyMode: 'quality',
  };

  // Colour: RGBX drops alpha (transparent pixels become black; the alpha stream restores them).
  const colorFrames = rendered.map(
    (data) => (timestamp) =>
      new scope.VideoFrame(data, {
        format: 'RGBX',
        codedWidth: evenWidth,
        codedHeight: evenHeight,
        timestamp,
      }),
  );
  // Alpha: an I420 frame whose luma plane is the alpha channel and whose chroma is neutral.
  const lumaSize = evenWidth * evenHeight;
  const alphaFrames = rendered.map((data) => (timestamp) => {
    const buffer = new Uint8Array(lumaSize + lumaSize / 2);
    for (let i = 0; i < lumaSize; i++) buffer[i] = data[i * 4 + 3];
    buffer.fill(128, lumaSize);
    return new scope.VideoFrame(buffer, {
      format: 'I420',
      codedWidth: evenWidth,
      codedHeight: evenHeight,
      timestamp,
    });
  });

  const [color, alpha] = await encodeStreams([
    (session) =>
      encodeStream(colorFrames, { frameUs, encoderConfig: { ...base, bitrate } }, scope, session),
    (session) =>
      encodeStream(
        alphaFrames,
        { frameUs, encoderConfig: { ...base, bitrate: Math.round(bitrate / 4) } },
        scope,
        session,
      ),
  ]);
  const muxed = muxAlphaWebm({
    width: evenWidth,
    height: evenHeight,
    frames: pairChunks(color, alpha, frames.length),
    frameMs: 1000 / fps,
    durationMs,
  });
  return new Blob([muxed], { type: 'video/webm' });
}
