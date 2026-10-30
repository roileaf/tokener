// Auto animate with AI tools: Segment Anything cuts out the part behind each tip pin (a wing, a
// tail, a raised weapon) so the pin can move that whole part. These helpers vet SAM's mask and
// turn the tip's motion into a turn of the part about where it joins the body. All pixel data is
// RGBA in source-image px (the cut-out's size).

/** Alpha at or above which a pixel belongs to a mask or to the figure. */
const SOLID = 128;
/** Px around the tip searched for the mask, since SAM's edge may stop just short of it. */
const TIP_REACH = 3;
/**
 * A part is at most this share of the figure; more means SAM took the body or both wings. A
 * dragon's near wing is about a third of it.
 */
const MAX_PART_SHARE = 0.38;
/** A part is at least this share of the figure; less is a speck, not a limb. */
const MIN_PART_SHARE = 0.005;
/** Share of the image's longest side a part keeps clear of the chest; nearer is the body. */
const CHEST_CLEARANCE = 0.03;
/** Share of a part that may lie behind the chest (away from its tip); more is the body. */
const MAX_BEHIND_SHARE = 0.2;
/** Largest turn (radians) a part makes about its hinge. */
const MAX_TURN = 0.6;

/** Share of the tip-to-chest distance the click goes past the part's first solid pixel. */
const CLICK_INSET = 0.04;

/**
 * Where to click SAM for the part at `tip`: a tip pin sits on the part's outermost, often faint
 * pixel, so step from it toward the chest to the first solid pixel and a little way past it.
 * Falls back to the tip when no solid art lies between them.
 */
export function findPartClick({ figure, tip, chest }) {
  const { width, height, data } = figure;
  const dx = chest.x - tip.x;
  const dy = chest.y - tip.y;
  const length = Math.hypot(dx, dy);
  const at = (step) => ({
    x: Math.round(tip.x + (dx * step) / length),
    y: Math.round(tip.y + (dy * step) / length),
  });
  const solid = ({ x, y }) =>
    x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3] >= SOLID;
  for (let step = 0; step < length / 2; step += 1) {
    if (!solid(at(step))) continue;
    // Go a little deeper, but stay on the art and short of halfway to the chest.
    let inside = step;
    const goal = Math.min(length / 2, step + Math.max(4, length * CLICK_INSET));
    while (inside + 1 <= goal && solid(at(inside + 1))) inside += 1;
    return at(inside);
  }
  return { x: Math.round(tip.x), y: Math.round(tip.y) };
}

/**
 * Vets SAM's `mask` for the part clicked at `tip`, keeping the piece connected to the click and
 * clipped to `figure` (the cut-out). Returns
 * `{ rgba, hinge, area }`: the region pixels, the hinge (the part's point nearest the chest, where
 * a wing or a neck joins the body) and the size in px. Null when the mask misses the tip, covers
 * the chest or any `avoid` point (the anchors), comes right up to the chest or reaches well behind
 * it (all mean SAM took the body), or is a speck or too big.
 */
export function fitPartMask({ mask, figure, tip, chest, avoid = [] }) {
  const { width, height } = figure;
  const solid = (data, x, y) =>
    x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3] >= SOLID;
  const inPart = (x, y) => solid(mask.data, x, y) && solid(figure.data, x, y);

  let seed = -1;
  for (let dy = -TIP_REACH; dy <= TIP_REACH && seed < 0; dy += 1)
    for (let dx = -TIP_REACH; dx <= TIP_REACH && seed < 0; dx += 1) {
      const x = Math.round(tip.x) + dx;
      const y = Math.round(tip.y) + dy;
      if (inPart(x, y)) seed = y * width + x;
    }
  if (seed < 0) return null;

  // Only the piece connected to the click: SAM often adds specks elsewhere on the figure.
  const kept = new Uint8Array(width * height);
  const stack = [seed];
  kept[seed] = 1;
  while (stack.length) {
    const index = stack.pop();
    const x = index % width;
    const y = (index - x) / width;
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (!inPart(nx, ny)) continue;
      const next = ny * width + nx;
      if (kept[next]) continue;
      kept[next] = 1;
      stack.push(next);
    }
  }
  const covers = (point) => {
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    return x >= 0 && y >= 0 && x < width && y < height && kept[y * width + x] === 1;
  };
  if ([chest, ...avoid].some(covers)) return null;

  const rgba = new Uint8ClampedArray(width * height * 4);
  let area = 0;
  let figureArea = 0;
  let behind = 0;
  let hinge = null;
  let nearestDistance = Infinity;
  const towardX = tip.x - chest.x;
  const towardY = tip.y - chest.y;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      if (solid(figure.data, x, y)) figureArea += 1;
      if (!kept[y * width + x]) continue;
      area += 1;
      const offset = (y * width + x) * 4;
      rgba[offset] = 255;
      rgba[offset + 1] = 255;
      rgba[offset + 2] = 255;
      rgba[offset + 3] = 255;
      if ((x - chest.x) * towardX + (y - chest.y) * towardY < 0) behind += 1;
      const distance = Math.hypot(x - chest.x, y - chest.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        hinge = { x, y };
      }
    }
  const share = area / figureArea;
  if (share < MIN_PART_SHARE || share > MAX_PART_SHARE) return null;
  if (nearestDistance < CHEST_CLEARANCE * Math.max(width, height)) return null;
  if (behind > area * MAX_BEHIND_SHARE) return null;
  return { rgba, hinge, area };
}

/**
 * The best part among SAM's candidate `masks` for the part clicked at `tip`: the largest one that
 * passes fitPartMask (a whole wing rather than a sliver of it), or null when none does.
 */
export function pickPartMask(masks, { figure, tip, chest, avoid = [] }) {
  let best = null;
  for (const mask of masks) {
    const part = fitPartMask({ mask, figure, tip, chest, avoid });
    if (part && (!best || part.area > best.area)) best = part;
  }
  return best;
}

/**
 * Keyframes that moved the `tip` become keyframes that turn the part about `hinge` instead: the
 * turn that carries the tip by about the same offset, capped at a natural swing.
 */
export function toHingeKeyframes(keyframes, tip, hinge) {
  const vx = tip.x - hinge.x;
  const vy = tip.y - hinge.y;
  const length = vx * vx + vy * vy || 1;
  return keyframes.map((key) => {
    const turn = (vx * (key.dy ?? 0) - vy * (key.dx ?? 0)) / length;
    return { ...key, dx: 0, dy: 0, rot: Math.max(-MAX_TURN, Math.min(MAX_TURN, turn)) };
  });
}
