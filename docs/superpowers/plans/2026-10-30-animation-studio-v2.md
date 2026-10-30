# Animation Studio v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add richer motion (multi-select, rotation, easing, ping-pong, five presets), procedural effects (wind, wobble, flicker, glow, particles), ring effects, Auto animate and saved, re-editable projects to the Token Creator's animation studio.

**Architecture:** Pure modules carry the logic and are node-tested: `animation.js` (keyframes, presets, rotation control points), new `animation-effects.js` (effect normalization, displacement fields, flicker, glow and particle rendering), new `auto-animate.js` (rig from silhouette), new `creator-project.js` (project serialize/parse). `token-animation.js` gains one frame renderer used by both preview and save. The creator UI wires them in; `actions.js` writes ring effects and the project flag.

**Tech Stack:** Plain ES modules, Canvas 2D, Foundry v13–v14, node:test + `canvas` dev dependency.

**Spec:** `docs/superpowers/specs/2026-10-30-animation-studio-v2-design.md`

## Global Constraints

- Foundry v13–v14; no new runtime dependencies; node:test `.mjs` tests (`node --test tests/*.mjs`); lint with `./node_modules/.bin/eslint scripts tests`; `npx prettier --write` touched files.
- Effects and particles are periodic in the loop (frame N == frame 0) and deterministic (seeded by effect id).
- Keyframe `ease` values: `'smooth'` (default, `0.5 - 0.5·cos(πu)`), `'linear'`, `'hold'`. Animation `mode`: `'loop'` (default) or `'pingpong'` sampled at `u = 1 - |1 - 2t|`.
- Rotation arm `ROTATION_ARM_RATIO = 0.12` of the cut-out's long side; presets amplitude 3 % of the long side (Shiver 1 %); Look ±0.18 rad; Wave phase delay 0.12 per pin; Flap dx 30 % toward the selection centroid.
- Ring effect bits: ENABLED 1, RING_PULSE 2, RING_GRADIENT 4, BKG_WAVE 8, INVISIBILITY 16.
- Project file name `<token file stem>.tokener.json`, `version: 1`; uploaded source `<stem>-source.png`; flag `flags.pf2e-tokener.project = { path, output }`.
- Saved animated output stays capped at 512 px. Preview target < 33 ms per 480 px frame with 2 effects.
- Never stage files you did not change. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Ping-pong with keyframes only in the first half: the second half mirrors exactly, no jump at t=0.5 or the loop seam. → Task 1 test.
- A project whose source image file was deleted or moved: the creator opens empty with a clear status, nothing throws. → Task 10 test.
- Effect regions after the user re-frames the art (zoom/move): regions stay attached to the art (source-image space), not to the token. → Task 4 test.
- Old 2.3 animations (no `mode`, no `ease`, no `effects`) still load and play identically. → Task 1 test.
- Particles near the token edge at the loop seam: no particle pops in or out between frame N-1 and 0. → Task 3 test.

---

### Task 1: Keyframes v2 — easing, rotation, ping-pong, multi-pin presets

**Files:** Modify `scripts/animation.js`; Test `tests/animation.test.mjs`

**Interfaces:**
- Produces: keyframe `{ t, dx, dy, rot = 0, ease = 'smooth' }`; pin `{ id, x, y, arm, keyframes }` (`createPin({ x, y, arm = 0 })`); `normalizeAnimation(value) -> { duration, fps, mode, pins, effects }` (effects passed through as an array, validated in Task 3); `setKeyframe(pin, t, { dx, dy, rot, ease })`; `samplePinOffset(pin, t, mode = 'loop') -> { dx, dy, rot }`; `samplePins(pins, t, mode = 'loop') -> { rest, moved }` including two satellite control points per pin that has any non-zero `rot` keyframe (at `±arm` along x, rotated about the moved pin); `ANIMATION_PRESETS = ['bob', 'sway', 'breathe', 'flap', 'wave', 'hover', 'shiver', 'look']`; `applyPreset(pins, ids, preset, { amplitude })`; `hasMotion(animation)` (any non-zero dx/dy/rot or any effect).

