import {
  AI_CUSTOM_MODEL_SETTING_KEY,
  AI_MODEL_SETTING_KEY,
  AI_TOOLS_SETTING_KEY,
  MODULE_ID,
} from './constants.js';
import { localize } from './utils.js';

// Optional, opt-in AI helpers for the Token Creator. Models are segmentation models (they decide
// which existing pixels belong to what and never generate new pixels) and run in the browser.
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
const SAM_MODEL_ID = 'Xenova/slimsam-77-uniform';

/**
 * Background removal models, from small and fast to larger and cleaner on illustrated art. All run
 * in the browser (WASM). RMBG-1.4 needs its own loader: its config names no standard model type.
 */
export const BACKGROUND_MODELS = Object.freeze({
  fast: Object.freeze({ id: 'Xenova/modnet' }),
  better: Object.freeze({ id: 'onnx-community/ISNet-ONNX', dtype: 'q8' }),
  best: Object.freeze({ id: 'briaai/RMBG-1.4', dtype: 'q8', loader: 'rmbg' }),
});
/** A Hugging Face model id: "owner/name", letters, digits, `.`, `_` and `-` only. */
const MODEL_ID_PATTERN = /^[\w-][\w.-]*\/[\w-][\w.-]*$/;
const RMBG_PROCESSOR = Object.freeze({
  do_normalize: true,
  do_pad: false,
  do_rescale: true,
  do_resize: true,
  image_mean: [0.5, 0.5, 0.5],
  feature_extractor_type: 'ImageFeatureExtractor',
  image_std: [1, 1, 1],
  resample: 2,
  rescale_factor: 1 / 255,
  size: { width: 1024, height: 1024 },
});
let transformersPromise = null;
let samPromise = null;

export function registerAiToolsSetting(settings = globalThis.game?.settings) {
  settings?.register?.(MODULE_ID, AI_TOOLS_SETTING_KEY, {
    name: localize('Settings.AiTools.Name', 'Enable AI-assisted tools'),
    hint: localize(
      'Settings.AiTools.Hint',
      'Adds AI background removal (~7 MB) and click-to-select pop-out (~14 MB) to the Token Creator. The segmentation models download from Hugging Face on first use and run in your browser.',
    ),
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
  });
  // Per browser: the download and the memory are the device's.
  settings?.register?.(MODULE_ID, AI_MODEL_SETTING_KEY, {
    name: localize('Settings.AiModel.Name', 'AI background removal model'),
    hint: localize(
      'Settings.AiModel.Hint',
      "Larger models cut out illustrated art more cleanly but download more on first use and take a few seconds per image. Check a model's license before using it for commercial work.",
    ),
    scope: 'client',
    config: true,
    type: String,
    choices: {
      fast: localize('Settings.AiModel.Fast', 'Fast: MODNet (~7 MB)'),
      better: localize('Settings.AiModel.Better', 'Better: ISNet (~44 MB, AGPL-3.0)'),
      best: localize('Settings.AiModel.Best', 'Best: RMBG-1.4 (~44 MB, non-commercial license)'),
      custom: localize('Settings.AiModel.Custom', 'Custom: the Hugging Face model below'),
    },
    default: 'fast',
  });
  settings?.register?.(MODULE_ID, AI_CUSTOM_MODEL_SETTING_KEY, {
    name: localize('Settings.AiCustomModel.Name', 'Custom AI background model'),
    hint: localize(
      'Settings.AiCustomModel.Hint',
      'A Hugging Face model id (owner/name) with a transformers.js background-removal build, used when the model above is Custom.',
    ),
    scope: 'client',
    config: true,
    type: String,
    default: '',
  });
}

/**
 * The background removal model chosen in the settings: `{ key, id, dtype?, loader? }`. A custom
 * choice without a valid "owner/name" id, or anything unknown, falls back to the fast model.
 */
export function getBackgroundModel(settings = globalThis.game?.settings) {
  const read = (key) => {
    try {
      return settings?.get?.(MODULE_ID, key);
    } catch {
      return undefined;
    }
  };
  const choice = read(AI_MODEL_SETTING_KEY);
  if (choice === 'custom') {
    const id = String(read(AI_CUSTOM_MODEL_SETTING_KEY) ?? '').trim();
    if (MODEL_ID_PATTERN.test(id)) return { key: 'custom', id };
  }
  const key = Object.hasOwn(BACKGROUND_MODELS, choice) ? choice : 'fast';
  return { key, ...BACKGROUND_MODELS[key] };
}

/**
 * Loads `model` and returns `remove(url)`, which resolves to the image at `url` as RGBA
 * `{ data, width, height }` with the background made transparent.
 */
export async function loadBackgroundRemover(model, { progress_callback } = {}) {
  const transformers = await loadTransformers();
  const options = { progress_callback, ...(model.dtype ? { dtype: model.dtype } : {}) };
  if (model.loader === 'rmbg') {
    const [network, processor] = await Promise.all([
      transformers.AutoModel.from_pretrained(model.id, {
        ...options,
        config: { model_type: 'custom' },
      }),
      transformers.AutoProcessor.from_pretrained(model.id, { config: RMBG_PROCESSOR }),
    ]);
    return async (url) => {
      const image = await transformers.RawImage.read(url);
      const { pixel_values: pixelValues } = await processor(image);
      const { output } = await network({ input: pixelValues });
      const mask = await transformers.RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(
        image.width,
        image.height,
      );
      const rgba = image.rgba();
      return {
        data: applyAlphaMask(rgba.data, mask.data, mask.channels),
        width: rgba.width,
        height: rgba.height,
      };
    };
  }
  const segmenter = await transformers.pipeline('background-removal', model.id, options);
  return async (url) => {
    const output = await segmenter(url);
    const result = Array.isArray(output) ? output[0] : output;
    const rgba = result.channels === 4 ? result : result.rgba();
    return { data: rgba.data, width: rgba.width, height: rgba.height };
  };
}

