/**
 * Rigid moving-least-squares (Schaefer et al. 2006) in complex form. Maps a point using control
 * points `from` -> `to`: with no pins the point is unchanged, with one pin it is translated.
 */
export function mlsRigid(vx, vy, from, to) {
  const count = from.length;
  if (!count) return { x: vx, y: vy };
  let sumW = 0;
  let pxs = 0;
  let pys = 0;
  let qxs = 0;
  let qys = 0;
  const weights = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const dx = from[i].x - vx;
    const dy = from[i].y - vy;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-6) return { x: to[i].x, y: to[i].y };
    const w = 1 / d2;
    weights[i] = w;
    sumW += w;
    pxs += w * from[i].x;
    pys += w * from[i].y;
    qxs += w * to[i].x;
    qys += w * to[i].y;
  }
  const px = pxs / sumW;
  const py = pys / sumW;
  const qx = qxs / sumW;
  const qy = qys / sumW;
  if (count === 1) return { x: vx - px + qx, y: vy - py + qy };

  // M = sum w * conj(p^) * q^
  let mr = 0;
  let mi = 0;
  for (let i = 0; i < count; i += 1) {
    const ax = from[i].x - px;
    const ay = from[i].y - py;
    const bx = to[i].x - qx;
    const by = to[i].y - qy;
    mr += weights[i] * (ax * bx + ay * by);
    mi += weights[i] * (ax * by - ay * bx);
  }
  const length = Math.hypot(mr, mi);
  if (!length) return { x: vx - px + qx, y: vy - py + qy };
  const ux = vx - px;
  const uy = vy - py;
  // (v - p*) * M / |M| + q*
  return { x: (ux * mr - uy * mi) / length + qx, y: (ux * mi + uy * mr) / length + qy };
}

/**
 * Backward map on a coarse grid: each output grid point gets the source position it samples from
 * (MLS with the moved pins as `from` and the rest pins as `to`).
 */
export function buildWarpGrid({ width, height, rest, moved, step = 8 }) {
  const cols = Math.ceil(width / step) + 1;
  const rows = Math.ceil(height / step) + 1;
  const gx = new Float32Array(cols * rows);
  const gy = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const source = mlsRigid(i * step, j * step, moved, rest);
      gx[j * cols + i] = source.x;
      gy[j * cols + i] = source.y;
    }
  }
  return { gx, gy, cols, rows, step };
}

/**
 * Fills `target` by sampling `source` through the warp grid. The grid is interpolated bilinearly
 * per pixel; the source is sampled bilinearly with premultiplied alpha so edges do not fringe.
 * Taps outside the source contribute nothing, so those pixels end up transparent.
 */
export function warpImageData(source, grid, target) {
  const { gx, gy, cols, step } = grid;
  const { width, height } = target;
  const src = source.data;
  const out = target.data;
  for (let y = 0; y < height; y += 1) {
    const fj = y / step;
    const j0 = Math.floor(fj);
    const tj = fj - j0;
    for (let x = 0; x < width; x += 1) {
      const fi = x / step;
      const i0 = Math.floor(fi);
      const ti = fi - i0;
      const k = j0 * cols + i0;
      const sx =
        (gx[k] * (1 - ti) + gx[k + 1] * ti) * (1 - tj) +
        (gx[k + cols] * (1 - ti) + gx[k + cols + 1] * ti) * tj;
      const sy =
        (gy[k] * (1 - ti) + gy[k + 1] * ti) * (1 - tj) +
        (gy[k + cols] * (1 - ti) + gy[k + cols + 1] * ti) * tj;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let n = 0; n < 4; n += 1) {
        const xx = x0 + (n & 1);
        const yy = y0 + (n >> 1);
        if (xx < 0 || yy < 0 || xx >= source.width || yy >= source.height) continue;
        const weight = (n & 1 ? fx : 1 - fx) * (n >> 1 ? fy : 1 - fy);
        const o = (yy * source.width + xx) * 4;
        const alpha = src[o + 3] * weight;
        r += src[o] * alpha;
        g += src[o + 1] * alpha;
        b += src[o + 2] * alpha;
        a += alpha;
      }
      const o = (y * width + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
        out[o + 3] = a;
      } else {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
      }
    }
  }
}
