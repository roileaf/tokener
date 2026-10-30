export const DEFAULT_ANIMATION = { duration: 2, fps: 30, mode: 'loop', pins: [], effects: [] };
export const ANIMATION_PRESETS = [
  'bob',
  'sway',
  'breathe',
  'flap',
  'wave',
  'hover',
  'shiver',
  'look',
];

/** Keyframes closer than this (around the loop seam) count as the same time. */
export const KEYFRAME_MERGE = 1 / 120;
/** Ping-pong keyframes stop short of 1 so the apex never merges with a keyframe at 0. */
export const PINGPONG_MAX_KEY = 1 - 2 * KEYFRAME_MERGE;
const BREATHE_SCALE = 0.03;
const FLAP_PULL = 0.3;
const WAVE_DELAY = 0.12;
const LOOK_ANGLE = 0.18;
const LOOK_SWING = 0.25;
const SHIVER_STEPS = 8;
const SHIVER_SCALE = 0.25;
/** Latest ping-pong keyframe time at which a Wave pin starts moving. */
const PINGPONG_WAVE_MAX_HOLD = 0.9;
const EASES = ['smooth', 'linear', 'hold'];
const MODES = ['loop', 'pingpong'];
/** Region keys name painted canvases: letters, digits, `_` and `-` only (as effect regions). */
const SAFE_REGION_KEY = /^[\w-]+$/;
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
export function loopDistance(a, b) {
  const gap = Math.abs(a - b);
  return Math.min(gap, 1 - gap);
}

function sortKeyframes(keyframes) {
  return [...keyframes].sort((a, b) => a.t - b.t);
}

/** Builds a keyframe, writing rot and ease only when they differ from their defaults. */
function makeKeyframe(t, { dx, dy, rot = 0, ease = 'smooth' }) {
  const key = { t, dx, dy };
  if (rot) key.rot = rot;
  if (ease !== 'smooth') key.ease = ease;
  return key;
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
    .map((pin) => {
      const arm = Number(pin.arm);
      const out = {
        id: typeof pin.id === 'string' && pin.id ? pin.id : newPinId(),
        x: Number(pin.x),
        y: Number(pin.y),
        keyframes: sortKeyframes(
          (Array.isArray(pin.keyframes) ? pin.keyframes : [])
            .map((k) => ({
              t: Number(k?.t),
              dx: Number(k?.dx),
              dy: Number(k?.dy),
              rot: k?.rot === undefined ? 0 : Number(k.rot),
              ease: EASES.includes(k?.ease) ? k.ease : 'smooth',
            }))
            .filter(
              (k) =>
                Number.isFinite(k.t) &&
                k.t >= 0 &&
                k.t < 1 &&
                Number.isFinite(k.dx) &&
                Number.isFinite(k.dy) &&
                Number.isFinite(k.rot),
            )
            .map((k) => makeKeyframe(k.t, k)),
        ),
      };
      if (Number.isFinite(arm) && arm > 0) out.arm = arm;
      if (typeof pin.region === 'string' && SAFE_REGION_KEY.test(pin.region))
        out.region = pin.region;
      // The preset that wrote the pin's motion, shown on its button; dropped once edited by hand.
      if (ANIMATION_PRESETS.includes(pin.preset)) out.preset = pin.preset;
      return out;
    });
  return {
    duration,
    fps: DEFAULT_ANIMATION.fps,
    mode: MODES.includes(raw.mode) ? raw.mode : 'loop',
    pins,
    effects: Array.isArray(raw.effects) ? raw.effects : [],
  };
}

/** Creates an anchor pin at source-image pixel (x, y) with no keyframes; arm is the rotation arm in px. */
export function createPin({ x, y, arm = 0 }) {
  const pin = { id: newPinId(), x, y, keyframes: [] };
  if (arm > 0) pin.arm = arm;
  return pin;
}

/**
 * Returns a new pin with a keyframe at t, replacing any keyframe within 1/120 of t. The motion is
 * then the user's own, so the pin no longer records a preset.
 */
