import { AI_TOOLS_SETTING_KEY, MODULE_ID } from './constants.js';
import { localize } from './utils.js';

// Optional, opt-in AI helpers for the Token Creator. Models are segmentation models (they decide
// which existing pixels belong to what and never generate new pixels) and run in the browser.
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
const SAM_MODEL_ID = 'Xenova/slimsam-77-uniform';
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
