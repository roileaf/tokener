import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canEncodeAnimation,
  encodeAlphaWebm,
  muxAlphaWebm,
  probeAnimationSupport,
} from '../scripts/webm-alpha.js';

const MASTERS = new Set([
  '1a45dfa3',
  '18538067',
  '1549a966',
  '1654ae6b',
  'ae',
  'e0',
  '1f43b675',
  'a0',
  '75a1',
  'a6',
  '1c53bb6b',
  'bb',
  'b7',
]);

function readVint(bytes, offset, keepMarker) {
  let length = 1;
  while (length <= 8 && !(bytes[offset] & (0x80 >> (length - 1)))) length++;
  let value = keepMarker ? bytes[offset] : bytes[offset] & (0xff >> length);
  for (let i = 1; i < length; i++) value = value * 256 + bytes[offset + i];
  return { value, length };
}

function parse(bytes, start = 0, end = bytes.length) {
  const out = [];
  let offset = start;
  while (offset < end) {
    const id = readVint(bytes, offset, true);
    const size = readVint(bytes, offset + id.length, false);
    const bodyStart = offset + id.length + size.length;
    const hex = id.value.toString(16);
    const body = bytes.subarray(bodyStart, bodyStart + size.value);
    out.push({
      id: hex,
      body,
      children: MASTERS.has(hex) ? parse(bytes, bodyStart, bodyStart + size.value) : null,
    });
    offset = bodyStart + size.value;
  }
  return out;
}

const find = (nodes, id) => nodes.find((node) => node.id === id);
const findAll = (nodes, id) => nodes.filter((node) => node.id === id);
const uint = (node) => node.body.reduce((sum, byte) => sum * 256 + byte, 0);
const text = (node) => new TextDecoder().decode(node.body);

function sampleMux() {
  const frames = [
    { color: Uint8Array.of(1, 2, 3), alpha: Uint8Array.of(9, 9), key: true },
    { color: Uint8Array.of(4, 5), alpha: Uint8Array.of(8), key: false },
    { color: Uint8Array.of(6), alpha: Uint8Array.of(7, 7, 7), key: false },
  ];
  const bytes = muxAlphaWebm({ width: 4, height: 2, frames, frameMs: 1000 / 30, durationMs: 100 });
  return { frames, tree: parse(bytes) };
}

test('muxed WebM declares VP9 with alpha and the exact loop duration', () => {
  const { tree } = sampleMux();
  const header = find(tree, '1a45dfa3');
  assert.equal(text(find(header.children, '4282')), 'webm');
  const segment = find(tree, '18538067').children;
  const info = find(segment, '1549a966').children;
  const duration = find(info, '4489').body;
  assert.equal(new DataView(duration.buffer, duration.byteOffset).getFloat64(0), 100);
  assert.equal(uint(find(info, '2ad7b1')), 1_000_000);
  const track = find(find(segment, '1654ae6b').children, 'ae').children;
  assert.equal(text(find(track, '86')), 'V_VP9');
  assert.equal(uint(find(find(track, 'e0').children, '53c0')), 1);
  assert.ok(find(segment, '1c53bb6b'));
});

test('every frame is a BlockGroup with its alpha in BlockAdditions', () => {
  const { frames, tree } = sampleMux();
  const cluster = find(find(tree, '18538067').children, '1f43b675').children;
  const groups = findAll(cluster, 'a0');
  assert.equal(groups.length, 3);
  const times = groups.map((group) => {
    const block = find(group.children, 'a1').body;
    return new DataView(block.buffer, block.byteOffset).getInt16(1);
  });
  assert.deepEqual(times, [0, 33, 67]);
  groups.forEach((group, index) => {
    const more = find(find(group.children, '75a1').children, 'a6').children;
    assert.deepEqual([...find(more, 'a5').body], [...frames[index].alpha]);
    assert.equal(Boolean(find(group.children, 'fb')), !frames[index].key);
    assert.deepEqual([...find(group.children, 'a1').body.subarray(4)], [...frames[index].color]);
  });
  assert.equal(find(groups[0].children, '9b'), undefined);
  assert.equal(uint(find(groups[2].children, '9b')), 33);
});

