# Animation studio v2 — design

## Intent

Extend the Token Creator's animation studio (pins + rigid MLS warp + transparent WebM loop,
shipped in 2.3.x) with everything discussed on 2026-10-30, at the user's request ("implement
ALL"):

1. More motion: multi-pin selection, rotation keyframes, per-keyframe easing, ping-pong loops and
   new presets **Flap**, **Wave**, **Hover**, **Shiver**, **Look**.
2. Procedural effects that need no pins: **Wind** (flutter a painted region), **Wobble** (ghostly
   distortion), **Flicker** (opacity/brightness pulse).
3. Overlays: **Glow** (aura around the silhouette, or eye glow in a painted region) and
   **Particles** (embers, smoke, sparkles, snow, drips).
4. Foundry's built-in **ring effects** (pulse, gradient, background wave, spectral) as toggles.
5. **Auto animate**: one click places pins and a sensible idle.
6. **Saved projects**: everything needed to reopen and keep editing a token is saved with it.

Everything stays non-generative: pixels are moved, tinted, blurred or procedurally drawn; no AI
model creates content.

## Existing pieces (read before building)

- `scripts/animation.js`: pins `{ id, x, y, keyframes: [{ t, dx, dy }] }` in source-image px,
  `t` in [0,1); cosine easing; `samplePins(pins, t) -> { rest, moved }`; presets bob/sway/breathe;
  `hasMotion`, `getFrameTimes`, `normalizeAnimation({ duration, fps, pins })`.
- `scripts/puppet-warp.js`: rigid MLS (`buildWarpGrid`, `warpImageData`).
- `scripts/token-animation.js`: `bendTokenArt` (token-space bend with padding), preview/save helpers.
- `scripts/webm-alpha.js`: WebCodecs VP9+alpha encoder (`encodeAlphaWebm`, `probeAnimationSupport`).
- `scripts/token-creator.js`: creator app (pin tool, Animate card, `encodeTokenAnimation`,
  `createToken`, `drawCreatedToken(..., { bent })`).
- `scripts/auto-compose.js`: `getAlphaGrid`, `analyseSubject` (head `{x,y,radius}`, bounds),
  `findProtrusions` (pieces with `tip`).
- `scripts/actions.js` `buildTokenUpdate`; `scripts/token-composer.js` `buildCreatedTokenCandidate`.

## Decisions

### Motion
- Keyframe gains optional `rot` (radians, default 0) and `ease` (`'smooth'` default = current
  cosine, `'linear'`, `'hold'` = keep the previous value until the next keyframe).
- Animation gains `mode: 'loop' | 'pingpong'` (default `'loop'`). Ping-pong samples keyframes at
  `u = 1 - |1 - 2t|` so the loop plays forward then backward and is seamless.