- [ ] **Step 1: Write failing tests**
  - `'hold' keeps the previous value until the next keyframe` (t=0 dy 0 hold, t=0.5 dy -10: sample 0.49 → 0, 0.5 → -10).
  - `'linear' interpolates evenly` (midpoint exactly half).
  - `ping-pong mirrors the first half` (keyframes 0 → 0, 0.5 → -10 in loop vs a pin with 0 → 0, 1 → -10... use: one keyframe pair at t 0 (0) and t 0.999 (-10) in pingpong: sample(0.25) == sample(0.75), sample(0.5) ≈ -10·ease(0.999…)).
  - `rotation adds two satellite control points about the pin` (arm 10, rot π/2 at t=0.5: moved satellites at (x, y±10) relative to moved pin; rest at (x±10, y)).
  - `pins without rotation add no satellites`.
  - `flap moves selected pins down together and toward their centroid`; `wave delays each selected pin by 0.12`; `hover moves every pin up together`; `shiver alternates small linear jitter`; `look rotates the selected pin by ±0.18`.
  - `old animations without mode/ease/effects normalize to loop/smooth/[]` and sample exactly as before.
- [ ] **Step 2:** `node --test tests/animation.test.mjs` → FAIL
- [ ] **Step 3:** Implement in `scripts/animation.js` (keep existing exports and behaviour).
- [ ] **Step 4:** full suite PASS
- [ ] **Step 5:** commit `feat: keyframe easing, rotation, ping-pong and new presets`

### Task 2: Use rotation control points in the bend

**Files:** Modify `scripts/token-animation.js` (`bendTokenArt`, `getBendMargin`, `getPinPreviewPoints`); Test `tests/token-animation.test.mjs`

**Interfaces:**
- Consumes: Task 1 `samplePins(pins, t, mode)` (with satellites), `createPin({ x, y, arm })`.
- Produces: `bendTokenArt({ ..., animation, t })` honours `animation.mode` and rotation; `getBendMargin` accounts for rotated satellites (largest satellite displacement).

- [ ] **Step 1: Failing tests:** `a rotating pin turns the art around it` (a horizontal bar centred on a pin with arm 10 and rot π/2 at t=0.5 becomes vertical: opaque pixels above/below the pin, transparent left/right at arm distance); `ping-pong animation bends the same at t and 1-t`.
- [ ] **Step 2–4:** fail, implement, full suite pass.
- [ ] **Step 5:** commit `feat: bend art with rotating pins and ping-pong loops`

### Task 3: Effects engine (pure)

**Files:** Create `scripts/animation-effects.js`; Test `tests/animation-effects.test.mjs`

**Interfaces:**
- Produces: `EFFECT_TYPES = ['wind', 'wobble', 'flicker', 'glow', 'particles']`; `PARTICLE_KINDS = ['embers', 'smoke', 'sparkles', 'snow', 'drips']`; `createEffect(type, { region = null } = {}) -> Effect` (spec defaults, id like pins); `normalizeEffects(list) -> Effect[]` (drops unknown types, clamps params); `getDisplacement(effect, x, y, t) -> { dx, dy }` (wind/wobble; token-space px; periodic in t); `getFlickerFactor(effect, t) -> number` (0–1 multiplier); `drawGlow(context, { effect, art, region, t, size, createCanvas, phase: 'behind' | 'over' })`; `drawParticles(context, { effect, emitter, t, size })` where `emitter` is `{ points: {x,y}[] }` sampled from region or silhouette edge (token space).

- [ ] **Step 1: Failing tests:** displacement periodic (`t=0` equals `t=1`), zero outside strength 0; flicker within [1-amount, 1] and periodic; glow behind adds alpha outside the silhouette, glow over with a region brightens only that region; particles deterministic (same effect+t → same pixels), periodic (t=0 vs t=1 identical), and `count` bounded; `normalizeEffects` drops unknown types and clamps.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5:** commit `feat: procedural animation effects`

### Task 4: One frame renderer with effects and regions

