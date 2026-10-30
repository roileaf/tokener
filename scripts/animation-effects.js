/**
 * Procedural, periodic, deterministic animation effects (wind, wobble, flicker, glow,
 * particles). Pure: only the canvas contexts / createCanvas passed in are touched.
 */
export const EFFECT_TYPES = ['wind', 'wobble', 'flicker', 'glow', 'particles'];
export const PARTICLE_KINDS = ['embers', 'smoke', 'sparkles', 'snow', 'drips'];

const TAU = Math.PI * 2;
const FLICKER_KINDS = ['opacity', 'brightness'];
const DEFAULT_GLOW_COLOR = '#8fd3ff';
const GLOW_STEPS = 12;
const MAX_PARTICLES = 200;
const PARTICLE_COLORS = {
  embers: '#ffa040',
  smoke: '#b4b8c4',
  sparkles: '#fff4b8',
  snow: '#ffffff',
  drips: '#7fb8ff',
};
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

let effectCounter = 0;

function newEffectId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  effectCounter += 1;
  return `fx-${Date.now().toString(36)}-${effectCounter}`;
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function wrap(t) {
  const number = Number(t);
  if (!Number.isFinite(number)) return 0;
  return number - Math.floor(number);
}

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngFor(key) {
  return mulberry32(hashString(String(key)));
}

/** Creates an effect with the spec defaults. */
export function createEffect(type, { region = null } = {}) {
  const base = { id: newEffectId(), type, region };
  switch (type) {
    case 'wind':
      return { ...base, strength: 4, scale: 24 };
    case 'wobble':
      return { ...base, strength: 3, scale: 40 };
    case 'flicker':
      return { ...base, amount: 0.25, kind: 'opacity', speed: 3 };
    case 'glow':
      return { ...base, color: DEFAULT_GLOW_COLOR, size: 10, pulse: 0.5 };
    case 'particles':
      return { ...base, kind: 'embers', count: 24, color: null, size: 3 };
    default:
      throw new Error(`Unknown effect type: ${type}`);
  }
}

function normalizeEffect(raw) {
  if (!raw || typeof raw !== 'object' || !EFFECT_TYPES.includes(raw.type)) return null;
  const defaults = createEffect(raw.type);
  const effect = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : defaults.id,
    type: raw.type,
    region: typeof raw.region === 'string' && raw.region ? raw.region : null,
  };
  switch (raw.type) {
    case 'wind':
    case 'wobble':
      effect.strength = clamp(raw.strength, 0, 40, defaults.strength);
      effect.scale = clamp(raw.scale, 4, 200, defaults.scale);
      break;
    case 'flicker':
      effect.amount = clamp(raw.amount, 0, 1, defaults.amount);
      effect.kind = pick(raw.kind, FLICKER_KINDS, 'opacity');
      effect.speed = Math.round(clamp(raw.speed, 1, 12, defaults.speed));
      break;
    case 'glow':
      effect.color = HEX_COLOR.test(raw.color) ? raw.color : DEFAULT_GLOW_COLOR;
      effect.size = clamp(raw.size, 1, 60, defaults.size);
      effect.pulse = clamp(raw.pulse, 0, 1, defaults.pulse);
      break;
    default:
      effect.kind = pick(raw.kind, PARTICLE_KINDS, 'embers');
      effect.count = Math.round(clamp(raw.count, 1, MAX_PARTICLES, defaults.count));
      effect.color = HEX_COLOR.test(raw.color) ? raw.color : null;
      effect.size = clamp(raw.size, 1, 20, defaults.size);
  }
  return effect;
}

/** Drops unknown effect types and clamps every param to its valid range. */
export function normalizeEffects(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeEffect).filter(Boolean);
}

function lattice(ix, iy, salt) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(salt, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1). */
function smoothNoise(x, y, salt) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const top = lattice(ix, iy, salt) * (1 - ux) + lattice(ix + 1, iy, salt) * ux;
  const bottom = lattice(ix, iy + 1, salt) * (1 - ux) + lattice(ix + 1, iy + 1, salt) * ux;
  return top * (1 - uy) + bottom * uy;
}

