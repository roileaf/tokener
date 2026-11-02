import { createDownloadTracker, loadTransformers } from './ai-tools.js';

// Describes the creature in a token image in a few words ("a large spider-like creature"), for
// the top-down prompt when the actor has no description of its looks. Qwen3-VL 2B (Apache-2.0,
// ~1.4 GB at 4 bits) runs in the browser on WebGPU; it is loaded for one description and freed,
// so it never shares the graphics card with the top-down model.
const CAPTION_MODEL = 'onnx-community/Qwen3-VL-2B-Instruct-ONNX';
const CAPTION_REVISION = '5dc9194ba42fa62c2f1440d98a71f7cd5280afe2';
const CAPTION_DTYPE = Object.freeze({
  embed_tokens: 'q4f16',
  vision_encoder: 'q4f16',
  decoder_model_merged: 'q4f16',
});
const IMAGE_SIZE = 768;
// Asking about held items or mounts made it invent them; asking only what the creature is and
// its body shape did not.
export const CAPTION_QUESTION =
  'Describe the main creature in this picture in one phrase of about eight to fifteen words: ' +
  'what kind of creature it is and the shape of its body. Do not mention what it stands or sits ' +
  'on, the background, its pose, the lighting or the colours.';

/**
 * A short phrase describing the main creature in `canvas`. `onStatus` receives
 * `{ phase: 'caption-download', percent }` and `{ phase: 'caption' }`.
 */
export async function describeCreature(canvas, { createCanvas, onStatus } = {}) {
  const transformers = await loadTransformers();
  onStatus?.({ phase: 'caption' });
  // The total grows as each file starts, so the percentage only ever moves forward.
  let shown = 0;
  const progress_callback = createDownloadTracker((percent) => {
    if (percent <= shown) return;
    shown = percent;
    onStatus?.({ phase: 'caption-download', percent });
  });
  const options = { revision: CAPTION_REVISION, progress_callback };
  const [processor, model] = await Promise.all([
    transformers.AutoProcessor.from_pretrained(CAPTION_MODEL, options),
    transformers.Qwen3VLForConditionalGeneration.from_pretrained(CAPTION_MODEL, {
      ...options,
      dtype: CAPTION_DTYPE,
      device: 'webgpu',
    }),
  ]);
  onStatus?.({ phase: 'caption' });
  try {
    const image = await transformers.RawImage.fromCanvas(fitCanvas(canvas, createCanvas));
    const text = processor.apply_chat_template(
      [
        {
          role: 'user',
          content: [{ type: 'image' }, { type: 'text', text: CAPTION_QUESTION }],
        },
      ],
      { add_generation_prompt: true },
    );
    const inputs = await processor(text, image);
    const output = await model.generate({ ...inputs, max_new_tokens: 40, do_sample: false });
    const promptLength = inputs.input_ids.dims.at(-1);
    const [answer] = processor.batch_decode(output.slice(null, [promptLength, null]), {
      skip_special_tokens: true,
    });
    return cleanCaption(answer);
  } finally {
    await model.dispose?.();
  }
}

/** One line, no quotes or closing full stop, at most ~25 words. */
export function cleanCaption(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“]+|["'”]+$/g, '')
    .replace(/[.!]+$/, '')
    .split(' ')
    .slice(0, 25)
    .join(' ');
}

/** The image no larger than IMAGE_SIZE, on white (the model reads transparency as black). */
function fitCanvas(source, createCanvas) {
  const scale = Math.min(1, IMAGE_SIZE / Math.max(source.width, source.height));
  const canvas = createCanvas(
    Math.max(1, Math.round(source.width * scale)),
    Math.max(1, Math.round(source.height * scale)),
  );
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}