**Files:** Modify `scripts/token-animation.js` (new `renderAnimationFrame`), `scripts/token-creator.js` (preview `getPreviewBend` path and `encodeTokenAnimation` use it); Test `tests/token-animation.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `renderAnimationFrame({ context, size, t, art: { cutout, popOutImage, regions: { [key]: canvas } }, view, animation, createCanvas, drawFrame })` where `drawFrame(context, bent)` is the caller's `drawCreatedToken(context, app, size, { bent })`. Order: bend art + pop-out + regions with one grid → displacement effects on art/pop-out (region-weighted) → flicker → `drawFrame` → glow behind/over → particles. Regions live in source-image px and are bent with the art.

- [ ] **Step 1: Failing tests:** `regions follow the art when the view changes` (region square on the art; re-framed view → region pixels still on the same art pixels); `a wind effect only moves pixels inside its region`; `with no effects and no motion, renderAnimationFrame draws the plain still frame` (pixel-equal to drawFrame with unbent art).
- [ ] **Step 2–4:** fail, implement (creator calls through `renderAnimationFrame` for preview and save), full suite pass.
- [ ] **Step 5:** commit `feat: render animation frames with effects`

### Task 5: Creator UI — multi-select, easing, rotation, ping-pong, presets

**Files:** Modify `scripts/token-creator.js`, `templates/token-creator.hbs`, `styles/pf2e-tokener.css`, `languages/en.json`, `scripts/token-animation.js` (pure helpers); Test `tests/token-creator.test.mjs`

**Interfaces:**
- Consumes: Task 1.
- Produces: app state `selectedPinIds: string[]` (replaces `selectedPinId`); helpers `toggleSelection(ids, id, additive) -> string[]`, `getPresetTargets(pins, selectedIds, preset) -> string[]` (per spec: bob/sway/look/shiver/flap/wave → selected; breathe/hover → all), `isPresetAvailable(pins, selectedIds, preset)` (flap ≥ 1 selected, wave ≥ 2 selected, breathe ≥ 2 pins, others ≥ 1 selected). Animate card: preset buttons for all 8, a Loop/Ping-pong segmented toggle, and for the selected pin's keyframe at the current time an easing select (Smooth/Linear/Hold) and a rotation slider (−45°…45°). Shift+click on a pin toggles selection.

- [ ] **Step 1: Failing tests** for `toggleSelection`, `getPresetTargets` (all 8 presets), `isPresetAvailable`.
- [ ] **Step 2–4:** fail, implement UI and helpers, full suite pass.
- [ ] **Step 5:** commit `feat: multi-pin selection, easing, rotation and new presets in the creator`

### Task 6: Creator UI — effects list and region brush

**Files:** Modify `scripts/token-creator.js`, `scripts/creator-shortcuts.js`, `templates/token-creator.hbs`, `styles/pf2e-tokener.css`, `languages/en.json`; Test `tests/token-creator.test.mjs`

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces: Animate card "Effects" section: add-effect select (5 types, particles kind select), list of effects (select, remove), parameter controls for the selected effect, "Use painted region / Whole figure" toggle. New tool `'region'` (**F**, shortcut command `tool-region`) paints the selected effect's region in source-image px (drag adds, right/Alt-drag removes), shown as a coloured overlay while active; regions stored in `app.effectRegions: { [effectId]: canvas }`. Helper `getEffectRegionKey(effect) -> string | null`.

- [ ] **Step 1: Failing tests:** `F selects the region tool`; `removing an effect drops its region`; `getToolButton('region') === 'region'`.
- [ ] **Step 2–4:** fail, implement, full suite pass.
- [ ] **Step 5:** commit `feat: effects and effect regions in the creator`

### Task 7: Auto animate

**Files:** Create `scripts/auto-animate.js`; Modify `scripts/token-creator.js`, template, en.json; Test `tests/auto-animate.test.mjs`

**Interfaces:**
- Consumes: `getAlphaGrid`, `analyseSubject`, `findProtrusions` (auto-compose.js), Task 1 presets.
- Produces: `buildAutoRig({ alpha, cutoutWidth, cutoutHeight, view, clipRadius, gridSize }) -> { pins, selectedPinIds }` per spec (head, chest, two bottom anchors, up to two tips; Breathe all, Bob 60 % on head, Flap on two tips or Sway on one). Button **Auto animate** in the Animate card; confirms before replacing existing pins.

- [ ] **Step 1: Failing tests** on a synthetic figure: head pin within one head radius of the analysed head; two anchors at bounds bottom 25 %/75 %; with a raised sword, one tip pin near its tip with a Sway; result `hasMotion` true; anchors have no keyframes.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5:** commit `feat: auto animate`

### Task 8: Ring effects

**Files:** Modify `scripts/token-creator.js` (option `ringEffects`, Frame card checkboxes, candidate), `scripts/token-composer.js` (`buildCreatedTokenCandidate({ ringEffects })`), `scripts/actions.js` (`buildTokenUpdate` writes `ring.effects`; `captureTokenState`/`tokenStateToUpdate` include `ring.effects`), template, en.json; Test `tests/pf2e-tokener.test.mjs`, `tests/token-creator.test.mjs`

**Interfaces:** `getRingEffectsMask({ pulse, gradient, wave, spectral }) -> number` (1 | bits) exported from `token-composer.js`.

- [ ] **Step 1: Failing tests:** mask values (none → 1, all → 31); `buildTokenUpdate` writes `ring.effects` for ring candidates (still and `ringFromToken`) and omits it otherwise; revert state round-trips `ring.effects`; `normalizeTokenCreatorOptions` defaults all four to false.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5:** commit `feat: dynamic ring effects in the creator`

### Task 9: Save projects

**Files:** Create `scripts/creator-project.js`; Modify `scripts/token-creator.js` (`createToken` writes the project), `scripts/token-composer.js` (candidate `projectSrc`), `scripts/actions.js` (flag); Test `tests/creator-project.test.mjs`, `tests/pf2e-tokener.test.mjs`

**Interfaces:**
- Produces: `PROJECT_VERSION = 1`; `buildProjectFileName(tokenFileName) -> string` (`dragon-2026….webm` → `dragon-2026….tokener.json`); `serializeProject({ label, output, options, token, portrait, animation, regions, toDataUrl }) -> object` (pure; `toDataUrl(canvas)` injected); `parseProject(json) -> Project | null` (validates version and shapes, normalizes animation/effects); `getProjectFlagUpdate({ path, output }) -> { 'flags.pf2e-tokener.project': { path, output } }`. Creator: sources without a path are uploaded as `<stem>-source.png`; the JSON is uploaded with `uploadBlob` (type `application/json`); candidate carries `projectSrc`; `buildTokenUpdate` adds the flag (token and prototype via existing actor path).

- [ ] **Step 1: Failing tests:** file name mapping; serialize → JSON.stringify → parse round-trips views, options, animation (pins with rot/ease, mode, effects) and region/mask data URLs; `parseProject` rejects wrong version/garbage with null; `buildTokenUpdate` writes the project flag when `candidate.projectSrc` is set.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5:** commit `feat: save Token Creator projects`

### Task 10: Load projects

**Files:** Modify `scripts/token-creator.js` (open flow, **Open project** button), `scripts/creator-project.js` (`shouldLoadProject(tokenDocument) -> { path } | null`), template, en.json; Test `tests/creator-project.test.mjs`

**Interfaces:** `shouldLoadProject(documentLike)` returns `{ path }` when `flags.pf2e-tokener.project.output === texture.src` (reads `_source` first), else null. `loadCreatorProject(app, path)` restores both workspaces (loading sources by path), views, options, pop-out mask, touch-ups, animation, effects and regions; on any failure leaves an empty creator and a status message `Creator.ProjectLoadFailed`.

- [ ] **Step 1: Failing tests:** `shouldLoadProject` true only when output matches the current art (token `_source` and prototype); a project whose source path 404s → status set, workspaces empty, no throw (fake fetch/image loader injected).
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5:** commit `feat: reopen saved Token Creator projects`

### Task 11: Docs and verification checklist

**Files:** Modify `CHANGELOG.md` (Unreleased → Added), `README.md` (Token Creator section)

- [ ] Document every feature above concisely; note ring effects work without video and on http games; note projects are saved next to tokens and reopen automatically.
- [ ] `npx prettier --check CHANGELOG.md README.md`; commit `docs: animation studio v2`.
- [ ] Hand the user a Foundry checklist: effects loop seamlessly in saved WebMs; ring effects visible; project reopens after reload; Open project works after Save only; old 2.3 tokens unaffected.