/** A copy of RGBA pixels whose alpha is a separate mask's first channel. */
export function applyAlphaMask(rgba, mask, channels = 1) {
  const out = new Uint8ClampedArray(rgba);
  for (let pixel = 0; pixel * 4 < out.length; pixel += 1)
    out[pixel * 4 + 3] = mask[pixel * channels];
  return out;
}

export function areAiToolsEnabled(settings = globalThis.game?.settings) {
  try {
    return Boolean(settings?.get?.(MODULE_ID, AI_TOOLS_SETTING_KEY));
  } catch {
    return false;
  }
}

export function loadTransformers() {
  transformersPromise ??= import(/* webpackIgnore: true */ TRANSFORMERS_URL)
    .then((transformers) => {
      // Never ask the Foundry server for /models/...; always use the Hugging Face hub and keep
      // downloaded files in the browser's Cache Storage so later sessions skip the download.
      transformers.env.allowLocalModels = false;
      // 4.x throws when asked to use Cache Storage where it does not exist (plain http).
      transformers.env.useBrowserCache = canCacheModels();
      return transformers;
    })
    .catch((error) => {
      transformersPromise = null;
      throw error;
    });
  return transformersPromise;
}

/** Browsers only expose Cache Storage on https:// or localhost, so models re-download elsewhere. */
export function canCacheModels(scope = globalThis) {
  return Boolean(scope?.isSecureContext && scope?.caches);
}

/** Combines transformers.js per-file progress events into one percentage for the status line. */
export function createDownloadTracker(onProgress) {
  const files = new Map();
  let last = null;
  return (event) => {
    if (!event?.file) return;
    const entry = files.get(event.file) ?? { loaded: 0, total: 0 };
    if (event.status === 'progress') {
      entry.loaded = Number(event.loaded) || 0;
      entry.total = Number(event.total) || entry.total;
    } else if (event.status === 'done') {
      entry.loaded = entry.total;
    } else {
      files.set(event.file, entry);
      return;
    }
    files.set(event.file, entry);
    let loaded = 0;
    let total = 0;
    for (const file of files.values()) {
      loaded += file.loaded;
      total += file.total;
    }
    if (!total) return;
    const percent = Math.round((loaded / total) * 100);
    if (percent === last) return;
    last = percent;
    onProgress?.(percent);
  };
}

async function readCanvasImage(transformers, canvas) {
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('Canvas export failed.')))),
  );
  const url = URL.createObjectURL(blob);
  try {
    return await transformers.RawImage.read(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function pickBestMaskIndex(scores) {
  let best = 0;
  for (let index = 1; index < (scores?.length ?? 0); index += 1) {
    if (scores[index] > scores[best]) best = index;
  }
  return best;
}

/** Converts one of SAM's stacked boolean masks into white RGBA pixels with alpha set by the mask. */
export function samMaskToImageData(data, width, height, index = 0) {
  const area = width * height;
  const offset = area * index;
  const rgba = new Uint8ClampedArray(area * 4);
  for (let pixel = 0; pixel < area; pixel += 1) {
    if (!data[offset + pixel]) continue;
    const target = pixel * 4;
    rgba[target] = 255;
    rgba[target + 1] = 255;
    rgba[target + 2] = 255;
    rgba[target + 3] = 255;
  }
  return rgba;
}

export function scaleSamPoint(point, originalSize, reshapedSize) {
  return [
    (point.x * reshapedSize.width) / originalSize.width,
    (point.y * reshapedSize.height) / originalSize.height,
  ];
}

/**
 * Prepares Segment Anything for one image: the expensive image embedding runs once and the
 * returned `select(point)` only runs the small mask decoder for each click.
 */
export async function createSamSelector(canvas, { onStatus } = {}) {
  const transformers = await loadTransformers();
  if (!samPromise) {
    onStatus?.({ phase: 'loading' });
    const progress_callback = createDownloadTracker((percent) =>
      onStatus?.({ phase: 'download', percent }),
    );
    samPromise = Promise.all([
      transformers.SamModel.from_pretrained(SAM_MODEL_ID, { progress_callback }),
      transformers.AutoProcessor.from_pretrained(SAM_MODEL_ID),
    ]).catch((error) => {
      samPromise = null;
      throw error;
    });
  }
  const [model, processor] = await samPromise;
  onStatus?.({ phase: 'analysing' });

  const inputs = await processor(await readCanvasImage(transformers, canvas));
  const embeddings = await model.get_image_embeddings(inputs);
  const [originalHeight, originalWidth] = inputs.original_sizes[0];
  const [reshapedHeight, reshapedWidth] = inputs.reshaped_input_sizes[0];

  return async function select(point) {
    const scaled = scaleSamPoint(
      point,
      { width: originalWidth, height: originalHeight },
      { width: reshapedWidth, height: reshapedHeight },
    );
    const outputs = await model({
      ...embeddings,
      input_points: new transformers.Tensor('float32', scaled, [1, 1, 1, 2]),
      input_labels: new transformers.Tensor('int64', [1n], [1, 1, 1]),
    });
    const masks = await processor.post_process_masks(
      outputs.pred_masks,
      inputs.original_sizes,
      inputs.reshaped_input_sizes,
    );
    const best = pickBestMaskIndex(outputs.iou_scores.data);
    return new ImageData(
      samMaskToImageData(masks[0].data, originalWidth, originalHeight, best),
      originalWidth,
      originalHeight,
    );
  };
}
