import { normalizePath } from './utils.js';

export const CREATED_TOKEN_SOURCE_ID = 'tokener-created';
export const CREATED_TOKEN_FOLDER_NAME = 'tokener';

export const PORTRAIT_ASPECTS = ['original', '1:1', '2:3', '3:4'];
export const PORTRAIT_BACKGROUNDS = ['original', 'transparent', 'color'];

export function getTokenFrameLayout({
  imageWidth,
  imageHeight,
  size,
  zoom = 1,
  offsetX = 0,
  offsetY = 0,
}) {
  return getRectFrameLayout({
    imageWidth,
    imageHeight,
    width: size,
    height: size,
    zoom,
    offsetX,
    offsetY,
  });
}

/** Scales the image to cover a `width` x `height` frame, then applies zoom and offset. */
export function getRectFrameLayout({
  imageWidth,
  imageHeight,
  width: frameWidth,
  height: frameHeight,
  zoom = 1,
  offsetX = 0,
  offsetY = 0,
}) {
  const cover = Math.max(
    frameWidth / Math.max(1, imageWidth),
    frameHeight / Math.max(1, imageHeight),
  );
  const scale = cover * (Number(zoom) || 1);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (frameWidth - width) / 2 + offsetX,
    y: (frameHeight - height) / 2 + offsetY,
    width,
    height,
  };
}

export function getPortraitAspectRatio(aspect, imageWidth, imageHeight) {
  const match = /^(\d+):(\d+)$/.exec(String(aspect ?? ''));
  if (match) return Number(match[1]) / Number(match[2]);
  return Math.max(1, imageWidth) / Math.max(1, imageHeight);
}

/** The portrait frame inside a square preview of `size`, as large as the aspect allows. */
export function getPortraitRect({ size, aspect, imageWidth, imageHeight }) {
  const ratio = getPortraitAspectRatio(aspect, imageWidth, imageHeight);
  const width = ratio >= 1 ? size : size * ratio;
  const height = ratio >= 1 ? size / ratio : size;
  return { x: (size - width) / 2, y: (size - height) / 2, width, height };
}

export function isPortraitUnchanged(options, view) {
  return (
    options?.portraitAspect === 'original' &&
    options?.portraitBackground === 'original' &&
    Number(view?.zoom ?? 1) === 1 &&
    !Number(view?.offsetX) &&
    !Number(view?.offsetY)
  );
}

/**
 * Draws the edited portrait into a `width` x `height` context. Offsets are fractions of the frame
 * so the preview and the exported file line up at any resolution.
 */
