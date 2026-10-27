import { AUTO_POP_OUT_DEPTH, getRingScale, getTokenFrameLayout } from './token-composer.js';

// Auto compose: reads the cut-out's silhouette, proposes framings and pop-out choices, and scores
// them so the creator can apply the best and offer alternatives. Everything here works on plain
// alpha arrays so it can be tested without a browser.

const OPAQUE = 128;
const HEAD_SIZES = [0.3, 0.4, 0.5];
const HEAD_HEIGHTS = [0.36, 0.4];
const IDEAL_HEAD_HEIGHT = 0.4;
const IDEAL_HEAD_SIZE = 0.4;
// Pop-out framings lift the head so its top breaks out of the opening by this share of its radius.
const POP_OUT_SIZES = [0.45, 0.55];
const POP_OUT_BREAK = 0.6;
const MIN_HEAD_RUN = 0.15;
const SHOULDER_GROWTH = 1.35;
const MAX_HEAD_DEPTH = 0.45;
const NECK_NARROWING = 0.85;
const SHOULDER_WINDOW = 4;
const SHOULDER_MIN_DEPTH = 0.35;
const FALLBACK_HEAD_RADIUS = 0.28;
const ELONGATED = 2.5;
const BOTTOM_ARC = (60 * Math.PI) / 180;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;

export const DEFAULT_COMPOSE_GRID = 96;
const ROOM_STEP = 5;
// Cells kept clear past a popped part's tip so its edge and shadow are not cut by the token edge.
const ROOM_MARGIN = 2;

/**
 * The same layout for a frame drawn at another scale inside the token: zoom and offsets follow the
 * frame so the art keeps its size and position relative to it.
 */
export function rescaleView(view, fromRingScale, toRingScale) {
  const factor = toRingScale / fromRingScale;
  return {
    zoom: view.zoom * factor,
    offsetX: view.offsetX * factor,
    offsetY: view.offsetY * factor,
  };
}

/**
 * Smallest breakout room (a percentage in `ROOM_STEP`s, up to `maxRoom`) that keeps every popped
 * cell inside the token. `ringScale` is the scale the grid was analysed at.
 */
export function fitBreakoutRoom({ popOutMask, gridSize, ringScale, maxRoom }) {
  const center = gridSize / 2;
  let reach = 0;
  for (let index = 0; index < popOutMask.length; index += 1) {
    if (!popOutMask[index]) continue;
    const x = index % gridSize;
    const y = (index - x) / gridSize;
    reach = Math.max(reach, Math.abs(x + 0.5 - center), Math.abs(y + 0.5 - center));
  }
  if (!reach) return 0;
  const ringRadius = center * ringScale;
  const needed = ((reach + ROOM_MARGIN) / ringRadius - 1) * 100;
  return Math.min(maxRoom, Math.max(0, Math.ceil(needed / ROOM_STEP - 1e-9) * ROOM_STEP));
}

/** Downsamples an RGBA image's alpha channel to at most `maxSize` on the long side. */
export function getAlphaGrid({ data, width, height }, maxSize = 256) {
  const scale = Math.max(1, Math.ceil(Math.max(width, height) / maxSize));
  const gridWidth = Math.ceil(width / scale);
  const gridHeight = Math.ceil(height / scale);
  const alpha = new Uint8Array(gridWidth * gridHeight);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = data[(y * width + x) * 4 + 3];
      const index = Math.floor(y / scale) * gridWidth + Math.floor(x / scale);
      if (value > alpha[index]) alpha[index] = value;
    }
  }
  return { alpha, width: gridWidth, height: gridHeight, scale };
}

/**
 * Bounds of the silhouette and a head estimate from a smoothed width profile (the widest run of
 * each row): skip thin spikes at the top (a raised sword or horn), take the crown down to the neck
 * (the first clear narrowing after the widest point) and stop at the shoulders. Busts and face
 * close-ups without a visible neck fall back to proportions of the silhouette.
 */
