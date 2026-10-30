import { DEFAULT_ANIMATION, hasMotion, samplePinOffset, samplePins } from './animation.js';
import {
  drawGlow,
  drawParticles,
  getDisplacement,
  getEmitterPoints,
  getFlickerFactor,
} from './animation-effects.js';
import { buildWarpGrid, warpImageData } from './puppet-warp.js';
import { getTokenFrameLayout } from './token-composer.js';

/** Largest edge, in pixels, of a saved animated token: VP9 + per-frame warps get slow beyond it. */
export const MAX_ANIMATED_SIZE = 512;

/** Share of the token size always kept around the art while bending, so edges never open up. */
const MIN_BEND_MARGIN = 0.1;

/** Token size, in pixels, at which effect strengths and scales are given. */
const EFFECT_REFERENCE_SIZE = 480;

/** Effects that move pixels through the warp. */
const DISPLACEMENT_TYPES = new Set(['wind', 'wobble']);

/** Cached emitters kept per source canvas before the cache for it is dropped. */
const MAX_EMITTERS_PER_SOURCE = 32;

/** Draws `image` at `layout`, shifted by `margin`, into a (size + 2 margin) square canvas. */
function drawLayout(image, layout, size, margin, createCanvas) {
  const canvas = createCanvas(size + margin * 2, size + margin * 2);
  canvas
    .getContext('2d')
    .drawImage(image, layout.x + margin, layout.y + margin, layout.width, layout.height);
  return canvas;
}

/** Grid spacing of the warp mesh, in token pixels. */
const WARP_STEP = 8;

/**
 * The part of a padded-canvas warp grid that covers the centre `size` x `size` square, so only
 * visible pixels are warped. `margin` must be a multiple of the grid step.
 */
function cropGrid(grid, margin, size) {
  const { gx, gy, cols, step } = grid;
  const skip = margin / step;
  const cropCols = Math.ceil(size / step) + 1;
  const outX = new Float32Array(cropCols * cropCols);
  const outY = new Float32Array(cropCols * cropCols);
  for (let j = 0; j < cropCols; j += 1) {
    const from = (j + skip) * cols + skip;
    outX.set(gx.subarray(from, from + cropCols), j * cropCols);
    outY.set(gy.subarray(from, from + cropCols), j * cropCols);
  }
  return { gx: outX, gy: outY, cols: cropCols, rows: cropCols, step };
}

/** Warps padded image data through a cropped grid into a `size` x `size` canvas. */
function warpData(source, grid, size, createCanvas) {
  const out = createCanvas(size, size);
  const context = out.getContext('2d');
  const target = context.createImageData(size, size);
  warpImageData(source, grid, target);
  context.putImageData(target, 0, 0);
  return out;
}

/** Plain size x size art at the token layout (no motion). */
function drawStill(image, layout, size, createCanvas) {
  return drawLayout(image, layout, size, 0, createCanvas);
}

/**
 * Padding (token pixels) drawn around the art before warping: the largest pin or rotated control point offset at any
 * keyframe, and at least a tenth of the token, so art from outside the token edge can slide in.
 */
export function getBendMargin(pins, scale, size) {
  let largest = 0;
  for (const pin of pins ?? [])
    for (const key of pin.keyframes ?? []) {
      // A satellite at `arm` from the pin travels at most 2 arm sin(rot / 2) <= arm min(2, |rot|).
      const swing = (pin.arm ?? 0) * Math.min(2, Math.abs(key.rot ?? 0));
      largest = Math.max(
        largest,
        (Math.abs(key.dx) + swing) * scale,
        (Math.abs(key.dy) + swing) * scale,
      );
    }
  return Math.ceil(Math.max(size * MIN_BEND_MARGIN, largest));
}

/** A glow effect with its `size` (px at `EFFECT_REFERENCE_SIZE`) converted to px at `size`. */
function atReferenceSize(effect, size) {
  return { ...effect, size: (Number(effect.size) * size) / EFFECT_REFERENCE_SIZE };
}

/**
 * The art with every whole-figure glow (region null) drawn under it. The aura is part of the
 * art, so the frame's clip applies and it sits between the frame fill and the figure.
 */