export function drawPortrait(
  context,
  { source, cutout, width, height, zoom = 1, offsetX = 0, offsetY = 0, background, color },
) {
  const image = background === 'original' ? source : cutout;
  const layout = getRectFrameLayout({
    imageWidth: image.width,
    imageHeight: image.height,
    width,
    height,
    zoom,
    offsetX: offsetX * width,
    offsetY: offsetY * height,
  });
  context.clearRect(0, 0, width, height);
  if (background === 'color') {
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(image, layout.x, layout.y, layout.width, layout.height);
}

/**
 * Where the token square sits on the preview canvas for a view-only zoom (`scale`) and pan. This
 * never changes the token itself, only how large it is drawn while editing.
 */
export function getPreviewViewport({ size, scale = 1, panX = 0, panY = 0 }) {
  const drawn = size * scale;
  return {
    x: (size - drawn) / 2 + panX,
    y: (size - drawn) / 2 + panY,
    scale,
    size: drawn,
  };
}

export function viewportPointToToken(viewport, { x, y }) {
  return {
    x: (x - viewport.x) / viewport.scale,
    y: (y - viewport.y) / viewport.scale,
  };
}

export function previewPointToImage({ layout, imageWidth, imageHeight, x, y }) {
  const scaleX = imageWidth / layout.width;
  const scaleY = imageHeight / layout.height;
  return {
    x: (x - layout.x) * scaleX,
    y: (y - layout.y) * scaleY,
    scale: Math.max(scaleX, scaleY),
  };
}

/** The frame opening (centred on a `size` token, `radius` in token pixels) in source-image pixels. */
export function getOpeningInImage({ layout, imageWidth, imageHeight, size, radius }) {
  const center = previewPointToImage({
    layout,
    imageWidth,
    imageHeight,
    x: size / 2,
    y: size / 2,
  });
  return { x: center.x, y: center.y, radius: radius * center.scale };
}

/** Restricts drawing to everything outside a circle, the only place popped parts show. */
export function clipOutsideOpening(context, { x, y, radius }, width, height) {
  context.beginPath();
  context.rect(0, 0, width, height);
  context.arc(x, y, radius, 0, Math.PI * 2, true);
  context.clip('evenodd');
}

// How far below the token centre the automatic pop-out reaches, as a fraction of the frame
// opening radius. Hair, horns and raised weapons pop out; the lower body stays cropped.
export const AUTO_POP_OUT_DEPTH = 0.35;

export function getAutoPopOutCutoff(size, radius) {
  return size / 2 + radius * AUTO_POP_OUT_DEPTH;
}

/**
 * Source-image rectangle matching the automatic pop-out area: the full token width from the top
 * down to just below the centre. Drawn through the cut-out, it follows the subject's outline.
 */
export function getAutoPopOutRect({ layout, imageWidth, imageHeight, size, radius }) {
  const topLeft = previewPointToImage({ layout, imageWidth, imageHeight, x: 0, y: 0 });
  const bottomRight = previewPointToImage({
    layout,
    imageWidth,
    imageHeight,
    x: size,
    y: getAutoPopOutCutoff(size, radius),
  });
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

/**
 * Breakout room: the frame is drawn smaller inside the token so popped-out parts have space past
 * its outer edge. `room` is extra size as a percentage of the frame; the token is then scaled up
 * by the inverse in Foundry so the frame still matches the grid.
 */
export function getRingScale(room = 0) {
  const value = Number(room);
  return 1 / (1 + Math.max(0, Number.isFinite(value) ? value : 0) / 100);
}

export function getRingGeometry({ size, ringScale = 1 }) {
  const ringSize = size * ringScale;
  return {
    center: size / 2,
    ringSize,
    offset: (size - ringSize) / 2,
    outerRadius: ringSize / 2 - 1,
  };
}

/**
 * Draws a circular token onto a 2D context. `image` should already have its background removed
 * when `popOut` is enabled, otherwise the part above the frame shows the original backdrop.
 */
export function drawTokenFrame(
  context,
  image,
  {
    size,
    zoom = 1,
    offsetX = 0,
    offsetY = 0,
    borderWidth = 0,
    borderColor = '#000000',
    fill = false,
    fillColor = '#000000',
    popOut = false,
    popOutImage = null,
    popOutShadow = false,
    ringScale = 1,
  },
) {
  const { center, outerRadius } = getRingGeometry({ size, ringScale });
  const innerRadius = Math.max(0, outerRadius - borderWidth);
  const layout = getTokenFrameLayout({
    imageWidth: image.width,
    imageHeight: image.height,
    size,
    zoom,
    offsetX,
    offsetY,
  });

  context.clearRect(0, 0, size, size);

  context.save();
  context.beginPath();
  context.arc(center, center, innerRadius, 0, Math.PI * 2);
  context.clip();
  if (fill) {
    context.fillStyle = fillColor;
    context.fillRect(0, 0, size, size);
  }
  context.drawImage(image, layout.x, layout.y, layout.width, layout.height);
  context.restore();

  if (borderWidth > 0) {
    context.beginPath();
    context.arc(center, center, outerRadius - borderWidth / 2, 0, Math.PI * 2);
    context.lineWidth = borderWidth;
    context.strokeStyle = borderColor;
    context.stroke();
  }

  drawPopOut(context, image, layout, {
    center,
    radius: innerRadius,
    popOut,
    popOutImage,
    popOutShadow,
  });
}

/**
 * Draws the parts of the subject that break out of the frame: a pre-masked `popOutImage` when the
 * user painted a mask, otherwise every part of the cut-out above the automatic cutoff line.
 */
function drawPopOut(context, image, layout, { center, radius, popOut, popOutImage, popOutShadow }) {
  if (!popOut) return;
  if (popOutShadow) drawPopOutShadow(context, image, layout, { center, radius, popOutImage });
  context.save();
  clipToPopOutArea(context, { center, radius, popOutImage });
  context.drawImage(popOutImage ?? image, layout.x, layout.y, layout.width, layout.height);
  context.restore();
}

/**
 * Where popped parts are drawn: outside the opening only, and above the automatic cutoff line when
 * no mask was painted. The art inside the opening is already drawn; drawing semi-transparent parts
 * there again (or shading them) would show a seam at the cutoff line.
 */
function clipToPopOutArea(context, { center, radius, popOutImage }) {
  const size = center * 2;
  if (!popOutImage) {
    context.beginPath();
    context.rect(0, 0, size, getAutoPopOutCutoff(size, radius));
    context.clip();
  }
  clipOutsideOpening(context, { x: center, y: center, radius }, size, size);
}

/**
 * A soft shadow cast by the popped parts onto the frame and whatever lies around the token, so they
 * read as in front of it. Only the shadow is drawn (the art is drawn far off-canvas and its shadow
 * offset back), and it is kept outside the opening so the framed art is not darkened.
 */
function drawPopOutShadow(context, image, layout, { center, radius, popOutImage }) {
  const size = center * 2;
  const away = size * 4;
  context.save();
  clipToPopOutArea(context, { center, radius, popOutImage });
  context.shadowColor = 'rgba(0, 0, 0, 0.55)';
  context.shadowBlur = size * 0.025;
  context.shadowOffsetX = away;
  context.shadowOffsetY = size * 0.012;
  context.drawImage(popOutImage ?? image, layout.x - away, layout.y, layout.width, layout.height);
  context.restore();
}

export const DEFAULT_RING_SUBJECT_RADIUS = 0.666;

/**
 * Draws a transparent subject for Foundry's dynamic token ring. Foundry renders the subject over
 * the ring, so the subject is clipped to the ring's inner circle (`clipRadius`, as a fraction of
 * the half size) and, with `popOut`, may break out over the ring. Previews pass the world's
 * ring `layers` (background, ring) to draw underneath, or a `guide` when that art is unavailable.
 */
export function drawRingSubject(
  context,
  image,
  {
    size,
    zoom = 1,
    offsetX = 0,
    offsetY = 0,
    clipRadius = DEFAULT_RING_SUBJECT_RADIUS,
    popOut = false,
    popOutImage = null,
    popOutShadow = false,
    guide = null,
    layers = [],
    ringScale = 1,
  },
) {
  const { center, ringSize, offset } = getRingGeometry({ size, ringScale });
  const radius = center * clipRadius * ringScale;
  const layout = getTokenFrameLayout({
    imageWidth: image.width,
    imageHeight: image.height,
    size,
    zoom,
    offsetX,
    offsetY,
  });

  context.clearRect(0, 0, size, size);
  if (layers.length) {
    for (const layer of layers) context.drawImage(layer, offset, offset, ringSize, ringSize);
  } else if (guide) {
    const ringWidth = center * 0.06 * ringScale;
    context.beginPath();
    context.arc(center, center, radius + ringWidth / 2, 0, Math.PI * 2);
    if (guide.backgroundColor) {
      context.fillStyle = guide.backgroundColor;
      context.fill();
    }
    context.lineWidth = ringWidth;
    context.strokeStyle = guide.ringColor || '#ffffff';
    context.stroke();
  }

  context.save();
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.clip();
  context.drawImage(image, layout.x, layout.y, layout.width, layout.height);
  context.restore();
  drawPopOut(context, image, layout, { center, radius, popOut, popOutImage, popOutShadow });
}

export function buildCreatedTokenFileName(
  name,
  { now = new Date(), suffix = '', extension = 'webp' } = {},
) {
  const slug =
    String(name ?? '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'token';
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    '-',
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join('');
  return `${slug}-${stamp}${suffix ? `-${suffix}` : ''}.${extension}`;
}

export function getCreatedTokenFolder({ worldId, configured } = {}) {
  const folder = normalizePath(configured)
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (folder) return folder;
  return `worlds/${worldId || 'shared'}/${CREATED_TOKEN_FOLDER_NAME}`;
}

const RING_EFFECT_BITS = Object.freeze({ pulse: 2, gradient: 4, wave: 8, spectral: 16 });

/** Foundry's `ring.effects` bit mask: ENABLED (1) plus one bit per selected effect. */
export function getRingEffectsMask({ pulse, gradient, wave, spectral } = {}) {
  const flags = { pulse, gradient, wave, spectral };
  let mask = 1;
  for (const [key, bit] of Object.entries(RING_EFFECT_BITS)) if (flags[key]) mask |= bit;
  return mask;
}

export function buildCreatedTokenCandidate({
  label,
  tokenSrc,
  portraitSrc,
  subjectSrc,
  ringColors,
  ringEffects,
  breakoutScale = 1,
  animated = false,
  projectSrc,
}) {
  const candidate = {
    id: `${CREATED_TOKEN_SOURCE_ID}:${tokenSrc}`,
    label: label ?? '',
    sourceId: CREATED_TOKEN_SOURCE_ID,
    tokenSrc,
    scale: 1,
  };
  if (breakoutScale > 1) candidate.breakoutScale = breakoutScale;
  if (portraitSrc) candidate.portraitSrc = portraitSrc;
  if (projectSrc) candidate.projectSrc = projectSrc;
  if (subjectSrc) {
    // An animated token is a video: Foundry's ring then uses the token texture itself as the
    // subject, so no separate subject image is set.
    if (animated) candidate.ringFromToken = true;
    else candidate.subjectSrc = subjectSrc;
    candidate.subjectScale = breakoutScale;
    if (ringColors) candidate.ringColors = { ...ringColors };
    if (ringEffects) candidate.ringEffects = getRingEffectsMask(ringEffects);
  }
  return candidate;
}

/**
 * The cut-out with the user's touch-ups applied on top of the automatic (or AI) result: the
 * `keep` layer brings original pixels back and the `remove` layer deletes pixels. Touch-ups are
 * kept separately so changing tolerance or the removal mode never throws them away.
 */
export function applyCutoutTouchUps({ base, source, keep, remove, createCanvas }) {
  if (!base || (!keep && !remove)) return base;
  const canvas = createCanvas(base.width, base.height);
  const context = canvas.getContext('2d');
  context.drawImage(base, 0, 0);
  if (keep && source) {
    const restored = createCanvas(base.width, base.height);
    const restoredContext = restored.getContext('2d');
    restoredContext.drawImage(source, 0, 0, base.width, base.height);
    restoredContext.globalCompositeOperation = 'destination-in';
    restoredContext.drawImage(keep, 0, 0);
    context.drawImage(restored, 0, 0);
  }
  if (remove) {
    context.globalCompositeOperation = 'destination-out';
    context.drawImage(remove, 0, 0);
  }
  return canvas;
}

/**
 * How the portrait file is produced when saving:
 * - `render`: export the edited portrait (or a generated image that has no file of its own),
 * - `path`: reuse the original image path,
 * - `upload-source`: upload the untouched local file so the actor can use it,
 * - `none`: the action does not change the portrait.
 */
export function getPortraitSavePlan({ action, edited, sourcePath, hasFile }) {
  if (action === 'token') return 'none';
  if (edited) return 'render';
  if (sourcePath) return 'path';
  if (hasFile) return action ? 'upload-source' : 'none';
  return action ? 'render' : 'none';
}