export function setKeyframe(pin, t, { dx, dy, rot = 0, ease = 'smooth' }) {
  const time = wrapTime(t);
  const kept = pin.keyframes.filter((k) => loopDistance(k.t, time) >= KEYFRAME_MERGE);
  const { preset: _preset, ...rest } = pin;
  return {
    ...rest,
    keyframes: sortKeyframes([...kept, makeKeyframe(time, { dx, dy, rot, ease })]),
  };
}

/** Returns a new pin without the keyframe nearest to t (within 1/120), and without its preset. */
export function removeKeyframe(pin, t) {
  const time = wrapTime(t);
  const { preset: _preset, ...rest } = pin;
  return {
    ...rest,
    keyframes: pin.keyframes.filter((k) => loopDistance(k.t, time) >= KEYFRAME_MERGE),
  };
}

function easeFraction(ease, fraction) {
  if (ease === 'hold') return 0;
  if (ease === 'linear') return fraction;
  return (1 - Math.cos(Math.PI * fraction)) / 2;
}

function keyValues(key) {
  return { dx: key.dx, dy: key.dy, rot: key.rot ?? 0 };
}

/** Samples a pin's offset and rotation at t; ping-pong plays forward then back without wrapping. */
export function samplePinOffset(pin, t, mode = 'loop') {
  const keys = pin.keyframes;
  if (!keys.length) return { dx: 0, dy: 0, rot: 0 };
  if (keys.length === 1) return keyValues(keys[0]);
  let time;
  let prev = null;
  let next;
  let prevT;
  let nextT;
  if (mode === 'pingpong') {
    const raw = Math.min(1, Math.max(0, Number(t) || 0));
    time = 1 - Math.abs(1 - 2 * raw);
    for (const key of keys) if (key.t <= time) prev = key;
    next = keys.find((key) => key.t > time);
    if (!prev) return keyValues(keys[0]);
    if (!next) return keyValues(keys[keys.length - 1]);
    prevT = prev.t;
    nextT = next.t;
  } else {
    time = wrapTime(t);
    for (const key of keys) if (key.t <= time) prev = key;
    if (prev) prevT = prev.t;
    else {
      prev = keys[keys.length - 1];
      prevT = prev.t - 1;
    }
    next = keys.find((key) => key.t > time);
    if (next) nextT = next.t;
    else {
      next = keys[0];
      nextT = next.t + 1;
    }
  }
  const span = nextT - prevT;
  const fraction = span > 0 ? (time - prevT) / span : 0;
  const eased = easeFraction(prev.ease, fraction);
  const from = keyValues(prev);
  const to = keyValues(next);
  return {
    dx: from.dx + (to.dx - from.dx) * eased,
    dy: from.dy + (to.dy - from.dy) * eased,
    rot: from.rot + (to.rot - from.rot) * eased,
  };
}

/**
 * Samples all pins at t, returning warp control points: rest positions and moved positions.
 * A pin with rotation keyframes and an arm adds two satellites at +-arm along x, rotated about it.
 */
export function samplePins(pins, t, mode = 'loop') {
  const rest = [];
  const moved = [];
  for (const pin of pins) {
    const { dx, dy, rot } = samplePinOffset(pin, t, mode);
    const x = pin.x + dx;
    const y = pin.y + dy;
    rest.push({ x: pin.x, y: pin.y });
    moved.push({ x, y });
    const arm = pin.arm ?? 0;
    if (arm > 0 && pin.keyframes.some((k) => k.rot)) {
      const cos = Math.cos(rot) * arm;
      const sin = Math.sin(rot) * arm;
      rest.push({ x: pin.x + arm, y: pin.y }, { x: pin.x - arm, y: pin.y });
      moved.push({ x: x + cos, y: y + sin }, { x: x - cos, y: y - sin });
    }
  }
  return { rest, moved };
}

/**
 * Returns new pins with preset keyframes written on the selected pins (hover: all pins). `mode`
 * shapes the keys for the playback mode: a loop swings out at 0.5 and back at the seam; ping-pong
 * plays only the forward half (rest pose at 0, peak at `PINGPONG_MAX_KEY`) and then plays it back.
 */
