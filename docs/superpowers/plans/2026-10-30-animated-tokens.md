# Animated Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a still token into a looping transparent WebM in the Token Creator by placing pins on the art and keyframing their motion, for painted-frame and dynamic-ring tokens.

**Architecture:** Three pure modules carry the logic: `puppet-warp.js` (rigid MLS warp), `animation.js` (pins, keyframes, presets, sampling) and `webm-alpha.js` (WebCodecs colour + alpha encode and a WebM muxer). `token-animation.js` bends the token-space art layers for a time `t`; the creator gains a pin tool, a timeline and an animated save path; `ring-video.js` starts ring-subject videos Foundry leaves paused.

**Tech Stack:** Plain ES modules, Canvas 2D, WebCodecs `VideoEncoder`/`VideoFrame`, Foundry v13–v14 APIs, node:test with the `canvas` dev dependency.

**Spec:** `docs/superpowers/specs/2026-10-30-animated-tokens-design.md`

## Global Constraints

- Foundry v13–v14; keep working for every system the module supports.
- No new runtime dependencies; tests use node:test (`node --test tests/*.mjs`) and the existing `canvas` dev dependency.
- Codec `vp09.00.10.08`; colour bitrate `outputSize * outputSize * 8` bits/s, alpha bitrate a quarter of it; keyframe on frame 0 only; `latencyMode: 'quality'`; odd widths/heights padded to even.
- Loop length 1–4 s in 0.5 s steps, default 2 s; 30 fps.
- Animation is offered only when `isSecureContext && 'VideoEncoder' in globalThis`.
- Ring tokens: `ring.subject.texture` stays `''` for videos (Foundry rejects video subjects).
- Warp grid step 8 px; easing `0.5 - 0.5 * cos(π u)` between keyframes.
- Shortcut **P** = pin tool.
- Another session has uncommitted work in `scripts/token-creator.js` (`compose-ai-ranking`). Start only after it is committed, or in a separate worktree; never stage files you did not change.
- Match surrounding code style; run `npx prettier --write` and `npx eslint scripts tests` on touched files.

## Review Focus

- Loading a different image (or switching to Portrait) while pins exist: pins are cleared for a new token image, the pin tool is token-only, nothing throws. → Task 5 test.
- Pins dragged off the art or past the token edge: the warp still produces transparent pixels outside the source, never smears edge pixels. → Task 1 test.
- Pins exist but none has keyframes (only anchors): saving writes the usual still WebP, not a video. → Task 6 test.
- Insecure game (`http://<ip>`): the Animate section is disabled with a reason and save never calls the encoder. → Task 3 and Task 6 tests.
- Two keyframes at nearly the same time (double click on the timeline): the later one replaces the earlier instead of creating a zero-length segment. → Task 2 test.

---

### Task 1: Rigid MLS puppet warp

**Files:**
- Create: `scripts/puppet-warp.js`
- Test: `tests/puppet-warp.test.mjs`

**Interfaces:**
- Produces: `mlsRigid(x: number, y: number, from: {x,y}[], to: {x,y}[]) -> {x, y}`; `buildWarpGrid({ width, height, rest: {x,y}[], moved: {x,y}[], step = 8 }) -> { gx: Float32Array, gy: Float32Array, cols: number, rows: number, step: number }` (maps each output grid point to its source position: MLS with `from = moved`, `to = rest`); `warpImageData(source: {data,width,height}, grid, target: {data,width,height}) -> void`.

- [ ] **Step 1: Write the failing tests**

```js
test('warp leaves the image unchanged when no pin moves', () => { /* 32x32 gradient, pins at (4,4),(28,28) rest==moved; target.data deepEqual source.data */ });
test('a moved pin carries the source pixel under its rest position', () => {
  // red dot at (10,10) on transparent 40x40; anchors (2,38),(38,38),(38,2); pin (10,10) -> (10,4)
  // assert target alpha at (10,4) > 200 and red channel > 200; alpha at (10,16) === 0
});
test('a single pin translates the whole image', () => { /* rest (5,5) moved (8,5): target(8+k,5) === source(5+k,5) */ });
test('pixels mapped outside the source stay transparent', () => { /* pin moved by 20px left; right edge column alpha === 0 */ });
test('mlsRigid returns the target exactly at a control point', () => { assert.deepEqual(mlsRigid(3, 4, [{x:3,y:4},{x:9,y:9}], [{x:5,y:6},{x:9,y:9}]), { x: 5, y: 6 }); });
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/puppet-warp.test.mjs`
Expected: FAIL, cannot find module `../scripts/puppet-warp.js`