function drawAuras(art, effects, { t, size, createCanvas }) {
  const auras = effects.filter((effect) => effect.type === 'glow' && !effect.region);
  if (!auras.length) return art;
  const out = createCanvas(size, size);
  const context = out.getContext('2d');
  for (const effect of auras)
    drawGlow(context, {
      effect: atReferenceSize(effect, size),
      art,
      region: null,
      t,
      size,
      createCanvas,
      phase: 'behind',
    });
  context.drawImage(art, 0, 0);
  return out;
}

let paddedCache = new WeakMap();
let emitterCache = new WeakMap();

/**
 * Forgets the cached padded layouts and particle emitters. Caches are keyed by canvas identity,
 * so call this after repainting a cut-out, pop-out or region canvas in place.
 */
export function clearEffectCaches() {
  paddedCache = new WeakMap();
  emitterCache = new WeakMap();
}

/**
 * Pixels of `image` drawn at `layout` on the padded warp canvas. They do not depend on the loop
 * time, so the last one per source canvas is cached: redrawing a large source every frame is
 * the slowest part of a frame.
 */
function getPaddedData(image, layout, size, margin, createCanvas) {
  const key = [size, margin, layout.x, layout.y, layout.width, layout.height].join('|');
  const cached = paddedCache.get(image);
  if (cached?.key === key) return cached.data;
  const full = size + margin * 2;
  const data = drawLayout(image, layout, size, margin, createCanvas)
    .getContext('2d')
    .getImageData(0, 0, full, full);
  paddedCache.set(image, { key, data });
  return data;
}

/** Token-space layout of the cut-out (and anything drawn in its source pixels) for `view`. */
function getArtLayout(cutout, view, size) {
  return getTokenFrameLayout({
    imageWidth: cutout.width,
    imageHeight: cutout.height,
    size,
    zoom: view?.zoom,
    offsetX: (view?.offsetX ?? 0) * size,
    offsetY: (view?.offsetY ?? 0) * size,
  });
}

/**
 * Source position of a warp grid at padded point (x, y): bilinear inside the grid, linear
 * extrapolation of the edge cells outside it.
 */
function sampleGrid(grid, x, y) {
  const { gx, gy, cols, rows, step } = grid;
  const fi = x / step;
  const fj = y / step;
  const i0 = Math.min(cols - 2, Math.max(0, Math.floor(fi)));
  const j0 = Math.min(rows - 2, Math.max(0, Math.floor(fj)));
  const ti = fi - i0;
  const tj = fj - j0;
  const k = j0 * cols + i0;
  return {
    x:
      (gx[k] * (1 - ti) + gx[k + 1] * ti) * (1 - tj) +
      (gx[k + cols] * (1 - ti) + gx[k + cols + 1] * ti) * tj,
    y:
      (gy[k] * (1 - ti) + gy[k + 1] * ti) * (1 - tj) +
      (gy[k + cols] * (1 - ti) + gy[k + cols + 1] * ti) * tj,
  };
}

/** Alpha (0..1) of padded image data at (x, y), nearest pixel; 0 outside. */
function alphaAt(image, x, y) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) return 0;
  return image.data[(py * image.width + px) * 4 + 3] / 255;
}

/**
 * Adds wind / wobble on top of the pin warp: each output node moves by the sum of the effects'
 * displacements, each weighted by its region's alpha where the pins put that node (or 1 for the
 * whole subject), and samples the pin-warped source there. Effect params are in px at
 * `EFFECT_REFERENCE_SIZE`, so a token looks the same at preview and saved sizes.
 */
function displaceGrid(grid, displacements, { margin, size, t }) {
  const { gx, gy, cols, rows, step } = grid;
  const toReference = EFFECT_REFERENCE_SIZE / size;
  const outX = new Float32Array(gx.length);
  const outY = new Float32Array(gy.length);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const n = j * cols + i;
      const px = i * step;
      const py = j * step;
      const rx = (px - margin) * toReference;
      const ry = (py - margin) * toReference;
      let dx = 0;
      let dy = 0;
      for (const { effect, alpha } of displacements) {
        const weight = alpha ? alphaAt(alpha, gx[n], gy[n]) : 1;
        if (!weight) continue;
        const offset = getDisplacement(effect, rx, ry, t);
        dx += (weight * offset.dx) / toReference;
        dy += (weight * offset.dy) / toReference;
      }
      if (!dx && !dy) {
        outX[n] = gx[n];
        outY[n] = gy[n];
        continue;
      }
      const source = sampleGrid(grid, px - dx, py - dy);
      outX[n] = source.x;
      outY[n] = source.y;
    }
  }
  return { gx: outX, gy: outY, cols, rows, step };
}