export function analyseSubject({ alpha, width, height }) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let area = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] < OPAQUE) continue;
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };

  const lastRow = Math.min(maxY, Math.floor(bounds.y + bounds.height * MAX_HEAD_DEPTH));
  const runs = [];
  for (let y = bounds.y; y <= lastRow; y += 1) runs.push(widestRun(alpha, width, y, minX, maxX));
  const raw = runs.map((run) => run.length);
  const smoothed = smoothWidths(raw, Math.max(1, Math.round(bounds.height * 0.015)));

  const minRun = Math.max(2, bounds.width * MIN_HEAD_RUN);
  const crown = smoothed.findIndex((value) => value >= minRun);
  let head = null;
  if (crown >= 0) {
    let widest = crown;
    let neck = -1;
    for (let row = crown + 1; row < smoothed.length; row += 1) {
      // Shoulders (or arms, a book, a cloak) can start without a visible neck: a quick widening
      // once we are about a head's depth below the crown ends the head where the widening began.
      // Raw widths are used here: smoothing would spread a sudden jump over several rows.
      const back = row - SHOULDER_WINDOW;
      if (
        back > crown &&
        row - crown >= raw[back] * SHOULDER_MIN_DEPTH &&
        raw[row] > raw[back] * SHOULDER_GROWTH &&
        raw[row - 1] > raw[back] * SHOULDER_GROWTH
      ) {
        neck = back;
        break;
      }
      if (smoothed[row] > smoothed[widest]) {
        widest = row;
      } else if (smoothed[row] < smoothed[widest] * NECK_NARROWING) {
        neck = row;
        while (neck + 1 < smoothed.length && smoothed[neck + 1] <= smoothed[neck]) neck += 1;
        break;
      }
    }
    if (neck > crown) head = measureHead(runs, crown, neck, bounds.y);
  }
  head ??= {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.width * FALLBACK_HEAD_RADIUS * 1.1,
    radius: Math.max(1, bounds.width * FALLBACK_HEAD_RADIUS),
  };
  return { bounds, area, head };
}

function measureHead(runs, crown, neck, top) {
  let mass = 0;
  let sumX = 0;
  let sumY = 0;
  let widest = 0;
  for (let row = crown; row <= neck; row += 1) {
    const run = runs[row];
    if (!run.length) continue;
    widest = Math.max(widest, run.length);
    mass += run.length;
    sumX += ((run.start + run.end) / 2) * run.length;
    sumY += (top + row) * run.length;
  }
  if (!mass) return null;
  return {
    x: sumX / mass,
    y: sumY / mass,
    // Average the head's half width and half height so tall hair or wide ears do not dominate.
    radius: Math.max(1, (widest / 2 + (neck - crown + 1) / 2) / 2),
  };
}

function smoothWidths(values, radius) {
  return values.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const value = values[index + offset];
      if (value === undefined) continue;
      sum += value;
      count += 1;
    }
    return sum / count;
  });
}

function widestRun(alpha, width, y, minX, maxX) {
  let best = { start: 0, end: -1, length: 0 };
  let start = -1;
  for (let x = minX; x <= maxX + 1; x += 1) {
    const on = x <= maxX && alpha[y * width + x] >= OPAQUE;
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      const length = x - start;
      if (length > best.length) best = { start, end: x - 1, length };
      start = -1;
    }
  }
  return best;
}

/**
 * Framings that place the head horizontally centred at a few heights and sizes (relative to the
 * frame opening), plus one that fits the whole figure inside the opening. Views use the creator's
 * convention: offsets are fractions of the token size.
 */
