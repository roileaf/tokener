import {
  AI_TOP_DOWN_SETTING_KEY,
  MODULE_ID,
  TOP_DOWN_FACE_MOVEMENT_SETTING_KEY,
} from './constants.js';
import { getLookFacing, getMovementRotation, getRotationAlong, getShownLook } from './art-views.js';
import { buildTopDownPrompt, getCreatureProfile, getDefaultFacing } from './top-down-prompt.js';
import { loadTransformers } from './ai-tools.js';
import { localize } from './utils.js';

// AI top-down tokens: FLUX.2 [klein] 4B (Apache-2.0) edits the token's image into a view from
// directly above. It runs in the browser on WebGPU (q4 weights, ~5.6 GB, downloaded once into
// the browser's private file system) and is opt-in per browser, since it needs a GPU with roughly 8 GB of memory.
const ORT_URL =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.bundle.min.mjs';
const ORT_WASM_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';
const FLUX_URL =
  'https://huggingface.co/kny/FLUX.2-klein-4B-onnx-web/resolve/d17e2e8e216e79c120740671d44dacf40dbed649/';
const VAE_ENCODER_URL =
  'https://huggingface.co/sorge89/FLUX.2-klein-4B-onnx/resolve/60e245a1438c3009569e8273f0ce72abd975a85d/vae_encoder.onnx';
const MODEL_FOLDER = `${MODULE_ID}-top-down`;
const GRAPHS = Object.freeze({
  textEncoder: {
    url: `${FLUX_URL}text_encoder/text_encoder_q4.onnx`,
    data: ['text_encoder_q4.onnx_data', 'text_encoder_q4.onnx_data_1'],
  },
  vaeEncoder: { url: VAE_ENCODER_URL, data: [] },
  transformer: {
    url: `${FLUX_URL}transformer/transformer_q4.onnx`,
    data: ['transformer_q4.onnx_data', 'transformer_q4.onnx_data_1'],
  },
  vaeDecoder: {
    url: `${FLUX_URL}vae_decoder/vae_decoder_fp16.onnx`,
    data: ['vae_decoder_fp16.onnx_data'],
  },
});
/** Each file's size, for one download percentage across all of them. */
const FILE_BYTES = Object.freeze({
  'text_encoder_q4.onnx': 3_345_052,
  'text_encoder_q4.onnx_data': 1_797_550_080,
  'text_encoder_q4.onnx_data_1': 684_032_000,
  'vae_encoder.onnx': 137_811_547,
  'transformer_q4.onnx': 4_443_262,
  'transformer_q4.onnx_data': 1_771_597_824,
  'transformer_q4.onnx_data_1': 1_227_079_680,
  'vae_decoder_fp16.onnx': 741_885,
  'vae_decoder_fp16.onnx_data': 99_225_344,
});

export const TOP_DOWN_SIZE = 512;
// High detail: finer hair, scales and gear at about 1.8x the time. 768 cannot run in a browser:
// one attention step needs a 2.5 GB buffer and WebGPU allows 2 GB.
export const TOP_DOWN_HIGH_DETAIL_SIZE = 640;
const BIG_SIZES = new Set(['large', 'huge', 'gargantuan']);
export const TOP_DOWN_SEEDS = Object.freeze([1, 2, 3]);
const STEPS = 4;
const TEXT_LENGTH = 512;
const PAD_TOKEN = 151643;
const REFERENCE_MARGIN = 32;
/** WebGPU must allow buffers this large, or the q4 weights cannot be placed. */
const MIN_BUFFER_BYTES = 1024 ** 3;

let ortPromise = null;
let tokenizerPromise = null;
let sessions = null;

export function registerTopDownSetting(settings = globalThis.game?.settings) {
  // Per browser: the download, the GPU and its memory are the device's.
  settings?.register?.(MODULE_ID, AI_TOP_DOWN_SETTING_KEY, {
    name: localize('Settings.AiTopDown.Name', 'AI top-down tokens (experimental)'),
    hint: localize(
      'Settings.AiTopDown.Hint',
      'Adds a Top-down button to the Token Creator that redraws the token image as seen from directly above. Needs a browser with WebGPU and a graphics card with about 8 GB of memory. The model (~5.7 GB, Apache-2.0) downloads from Hugging Face on first use and runs on your computer.',
    ),
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
  });
  settings?.register?.(MODULE_ID, TOP_DOWN_FACE_MOVEMENT_SETTING_KEY, {
    name: localize('Settings.TopDownFaceMovement.Name', 'Top-down tokens face where they move'),
    hint: localize(
      'Settings.TopDownFaceMovement.Hint',
      'Tokens showing a top-down look turn to face the direction they move in. Regular looks and tokens with locked rotation are left alone.',
    ),
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });
}