/** The canvas an effect's region is painted on, or null for the whole figure / no paint yet. */
function getRegionCanvas(effect, regions) {
  if (!effect.region) return null;
  return regions?.[effect.region] ?? regions?.[effect.id] ?? null;
}

/**
 * Bends the cut-out, pop-out image and effect regions with one warp: the pins at `t`, plus the
 * wind / wobble effects. Returns size x size token-space canvases `{ art, popOut, regions }`.
 */
function bendLayers({ cutout, popOutImage, regions, view, size, animation, t, createCanvas }) {
  const layout = getArtLayout(cutout, view, size);
  const effects = animation.effects ?? [];
  const scale = layout.width / Math.max(1, cutout.width);
  const displacementEffects = effects.filter(
    (effect) => DISPLACEMENT_TYPES.has(effect.type) && Number(effect.strength) > 0,
  );
  const reach = displacementEffects.reduce(
    (sum, effect) => sum + (Number(effect.strength) * size) / EFFECT_REFERENCE_SIZE,
    0,
  );
  const margin =
    Math.ceil((getBendMargin(animation.pins, scale, size) + reach) / WARP_STEP) * WARP_STEP;
  const full = size + margin * 2;
  const { rest, moved } = samplePins(animation.pins ?? [], t, animation.mode);
  const toPadded = (point) => ({
    x: layout.x + margin + point.x * scale,
    y: layout.y + margin + point.y * scale,
  });
  let grid = buildWarpGrid({
    width: full,
    height: full,
    rest: rest.map(toPadded),
    moved: moved.map(toPadded),
    step: WARP_STEP,
  });

  const paddedData = (image) => getPaddedData(image, layout, size, margin, createCanvas);
  const regionCanvases = new Map();
  for (const effect of effects) {
    const canvas = getRegionCanvas(effect, regions);
    if (canvas && !regionCanvases.has(effect.region)) regionCanvases.set(effect.region, canvas);
  }

  let displaced = false;
  if (displacementEffects.length) {
    const displacements = [];
    for (const effect of displacementEffects) {
      if (!effect.region) displacements.push({ effect, alpha: null });
      else if (regionCanvases.has(effect.region))
        displacements.push({ effect, alpha: paddedData(regionCanvases.get(effect.region)) });
    }
    if (displacements.length) {
      grid = displaceGrid(grid, displacements, { margin, size, t });
      displaced = true;
    }
  }

  // Nothing moves this frame (e.g. only flicker / glow / particles): skip the warp, which would
  // only cost time and an ImageData round trip.
  const still =
    !displaced && rest.every((point, i) => point.x === moved[i].x && point.y === moved[i].y);
  const visible = still ? null : cropGrid(grid, margin, size);
  const bend = (image) =>
    still
      ? drawStill(image, layout, size, createCanvas)
      : warpData(paddedData(image), visible, size, createCanvas);
  // Regions are bent on first read: only some effects (region glow) draw them.
  const bentRegions = {};
  for (const [key, canvas] of regionCanvases) {
    let bent = null;
    Object.defineProperty(bentRegions, key, {
      enumerable: true,
      get: () => (bent ??= bend(canvas)),
    });
  }
  return {
    art: bend(cutout),
    popOut: popOutImage ? bend(popOutImage) : null,
    regions: bentRegions,
  };
}

/**
 * Bends the token art (and its pop-out image) at loop time `t` in token space, so the frame or
 * ring drawn afterwards stays still. `view.offsetX/Y` are fractions of `size`, as in `app.view`.
 * Returns size x size canvases that draw at an identity layout. The art is warped on a padded
 * canvas, so parts that overflow the token (cover layouts) move in instead of leaving gaps.
 */