- Rotation: a pin with any non-zero `rot` keyframe contributes two extra control points at
  `±ROTATION_ARM` (12 % of the cut-out's long side, stored per pin as `arm`, set at creation) along
  the x axis, rotated by the sampled angle about the pin's moved position. Pins without rotation
  add only themselves. `samplePins` returns these points so the warp is unchanged.
- Multi-selection: `selectedPinIds: string[]`; click selects one, Shift+click toggles. Presets:
  - **Bob**, **Sway**, **Look** (rotation ±0.18 rad with a small dx), **Shiver** (8 keyframes of
    ±25 % amplitude jitter, `ease: 'linear'`): each selected pin.
  - **Flap**: selected pins move down by `amplitude` at t=0.5 and swing their dx toward the
    selection's centroid by 30 % of amplitude (wings beat together).
  - **Wave**: selected pins in selection order; pin i gets a sway with phase delay `i × 0.12`
    (follow-through along tails/tentacles/capes); needs ≥ 2 pins.
  - **Breathe** (existing) and **Hover** (all pins move up by `amplitude` at t=0.5): all pins.
  - Amplitude stays 3 % of the cut-out's long side (Shiver uses 1 %).

### Effects
- `animation.effects: Effect[]`, each `{ id, type, region: string | null, ...params }` where
  `region` is a key into the effect-region canvases (source-image px, same size as the cut-out),
  `null` meaning the whole subject (or "around the figure" for particles).
- Types and params (all periodic in the loop so frame 0 equals frame N):
  - `wind`: `strength` (px at token size, default 4), `scale` (noise wavelength, default 24 px);
    displacement `d(x,y,t) = strength × (sin(2πt + φ(x,y)), 0.5·cos(2πt + φ'(x,y)))` inside the
    region (feathered), φ from a smooth hash of `(x/scale, y/scale)`.
  - `wobble`: `strength` (default 3), `scale` (default 40): sinusoidal displacement of the whole
    subject or region.
  - `flicker`: `amount` (0–1, default 0.25), `kind: 'opacity' | 'brightness'`, `speed` (integer
    cycles per loop, default 3).
  - `glow`: `color` (default `#8fd3ff`), `size` (px at token size, default 10), `pulse` (0–1,
    default 0.5). Region null → aura around the whole silhouette drawn behind the art; region set
    → glow of that region drawn over the art with `lighter` blending (eye glow).
  - `particles`: `kind: 'embers' | 'smoke' | 'sparkles' | 'snow' | 'drips'`, `count` (default 24),
    `color` (kind default), `size` (default 3). Emitter = region (or the silhouette's edge when
    null). Deterministic: seeded by effect id, each particle has a phase so its lifetime wraps at
    the loop boundary; drawn on top of everything, unclipped.
- Pipeline per frame `t` (token space, output size): bent art and bent regions (same warp as pins)
  → displacement effects (wind, wobble) → flicker → frame/ring clip and pop-out
  (`drawCreatedToken(..., { bent })`) → glow behind/over → particles on top.
- `hasMotion(animation)` is true when any pin moves or any effect exists.

### Ring effects
- Frame card (dynamic ring only): checkboxes **Pulse**, **Gradient**, **Background wave**,
  **Spectral** → creator option `ringEffects: { pulse, gradient, wave, spectral }`; on apply
  `'ring.effects' = 1 | 2·pulse | 4·gradient | 8·wave | 16·spectral` (bits from
  `TokenRing.effects`). Works for still and animated tokens; no video needed. Revert restores it
  (captured with the token state).

### Auto animate
- Button **Auto animate** in the Animate card. From the cut-out's alpha grid: head from
  `analyseSubject`; protrusion tips from `findProtrusions` at the current view (top 2 by distance
  from centre, skipping bottom-arc pieces). Pins: head, chest (head + 1.6 head radii down), two
  anchors at the bottom of the bounds (25 % and 75 % across), and up to two tip pins. Motion:
  Breathe on all, Bob (60 % amplitude) on the head, Flap on the tips when two tips exist, Sway on
  a single tip. Replaces existing pins after a confirm when pins exist.

### Saved projects
- Every save (Save only, Token, Actor, Portrait, Both) writes a project file
  `<token file stem>.tokener.json` next to the saved token in the created token folder:
  `{ version: 1, savedAt, label, output: tokenSrc, options: creatorOptions, token: Workspace,
  portrait: Workspace | null, animation }` where `Workspace = { sourcePath, view, popOutMask?,
  cleanup: { keep?, remove? } }`, masks/regions as PNG data URLs, and `animation` includes
  `effects` and `regions: { [key]: dataUrl }`.
- A source loaded from a file, paste or drop has no path: it is uploaded as
  `<stem>-source.png` in the same folder and referenced by path.
- Apply writes `flags.pf2e-tokener.project = { path, output }` on the token (and the actor's
  prototype token for Actor/Both).
- Opening the creator for a token whose project flag's `output` equals its current
  `texture.src` loads that project (sources, views, options, masks, touch-ups, animation,
  effects, regions) and shows "Editing the saved project". The Image card gets **Open project**
  (FilePicker for `.json`) to load any project file, e.g. after Save only.
- Loading is defensive: unknown versions or missing files leave the creator empty with a status
  message.

## Non-goals
- Layered parts, onion skinning, per-effect keyframes, audio.
- Generative fills or AI-created motion.
- Migrating older animated tokens (made before projects existed) into projects.

## Constraints
- Foundry v13–v14; no new runtime dependencies; plain ES modules; node:test (`.mjs`) tests with
  the `canvas` dev dependency; prettier + eslint (`./node_modules/.bin/eslint scripts tests`).
- Effects and particles must loop seamlessly (frame N == frame 0) and be deterministic.
- Preview must stay responsive at 480 px (target < 33 ms per frame with 2 effects).
- Saved animated output still capped at 512 px; projects store masks at source resolution.

## Left to the builder
- Exact UI layout and icons for the new controls (match existing cards/segmented/slider styles).
- Particle shapes and default colours per kind.
- Noise/hash function choice for wind and wobble.