export function applyPreset(pins, ids, preset, { amplitude = 0, mode = 'loop' } = {}) {
  const selected = new Set(ids);
  const chosen = pins.filter((pin) => selected.has(pin.id));
  const cx = chosen.length ? chosen.reduce((sum, pin) => sum + pin.x, 0) / chosen.length : 0;
  const cy = chosen.length ? chosen.reduce((sum, pin) => sum + pin.y, 0) / chosen.length : 0;
  const order = new Map(ids.map((id, index) => [id, index]));
  const pingpong = mode === 'pingpong';
  const peak = pingpong ? PINGPONG_MAX_KEY : 0.5;
  if (preset === 'wave' && chosen.length < 2) return pins;
  return pins.map((pin) => {
    if (!selected.has(pin.id) && preset !== 'hover') return pin;
    let keyframes;
    if (preset === 'bob' || preset === 'hover') {
      keyframes = [
        { t: 0, dx: 0, dy: 0 },
        { t: peak, dx: 0, dy: -amplitude },
      ];
    } else if (preset === 'sway') {
      keyframes = [
        { t: 0, dx: -amplitude, dy: 0 },
        { t: peak, dx: amplitude, dy: 0 },
      ];
    } else if (preset === 'breathe') {
      keyframes = [
        { t: 0, dx: 0, dy: 0 },
        { t: peak, dx: (pin.x - cx) * BREATHE_SCALE, dy: (pin.y - cy) * BREATHE_SCALE },
      ];
    } else if (preset === 'flap') {
      keyframes = [
        { t: 0, dx: 0, dy: 0 },
        { t: peak, dx: Math.sign(cx - pin.x) * amplitude * FLAP_PULL, dy: amplitude },
      ];
    } else if (preset === 'wave') {
      const delay = order.get(pin.id) * WAVE_DELAY;
      if (pingpong) {
        // Every pin peaks at the apex; later pins hold their start pose longer (follow-through).
        const start = Math.min(PINGPONG_WAVE_MAX_HOLD, 2 * delay);
        keyframes = [{ t: 0, dx: -amplitude, dy: 0 }];
        if (start >= KEYFRAME_MERGE) keyframes.push({ t: start, dx: -amplitude, dy: 0 });
        keyframes.push({ t: PINGPONG_MAX_KEY, dx: amplitude, dy: 0 });
      } else {
        keyframes = sortKeyframes([
          { t: wrapTime(delay), dx: -amplitude, dy: 0 },
          { t: wrapTime(0.5 + delay), dx: amplitude, dy: 0 },
        ]);
      }
    } else if (preset === 'shiver') {
      // Ping-pong spreads the jitter over the forward half, which then plays back.
      const step = pingpong ? PINGPONG_MAX_KEY / (SHIVER_STEPS - 1) : 1 / SHIVER_STEPS;
      keyframes = Array.from({ length: SHIVER_STEPS }, (_, i) => {
        const sign = i % 2 ? -1 : 1;
        return makeKeyframe(i * step, {
          dx: sign * amplitude * SHIVER_SCALE,
          dy: -sign * amplitude * SHIVER_SCALE * 0.5,
          ease: 'linear',
        });
      });
    } else if (preset === 'look') {
      keyframes = [
        makeKeyframe(0, { dx: -amplitude * LOOK_SWING, dy: 0, rot: -LOOK_ANGLE }),
        makeKeyframe(peak, { dx: amplitude * LOOK_SWING, dy: 0, rot: LOOK_ANGLE }),
      ];
    } else return pin;
    return { ...pin, keyframes, preset };
  });
}

/** True when any pin keyframe moves or rotates, or the animation has any effect. */
export function hasMotion(animation) {
  if ((animation?.effects ?? []).length > 0) return true;
  return (animation?.pins ?? []).some((pin) =>
    pin.keyframes?.some((k) => k.dx !== 0 || k.dy !== 0 || (k.rot ?? 0) !== 0),
  );
}

/** Loop times (fractions in [0, 1)) of every rendered frame. */
export function getFrameTimes(animation) {
  const total = Math.round(animation.duration * animation.fps);
  return Array.from({ length: total }, (_, i) => i / total);
}