export function bendTokenArt({ cutout, popOutImage, view, size, animation, t, createCanvas }) {
  if (!hasMotion(animation)) {
    const layout = getArtLayout(cutout, view, size);
    return {
      art: drawStill(cutout, layout, size, createCanvas),
      popOut: popOutImage ? drawStill(popOutImage, layout, size, createCanvas) : null,
    };
  }
  const { art, popOut } = bendLayers({
    cutout,
    popOutImage,
    regions: {},
    view,
    size,
    animation,
    t,
    createCanvas,
  });
  return { art, popOut };
}

/** Product of the flicker factors per kind at `t`. */
function getFlicker(effects, t) {
  let opacity = 1;
  let brightness = 1;
  for (const effect of effects) {
    if (effect.type !== 'flicker') continue;
    const factor = getFlickerFactor(effect, t);
    if (effect.kind === 'brightness') brightness *= factor;
    else opacity *= factor;
  }
  return { opacity, brightness };
}

/** `canvas` faded to `opacity` and darkened to `brightness` (both 1 returns it unchanged). */
function applyFlicker(canvas, { opacity, brightness }, size, createCanvas) {
  if (!canvas || (opacity === 1 && brightness === 1)) return canvas;
  const out = createCanvas(size, size);
  const context = out.getContext('2d');
  context.globalAlpha = opacity;
  context.drawImage(canvas, 0, 0);
  if (brightness < 1) {
    context.globalAlpha = 1 - brightness;
    context.globalCompositeOperation = 'source-atop';
    context.fillStyle = '#000000';
    context.fillRect(0, 0, size, size);
  }
  return out;
}

/**
 * Particle emitter points for an effect, from its region (or the silhouette edge) at the still
 * layout. Scanning pixels is slow, so points are cached per source canvas, effect, size and view.
 */
function getEmitter({ effect, source, isRegion, layout, size, createCanvas }) {
  let byKey = emitterCache.get(source);
  if (!byKey) {
    byKey = new Map();
    emitterCache.set(source, byKey);
  }
  const key = [effect.id, isRegion, size, layout.x, layout.y, layout.width, layout.height].join(
    '|',
  );
  let emitter = byKey.get(key);
  if (!emitter) {
    if (byKey.size >= MAX_EMITTERS_PER_SOURCE) byKey.clear();
    const still = drawStill(source, layout, size, createCanvas);
    emitter = {
      points: getEmitterPoints({
        art: isRegion ? null : still,
        region: isRegion ? still : null,
        size,
        createCanvas,
        seed: effect.id,
      }),
    };
    byKey.set(key, emitter);
  }
  return emitter;
}

/**
 * Draws one animation frame of the token at loop time `t` into `context` (size x size):
 * the art, pop-out image and effect regions (source-image px canvases keyed by `effect.region`)
 * bent with one warp (pins + wind / wobble, weighted by their regions) -> flicker -> whole-figure
 * glow drawn under the art (inside it, so the frame clips it) -> `drawFrame(context, bent)` (the
 * caller's frame or ring) -> region glow over -> particles on top. With no pin motion
 * and no effects, `drawFrame(context, null)` draws the plain still token. Returns `bent`
 * (`{ art, popOut, regions }` or null), which callers may pass back as `bent` to skip bending
 * an identical pose again.
 */
export function renderAnimationFrame({
  context,
  size,
  t,
  art: { cutout, popOutImage = null, regions = {} },
  view,
  animation,
  createCanvas,
  drawFrame,
  bent: prepared,
}) {
  if (!hasMotion(animation)) {
    drawFrame(context, null);
    return null;
  }
  const effects = animation.effects ?? [];
  let bent = prepared;
  if (!bent) {
    const layers = bendLayers({
      cutout,
      popOutImage,
      regions,
      view,
      size,
      animation,
      t,
      createCanvas,
    });
    const flicker = getFlicker(effects, t);
    bent = {
      art: drawAuras(applyFlicker(layers.art, flicker, size, createCanvas), effects, {
        t,
        size,
        createCanvas,
      }),
      popOut: applyFlicker(layers.popOut, flicker, size, createCanvas),
      regions: layers.regions,
    };
  }
  drawFrame(context, bent);

  for (const effect of effects) {
    if (effect.type !== 'glow' || !effect.region) continue;
    const region = bent.regions[effect.region];
    if (region)
      drawGlow(context, {
        effect: atReferenceSize(effect, size),
        art: bent.art,
        region,
        t,
        size,
        createCanvas,
        phase: 'over',
      });
  }

  let layout = null;
  for (const effect of effects) {
    if (effect.type !== 'particles') continue;
    const regionCanvas = getRegionCanvas(effect, regions);
    if (effect.region && !regionCanvas) continue;
    layout ??= getArtLayout(cutout, view, size);
    const emitter = getEmitter({
      effect,
      source: regionCanvas ?? cutout,
      isRegion: Boolean(regionCanvas),
      layout,
      size,
      createCanvas,
    });
    drawParticles(context, { effect, emitter, t, size });
  }
  return bent;
}