export function getFramings({ imageWidth, imageHeight, analysis, clipRadius, ringScale = 1 }) {
  if (!analysis) return [];
  const ringY = (y) => 0.5 + (y - 0.5) * ringScale;
  const cover = 1 / Math.max(1, Math.min(imageWidth, imageHeight));
  const opening = clipRadius / 2;
  const { head, bounds } = analysis;
  const frame = (zoom, point, target) => {
    const scale = cover * zoom;
    return {
      zoom,
      offsetX: target.x - point.x * scale - (1 - imageWidth * scale) / 2,
      offsetY: target.y - point.y * scale - (1 - imageHeight * scale) / 2,
    };
  };

  const framings = [];
  for (const headSize of HEAD_SIZES) {
    const zoom = clampZoom((headSize * opening) / (head.radius * cover));
    for (const headY of HEAD_HEIGHTS) {
      framings.push({
        id: `head-${headSize}-${headY}`,
        kind: 'head',
        headSize,
        headY,
        view: frame(zoom, head, { x: 0.5, y: ringY(headY) }),
      });
    }
  }
  const openingTop = 0.5 - opening;
  for (const headSize of POP_OUT_SIZES) {
    const zoom = clampZoom((headSize * opening) / (head.radius * cover));
    const headRadius = head.radius * cover * zoom;
    const headY = openingTop + headRadius * (1 - POP_OUT_BREAK);
    framings.push({
      id: `popout-${headSize}`,
      kind: 'popout',
      headSize,
      headY,
      view: frame(zoom, head, { x: 0.5, y: headY }),
    });
  }
  const figureZoom = clampZoom(
    (2 * opening * 0.95) / (Math.max(bounds.height, bounds.width) * cover),
  );
  framings.push({
    id: 'figure',
    kind: 'figure',
    view: frame(
      figureZoom,
      { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      { x: 0.5, y: 0.5 },
    ),
  });
  return framings;
}

function clampZoom(zoom) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(zoom) ? zoom : 1));
}

/**
 * Rasterises the subject onto a `gridSize` token grid for a view and splits whatever lies outside
 * the frame opening into connected pieces.
 */
export function findProtrusions({ alpha, view, clipRadius, gridSize = DEFAULT_COMPOSE_GRID }) {
  const { width, height } = alpha;
  const layout = getTokenFrameLayout({
    imageWidth: width,
    imageHeight: height,
    size: gridSize,
    zoom: view.zoom,
    offsetX: view.offsetX * gridSize,
    offsetY: view.offsetY * gridSize,
  });
  const center = gridSize / 2;
  const radius = center * clipRadius;
  const occupied = new Uint8Array(gridSize * gridSize);
  // Cells showing the source picture's own border: art there was cut off by whoever made it.
  const sourceEdge = new Uint8Array(gridSize * gridSize);
  const margin = Math.max(1, Math.ceil(width / layout.width));
  let insideCells = 0;
  let insideOccupied = 0;
  for (let gy = 0; gy < gridSize; gy += 1) {
    for (let gx = 0; gx < gridSize; gx += 1) {
      const ix = Math.floor(((gx + 0.5 - layout.x) * width) / layout.width);
      const iy = Math.floor(((gy + 0.5 - layout.y) * height) / layout.height);
      const on =
        ix >= 0 && iy >= 0 && ix < width && iy < height && alpha.alpha[iy * width + ix] >= OPAQUE;
      const inside = Math.hypot(gx + 0.5 - center, gy + 0.5 - center) < radius;
      if (inside) {
        insideCells += 1;
        if (on) insideOccupied += 1;
      }
      if (on) occupied[gy * gridSize + gx] = inside ? 2 : 1;
      if (on && (ix < margin || iy < margin || ix >= width - margin || iy >= height - margin))
        sourceEdge[gy * gridSize + gx] = 1;
    }
  }

  const visited = new Uint8Array(gridSize * gridSize);
  const pieces = [];
  for (let start = 0; start < occupied.length; start += 1) {
    if (occupied[start] !== 1 || visited[start]) continue;
    const cells = [];
    const queue = [start];
    visited[start] = 1;
    while (queue.length) {
      const index = queue.pop();
      cells.push(index);
      const x = index % gridSize;
      const y = (index - x) / gridSize;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gridSize || ny >= gridSize) continue;
        const next = ny * gridSize + nx;
        if (occupied[next] !== 1 || visited[next]) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    pieces.push(describePiece(pieces.length, cells, { gridSize, center, radius, sourceEdge }));
  }

  return {
    gridSize,
    occupied,
    pieces,
    insideCoverage: insideCells ? insideOccupied / insideCells : 0,
  };
}