function makeScope() {
  const log = { frames: [], configs: [], encodes: [], closed: 0 };
  class FakeVideoFrame {
    constructor(data, init) {
      this.data = data;
      Object.assign(this, init);
      this.closed = false;
      log.frames.push(this);
    }
    close() {
      this.closed = true;
    }
  }
  class FakeVideoEncoder {
    constructor({ output }) {
      this.output = output;
    }
    configure(config) {
      this.config = config;
      log.configs.push(config);
    }
    encode(frame, options) {
      log.encodes.push({ format: frame.format, keyFrame: options.keyFrame });
      const payload = Uint8Array.of(frame.format === 'RGBX' ? 1 : 2, frame.timestamp / 1000);
      this.output({
        type: options.keyFrame ? 'key' : 'delta',
        timestamp: frame.timestamp,
        byteLength: payload.length,
        copyTo: (target) => target.set(payload),
      });
    }
    async flush() {}
    close() {
      log.closed++;
    }
  }
  return {
    log,
    scope: { isSecureContext: true, VideoEncoder: FakeVideoEncoder, VideoFrame: FakeVideoFrame },
  };
}

test('encoding feeds colour as RGBX and alpha as I420 luma with one keyframe', async () => {
  const { log, scope } = makeScope();
  const width = 4;
  const height = 2;
  const frames = [0, 1, 2].map((n) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set([10, 20, 30, 40 + n + i], i * 4);
    return { data, width, height };
  });
  const result = await encodeAlphaWebm(
    { frames, width, height, fps: 30, durationMs: 100, bitrate: width * height * 8 },
    scope,
  );
  assert.equal(result.type, 'video/webm');

  const color = log.frames.filter((f) => f.format === 'RGBX');
  const alpha = log.frames.filter((f) => f.format === 'I420');
  assert.equal(color.length, 3);
  assert.equal(alpha.length, 3);
  alpha.forEach((frame, n) => {
    const luma = [...frame.data.subarray(0, width * height)];
    assert.deepEqual(
      luma,
      Array.from({ length: width * height }, (_, i) => 40 + n + i),
    );
    assert.ok(frame.data.subarray(width * height).every((byte) => byte === 128));
    assert.equal(frame.data.length, width * height * 1.5);
  });
  assert.ok(log.frames.every((f) => f.closed));
  assert.deepEqual(
    log.encodes
      .filter((e) => e.keyFrame)
      .map((e) => e.format)
      .sort(),
    ['I420', 'RGBX'],
  );
  assert.equal(log.configs.length, 2);
  assert.ok(
    log.configs.every(
      (c) => c.codec === 'vp09.00.10.08' && c.width === width && c.height === height,
    ),
  );
  assert.deepEqual(
    log.configs.map((c) => c.bitrate).sort((a, b) => a - b),
    [width * height * 2, width * height * 8],
  );
  assert.equal(log.closed, 2);

  const tree = parse(new Uint8Array(await result.arrayBuffer()));
  const cluster = find(find(tree, '18538067').children, '1f43b675').children;
  assert.equal(findAll(cluster, 'a0').length, 3);
});

test('odd sizes are padded to even before encoding', async () => {
  const { log, scope } = makeScope();
  const data = new Uint8ClampedArray(3 * 3 * 4).fill(255);
  await encodeAlphaWebm(
    {
      frames: [{ data, width: 3, height: 3 }],
      width: 3,
      height: 3,
      fps: 30,
      durationMs: 33,
      bitrate: 1000,
    },
    scope,
  );
  assert.ok(log.configs.every((c) => c.width === 4 && c.height === 4));
  const rgbx = log.frames.find((f) => f.format === 'RGBX');
  assert.equal(rgbx.codedWidth, 4);
  assert.equal(rgbx.data.length, 4 * 4 * 4);
  const i420 = log.frames.find((f) => f.format === 'I420');
  assert.equal(i420.data.length, 4 * 4 * 1.5);
  assert.equal(i420.data[3], 0);
  assert.equal(i420.data[0], 255);
});

test('animation encoding needs a secure context with WebCodecs', () => {
  assert.equal(
    canEncodeAnimation({
      isSecureContext: false,
      VideoEncoder: function () {},
      VideoFrame: function () {},
    }),
    false,
  );
  assert.equal(canEncodeAnimation({ isSecureContext: true }), false);
  assert.equal(
    canEncodeAnimation({
      isSecureContext: true,
      VideoEncoder: function () {},
      VideoFrame: function () {},
    }),
    true,
  );
});

