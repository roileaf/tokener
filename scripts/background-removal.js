const OPAQUE_ALPHA = 128;
const TRANSPARENT_ALPHA = 16;
const PALETTE_MERGE_DISTANCE = 24;
const PALETTE_MIN_SHARE = 0.02;
const PALETTE_MIN_DOMINANT_SHARE = 0.15;
// Portrait art usually crops the subject at the bottom edge and often at the top centre, so only
// the border around the top corners defines the backdrop colours. Every border pixel can still
// seed the flood fill.
const PALETTE_CORNER_RATIO = 0.2;
const LOCAL_STEP_RATIO = 0.5;
const PALETTE_REACH_RATIO = 2.5;

export const DEFAULT_BACKGROUND_TOLERANCE = 32;
export const DEFAULT_BACKGROUND_FEATHER = 2;

export function removeImageBackground(
  image,
  { tolerance = DEFAULT_BACKGROUND_TOLERANCE, feather = DEFAULT_BACKGROUND_FEATHER } = {},
) {
  const { data, width, height } = image ?? {};
  if (!data || !width || !height) return image;

  const palette = getBorderPalette(image);
  if (!palette.length) return image;

  const background = floodBackground(image, palette, Math.max(1, Number(tolerance) || 0));
  featherSubjectEdges(image, background, Math.max(0, Math.round(Number(feather) || 0)));
  for (let index = 0; index < background.length; index += 1) {
    if (background[index]) data[index * 4 + 3] = 0;
  }
  return image;
}

export function getBorderPalette(image) {
  const clusters = [];
  let total = 0;
  for (const index of backdropIndexes(image.width, image.height)) {
    const offset = index * 4;
    if (image.data[offset + 3] < OPAQUE_ALPHA) continue;
    total += 1;
    const color = [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
    const cluster = clusters.find(
      (entry) => colorDistance(entry.color, color) < PALETTE_MERGE_DISTANCE,
    );
    if (!cluster) {
      clusters.push({ color, sum: [...color], count: 1 });
      continue;
    }
    cluster.count += 1;
    for (let channel = 0; channel < 3; channel += 1) {
      cluster.sum[channel] += color[channel];
      cluster.color[channel] = cluster.sum[channel] / cluster.count;
    }
  }

  const largest = Math.max(0, ...clusters.map((cluster) => cluster.count));
  const minimum = Math.max(
    1,
    Math.floor(total * PALETTE_MIN_SHARE),
    Math.floor(largest * PALETTE_MIN_DOMINANT_SHARE),
  );
  return clusters.filter((cluster) => cluster.count >= minimum).map((cluster) => cluster.color);
}

export function getAlphaBounds(image, threshold = TRANSPARENT_ALPHA) {
  const { data, width, height } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function floodBackground(image, palette, tolerance) {
  const { data, width, height } = image;
  const background = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const localStep = tolerance * LOCAL_STEP_RATIO;
  const paletteReach = tolerance * PALETTE_REACH_RATIO;
  let head = 0;
  let tail = 0;

  const paletteDistance = (index) => {
    const offset = index * 4;
    let best = Infinity;
    for (const color of palette) {
      best = Math.min(
        best,
        Math.hypot(
          color[0] - data[offset],
          color[1] - data[offset + 1],
          color[2] - data[offset + 2],
        ),
      );
    }
    return best;
  };

  for (const index of borderIndexes(width, height)) {
    if (background[index]) continue;
    if (data[index * 4 + 3] >= TRANSPARENT_ALPHA && paletteDistance(index) >= tolerance) continue;
    background[index] = 1;
    queue[tail++] = index;
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = (index - x) / width;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (background[next]) continue;
      if (!isBackgroundStep(data, index, next, paletteDistance, tolerance, localStep, paletteReach))
        continue;
      background[next] = 1;
      queue[tail++] = next;
    }
  }

  return background;
}

function isBackgroundStep(data, from, to, paletteDistance, tolerance, localStep, paletteReach) {
  if (data[to * 4 + 3] < TRANSPARENT_ALPHA) return true;
  const distance = paletteDistance(to);
  if (distance < tolerance) return true;
  return distance < paletteReach && pixelDistance(data, from, to) < localStep;
}

function featherSubjectEdges(image, background, radius) {
  if (!radius) return;
  const { data, width, height } = image;
  const distance = new Uint8Array(width * height);
  let frontier = [];
  for (let index = 0; index < background.length; index += 1) {
    if (background[index]) frontier.push(index);
  }

  for (let step = 1; step <= radius && frontier.length; step += 1) {
    const next = [];
    for (const index of frontier) {
      const x = index % width;
      const y = (index - x) / width;
      for (const [dx, dy] of NEIGHBOURS_WITH_DIAGONALS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbour = ny * width + nx;
        if (background[neighbour] || distance[neighbour]) continue;
        distance[neighbour] = step;
        next.push(neighbour);
      }
    }
    frontier = next;
  }

  for (let index = 0; index < distance.length; index += 1) {
    if (!distance[index]) continue;
    const offset = index * 4 + 3;
    data[offset] = Math.round((data[offset] * distance[index]) / (radius + 1));
  }
}

function* backdropIndexes(width, height) {
  const cornerWidth = Math.max(1, Math.ceil(width * PALETTE_CORNER_RATIO));
  const cornerHeight = Math.max(2, Math.ceil(height * PALETTE_CORNER_RATIO));
  for (let x = 0; x < width; x += 1) {
    if (x < cornerWidth || x >= width - cornerWidth) yield x;
  }
  for (let y = 1; y < Math.min(height, cornerHeight); y += 1) {
    yield y * width;
    if (width > 1) yield y * width + width - 1;
  }
}

function* borderIndexes(width, height) {
  for (let x = 0; x < width; x += 1) {
    yield x;
    if (height > 1) yield (height - 1) * width + x;
  }
  for (let y = 1; y < height - 1; y += 1) {
    yield y * width;
    if (width > 1) yield y * width + width - 1;
  }
}

function pixelDistance(data, a, b) {
  const ao = a * 4;
  const bo = b * 4;
  return Math.hypot(data[ao] - data[bo], data[ao + 1] - data[bo + 1], data[ao + 2] - data[bo + 2]);
}

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const NEIGHBOURS_WITH_DIAGONALS = [...NEIGHBOURS, [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Connected region around (x, y) whose colour stays within `tolerance` of the clicked pixel, used
 * by the fill tool to remove or restore a patch of background in one click.
 */
export function getFillRegion(image, x, y, { tolerance = DEFAULT_BACKGROUND_TOLERANCE } = {}) {
  const { data, width, height } = image;
  const region = new Uint8Array(width * height);
  const startX = Math.floor(x);
  const startY = Math.floor(y);
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) return region;

  const seed = (startY * width + startX) * 4;
  const seedColor = [data[seed], data[seed + 1], data[seed + 2]];
  const limit = Math.max(1, Number(tolerance) || 0);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  region[startY * width + startX] = 1;
  queue[tail++] = startY * width + startX;

  while (head < tail) {
    const index = queue[head++];
    const px = index % width;
    const py = (index - px) / width;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (region[next]) continue;
      const offset = next * 4;
      if (
        Math.hypot(
          data[offset] - seedColor[0],
          data[offset + 1] - seedColor[1],
          data[offset + 2] - seedColor[2],
        ) >= limit
      )
        continue;
      region[next] = 1;
      queue[tail++] = next;
    }
  }
  return region;
}