function describePiece(id, cells, { gridSize, center, radius, sourceEdge }) {
  let minX = gridSize;
  let minY = gridSize;
  let maxX = -1;
  let maxY = -1;
  let sumX = 0;
  let sumY = 0;
  let touchesOpening = false;
  let touchesEdge = false;
  let touchesSourceEdge = false;
  let tip = null;
  let tipDistance = -1;
  for (const index of cells) {
    const x = index % gridSize;
    const y = (index - x) / gridSize;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    sumX += x + 0.5;
    sumY += y + 0.5;
    const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center);
    if (distance < radius + 1.5) touchesOpening = true;
    if (x === 0 || y === 0 || x === gridSize - 1 || y === gridSize - 1) touchesEdge = true;
    if (sourceEdge?.[index]) touchesSourceEdge = true;
    if (distance > tipDistance) {
      tipDistance = distance;
      tip = { x: x + 0.5, y: y + 0.5 };
    }
  }
  const centroid = { x: sumX / cells.length, y: sumY / cells.length };
  const spanX = maxX - minX + 1;
  const spanY = maxY - minY + 1;
  const dx = centroid.x - center;
  const dy = centroid.y - center;
  return {
    id,
    cells,
    area: cells.length,
    centroid,
    bounds: { x: minX, y: minY, width: spanX, height: spanY },
    elongation: Math.max(spanX, spanY) / Math.max(1, Math.min(spanX, spanY)),
    touchesOpening,
    touchesEdge,
    touchesSourceEdge,
    inBottomArc: dy > 0 && Math.atan2(Math.abs(dx), dy) < BOTTOM_ARC,
    tip,
  };
}

/**
 * Pop-out choices for one framing: nothing; compact pieces above the centre (head, hair, ears);
 * those plus long, thin pieces reaching above the automatic cutoff (weapons, horns, staves); and a
 * full breakout that also pops side parts (fists, wings, cloaks). Pieces in the bottom arc, pieces
 * not attached to the opening and pieces cut off by the source picture's edge never pop out: the
 * frame hides that cut, a pop-out would show it.
 */
export function getPopOutVariants(protrusions, { gridSize, clipRadius }) {
  const center = gridSize / 2;
  const cutoff = center + center * clipRadius * AUTO_POP_OUT_DEPTH;
  const eligible = protrusions.pieces.filter(
    (piece) =>
      !piece.inBottomArc && piece.touchesOpening && !piece.touchesSourceEdge && piece.area >= 2,
  );
  const top = eligible.filter((piece) => piece.elongation < ELONGATED && piece.centroid.y < center);
  const parts = eligible.filter(
    (piece) => piece.elongation >= ELONGATED && piece.centroid.y < cutoff,
  );
  return [
    { kind: 'none', pieces: [] },
    { kind: 'top', pieces: top.map((piece) => piece.id) },
    { kind: 'top-parts', pieces: [...top, ...parts].map((piece) => piece.id) },
    { kind: 'breakout', pieces: eligible.map((piece) => piece.id) },
  ];
}