function makeFrames(count, width = 2, height = 2) {
  return Array.from({ length: count }, () => ({
    data: new Uint8ClampedArray(width * height * 4).fill(200),
    width,
    height,
  }));
}

function encodeWith(scope, count = 3) {
  return encodeAlphaWebm(
    { frames: makeFrames(count), width: 2, height: 2, fps: 30, durationMs: 100, bitrate: 1000 },
    scope,
  );
}

test('an encoder error is rethrown and both encoders and frames are closed', async () => {
  const { log, scope } = makeScope();
  const Base = scope.VideoEncoder;
  scope.VideoEncoder = class extends Base {
    encode(frame, options) {
      if (frame.format === 'I420' && frame.timestamp > 0) throw new Error('alpha broke');
      super.encode(frame, options);
    }
  };
  await assert.rejects(encodeWith(scope, 40), /alpha broke/);
  assert.equal(log.closed, 2);
  // The colour stream stops early instead of encoding the whole loop.
  assert.ok(log.encodes.filter((e) => e.format === 'RGBX').length < 40);
  assert.ok(log.frames.every((f) => f.closed));
});

test('an error reported through the encoder callback is rethrown', async () => {
  const { log, scope } = makeScope();
  scope.VideoEncoder = class {
    constructor({ error }) {
      this.error = error;
    }
    configure() {}
    encode() {
      this.error(new Error('codec failed'));
    }
    async flush() {}
    close() {
      log.closed++;
    }
  };
  await assert.rejects(encodeWith(scope), /codec failed/);
  assert.equal(log.closed, 2);
});

test('a frame the encoder never returns is an error, for colour and for alpha', async () => {
  for (const [format, message] of [
    ['RGBX', /Missing encoded frame 1/],
    ['I420', /Missing encoded alpha frame 1/],
  ]) {
    const { scope } = makeScope();
    const Base = scope.VideoEncoder;
    scope.VideoEncoder = class extends Base {
      encode(frame, options) {
        if (frame.format === format && frame.timestamp > 0 && frame.timestamp < 40_000) return;
        super.encode(frame, options);
      }
    };
    await assert.rejects(encodeWith(scope), message);
  }
});

test('encoding waits while the encoder queue is full', async () => {
  let maxQueue = 0;
  const { scope } = makeScope();
  scope.VideoEncoder = class extends EventTarget {
    constructor({ output }) {
      super();
      this.output = output;
      this.pending = [];
    }
    get encodeQueueSize() {
      return this.pending.length;
    }
    configure() {}
    encode(frame, options) {
      this.pending.push({ timestamp: frame.timestamp, key: options.keyFrame });
      maxQueue = Math.max(maxQueue, this.pending.length);
      setTimeout(() => this.drain(), 1);
    }
    drain() {
      const item = this.pending.shift();
      if (!item) return;
      this.output({
        type: item.key ? 'key' : 'delta',
        timestamp: item.timestamp,
        byteLength: 1,
        copyTo: (target) => target.set([1]),
      });
      this.dispatchEvent(new Event('dequeue'));
    }
    async flush() {
      while (this.pending.length) this.drain();
    }
    close() {}
  };
  const blob = await encodeWith(scope, 40);
  assert.equal(blob.type, 'video/webm');
  assert.ok(maxQueue <= 9, `queue reached ${maxQueue}`);
});

test('animation support is probed with the VP9 config', async () => {
  const base = { isSecureContext: true, VideoFrame: function () {} };
  let asked = null;
  const supported = {
    ...base,
    VideoEncoder: Object.assign(function () {}, {
      isConfigSupported: async (config) => {
        asked = config;
        return { supported: true };
      },
    }),
  };
  assert.equal(await probeAnimationSupport(supported), true);
  assert.equal(asked.codec, 'vp09.00.10.08');
  const unsupported = {
    ...base,
    VideoEncoder: Object.assign(function () {}, {
      isConfigSupported: async () => ({ supported: false }),
    }),
  };
  assert.equal(await probeAnimationSupport(unsupported), false);
  const throws = {
    ...base,
    VideoEncoder: Object.assign(function () {}, {
      isConfigSupported: async () => {
        throw new Error('nope');
      },
    }),
  };
  assert.equal(await probeAnimationSupport(throws), false);
  assert.equal(await probeAnimationSupport({ isSecureContext: false }), false);
});