/** The edge of the saved WebM: the chosen output size, capped at `MAX_ANIMATED_SIZE`. */
export function getAnimatedOutputSize(outputSize) {
  return Math.min(Number(outputSize) || MAX_ANIMATED_SIZE, MAX_ANIMATED_SIZE);
}

/** Preview playback runs under Move and the pin tool; mask and touch-up tools edit the still art. */
export function canPlayWithTool(maskTool) {
  return !maskTool || maskTool === 'pin';
}

/**
 * Whether the preview shows the bent art: not while a mask or touch-up tool is active, nor while
 * a modifier/right-button stroke would paint the pop-out mask under Move (`pointerMode` set),
 * because the mask overlay and brush map to the still art.
 */
export function shouldBendPreview({ maskTool, pointerMode }) {
  return canPlayWithTool(maskTool) && !pointerMode;
}

/** Breathe scales pins about their centre, so it needs at least two pins to do anything useful. */
export function isPresetAvailable(pins, selectedPinId, preset) {
  if (preset === 'breathe' && (pins?.length ?? 0) < 2) return false;
  return getPresetTargets(pins, selectedPinId, preset).length > 0;
}

/**
 * How the token is saved: an animated WebM loop only when some pin moves and this browser can
 * encode one; otherwise the usual still image.
 */
export function getAnimatedSavePlan({ animation, canEncode }) {
  return canEncode && hasMotion(animation) ? 'animated' : 'still';
}

/** A fresh animation for a newly loaded token image: pins belong to the old art, the loop length stays. */
export function resetAnimationForNewSource(animation) {
  return { ...DEFAULT_ANIMATION, ...(animation ?? {}), pins: [] };
}

/** True when a pin never moves, so it holds the art still around it. */
export function isAnchorPin(pin) {
  return !pin.keyframes?.some((k) => k.dx !== 0 || k.dy !== 0);
}

/**
 * Maps pins (source-image pixels) to preview points at loop time `t`, using the preview `layout`
 * of the cut-out (`getPreviewLayout`). Each point says whether it is selected or an anchor.
 */
export function getPinPreviewPoints({ pins, layout, cutoutWidth, t = 0, selectedId = null }) {
  const scale = layout.width / Math.max(1, cutoutWidth);
  return (pins ?? []).map((pin) => {
    const { dx, dy } = samplePinOffset(pin, t);
    return {
      id: pin.id,
      x: layout.x + (pin.x + dx) * scale,
      y: layout.y + (pin.y + dy) * scale,
      selected: pin.id === selectedId,
      anchor: isAnchorPin(pin),
    };
  });
}

/**
 * Which pins a preset writes: Bob and Sway move the selected pin only (none when nothing is
 * selected); Breathe scales every pin about their shared centre.
 */
export function getPresetTargets(pins, selectedPinId, preset) {
  const list = pins ?? [];
  if (preset === 'breathe') return list.map((pin) => pin.id);
  return list.some((pin) => pin.id === selectedPinId) ? [selectedPinId] : [];
}

/** Dragging a pin without keyframes moves where it rests; otherwise it sets its offset now. */
export function getPinDragMode(pin) {
  return pin?.keyframes?.length ? 'keyframe' : 'rest';
}

/**
 * Pin hit radius in token-space preview pixels for a radius given in screen (CSS) pixels: the
 * preview canvas may be drawn smaller or larger than its pixel size, and the viewport may zoom.
 */
export function getPinHitRadius({ radius, viewportScale = 1, canvasWidth, clientWidth }) {
  const cssScale = clientWidth > 0 && canvasWidth > 0 ? canvasWidth / clientWidth : 1;
  return (radius * cssScale) / (viewportScale || 1);
}