/** Higher is better. Combines head placement, head size, fill and pop-out taste, minus penalties. */
export function scoreCandidate({
  framing,
  head,
  protrusions,
  variant,
  gridSize,
  clipRadius,
  ringScale = 1,
}) {
  const center = gridSize / 2;
  const opening = center * clipRadius;
  // Areas and distances are judged against the frame, not the token around it.
  const frameSize = gridSize * ringScale;
  const total = frameSize * frameSize;
  const popped = new Set(variant.pieces);
  // Pop-out framings put the head high on purpose; judge them against their own target.
  const targetHeadY =
    framing?.kind === 'popout' ? framing.headY : 0.5 + (IDEAL_HEAD_HEIGHT - 0.5) * ringScale;

  const placement =
    1 -
    Math.min(
      1,
      Math.hypot((head.x - center) / frameSize, (head.y - targetHeadY * gridSize) / frameSize) * 4,
    );
  const size = 1 - Math.min(1, Math.abs(head.radius / opening - IDEAL_HEAD_SIZE) / 0.3);

  const coverage = protrusions.insideCoverage;
  const fill = coverage < 0.55 ? coverage / 0.55 : coverage > 0.9 ? 1 - (coverage - 0.9) * 5 : 1;

  let poppedArea = 0;
  let floating = 0;
  let floatingCount = 0;
  let edgeCuts = 0;
  let sideCuts = 0;
  for (const piece of protrusions.pieces) {
    if (popped.has(piece.id)) {
      poppedArea += piece.area;
      if (!piece.touchesOpening) {
        floating += piece.area;
        floatingCount += 1;
      }
      if (piece.touchesEdge) edgeCuts += 1;
    } else if (!piece.inBottomArc && piece.touchesOpening) {
      sideCuts += piece.area;
    }
  }
  const fraction = poppedArea / total;
  const popOut =
    fraction === 0
      ? 0.6
      : fraction < 0.03
        ? 0.6 + (0.4 * fraction) / 0.03
        : fraction <= 0.12
          ? 1
          : Math.max(0, 1 - (fraction - 0.12) * 6);

  const penalty =
    (floating / total) * 20 + floatingCount * 0.15 + edgeCuts * 0.2 + (sideCuts / total) * 3;
  return 0.3 * placement + 0.2 * size + 0.2 * fill + 0.3 * popOut - penalty;
}

/**
 * Proposes framings and pop-out choices for a cut-out, scores them and returns the distinct
 * candidates best first. Each carries its view, popped pieces and a grid mask of the popped cells.
 */
export function composeCandidates({
  alpha,
  clipRadius,
  ringScale = 1,
  maxRoom = null,
  gridSize = DEFAULT_COMPOSE_GRID,
  limit = 8,
}) {
  const analysis = analyseSubject(alpha);
  if (!analysis) return [];
  const framings = getFramings({
    imageWidth: alpha.width,
    imageHeight: alpha.height,
    analysis,
    clipRadius,
    ringScale,
  });

  const candidates = new Map();
  for (const framing of framings) {
    const protrusions = findProtrusions({ alpha, view: framing.view, clipRadius, gridSize });
    const head = projectHead(analysis.head, alpha, framing.view, gridSize);
    for (const variant of getPopOutVariants(protrusions, { gridSize, clipRadius })) {
      const pieces = [...variant.pieces].sort((a, b) => a - b);
      const key = `${framing.id}:${pieces.join(',')}`;
      if (candidates.has(key)) continue;
      const popOutMask = new Uint8Array(gridSize * gridSize);
      for (const id of pieces) {
        for (const cell of protrusions.pieces[id].cells) popOutMask[cell] = 1;
      }
      // With `maxRoom`, the grid is analysed with the frame at its smallest and each candidate
      // gets just the room its popped parts need, with the view to use at that room.
      let fit = null;
      if (maxRoom !== null) {
        const room = fitBreakoutRoom({
          popOutMask: expandPopOutMask(popOutMask, protrusions.occupied, gridSize),
          gridSize,
          ringScale,
          maxRoom,
        });
        const fitScale = getRingScale(room);
        fit = { room, ringScale: fitScale, view: rescaleView(framing.view, ringScale, fitScale) };
      }
      candidates.set(key, {
        key,
        framing,
        view: framing.view,
        fit,
        variant: variant.kind,
        pieces,
        protrusions,
        popOutMask,
        score: scoreCandidate({
          framing,
          head,
          protrusions,
          variant,
          gridSize,
          clipRadius,
          ringScale,
        }),
      });
    }
  }
  const unique = [];
  for (const candidate of [...candidates.values()].sort((a, b) => b.score - a.score)) {
    if (unique.some((kept) => isSameLayout(kept, candidate))) continue;
    unique.push(candidate);
    if (unique.length >= limit) break;
  }
  return unique;
}