/** Wind / wobble displacement at token-space (x, y), in token px. Periodic in t. */
export function getDisplacement(effect, x, y, t) {
  const strength = Number(effect?.strength);
  if (!(strength > 0)) return { dx: 0, dy: 0 };
  const scale = Math.max(1, Number(effect.scale) || 24);
  const phase = wrap(t) * TAU;
  if (effect.type === 'wind') {
    const a = smoothNoise(x / scale, y / scale, 1) * TAU;
    const b = smoothNoise(x / scale + 17.3, y / scale + 5.1, 2) * TAU;
    return { dx: strength * Math.sin(phase + a), dy: strength * 0.5 * Math.cos(phase + b) };
  }
  if (effect.type === 'wobble') {
    return {
      dx: strength * Math.sin(phase + (TAU * y) / scale),
      dy: strength * 0.5 * Math.cos(phase + (TAU * x) / scale),
    };
  }
  return { dx: 0, dy: 0 };
}

/** Flicker multiplier in [1 - amount, 1]; periodic because the speed is an integer. */
export function getFlickerFactor(effect, t) {
  const amount = clamp(effect?.amount, 0, 1, 0);
  if (amount === 0) return 1;
  const speed = Math.max(1, Math.round(Number(effect.speed) || 3));
  const phase = wrap(t) * TAU;
  const seed = rngFor(effect.id ?? 'flicker');
  const p1 = seed() * TAU;
  const p2 = seed() * TAU;
  const wave =
    0.55 * Math.sin(phase * speed + p1) + 0.3 * Math.sin(phase * (speed * 2 + 1) + p2) + 0.15;
  const level = Math.min(1, Math.max(0, 0.5 + wave * 0.5));
  return 1 - amount * level;
}

function tinted(source, size, color, createCanvas) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext('2d');
  context.drawImage(source, 0, 0, size, size);
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = color;
  context.fillRect(0, 0, size, size);
  return canvas;
}

function drawBlurred(context, shape, radius, alpha, steps = GLOW_STEPS) {
  const rings = [0.34, 0.67, 1];
  context.save();
  context.globalAlpha = alpha;
  context.drawImage(shape, 0, 0);
  for (const ring of rings) {
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * TAU;
      context.drawImage(shape, Math.cos(angle) * radius * ring, Math.sin(angle) * radius * ring);
    }
  }
  context.restore();
}

/**
 * Glow. phase 'behind' draws the whole-silhouette aura (region-less effects only);
 * phase 'over' draws the region glow with additive blending.
 */
export function drawGlow(context, { effect, art, region, t, size, createCanvas, phase }) {
  const color = HEX_COLOR.test(effect?.color) ? effect.color : DEFAULT_GLOW_COLOR;
  const radius = clamp(effect?.size, 1, 60, 10);
  const pulse = clamp(effect?.pulse, 0, 1, 0);
  const level = 1 - pulse * 0.5 * (1 - Math.cos(wrap(t) * TAU));
  if (phase === 'behind') {
    if (region || !art) return;
    const shape = tinted(art, size, color, createCanvas);
    drawBlurred(context, shape, radius, 0.16 * level);
    return;
  }
  if (phase === 'over' && region) {
    const shape = tinted(region, size, color, createCanvas);
    const layer = createCanvas(size, size);
    const layerContext = layer.getContext('2d');
    drawBlurred(layerContext, shape, radius * 0.5, 0.2);
    layerContext.globalAlpha = 1;
    layerContext.drawImage(shape, 0, 0);
    context.save();
    context.globalCompositeOperation = 'lighter';
    context.globalAlpha = Math.min(1, level);
    context.drawImage(layer, 0, 0);
    context.restore();
  }
}

/**
 * Deterministic emitter points in token space: sampled inside the region, or along the
 * silhouette edge of the art when region is null. Returns [] when nothing qualifies.
 */
