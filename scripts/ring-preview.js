// Canvas approximation of Foundry's dynamic token ring shader, used to preview created ring
// subjects against the ring spritesheet configured for the current world.

const WHITE = '#ffffff';

export function selectRingFrame(spritesheet, size = 1) {
  const frames = spritesheet?.frames ?? {};
  const config = spritesheet?.config ?? {};
  const rings = Object.entries(frames)
    .filter(([name]) => !name.includes('-bkg') && !name.includes('-msk'))
    .map(([name, data]) => ({ name, data, gridTarget: Number(data?.gridTarget ?? 1) }));
  if (!rings.length) return null;

  const target = Number.isFinite(Number(size)) ? Number(size) : 1;
  rings.sort((a, b) => a.gridTarget - b.gridTarget);
  const closest = rings.reduce((best, ring) =>
    Math.abs(ring.gridTarget - target) < Math.abs(best.gridTarget - target) ? ring : best,
  );
  const { name, data } = closest;
  return {
    ringName: name,
    ring: data.frame,
    background: frames[`${name}-bkg`]?.frame ?? null,
    mask: frames[`${name}-msk`]?.frame ?? null,
    colorBand: {
      ...(data.colorBand ?? config.defaultColorBand ?? { startRadius: 0, endRadius: 0 }),
    },
    defaultRingColor: validColor(data.ringColor) ?? validColor(config.defaultRingColor),
    defaultBackgroundColor:
      validColor(data.backgroundColor) ?? validColor(config.defaultBackgroundColor),
  };
}

export function resolveRingColor(color, defaultColor) {
  const resolved = validColor(color) ?? WHITE;
  return resolved === WHITE && defaultColor ? defaultColor : resolved;
}

export function colorizeRingFrame(image, mask, { colorBand, ringColor }) {
  const { data, width, height } = image;
  const [red, green, blue] = hexToRgb(ringColor);
  const start = mask ? 0 : Number(colorBand?.startRadius ?? 0);
  const end = mask ? 0 : Number(colorBand?.endRadius ?? 0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (mask) {
        const maskAlpha = mask.data[offset + 3] / 255;
        if (!maskAlpha) continue;
        const channel = mask.data[offset] / 255;
        blendOver(data, offset, [red * channel, green * channel, blue * channel], maskAlpha);
        continue;
      }
      const dx = ((x + 0.5) / width - 0.5) * 2;
      const dy = ((y + 0.5) / height - 0.5) * 2;
      const distance = Math.hypot(dx, dy);
      if (distance < start || distance >= end) continue;
      const channel = data[offset] / 255;
      data[offset] = Math.round(red * channel);
      data[offset + 1] = Math.round(green * channel);
      data[offset + 2] = Math.round(blue * channel);
    }
  }
  return image;
}

export function colorizeRingBackground(image, tint) {
  const color = validColor(tint) ?? WHITE;
  if (color === WHITE) return image;
  const tintChannels = hexToRgb(color).map((value) => value / 255);
  const { data } = image;
  for (let offset = 0; offset < data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const base = data[offset + channel] / 255;
      const overlay =
        base < 0.5
          ? 2 * base * tintChannels[channel]
          : 1 - 2 * (1 - base) * (1 - tintChannels[channel]);
      data[offset + channel] = Math.round(overlay * 255);
    }
  }
  return image;
}

function blendOver(data, offset, color, alpha) {
  for (let channel = 0; channel < 3; channel += 1) {
    data[offset + channel] = Math.round(
      color[channel] * alpha + data[offset + channel] * (1 - alpha),
    );
  }
  data[offset + 3] = Math.round(255 * alpha + data[offset + 3] * (1 - alpha));
}

function validColor(value) {
  if (typeof value === 'number' && Number.isFinite(value))
    return `#${Math.max(0, Math.min(0xffffff, value)).toString(16).padStart(6, '0')}`;
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  return /^#[0-9a-f]{6}$/.test(text) ? text : null;
}

function hexToRgb(hex) {
  const value = parseInt(String(validColor(hex) ?? WHITE).slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * Radius (fraction of the half size) where the ring art becomes solid, measured along several
 * directions and averaged with the median. Foundry draws the subject over the ring, so the subject
 * should stop exactly here: clipping at the colour band instead can leave a strip of background
 * showing (the bronze medium ring's band starts at 0.6 but its art only at 0.68).
 */
export function measureRingInnerEdge(
  { data, width, height },
  { threshold = 200, directions = 32 } = {},
) {
  const center = Math.min(width, height) / 2;
  const edges = [];
  for (let step = 0; step < directions; step += 1) {
    const angle = (step / directions) * Math.PI * 2;
    for (let radius = 0.3; radius <= 1; radius += 0.0025) {
      const x = Math.floor(width / 2 + Math.cos(angle) * radius * center);
      const y = Math.floor(height / 2 + Math.sin(angle) * radius * center);
      if (x < 0 || y < 0 || x >= width || y >= height) break;
      if (data[(y * width + x) * 4 + 3] >= threshold) {
        edges.push(radius);
        break;
      }
    }
  }
  if (edges.length < directions / 2) return null;
  edges.sort((a, b) => a - b);
  return edges[Math.floor(edges.length / 2)];
}
