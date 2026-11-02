import { cacheFileName } from './ai-tools.js';
import { MODULE_ID } from './constants.js';

// Generated top-down versions are kept in the browser's private file system, per actor and
// portrait image, so closing and reopening the Token Creator (or reloading) does not mean
// generating them again. Each stance keeps its versions, the one picked and its framing.
const FOLDER = `${MODULE_ID}-top-down-tokens`;
const MANIFEST = 'manifest.json';

/**
 * The key a set of top-down versions is kept under: the actor (or token) and the portrait image
 * it was made from, flips included. Null for an image with no path (an upload or a paste).
 */
export function getTopDownStoreKey({ ownerUuid, source }) {
  if (!ownerUuid || !source?.path) return null;
  const flip = source.flip ? `${source.flip.x ? 'x' : ''}${source.flip.y ? 'y' : ''}` : '';
  return `${ownerUuid}|${source.path}|${flip}`;
}

/**
 * Keeps `stances` (stance -> `{ images, applied, facing, view, label }`) under `key`. With
 * `images: false` only the picks and framing are written (the images are already there).
 */
export async function saveTopDownStances(key, stances, { images = true } = {}) {
  const folder = await openFolder(key, { create: true });
  if (!folder) return;
  const manifest = { key, stances: {} };
  for (const [stance, entry] of Object.entries(stances ?? {})) {
    if (!entry?.images?.length) continue;
    manifest.stances[stance] = {
      count: entry.images.length,
      applied: entry.applied,
      facing: entry.facing ?? null,
      view: entry.view ?? null,
      label: entry.label ?? '',
    };
    if (!images) continue;
    for (const [index, canvas] of entry.images.entries()) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob) await writeFile(folder, `${stance}-${index}.png`, blob);
    }
  }
  await writeFile(folder, MANIFEST, JSON.stringify(manifest));
}

/**
 * The stances kept under `key`, with their images as canvases, or null when there are none.
 * `createCanvas(width, height)` makes the canvases.
 */
export async function loadTopDownStances(key, createCanvas) {
  const folder = await openFolder(key);
  if (!folder) return null;
  try {
    const manifest = JSON.parse(
      await (await (await folder.getFileHandle(MANIFEST)).getFile()).text(),
    );
    if (manifest.key !== key) return null;
    const stances = {};
    for (const [stance, entry] of Object.entries(manifest.stances ?? {})) {
      const images = [];
      for (let index = 0; index < entry.count; index += 1) {
        const file = await (await folder.getFileHandle(`${stance}-${index}.png`)).getFile();
        const bitmap = await createImageBitmap(file);
        const canvas = createCanvas(bitmap.width, bitmap.height);
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        bitmap.close?.();
        images.push(canvas);
      }
      stances[stance] = { ...entry, images };
    }
    return Object.keys(stances).length ? stances : null;
  } catch {
    return null;
  }
}

async function openFolder(key, { create = false } = {}) {
  try {
    const root = await globalThis.navigator?.storage?.getDirectory?.();
    if (!root || !key) return null;
    const base = await root.getDirectoryHandle(FOLDER, { create });
    return await base.getDirectoryHandle(await cacheFileName(key), { create });
  } catch {
    return null;
  }
}

async function writeFile(folder, name, data) {
  const writable = await (await folder.getFileHandle(name, { create: true })).createWritable();
  await writable.write(data);
  await writable.close();
}