export function getEmitterPoints({ art, region, size, createCanvas, count = 64, seed }) {
  const source = region ?? art;
  if (!source) return [];
  const canvas = createCanvas(size, size);
  const context = canvas.getContext('2d');
  context.drawImage(source, 0, 0, size, size);
  const { data } = context.getImageData(0, 0, size, size);
  const solid = (x, y) =>
    x >= 0 && y >= 0 && x < size && y < size && data[(y * size + x) * 4 + 3] > 128;
  const candidates = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!solid(x, y)) continue;
      if (region || !solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1))
        candidates.push(y * size + x);
    }
  }
  if (!candidates.length) return [];
  const random = rngFor(seed ?? 'emitter');
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const index = candidates[Math.floor(random() * candidates.length)];
    points.push({ x: (index % size) + random(), y: Math.floor(index / size) + random() });
  }
  return points;
}

function fade(age) {
  const inRamp = Math.min(1, age / 0.15);
  const outRamp = Math.min(1, (1 - age) / 0.3);
  const value = Math.max(0, Math.min(inRamp, outRamp));
  return value * value * (3 - 2 * value);
}

/** Draws looping particles for one effect; every particle's lifetime wraps with the loop. */
export function drawParticles(context, { effect, emitter, t, size }) {
  const points = emitter?.points;
  if (!points?.length) return;
  const kind = pick(effect.kind, PARTICLE_KINDS, 'embers');
  const count = Math.round(clamp(effect.count, 0, MAX_PARTICLES, 0));
  const color = HEX_COLOR.test(effect.color) ? effect.color : PARTICLE_COLORS[kind];
  const base = Math.max(0.5, Number(effect.size) || 3);
  const unit = size / 100;
  const loop = wrap(t);
  const random = rngFor(effect.id ?? 'particles');
  context.save();
  context.fillStyle = color;
  context.strokeStyle = color;
  for (let i = 0; i < count; i += 1) {
    const point = points[Math.floor(random() * points.length)];
    const phase = random();
    const drift = random() * 2 - 1;
    const sway = random() * TAU;
    const scale = 0.6 + random() * 0.8;
    const age = wrap(loop + phase);
    const alpha = fade(age);
    if (alpha <= 0.01) continue;
    let x = point.x;
    let y = point.y;
    let radius = base * scale;
    let opacity = alpha;
    if (kind === 'embers') {
      x += drift * 10 * unit * age + Math.sin(sway + age * TAU) * 3 * unit;
      y -= age * 38 * unit;
      radius *= 1 - age * 0.5;
    } else if (kind === 'smoke') {
      x += drift * 8 * unit * age + Math.sin(sway + age * TAU) * 4 * unit;
      y -= age * 22 * unit;
      radius *= 1 + age * 1.8;
      opacity *= 0.35;
    } else if (kind === 'sparkles') {
      x += drift * 4 * unit;
      y += Math.sin(sway) * 4 * unit;
      opacity *= 0.5 + 0.5 * Math.sin(age * TAU * 2 + sway);
    } else if (kind === 'snow') {
      x += Math.sin(sway + age * TAU) * 4 * unit + drift * 6 * unit * age;
      y += age * 36 * unit;
    } else {
      y += age * age * 40 * unit;
    }
    context.globalAlpha = Math.min(1, Math.max(0, opacity));
    if (kind === 'sparkles') {
      const arm = radius * 1.6;
      context.lineWidth = Math.max(0.6, radius * 0.4);
      context.beginPath();
      context.moveTo(x - arm, y);
      context.lineTo(x + arm, y);
      context.moveTo(x, y - arm);
      context.lineTo(x, y + arm);
      context.stroke();
    } else if (kind === 'drips') {
      context.beginPath();
      context.ellipse(x, y, radius * 0.6, radius * (1 + age), 0, 0, TAU);
      context.fill();
    } else {
      context.beginPath();
      context.arc(x, y, Math.max(0.3, radius), 0, TAU);
      context.fill();
    }
  }
  context.restore();
}