/** Turns tokens showing a top-down look towards where they move (world setting, on by default). */
export function registerTopDownMovement(hooks = globalThis.Hooks) {
  const facingOf = (document) =>
    readSetting(TOP_DOWN_FACE_MOVEMENT_SETTING_KEY, true) && !document?.lockRotation
      ? getTopDownLookFacing(document)
      : null;
  hooks?.on?.('preUpdateToken', (document, changes, options, userId) => {
    if (userId !== globalThis.game?.user?.id) return;
    const facing = facingOf(document);
    if (!facing) return;
    // Foundry v14+ moves tokens along waypoints, in updates that can repeat a rotation already
    // set: the turn is worked out from the move's own path every time, never added to.
    const move = options?._movement?.[document.id];
    if (move) {
      const rotation = getRotationAlong(
        [move.origin, ...(move.passed?.waypoints ?? []).filter((point) => !point.intermediate)],
        facing,
      );
      if (rotation !== null) changes.rotation = rotation;
      return;
    }
    // Older Foundry: a plain position update.
    if (changes.rotation !== undefined) return;
    const rotation = getMovementRotation(document, changes, facing);
    if (rotation !== null && rotation !== document.rotation) changes.rotation = rotation;
  });
}

/**
 * Where the shown top-down look faces: as recorded when it was made, else what suits the creature
 * (looks saved before facing was recorded). Null for the regular look.
 */
export function getTopDownLookFacing(document) {
  if (!getShownLook(document) || getShownLook(document) === 'regular') return null;
  return getLookFacing(document) ?? getDefaultTopDownFacing(document);
}

