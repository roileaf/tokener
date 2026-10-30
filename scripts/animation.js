export const DEFAULT_ANIMATION = { duration: 2, fps: 30, pins: [] };
export const ANIMATION_PRESETS = ['bob', 'sway', 'breathe'];

const KEYFRAME_MERGE = 1 / 120;
const BREATHE_SCALE = 0.03;
let pinCounter = 0;

function newPinId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  pinCounter += 1;
  return `pin-${Date.now().toString(36)}-${pinCounter}`;
}

/** Wraps a loop time into [0, 1). */
function wrapTime(t) {
  const value = Number(t) || 0;
  return value - Math.floor(value);
}

/** Distance between two loop times, measured around the loop seam (0.999 is next to 0). */
function loopDistance(a, b) {
  const gap = Math.abs(a - b);
  return Math.min(gap, 1 - gap);
}

function sortKeyframes(keyframes) {
  return [...keyframes].sort((a, b) => a.t - b.t);
}

/** Clamps duration to 1-4 s in half steps and fixes fps at 30; keeps only valid pins and keyframes. */
export function normalizeAnimation(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const seconds = Number(raw.duration);
  const duration = Number.isFinite(seconds)
    ? Math.min(4, Math.max(1, Math.round(seconds * 2) / 2))
    : DEFAULT_ANIMATION.duration;
  const pins = (Array.isArray(raw.pins) ? raw.pins : [])
    .filter((pin) => pin && Number.isFinite(Number(pin.x)) && Number.isFinite(Number(pin.y)))
    .map((pin) => ({
      id: typeof pin.id === 'string' && pin.id ? pin.id : newPinId(),
      x: Number(pin.x),
      y: Number(pin.y),
      keyframes: sortKeyframes(
        (Array.isArray(pin.keyframes) ? pin.keyframes : [])
          .map((k) => ({ t: Number(k?.t), dx: Number(k?.dx), dy: Number(k?.dy) }))
          .filter(
            (k) =>
              Number.isFinite(k.t) &&
              k.t >= 0 &&
              k.t < 1 &&
              Number.isFinite(k.dx) &&
              Number.isFinite(k.dy),
          ),
      ),
    }));
  return { duration, fps: DEFAULT_ANIMATION.fps, pins };
}

/** Creates an anchor pin at source-image pixel (x, y) with no keyframes. */
export function createPin({ x, y }) {
  return { id: newPinId(), x, y, keyframes: [] };
}

/** Returns a new pin with a keyframe at t, replacing any keyframe within 1/120 of t. */
export function setKeyframe(pin, t, { dx, dy }) {
  const time = wrapTime(t);
  const kept = pin.keyframes.filter((k) => loopDistance(k.t, time) >= KEYFRAME_MERGE);
  return { ...pin, keyframes: sortKeyframes([...kept, { t: time, dx, dy }]) };
}

/** Returns a new pin without the keyframe nearest to t (within 1/120). */
export function removeKeyframe(pin, t) {
  const time = wrapTime(t);
  return {
    ...pin,
    keyframes: pin.keyframes.filter((k) => loopDistance(k.t, time) >= KEYFRAME_MERGE),
  };
}

/** Samples a pin's looping offset at t with cosine easing between keyframes. */
export function samplePinOffset(pin, t) {
  const keys = pin.keyframes;
  if (!keys.length) return { dx: 0, dy: 0 };
  if (keys.length === 1) return { dx: keys[0].dx, dy: keys[0].dy };
  const time = wrapTime(t);
  let prev = null;
  for (const key of keys) if (key.t <= time) prev = key;
  let prevT;
  if (prev) prevT = prev.t;
  else {
    prev = keys[keys.length - 1];
    prevT = prev.t - 1;
  }
  let next = keys.find((key) => key.t > time);
  let nextT;
  if (next) nextT = next.t;
  else {
    next = keys[0];
    nextT = next.t + 1;
  }
  const span = nextT - prevT;
  const fraction = span > 0 ? (time - prevT) / span : 0;
  const eased = (1 - Math.cos(Math.PI * fraction)) / 2;
  return {
    dx: prev.dx + (next.dx - prev.dx) * eased,
    dy: prev.dy + (next.dy - prev.dy) * eased,
  };
}

/** Samples all pins at t, returning warp control points: rest positions and moved positions. */
export function samplePins(pins, t) {
  const rest = [];
  const moved = [];
  for (const pin of pins) {
    const { dx, dy } = samplePinOffset(pin, t);
    rest.push({ x: pin.x, y: pin.y });
    moved.push({ x: pin.x + dx, y: pin.y + dy });
  }
  return { rest, moved };
}

/** Returns new pins with preset keyframes written on the selected pins; others are unchanged. */
export function applyPreset(pins, ids, preset, { amplitude = 0 } = {}) {
  const selected = new Set(ids);
  const chosen = pins.filter((pin) => selected.has(pin.id));
  const cx = chosen.length ? chosen.reduce((sum, pin) => sum + pin.x, 0) / chosen.length : 0;
  const cy = chosen.length ? chosen.reduce((sum, pin) => sum + pin.y, 0) / chosen.length : 0;
  return pins.map((pin) => {
    if (!selected.has(pin.id)) return pin;
    let keyframes;
    if (preset === 'bob') {
      keyframes = [
        { t: 0, dx: 0, dy: 0 },
        { t: 0.5, dx: 0, dy: -amplitude },
      ];
    } else if (preset === 'sway') {
      keyframes = [
        { t: 0, dx: -amplitude, dy: 0 },
        { t: 0.5, dx: amplitude, dy: 0 },
      ];
    } else if (preset === 'breathe') {
      keyframes = [
        { t: 0, dx: 0, dy: 0 },
        { t: 0.5, dx: (pin.x - cx) * BREATHE_SCALE, dy: (pin.y - cy) * BREATHE_SCALE },
      ];
    } else return pin;
    return { ...pin, keyframes };
  });
}

/** True when any pin has a non-zero keyframe offset. */
export function hasMotion(animation) {
  return (animation?.pins ?? []).some((pin) =>
    pin.keyframes?.some((k) => k.dx !== 0 || k.dy !== 0),
  );
}

/** Loop times (fractions in [0, 1)) of every rendered frame. */
export function getFrameTimes(animation) {
  const total = Math.round(animation.duration * animation.fps);
  return Array.from({ length: total }, (_, i) => i / total);
}