- [ ] **Step 3: Implement `scripts/puppet-warp.js`**

Use the spike's complex-number form: weights `1 / d²`, centroids `p*`, `q*`, `M = Σ w · conj(p̂) · q̂`, result `(v − p*) · M / |M| + q*`; with zero pins return the point, with one pin translate. `warpImageData` bilinearly interpolates `gx/gy` between grid points and samples the source bilinearly with premultiplied alpha (out-of-bounds taps contribute nothing). Reference: `C:\tmp\puppet-spike\puppet.html` `mlsRigid`/`renderFrame`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/puppet-warp.test.mjs` — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/puppet-warp.js tests/puppet-warp.test.mjs
git commit -m "feat: add rigid MLS puppet warp"
```

### Task 2: Pins, keyframes and presets

**Files:**
- Create: `scripts/animation.js`
- Test: `tests/animation.test.mjs`

**Interfaces:**
- Produces: `DEFAULT_ANIMATION = { duration: 2, fps: 30, pins: [] }`; `ANIMATION_PRESETS = ['bob', 'sway', 'breathe']`; `normalizeAnimation(value) -> { duration, fps, pins }`; `createPin({ x, y }) -> { id: string, x, y, keyframes: [] }`; `setKeyframe(pin, t, { dx, dy }) -> pin` (new object; keyframes sorted by `t` in `[0,1)`; replaces any keyframe within `1/120` of `t`); `removeKeyframe(pin, t) -> pin`; `samplePinOffset(pin, t) -> { dx, dy }`; `samplePins(pins, t) -> { rest: {x,y}[], moved: {x,y}[] }`; `applyPreset(pins, ids: string[], preset, { amplitude }) -> pins`; `hasMotion(animation) -> boolean` (some pin has a non-zero keyframe); `getFrameTimes(animation) -> number[]` (`i / (duration * fps)` for `i < duration * fps`).

- [ ] **Step 1: Write the failing tests**

```js
test('a pin without keyframes never moves', () => assert.deepEqual(samplePinOffset(createPin({ x: 1, y: 2 }), 0.3), { dx: 0, dy: 0 }));
test('offsets ease between keyframes and wrap around the loop', () => {
  let pin = setKeyframe(createPin({ x: 0, y: 0 }), 0, { dx: 0, dy: 0 });
  pin = setKeyframe(pin, 0.5, { dx: 0, dy: -10 });
  assert.deepEqual(samplePinOffset(pin, 0.5), { dx: 0, dy: -10 });
  assert.ok(Math.abs(samplePinOffset(pin, 0.25).dy + 5) < 1e-9); // cosine ease midpoint
  assert.ok(Math.abs(samplePinOffset(pin, 0.75).dy + 5) < 1e-9); // wraps back toward t=0
});
test('a keyframe close to an existing one replaces it', () => { /* setKeyframe at 0.5 then 0.5 + 1/240: keyframes.length === 1 and dy is the new value */ });
test('bob, sway and breathe presets fill keyframes for the selected pins only', () => {
  // bob: t=0 {0,0}, t=0.5 {0,-amplitude}; sway: t=0 {-a,0}, t=0.5 {a,0};
  // breathe: t=0.5 offset = (pin - centroid of selected pins) * 0.03; unselected pins keep keyframes []
});
test('animation settings clamp duration to 1-4 s in half steps and keep 30 fps', () => {
  assert.equal(normalizeAnimation({ duration: 9 }).duration, 4);
  assert.equal(normalizeAnimation({ duration: 1.2 }).duration, 1);
  assert.equal(getFrameTimes(normalizeAnimation({ duration: 2 })).length, 60);
});
test('hasMotion is false for anchors only', () => assert.equal(hasMotion({ pins: [createPin({ x: 1, y: 1 })] }), false));
```

- [ ] **Step 2: Run to verify they fail** — `node --test tests/animation.test.mjs` → FAIL, module not found

- [ ] **Step 3: Implement `scripts/animation.js`** with the signatures above. Pin ids: `globalThis.crypto?.randomUUID?.()` with a counter fallback. `normalizeAnimation` drops pins without finite `x`/`y` and keyframes outside `[0,1)`.

- [ ] **Step 4: Run to verify they pass** — `node --test tests/animation.test.mjs` → PASS

- [ ] **Step 5: Commit** — `git add scripts/animation.js tests/animation.test.mjs && git commit -m "feat: add token animation keyframes and presets"`

### Task 3: Transparent WebM encoder and muxer

**Files:**
- Create: `scripts/webm-alpha.js`
- Test: `tests/webm-alpha.test.mjs`

**Interfaces:**
- Produces: `canEncodeAnimation(scope = globalThis) -> boolean` (`scope.isSecureContext && typeof scope.VideoEncoder === 'function' && typeof scope.VideoFrame === 'function'`); `muxAlphaWebm({ width, height, frames: { color: Uint8Array, alpha?: Uint8Array, key: boolean }[], frameMs, durationMs }) -> Uint8Array`; `encodeAlphaWebm({ frames: ImageData[], width, height, fps, durationMs, bitrate }, scope = globalThis) -> Promise<Blob>` (type `video/webm`).

- [ ] **Step 1: Write the failing tests**

```js
// The test file carries a ~20-line EBML reader (readVint + walk children) to inspect output.
test('muxed WebM declares VP9 with alpha and the exact loop duration', () => {
  // 3 frames, frameMs 1000/30, durationMs 100; assert DocType 'webm', CodecID 'V_VP9',
  // AlphaMode (0x53C0) === 1, Duration (0x4489) === 100, Cues present
});
test('every frame is a BlockGroup with its alpha in BlockAdditions', () => {
  // 3 BlockGroups; block timecodes 0, 33, 67; BlockAdditional bytes equal the alpha input;
  // ReferenceBlock only on frames with key=false; BlockDuration on the last frame === 33
});
test('encoding feeds colour as RGBX and alpha as I420 luma with one keyframe', async () => {
  // fake scope: isSecureContext true; VideoFrame records {format, data}; VideoEncoder records
  // encode(frame, {keyFrame}) and emits a chunk {type, timestamp, byteLength, copyTo}.
  // assert: colour frames format 'RGBX', alpha frames format 'I420' whose first width*height
  // bytes equal the input alpha channel and chroma bytes are all 128; keyFrame true only for frame 0;
  // configs have codec 'vp09.00.10.08' and colour bitrate === width*height*8; result.type === 'video/webm'
});
test('animation encoding needs a secure context with WebCodecs', () => {
  assert.equal(canEncodeAnimation({ isSecureContext: false, VideoEncoder: function () {}, VideoFrame: function () {} }), false);
  assert.equal(canEncodeAnimation({ isSecureContext: true }), false);
});
```

- [ ] **Step 2: Run to verify they fail** — `node --test tests/webm-alpha.test.mjs` → FAIL, module not found

- [ ] **Step 3: Implement `scripts/webm-alpha.js`**

Port `muxWebm`, `encodeStream` and the colour/alpha frame construction from the spike (`scratchpad/puppet/v3-encode.js`, copy kept at `C:\tmp\puppet-spike\puppet-v3.html`). Element IDs: EBML `1a45dfa3`, Segment `18538067`, Info `1549a966` (TimecodeScale `2ad7b1` = 1 000 000, Duration `4489` float64), Tracks `1654ae6b` > TrackEntry `ae` (TrackNumber `d7`, TrackUID `73c5`, TrackType `83`, CodecID `86`, MaxBlockAdditionID `55ee` = 1, Video `e0` > PixelWidth `b0`, PixelHeight `ba`, AlphaMode `53c0` = 1), Cluster `1f43b675` > Timecode `e7`, BlockGroup `a0` > Block `a1`, ReferenceBlock `fb`, BlockDuration `9b`, BlockAdditions `75a1` > BlockMore `a6` > BlockAddID `ee` = 1, BlockAdditional `a5`; Cues `1c53bb6b` > CuePoint `bb` > CueTime `b3`, CueTrackPositions `b7` > CueTrack `f7`, CueClusterPosition `f1`. Chunks are placed by `Math.round(chunk.timestamp / frameUs)`.

- [ ] **Step 4: Run to verify they pass** — `node --test tests/webm-alpha.test.mjs` → PASS

- [ ] **Step 5: Commit** — `git add scripts/webm-alpha.js tests/webm-alpha.test.mjs && git commit -m "feat: encode transparent WebM loops with WebCodecs"`

### Task 4: Bend the token art for a moment in the loop

**Files:**
- Create: `scripts/token-animation.js`
- Modify: `scripts/token-creator.js` (`drawCreatedToken`, around line 1422)
- Test: `tests/token-animation.test.mjs`

**Interfaces:**
- Consumes: Task 1 `buildWarpGrid`, `warpImageData`; Task 2 `samplePins`; `getTokenFrameLayout` from `token-composer.js`.
- Produces: `bendTokenArt({ cutout, popOutImage, view: { zoom, offsetX, offsetY }, size, animation, t, createCanvas }) -> { art: Canvas, popOut: Canvas | null }` — draws each source into a `size × size` canvas at the token layout (offsets are fractions of `size`, as in `app.view`), maps pins from source to token space with the same layout, and warps both with one grid. `drawCreatedToken(context, app, size, { preview = false, bent = null })`: when `bent` is given, draws `bent.art` / `bent.popOut` with `zoom: 1, offsetX: 0, offsetY: 0` instead of `app.cutout` / `getPopOutImage(app)`.

- [ ] **Step 1: Write the failing tests** (node-canvas `createCanvas`)

```js
test('art with pins that do not move matches the plain layout', () => {
  // 40x20 cut-out, view {zoom:1, offsetX:0, offsetY:0}, size 32, one anchor pin; compare
  // bent.art pixels with a canvas where the cut-out is drawn at getTokenFrameLayout(...) (max channel diff <= 2)
});
test('a moved pin bends the art and the pop-out image together', () => {
  // pin with keyframe t=0.5 dy=-6 (source px); at t=0.5 the opaque top row of art and popOut
  // both move up by 6 * layoutScale px (±1)
});
test('no pop-out image gives popOut null', () => { /* popOutImage null -> result.popOut === null */ });
```

- [ ] **Step 2: Run to verify they fail** — `node --test tests/token-animation.test.mjs` → FAIL

- [ ] **Step 3: Implement `bendTokenArt` in `scripts/token-animation.js` and the `bent` option in `drawCreatedToken`**

Pins map to token space as `layout.x + pin.x * scale`, where `scale = layout.width / cutout.width`; keyframe offsets are in source pixels and scale the same way.

- [ ] **Step 4: Run to verify they pass** — `node --test tests/*.mjs` → PASS (whole suite: `drawCreatedToken` is shared)

- [ ] **Step 5: Commit** — `git add scripts/token-animation.js tests/token-animation.test.mjs scripts/token-creator.js && git commit -m "feat: bend token art for animation frames"`

### Task 5: Pin tool, timeline and live preview

**Files:**
- Modify: `scripts/token-creator.js`, `scripts/creator-shortcuts.js`, `templates/token-creator.hbs`, `styles/pf2e-tokener.css`, `languages/en.json`
- Test: `tests/token-creator.test.mjs`

**Interfaces:**
- Consumes: Task 2 (`normalizeAnimation`, `createPin`, `setKeyframe`, `removeKeyframe`, `applyPreset`, `samplePinOffset`); Task 3 `canEncodeAnimation`; Task 4 `bendTokenArt`, `drawCreatedToken(..., { bent })`.
- Produces: app state `app.animation` (normalized), `app.animationTime` (0–1), `app.selectedPinId`, `app.animationPlaying`; mask tool `'pin'`; shortcut command `'tool-pin'` on **P**; exported `getAnimationSection(app)` like `getCreatorSection`.

Behaviour: in Token mode only, the pin tool adds a pin on click (source coords via `previewPointToImage`), selects it, drags it (dragging at the current time sets a keyframe offset; when the animation has no keyframes yet, dragging moves the rest position), right-click removes it. An **Animate** card (token-only, shown under Frame) holds play/pause, a scrub slider (0–100 % of the loop), a keyframe marker row for the selected pin, **Add keyframe** / **Remove keyframe** at the current time, presets **Bob**, **Sway**, **Breathe** (amplitude 3 % of the cut-out's long side, applied to the selected pin or to all pins with a non-zero distance from the anchors), loop length select (1–4 s, 0.5 s steps) and a hint "Keep moves small: parts can't reveal what is behind them." When `canEncodeAnimation()` is false the card's controls are disabled with the hint "Animated tokens need Foundry opened over https or localhost." While playing, `requestAnimationFrame` advances `animationTime` by `dt / duration` and the preview draws `bendTokenArt` at `PREVIEW_SIZE`; pins are drawn as dots (selected: gold ring, anchors: hollow). Loading a new token image clears `app.animation.pins`; switching the edit target to Portrait stops playback and hides pins.

- [ ] **Step 1: Write the failing tests**

```js
test('P selects the pin tool', () => assert.equal(getMaskShortcut({ key: 'p' }), 'tool-pin'));
test('a new token image clears pins but keeps the loop length', () => {
  // use the exported helper `resetAnimationForNewSource(animation)` -> { ...animation, pins: [] }
});
test('pin dots map from source to preview space with the current layout', () => {
  // exported pure helper `getPinPreviewPoints({ pins, layout, cutoutWidth, t })` -> [{ id, x, y, selected? }]
});
```

- [ ] **Step 2: Run to verify they fail** — `node --test tests/token-creator.test.mjs` → FAIL

- [ ] **Step 3: Implement** the shortcut entry `p: 'tool-pin'`, the exported helpers `resetAnimationForNewSource` and `getPinPreviewPoints` in `scripts/token-animation.js`, the creator state, listeners, template card and styles (reuse `.pf2e-tokener-creator-card`, segmented, slider and icon-button classes), and i18n keys under `PF2ETokener.Creator.Animate.*` (`Title`, `Play`, `Pause`, `AddKeyframe`, `RemoveKeyframe`, `Bob`, `Sway`, `Breathe`, `Length`, `Hint`, `Unavailable`, `PinTooltip`).

- [ ] **Step 4: Run to verify they pass** — `node --test tests/*.mjs` → PASS; `npx eslint scripts tests` → no issues

- [ ] **Step 5: Commit** — stage only the files listed above, `git commit -m "feat: add pin tool and animation timeline to the Token Creator"`

### Task 6: Save animated tokens

**Files:**
- Modify: `scripts/token-creator.js` (`createToken` ~2438, `uploadCanvas` ~2537), `scripts/token-composer.js` (`buildCreatedTokenCandidate`), `scripts/actions.js` (`buildTokenUpdate`)
- Test: `tests/token-creator.test.mjs`, `tests/pf2e-tokener.test.mjs`

**Interfaces:**
- Consumes: Task 2 `hasMotion`, `getFrameTimes`; Task 3 `encodeAlphaWebm`, `canEncodeAnimation`; Task 4 `bendTokenArt`.
- Produces: `buildCreatedTokenCandidate({ ..., animated = false })` — when `animated` and a ring is used, sets `candidate.ringFromToken = true` and omits `subjectSrc`; `buildTokenUpdate` with `candidate.ringFromToken` writes `'ring.enabled': true`, `'ring.subject.texture': ''`, `'ring.subject.scale'` = ring scale override ?? `candidate.subjectScale` ?? breakout scale ?? 1, and ring colours as for still ring tokens; `uploadBlob(blob, folder, fileName)` beside `uploadCanvas`; `getAnimatedSavePlan({ animation, canEncode }) -> 'still' | 'animated'`.

Behaviour: when `getAnimatedSavePlan` says `'animated'`, render every time from `getFrameTimes` at `outputSize` through `bendTokenArt` + `drawCreatedToken(..., { bent })` into ImageData, encode with `encodeAlphaWebm` (status line shows "Encoding animation… n/60"), upload as `buildCreatedTokenFileName(label, { now, extension: 'webm' })`. The portrait still saves from its own workspace exactly as today.

- [ ] **Step 1: Write the failing tests**

```js
test('anchors-only or unavailable encoding saves a still image', () => {
  assert.equal(getAnimatedSavePlan({ animation: { pins: [createPin({ x: 1, y: 1 })] }, canEncode: true }), 'still');
  assert.equal(getAnimatedSavePlan({ animation: animatedFixture, canEncode: false }), 'still');
  assert.equal(getAnimatedSavePlan({ animation: animatedFixture, canEncode: true }), 'animated');
});
test('animated ring tokens use the token video as the ring subject', () => {
  const candidate = buildCreatedTokenCandidate({ label: 'D', tokenSrc: 'd.webm', subjectSrc: 'd.webm', animated: true, breakoutScale: 1.25 });
  assert.equal(candidate.subjectSrc, undefined);
  assert.equal(candidate.ringFromToken, true);
  const update = buildTokenUpdate(candidate, { scale: 1 });
  assert.equal(update['ring.enabled'], true);
  assert.equal(update['ring.subject.texture'], '');
  assert.equal(update['ring.subject.scale'], 1.25);
  assert.equal(update['texture.scaleX'], 1.25);
});
```

- [ ] **Step 2: Run to verify they fail** — `node --test tests/*.mjs` → the two new tests FAIL

- [ ] **Step 3: Implement** the candidate flag, `buildTokenUpdate` branch, `uploadBlob`, `getAnimatedSavePlan` (exported from `scripts/token-animation.js`) and the animated branch in `createToken`.

- [ ] **Step 4: Run to verify they pass** — `node --test tests/*.mjs` → PASS

- [ ] **Step 5: Commit** — `git commit -m "feat: save animated tokens as transparent WebM loops"`

### Task 7: Play ring-subject videos in Foundry

**Files:**
- Create: `scripts/ring-video.js`
- Modify: `scripts/pf2e-tokener.js` (`ready` hook, ~line 177)
- Test: `tests/ring-video.test.mjs`

**Interfaces:**
- Produces: `playRingVideo(token, videoHelper = globalThis.game?.video) -> boolean` (true when it started a video); `registerRingVideoPlayback(hooks = globalThis.Hooks) -> void` (hooks `drawToken` and `refreshToken`).

- [ ] **Step 1: Write the failing tests**

```js
test('a paused ring-subject video is started muted', () => {
  // token: { document: { ring: { enabled: true } }, mesh: { texture: { baseTexture: { resource: { source: video } } } } }
  // video = { tagName: 'VIDEO', paused: true }; helper.play records (video, { volume: 0 }); returns true
});
test('playing videos, images and ring-less tokens are left alone', () => { /* paused false, tagName 'IMG', ring.enabled false -> helper.play not called */ });
test('playback is registered on drawToken and refreshToken', () => { /* fake hooks.on records both names */ });
```

- [ ] **Step 2: Run to verify they fail** — `node --test tests/ring-video.test.mjs` → FAIL

- [ ] **Step 3: Implement** and call `registerRingVideoPlayback()` in the `ready` hook next to `renderTokenHUD`.

- [ ] **Step 4: Run to verify they pass** — `node --test tests/*.mjs` → PASS

- [ ] **Step 5: Commit** — `git add scripts/ring-video.js tests/ring-video.test.mjs scripts/pf2e-tokener.js && git commit -m "fix: play animated ring subjects"`

### Task 8: Verify in Foundry and document

**Files:**
- Modify: `CHANGELOG.md` (Unreleased > Added), `README.md` (Token Creator section)

- [ ] **Step 1: Verify the encode** — in Foundry (localhost), animate a creature with a 3-pin **Bob**, save; run `ffprobe -v error -count_frames -show_entries stream=nb_read_frames:stream_tags=alpha_mode -show_entries format=duration <file>` → `nb_read_frames=60`, `alpha_mode=1`, `duration=2.000000`.
- [ ] **Step 2: Verify painted frame** — apply with Painted border + pop-out: loops smoothly, frame still, popped head moves with its shadow.
- [ ] **Step 3: Verify ring sizing (spec risk)** — apply the same art as still and as animated ring tokens with breakout room 25 %: the ring is the same size on the grid in both and the art lines up. If the animated one is off, fix the scale in `buildTokenUpdate`'s `ringFromToken` branch (Foundry's inferred-subject path applies `adjustScaleByFitMode` and, in grid fit mode, `subjectScaleAdjustment`) and add a test for the corrected values.
- [ ] **Step 4: Verify insecure fallback** — open the world via `http://<lan-ip>:30000`: the Animate card explains it needs https or localhost; saving still works as before.
- [ ] **Step 5: Document** — CHANGELOG entry ("Animated tokens: pin the art, keyframe or apply Bob/Sway/Breathe, save a transparent looping WebM; works with the dynamic ring; needs https or localhost") and a README paragraph; `npx prettier --check CHANGELOG.md README.md`.
- [ ] **Step 6: Commit** — `git commit -m "docs: animated tokens"`