function readSetting(key, fallback) {
  try {
    return globalThis.game?.settings?.get?.(MODULE_ID, key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function isTopDownEnabled(settings = globalThis.game?.settings) {
  try {
    return Boolean(settings?.get?.(MODULE_ID, AI_TOP_DOWN_SETTING_KEY));
  } catch {
    return false;
  }
}

/**
 * Whether this browser's GPU can run the model: `{ ok, reason }`. WebGPU cannot report how much
 * memory a GPU has, so this rules out what surely fails (no WebGPU, a software adapter, no
 * half-precision shaders, small buffers); running out of memory is reported when it happens.
 */
export async function checkTopDownSupport(gpu = globalThis.navigator?.gpu) {
  if (!gpu) return { ok: false, reason: 'webgpu' };
  let adapter = null;
  try {
    adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch {
    adapter = null;
  }
  if (!adapter || adapter.isFallbackAdapter || adapter.info?.isFallbackAdapter)
    return { ok: false, reason: 'adapter' };
  if (!adapter.features?.has?.('shader-f16')) return { ok: false, reason: 'f16' };
  if (!(Number(adapter.limits?.maxBufferSize) >= MIN_BUFFER_BYTES))
    return { ok: false, reason: 'memory' };
  return { ok: true, reason: null };
}

export function describeTopDownSupport(reason) {
  return (
    {
      webgpu: localize(
        'Creator.TopDownNoWebGpu',
        'Top-down needs WebGPU, which this browser does not offer. Try a current Chrome or Edge.',
      ),
      adapter: localize(
        'Creator.TopDownNoAdapter',
        'Top-down needs a graphics card; this browser only offers software rendering.',
      ),
      f16: localize(
        'Creator.TopDownNoF16',
        'This graphics card cannot run the top-down model (no half-precision support).',
      ),
      memory: localize(
        'Creator.TopDownNoMemory',
        'This graphics card does not have enough memory for the top-down model.',
      ),
    }[reason] ?? ''
  );
}

/**
 * The prompt for a token's creature, from its actor's data in whichever system is running.
 * `appearance` (what the creature looks like) replaces the actor's own description when given.
 */
export function getTopDownPrompt(
  tokenDocument,
  { appearance, facing, stance, systemId = globalThis.game?.system?.id } = {},
) {
  const profile = getTopDownProfile(tokenDocument, { systemId });
  return buildTopDownPrompt({
    ...profile,
    appearance: appearance ?? profile.appearance,
    facing,
    stance,
  });
}

/** What the actor's own text says the creature looks like ('' for most creatures). */
export function getActorAppearance(tokenDocument, { systemId = globalThis.game?.system?.id } = {}) {
  return getTopDownProfile(tokenDocument, { systemId }).appearance;
}

/** Whether the actor is a group (troop, swarm, horde) drawn as one token. */
export function isTopDownGroup(tokenDocument, { systemId = globalThis.game?.system?.id } = {}) {
  return getTopDownProfile(tokenDocument, { systemId }).group;
}

/**
 * The framing that fills the token square with the creature the same way every time: its
 * opaque box (`box`, in image pixels) centred and scaled to `fill` of the square, whatever room
 * the model left around it. Returns `{ zoom, offsetX, offsetY }` in the creator's view units.
 */
export function fitViewToBox({ imageWidth, imageHeight, box, fill = 0.95 }) {
  const cover = Math.max(1 / imageWidth, 1 / imageHeight);
  const zoom = fill / (Math.max(box.width, box.height) * cover);
  const scale = cover * zoom;
  return {
    zoom,
    offsetX: scale * (imageWidth / 2 - (box.x + box.width / 2)),
    offsetY: scale * (imageHeight / 2 - (box.y + box.height / 2)),
  };
}

/** Front or back, from the creature's kind (and its name, for systems without kinds). */
/** High detail by default for Large and bigger, whose token is stretched over several squares. */
export function getDefaultTopDownHighDetail(
  tokenDocument,
  { systemId = globalThis.game?.system?.id } = {},
) {
  return BIG_SIZES.has(getTopDownProfile(tokenDocument, { systemId }).size);
}

export function getDefaultTopDownFacing(
  tokenDocument,
  { systemId = globalThis.game?.system?.id } = {},
) {
  return getDefaultFacing(getTopDownProfile(tokenDocument, { systemId }));
}

/**
 * The box around the creature in a background-removal mask (`alpha`, one byte per pixel), with a
 * margin, or null when it would keep nearly the whole image anyway. Solid shapes much smaller
 * than the biggest one (bystanders in a scene, specks) are left out, so busy art is cropped to
 * its main figure; the crop keeps the original background, which the model reads better than a
 * cut-out.
 */
export function findSubjectBox(
  alpha,
  width,
  height,
  { threshold = 128, minShare = 0.15, margin = 0.08 } = {},
) {
  const labels = new Int32Array(alpha.length);
  const boxes = [];
  const queue = new Int32Array(alpha.length);
  for (let start = 0; start < alpha.length; start += 1) {
    if (alpha[start] < threshold || labels[start]) continue;
    const label = boxes.length + 1;
    const box = { count: 0, minX: width, minY: height, maxX: 0, maxY: 0 };
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = label;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = (index - x) / width;
      box.count += 1;
      box.minX = Math.min(box.minX, x);
      box.maxX = Math.max(box.maxX, x);
      box.minY = Math.min(box.minY, y);
      box.maxY = Math.max(box.maxY, y);
      for (const next of [
        index - width,
        index + width,
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
      ]) {
        if (next < 0 || next >= alpha.length || labels[next] || alpha[next] < threshold) continue;
        labels[next] = label;
        queue[tail++] = next;
      }
    }
    boxes.push(box);
  }
  if (!boxes.length) return null;
  const biggest = Math.max(...boxes.map((box) => box.count));
  const kept = boxes.filter((box) => box.count >= biggest * minShare);
  const minX = Math.min(...kept.map((box) => box.minX));
  const minY = Math.min(...kept.map((box) => box.minY));
  const maxX = Math.max(...kept.map((box) => box.maxX));
  const maxY = Math.max(...kept.map((box) => box.maxY));
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * margin);
  const box = {
    x: Math.max(0, minX - pad),
    y: Math.max(0, minY - pad),
    width: Math.min(width, maxX + pad + 1) - Math.max(0, minX - pad),
    height: Math.min(height, maxY + pad + 1) - Math.max(0, minY - pad),
  };
  return box.width * box.height > width * height * 0.9 ? null : box;
}

/** `canvas` cut down to `box` (or itself when there is no box). */
export function cropCanvas(canvas, box, createCanvas) {
  if (!box) return canvas;
  const crop = createCanvas(box.width, box.height);
  crop
    .getContext('2d')
    .drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  return crop;
}

function getTopDownProfile(tokenDocument, { systemId }) {
  const actor = tokenDocument?.actor ?? null;
  return getCreatureProfile({
    name: actor?.name ?? tokenDocument?.name ?? '',
    system: systemId,
    data: actor?.system,
    footprint: [Number(tokenDocument?.width) || 1, Number(tokenDocument?.height) || 1],
  });
}

/**
 * The reference the model edits: the whole source image (its background included, which the
 * model ignores better than a rough cut-out) fitted inside a white square.
 */
export function drawTopDownReference(source, createCanvas, size = TOP_DOWN_SIZE) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, size, size);
  const room = size - REFERENCE_MARGIN;
  const scale = Math.min(room / source.width, room / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  context.drawImage(source, (size - width) / 2, (size - height) / 2, width, height);
  return canvas;
}

/**
 * Generates one top-down image per seed from `source` (a canvas) and `prompt`. `onStatus`
 * receives `{ phase: 'download', percent }`, `{ phase: 'loading' }` and
 * `{ phase: 'generating', done, total }`. `size` is the square it works at (512 by default; larger
 * is sharper, slower and needs more graphics memory). Resolves to canvases on a white background; the models
 * stay loaded for the next call until `releaseTopDownModels()`.
 */
export async function generateTopDown(
  source,
  prompt,
  { seeds = TOP_DOWN_SEEDS, size = TOP_DOWN_SIZE, createCanvas, onStatus } = {},
) {
  const ort = await loadOrt();
  const models = await loadSessions(ort, onStatus);
  onStatus?.({ phase: 'generating', done: 0, total: seeds.length });

  const embeds = await encodePrompt(ort, models.textEncoder, prompt);
  const reference = await encodeReference(
    ort,
    models.vaeEncoder,
    drawTopDownReference(source, createCanvas, size),
  );
  const results = [];
  for (const seed of seeds) {
    const latents = await denoise(ort, models.transformer, { embeds, reference, seed });
    results.push(await decode(ort, models.vaeDecoder, latents, createCanvas));
    onStatus?.({ phase: 'generating', done: results.length, total: seeds.length });
  }
  return results;
}

/** Frees the GPU memory the models hold. */
export async function releaseTopDownModels() {
  const loaded = sessions;
  sessions = null;
  if (!loaded) return;
  const models = await loaded.catch(() => null);
  if (models) await Promise.all(Object.values(models).map((session) => session.release?.()));
}

function loadOrt() {
  ortPromise ??= import(/* webpackIgnore: true */ ORT_URL)
    .then((ort) => {
      ort.env.wasm.wasmPaths = ORT_WASM_URL;
      return ort;
    })
    .catch((error) => {
      ortPromise = null;
      throw error;
    });
  return ortPromise;
}

function loadSessions(ort, onStatus) {
  sessions ??= (async () => {
    const files = Object.values(GRAPHS).flatMap(({ url, data }) => [
      url,
      ...data.map((name) => url.replace(/[^/]+$/, name)),
    ]);
    const urls = await fetchModelFiles(files, onStatus);
    onStatus?.({ phase: 'loading' });
    const models = {};
    // One at a time: building a session briefly needs its weights twice over.
    for (const [key, { url, data }] of Object.entries(GRAPHS)) {
      models[key] = await ort.InferenceSession.create(urls.get(url), {
        executionProviders: ['webgpu'],
        externalData: data.map((name) => ({
          path: name,
          data: urls.get(url.replace(/[^/]+$/, name)),
        })),
      });
    }
    return models;
  })().catch((error) => {
    sessions = null;
    throw error;
  });
  return sessions;
}

/**
 * URLs for the model files. They are kept on disk in the browser's private file system (the
 * Origin Private File System) after the first download; a browser that cannot give the site
 * ~5.7 GB gets the remote URLs instead and downloads the model again each session.
 */
async function fetchModelFiles(urls, onStatus) {
  const folder = await openModelFolder();
  const result = new Map();
  const missing = [];
  for (const url of urls) {
    const file = await readKeptFile(folder, url);
    if (file) result.set(url, URL.createObjectURL(file));
    else missing.push(url);
  }
  if (!missing.length) return result;
  const total = missing.reduce((sum, url) => sum + (FILE_BYTES[getFileName(url)] ?? 0), 0);
  if (!folder || (await getFreeStorage()) < total * 1.05) {
    onStatus?.({ phase: 'stream' });
    for (const url of missing) result.set(url, url);
    return result;
  }
  globalThis.navigator?.storage?.persist?.().catch?.(() => {});
  let received = 0;
  let reported = -1;
  for (const url of missing) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} for ${url}`);
    const name = getFileName(url);
    const handle = await folder.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await writable.write(value);
        received += value.byteLength;
        const percent = Math.min(99, Math.floor((received / total) * 100));
        if (percent !== reported) onStatus?.({ phase: 'download', percent: (reported = percent) });
      }
      await writable.close();
    } catch (error) {
      await writable.abort?.().catch(() => {});
      await folder.removeEntry(name).catch(() => {});
      throw error;
    }
    result.set(url, URL.createObjectURL(await handle.getFile()));
  }
  return result;
}

const getFileName = (url) => url.split('/').pop();

/** A kept model file, if it is complete (an interrupted download leaves a shorter one). */
async function readKeptFile(folder, url) {
  if (!folder) return null;
  const name = getFileName(url);
  try {
    const file = await (await folder.getFileHandle(name)).getFile();
    return file.size === FILE_BYTES[name] ? file : null;
  } catch {
    return null;
  }
}

async function openModelFolder() {
  try {
    const root = await globalThis.navigator?.storage?.getDirectory?.();
    return (await root?.getDirectoryHandle(MODEL_FOLDER, { create: true })) ?? null;
  } catch {
    return null;
  }
}

async function getFreeStorage() {
  try {
    const { quota = 0, usage = 0 } = await globalThis.navigator.storage.estimate();
    return quota - usage;
  } catch {
    return 0;
  }
}

function loadTokenizer() {
  tokenizerPromise ??= (async () => {
    const transformers = await loadTransformers();
    const [json, config] = await Promise.all(
      ['tokenizer.json', 'tokenizer_config.json'].map(async (name) => {
        const response = await fetch(`${FLUX_URL}tokenizer/${name}`);
        if (!response.ok) throw new Error(`${response.status} for tokenizer/${name}`);
        return response.json();
      }),
    );
    return new transformers.PreTrainedTokenizer(json, config);
  })().catch((error) => {
    tokenizerPromise = null;
    throw error;
  });
  return tokenizerPromise;
}

/** The text encoder reads the prompt as a Qwen3 chat turn with thinking switched off. */
export function formatTopDownChat(prompt) {
  return `<|im_start|>user\n${prompt}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`;
}

async function encodePrompt(ort, session, prompt) {
  const tokenizer = await loadTokenizer();
  const ids = tokenizer
    .encode(formatTopDownChat(prompt), { add_special_tokens: false })
    .slice(0, TEXT_LENGTH);
  const inputIds = new BigInt64Array(TEXT_LENGTH).fill(BigInt(PAD_TOKEN));
  const mask = new BigInt64Array(TEXT_LENGTH);
  ids.forEach((id, index) => {
    inputIds[index] = BigInt(id);
    mask[index] = 1n;
  });
  const out = await session.run({
    input_ids: new ort.Tensor('int64', inputIds, [1, TEXT_LENGTH]),
    attention_mask: new ort.Tensor('int64', mask, [1, TEXT_LENGTH]),
  });
  return out.prompt_embeds;
}

/** The reference image as latent tokens, `[h * w, 128]`. */
async function encodeReference(ort, session, canvas) {
  const size = canvas.width;
  const { data } = canvas.getContext('2d').getImageData(0, 0, size, size);
  const area = size * size;
  const pixels = new Float32Array(3 * area);
  for (let pixel = 0; pixel < area; pixel += 1)
    for (let channel = 0; channel < 3; channel += 1)
      pixels[channel * area + pixel] = data[pixel * 4 + channel] / 127.5 - 1;
  const out = await session.run({
    [session.inputNames[0]]: new ort.Tensor('float32', pixels, [1, 3, size, size]),
  });
  const latents = out[session.outputNames[0]];
  const [, channels, height, width] = latents.dims;
  return { tokens: toTokens(latents.data, channels, height * width), height, width };
}

function toTokens(nchw, channels, count) {
  const tokens = new Float32Array(count * channels);
  for (let channel = 0; channel < channels; channel += 1)
    for (let index = 0; index < count; index += 1)
      tokens[index * channels + channel] = nchw[channel * count + index];
  return tokens;
}

async function denoise(ort, session, { embeds, reference, seed }) {
  const { tokens, height, width } = reference;
  const count = height * width;
  const imageIds = new BigInt64Array(count * 8);
  // The noise tokens sit at time 0, the reference's at time 10 of the same grid.
  imageIds.set(getGridIds(0, height, width), 0);
  imageIds.set(getGridIds(10, height, width), count * 4);
  const textIds = new BigInt64Array(TEXT_LENGTH * 4);
  for (let index = 0; index < TEXT_LENGTH; index += 1) textIds[index * 4 + 3] = BigInt(index);
  const sigmas = getTopDownSigmas(count, STEPS);
  let latents = gaussianNoise(count * 128, seed);
  for (let step = 0; step < STEPS; step += 1) {
    const input = new Float32Array(count * 256);
    input.set(latents, 0);
    input.set(tokens, count * 128);
    const out = await session.run({
      hidden_states: new ort.Tensor('float32', input, [1, count * 2, 128]),
      encoder_hidden_states: embeds,
      timestep: new ort.Tensor('float32', new Float32Array([sigmas[step]]), [1]),
      img_ids: new ort.Tensor('int64', imageIds, [count * 2, 4]),
      txt_ids: new ort.Tensor('int64', textIds, [TEXT_LENGTH, 4]),
    });
    // Only the noise tokens' predictions (the first `count` rows) move the image.
    const prediction = out.noise_pred.data;
    const delta = sigmas[step + 1] - sigmas[step];
    const next = new Float32Array(count * 128);
    for (let index = 0; index < next.length; index += 1)
      next[index] = latents[index] + delta * prediction[index];
    latents = next;
  }
  return { latents, height, width };
}

async function decode(ort, session, { latents, height, width }, createCanvas) {
  const count = height * width;
  const nchw = new Float32Array(128 * count);
  for (let index = 0; index < count; index += 1)
    for (let channel = 0; channel < 128; channel += 1)
      nchw[channel * count + index] = latents[index * 128 + channel];
  const out = await session.run({
    latents: new ort.Tensor('float32', nchw, [1, 128, height, width]),
  });
  const [, , outHeight, outWidth] = out.image.dims;
  const area = outWidth * outHeight;
  const pixels = new Uint8ClampedArray(area * 4);
  for (let pixel = 0; pixel < area; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1)
      pixels[pixel * 4 + channel] = Math.round(
        Math.min(1, Math.max(0, out.image.data[channel * area + pixel])) * 255,
      );
    pixels[pixel * 4 + 3] = 255;
  }
  const canvas = createCanvas(outWidth, outHeight);
  canvas.getContext('2d').putImageData(new ImageData(pixels, outWidth, outHeight), 0, 0);
  return canvas;
}

/** Position ids `(t, row, column, 0)` for every cell of an `h` by `w` latent grid. */
export function getGridIds(t, height, width) {
  const ids = new BigInt64Array(height * width * 4);
  for (let row = 0; row < height; row += 1)
    for (let column = 0; column < width; column += 1) {
      const offset = (row * width + column) * 4;
      ids[offset] = BigInt(t);
      ids[offset + 1] = BigInt(row);
      ids[offset + 2] = BigInt(column);
    }
  return ids;
}

/** FLUX.2's step schedule: evenly spaced, shifted by an empirical mu for this image size, then 0. */
export function getTopDownSigmas(sequenceLength, steps) {
  const [a1, b1, a2, b2] = [8.73809524e-5, 1.89833333, 0.00016927, 0.45666666];
  let mu;
  if (sequenceLength > 4300) mu = a2 * sequenceLength + b2;
  else {
    const at200 = a2 * sequenceLength + b2;
    const at10 = a1 * sequenceLength + b1;
    const slope = (at200 - at10) / 190;
    mu = slope * steps + (at200 - 200 * slope);
  }
  const shift = Math.exp(mu);
  const sigmas = [];
  for (let step = 0; step < steps; step += 1) {
    const base = steps > 1 ? 1 + ((1 / steps - 1) * step) / (steps - 1) : 1;
    sigmas.push(shift / (shift + (1 / base - 1)));
  }
  return [...sigmas, 0];
}

/** Standard normal noise from a seed (so a seed always gives the same image). */
export function gaussianNoise(count, seed) {
  const random = mulberry32(seed);
  const out = new Float32Array(count);
  for (let index = 0; index < count; index += 2) {
    const radius = Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12)));
    const angle = 2 * Math.PI * random();
    out[index] = radius * Math.cos(angle);
    if (index + 1 < count) out[index + 1] = radius * Math.sin(angle);
  }
  return out;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