/** Framings clamped to the same zoom (close-ups) can land on practically the same layout. */
function isSameLayout(a, b) {
  return (
    Math.abs(a.view.zoom - b.view.zoom) < 0.02 &&
    Math.abs(a.view.offsetX - b.view.offsetX) < 0.01 &&
    Math.abs(a.view.offsetY - b.view.offsetY) < 0.01 &&
    a.pieces.join() === b.pieces.join()
  );
}

function projectHead(head, alpha, view, gridSize) {
  const layout = getTokenFrameLayout({
    imageWidth: alpha.width,
    imageHeight: alpha.height,
    size: gridSize,
    zoom: view.zoom,
    offsetX: view.offsetX * gridSize,
    offsetY: view.offsetY * gridSize,
  });
  const scale = layout.width / alpha.width;
  return {
    x: layout.x + head.x * scale,
    y: layout.y + head.y * scale,
    radius: head.radius * scale,
  };
}

/**
 * Grows a popped-cell mask a few cells over the subject so popped parts join the in-frame art
 * without a seam at the opening (the grid is coarse compared to the preview).
 */
export function expandPopOutMask(mask, occupied, gridSize, steps = 2) {
  let current = mask.slice();
  for (let step = 0; step < steps; step += 1) {
    const next = current.slice();
    for (let index = 0; index < current.length; index += 1) {
      if (!current[index]) continue;
      const x = index % gridSize;
      const y = (index - x) / gridSize;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= gridSize || ny >= gridSize) continue;
          const neighbour = ny * gridSize + nx;
          if (occupied[neighbour]) next[neighbour] = 1;
        }
      }
    }
    current = next;
  }
  return current;
}

/**
 * True when most of the image's edge is still opaque, i.e. the background was not removed and
 * the whole rectangle would be mistaken for the character.
 */
export function hasBackgroundLeft({ alpha, width, height }, threshold = 0.6) {
  let edge = 0;
  let opaque = 0;
  const count = (x, y) => {
    edge += 1;
    if (alpha[y * width + x] >= OPAQUE) opaque += 1;
  };
  for (let x = 0; x < width; x += 1) {
    count(x, 0);
    count(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    count(0, y);
    count(width - 1, y);
  }
  return edge > 0 && opaque / edge > threshold;
}

/**
 * The layouts to offer: the best per framing, making sure both a pop-out and a contained layout
 * are among them when the art allows, best first.
 */
export function pickComposeOptions(candidates, count = 4) {
  const byFraming = new Map();
  for (const candidate of candidates) {
    if (!byFraming.has(candidate.framing.id)) byFraming.set(candidate.framing.id, candidate);
  }
  const ranked = [...byFraming.values()];
  for (const candidate of candidates) if (!ranked.includes(candidate)) ranked.push(candidate);

  const picked = ranked.slice(0, count);
  const ensure = (test) => {
    if (picked.some(test)) return;
    const extra = ranked.find((candidate) => test(candidate) && !picked.includes(candidate));
    if (extra) picked[picked.length - 1] = extra;
  };
  ensure((candidate) => candidate.pieces.length > 0);
  ensure((candidate) => candidate.pieces.length === 0);
  return picked.sort((a, b) => b.score - a.score);
}
