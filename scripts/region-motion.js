import { sampleGrid } from './puppet-warp.js';

// Region pins: a pin that owns a painted region moves that whole area as one solid piece (shifted
// and turned about the pin) instead of pulling the art around it. The paint becomes a weight
// field on the warp mesh, 1 inside and easing to 0 over a feather outside, so the art between the
// moved region and the still body stretches instead of tearing.

/** Weight at or above which a mesh node counts as inside the painted region. */
const INSIDE_ALPHA = 128;
/** Fixed-point steps when inverting the blended motion; the weights vary slowly, so few suffice. */
const INVERT_STEPS = 6;

/**
 * The weight field of a painted region on a warp mesh of `step` px covering `mask` (RGBA image
 * data in the same space as the mesh). Nodes on the paint weigh 1; outside, the weight eases from
 * 1 to 0 over `feather` px of (chamfer) distance from the paint.
 */
export function buildRegionField(mask, { step, feather }) {
  const cols = Math.ceil(mask.width / step) + 1;
  const rows = Math.ceil(mask.height / step) + 1;
  const count = cols * rows;
  const distance = new Float32Array(count).fill(Infinity);
  let painted = false;
  for (let j = 0; j < rows; j += 1)
    for (let i = 0; i < cols; i += 1) {
      const x = Math.min(mask.width - 1, i * step);
      const y = Math.min(mask.height - 1, j * step);
      if (mask.data[(y * mask.width + x) * 4 + 3] >= INSIDE_ALPHA) {
        distance[j * cols + i] = 0;
        painted = true;
      }
    }
  const w = new Float32Array(count);
  if (!painted) return { w, cols, rows, step };

  // Two-pass chamfer distance in node units (1 straight, sqrt 2 diagonal).
  const diagonal = Math.SQRT2;
  const relax = (n, i, j, di, dj, cost) => {
    const ni = i + di;
    const nj = j + dj;
    if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) return;
    const candidate = distance[nj * cols + ni] + cost;
    if (candidate < distance[n]) distance[n] = candidate;
  };
  for (let j = 0; j < rows; j += 1)
    for (let i = 0; i < cols; i += 1) {
      const n = j * cols + i;
      relax(n, i, j, -1, 0, 1);
      relax(n, i, j, 0, -1, 1);
      relax(n, i, j, -1, -1, diagonal);
      relax(n, i, j, 1, -1, diagonal);
    }
  for (let j = rows - 1; j >= 0; j -= 1)
    for (let i = cols - 1; i >= 0; i -= 1) {
      const n = j * cols + i;
      relax(n, i, j, 1, 0, 1);
      relax(n, i, j, 0, 1, 1);
      relax(n, i, j, 1, 1, diagonal);
      relax(n, i, j, -1, 1, diagonal);
    }

  const reach = Math.max(feather, step);
  for (let n = 0; n < count; n += 1) {
    const fraction = Math.min(1, (distance[n] * step) / reach);
    w[n] = 1 - fraction * fraction * (3 - 2 * fraction);
  }
  return { w, cols, rows, step };
}

/** Bilinear weight of `field` at mesh-space point (x, y); 0 outside the mesh. */
export function sampleField(field, x, y) {
  const { w, cols, rows, step } = field;
  const fi = x / step;
  const fj = y / step;
  if (fi < 0 || fj < 0 || fi > cols - 1 || fj > rows - 1) return 0;
  const i0 = Math.min(cols - 2, Math.floor(fi));
  const j0 = Math.min(rows - 2, Math.floor(fj));
  const ti = fi - i0;
  const tj = fj - j0;
  const k = j0 * cols + i0;
  return (
    (w[k] * (1 - ti) + w[k + 1] * ti) * (1 - tj) +
    (w[k + cols] * (1 - ti) + w[k + cols + 1] * ti) * tj
  );
}

/**
 * Moves painted regions on top of a backward warp grid. Each motion `{ field, cx, cy, dx, dy, rot }`
 * turns its region by `rot` about the pivot (cx, cy) and shifts it by (dx, dy), all in mesh px.
 * The forward map is s -> s + sum w(s) (T(s) - s); each output node is inverted by fixed-point
 * steps that hold the weights while solving the blended affine map exactly, then samples `grid`.
 */
export function moveGridByRegions(grid, motions) {
  const { cols, rows, step } = grid;
  const outX = new Float32Array(cols * rows);
  const outY = new Float32Array(cols * rows);
  const prepared = motions.map((motion) => {
    const cos = Math.cos(motion.rot || 0);
    const sin = Math.sin(motion.rot || 0);
    // T(s) = R s + offset, with offset = c - R c + d.
    return {
      field: motion.field,
      cos,
      sin,
      ox: motion.cx - (cos * motion.cx - sin * motion.cy) + (motion.dx || 0),
      oy: motion.cy - (sin * motion.cx + cos * motion.cy) + (motion.dy || 0),
    };
  });
  for (let j = 0; j < rows; j += 1)
    for (let i = 0; i < cols; i += 1) {
      const px = i * step;
      const py = j * step;
      let sx = px;
      let sy = py;
      for (let iteration = 0; iteration < INVERT_STEPS; iteration += 1) {
        // Blended map with the weights held: A s + b, A = I + sum w (R - I), b = sum w offset.
        let a = 1;
        let b = 0;
        let c = 0;
        let d = 1;
        let bx = 0;
        let by = 0;
        let moved = false;
        for (const motion of prepared) {
          const weight = sampleField(motion.field, sx, sy);
          if (!weight) continue;
          moved = true;
          a += weight * (motion.cos - 1);
          b -= weight * motion.sin;
          c += weight * motion.sin;
          d += weight * (motion.cos - 1);
          bx += weight * motion.ox;
          by += weight * motion.oy;
        }
        if (!moved) {
          sx = px;
          sy = py;
          if (iteration) break;
          continue;
        }
        const determinant = a * d - b * c;
        if (Math.abs(determinant) < 1e-9) break;
        const rx = px - bx;
        const ry = py - by;
        const nextX = (d * rx - b * ry) / determinant;
        const nextY = (a * ry - c * rx) / determinant;
        const settled = Math.abs(nextX - sx) < 1e-3 && Math.abs(nextY - sy) < 1e-3;
        sx = nextX;
        sy = nextY;
        if (settled) break;
      }
      const source = sampleGrid(grid, sx, sy);
      outX[j * cols + i] = source.x;
      outY[j * cols + i] = source.y;
    }
  return { gx: outX, gy: outY, cols, rows, step };
}

/**
 * Fills the closed outline `points` (image px) into `mask` (RGBA image data) in place: 'paint'
 * makes the pixels inside opaque white, 'erase' clears them. A pixel is inside when its centre is
 * (even-odd rule). Returns false, leaving the mask alone, for an outline of fewer than 3 points.
 */
export function fillLasso(mask, points, mode) {
  if (!Array.isArray(points) || points.length < 3) return false;
  const { data, width, height } = mask;
  const value = mode === 'erase' ? 0 : 255;
  const crossings = [];
  for (let y = 0; y < height; y += 1) {
    const cy = y + 0.5;
    crossings.length = 0;
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      if (a.y <= cy === b.y <= cy) continue;
      crossings.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    crossings.sort((left, right) => left - right);
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const start = Math.max(0, Math.ceil(crossings[index] - 0.5));
      const end = Math.min(width - 1, Math.floor(crossings[index + 1] - 0.5));
      for (let x = start; x <= end; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = value;
        data[offset + 1] = value;
        data[offset + 2] = value;
        data[offset + 3] = value;
      }
    }
  }
  return true;
}
