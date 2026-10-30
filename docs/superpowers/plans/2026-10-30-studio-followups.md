# Studio follow-ups Implementation Plan (flip, faster Tokener, animated portraits)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Flip the token or portrait image horizontally/vertically in the Token Creator; (2) make the Tokener picker window open faster; (3) let portraits be animated (Foundry actor images must be images, so portraits are saved as animated WebP).

**Architecture:** Flip mirrors a workspace's pixel data and everything stored in its source-pixel space in one pure step, so every downstream path stays correct untouched. The picker renders immediately with a loading state, the art index warms in the background after the world loads, and the index is cached in IndexedDB keyed by a signature of the installed modules and folder settings. Animated portraits reuse the animation renderer with the portrait layout and mux per-frame still WebP blobs into an animated WebP container (RIFF/VP8X/ANIM/ANMF) — no new dependencies.

**Tech Stack:** Plain ES modules, Canvas 2D, IndexedDB, Foundry v13–v14, node:test + `canvas` dev dependency.

**Spec:** this document (design decisions below are binding) plus `docs/superpowers/specs/2026-10-30-animation-studio-v2-design.md` for the animation model.

## Design decisions

- **Flip.** Buttons **Flip horizontal** / **Flip vertical** in the Image card, acting on the workspace being edited (Token or Portrait; when the portrait shares the token's image, flipping in Portrait mode first separates nothing — it flips the shared source, so both flip; say so in the tooltip). A flip mirrors: the source canvas, `autoCutout`, `cutout`, touch-up `keep`/`remove`, and for the token workspace also `popOutMask`, every `effectRegions` canvas, and pins (`x → w − x` or `y → h − y`, keyframe `dx → −dx` / `dy → −dy`, `rot → −rot`). Flipping twice restores the original exactly. The view offset is mirrored too (`offsetX → −offsetX` for horizontal, `offsetY → −offsetY` for vertical) so the framing stays visually equivalent. Undo history entries for the flipped workspace are mirrored or cleared (clearing is acceptable). Projects store `flip: { x: boolean, y: boolean }` per workspace (`token.flip`, `portrait.flip`); load applies the flips after loading the unflipped source by path, before masks/regions (which are saved already flipped — so on load, flip only the freshly loaded source/cut-out, then restore saved masks/regions/pins as-is).
- **Faster Tokener.**
  - Measure: `console.info('pf2e-tokener | art index built in <ms> ms (<n> candidates, <m> modules)')` after each index build.
  - Instant open: `preparePickerContext` must not await a cold index build; when the index is not ready it renders a loading state (`HUD.IndexLoading`, "Finding token art…") and re-renders the main part when the build completes.
  - Warm-up: after `ready`, schedule `ensureIndex()` in the background (via `requestIdleCallback` with a 3 s timeout, else `setTimeout(…, 3000)`), only for users who can use Tokener (GM or player-owned access enabled).
  - Persistent cache: IndexedDB database `pf2e-tokener`, store `index`, one record `{ signature, savedAt, candidates }`. Signature = system id + sorted active module `id@version` + the custom folder setting value + the image tag override setting value + Tokener's version. On start, a matching cached index is used immediately and no rescan happens; a mismatch triggers a rebuild that overwrites the cache. A **Rescan** button in the picker forces a rebuild. Any IndexedDB failure falls back silently to the in-memory build. Candidates must be plain JSON (verify; strip functions/DOM refs if any).
- **Animated portraits.** Portrait card gains **Animate portrait** (checkbox, only shown when animation is available and the token animation has active motion). When checked and the portrait shares the token's image (same source), the portrait is rendered for every animation frame with the portrait layout (`drawPortrait` geometry, no frame/ring; pins/effects apply because they live in source space) at the portrait output size capped to 512 px on the long side, 15 fps, and saved as an animated WebP (`<stem>-portrait.webp`) built by `encodeAnimatedWebp(frames, { width, height, fps, quality: 0.85 })`: each frame → `canvas.toBlob('image/webp', quality)` → extract its `VP8 `/`VP8L` (+ `ALPH`) chunks → wrap in `ANMF` (offset 0,0, duration `round(1000 / fps)`, blending off, disposal none) inside `RIFF WEBP` with `VP8X` (animation + alpha flags, canvas size) and `ANIM` (transparent background, loop 0). A separate portrait image (not shared) can't be animated (checkbox disabled with a tooltip). Projects store the checkbox in options. If WebP encoding isn't available (`canvas.toBlob('image/webp')` returns PNG), fall back to the still portrait with a status note.

## Global Constraints

- Foundry v13–v14; no new runtime dependencies; node:test `.mjs` tests (`node --test tests/*.mjs`, currently 366) and `npx jest --runInBand tests/compose-ai-ranking.test.js` stay green; lint `./node_modules/.bin/eslint scripts tests`; `npx prettier --write` touched files.
- Never stage files you did not change. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Flip with pins, effects regions and pop-out mask present: after a flip the art, pins and regions stay aligned; flipping twice restores everything exactly. → Task 1 test.
- A cached index from an older module set: signature mismatch → rebuild, never stale results. → Task 2 test.
- The picker opened before the index is ready: shows loading, then fills in without user action. → Task 2 test.
- Animated portrait with a separate portrait image: never attempted; still portrait saved. → Task 3 test.
- Browsers where `toBlob('image/webp')` yields PNG: still portrait, no broken file. → Task 3 test.

---

### Task 1: Flip image

**Files:** Create `scripts/image-flip.js`; Modify `scripts/token-creator.js`, `scripts/creator-project.js`, `templates/token-creator.hbs`, `languages/en.json`, `styles/pf2e-tokener.css`; Test `tests/image-flip.test.mjs`, `tests/creator-project.test.mjs`

**Interfaces:** `flipCanvas(canvas, axis, createCanvas) -> canvas` (axis `'x' | 'y'`, returns a new mirrored canvas; null in → null out); `flipPins(pins, axis, { width, height }) -> pins`; `flipView(view, axis) -> view`; project workspace `flip: { x, y }` (serialize + parse, default `{ x: false, y: false }`).

- [ ] Failing tests: canvas mirrored pixel-exact and double flip identity; pins/keyframes/rot mirrored and double flip identity; view offsets mirrored; project round-trip keeps `flip`; loading a flipped project yields the same cut-out pixels as before saving (fake loader).
- [ ] Implement helpers, creator buttons + `flipWorkspace(app, axis)` (mirrors everything listed in the design, resets caches `clearEffectCaches()` / `app._previewBend = null`, clears that workspace's undo history), project save/load.
- [ ] Full suite + lint; commit `feat: flip the token or portrait image`.

### Task 2: Faster Tokener opening

**Files:** Modify `scripts/foundry-index.js`, `scripts/picker-app.js`, `scripts/pf2e-tokener.js`, `templates/picker.hbs`, `languages/en.json`; Create `scripts/index-cache.js`; Test `tests/pf2e-tokener.test.mjs` (or a new `tests/index-cache.test.mjs`)

**Interfaces:** `getIndexSignature({ systemId, modules, customFolders, imageTags, version }) -> string`; `readIndexCache(signature, idb = globalThis.indexedDB) -> Promise<candidates | null>`; `writeIndexCache(signature, candidates, idb) -> Promise<void>`; `isIndexReady() -> boolean`; `warmIndexInBackground({ schedule }) -> void`; foundry-index `rebuildIndex({ force })` uses the cache unless forced.

- [ ] Failing tests: signature changes when a module version / custom folders change and is order-independent; cache hit returns candidates without browsing (fake FilePicker counts zero browse calls); mismatch rebuilds and overwrites; IndexedDB unavailable → falls back without throwing; picker context when the index isn't ready renders loading and requests a re-render on completion; timing log emitted once per build.
- [ ] Implement (fake IndexedDB in tests via a tiny in-memory shim).
- [ ] Full suite + lint; commit `perf: open Tokener instantly and cache the art index`.

### Task 3: Animated portraits

**Files:** Create `scripts/webp-anim.js`; Modify `scripts/token-creator.js`, `scripts/creator-project.js` (options only via normalize), `templates/token-creator.hbs`, `languages/en.json`, CHANGELOG/README; Test `tests/webp-anim.test.mjs`, `tests/token-creator.test.mjs`

**Interfaces:** `extractWebpFrameChunks(bytes: Uint8Array) -> { width, height, chunks: Uint8Array[], hasAlpha }` (accepts simple VP8/VP8L and extended VP8X+ALPH+VP8 still WebPs); `muxAnimatedWebp({ width, height, frames: { chunks, hasAlpha }[], durationMs }) -> Uint8Array`; `encodeAnimatedWebp(canvases, { fps, quality }, scope) -> Promise<Blob | null>` (null when the browser can't encode WebP); option `animatePortrait` (default false) in `normalizeTokenCreatorOptions`; `getPortraitAnimationPlan({ options, sharedSource, hasActiveMotion, canEncodeWebp }) -> 'animated' | 'still'`.

- [ ] Failing tests: chunk extraction from hand-built simple VP8L and extended (VP8X+ALPH+VP8) WebP byte fixtures; muxed file parses back (RIFF size correct, VP8X animation+alpha flags, canvas size, ANIM loop 0, N ANMF chunks with the right duration, frame payload bytes preserved, even-length chunk padding); plan returns 'still' for a separate portrait, no motion, or no WebP support; option defaults false.
- [ ] Implement muxer + creator wiring (portrait frames via the renderer with portrait layout, 512 px cap, 15 fps; upload `<stem>-portrait.webp`; fallback note).
- [ ] Full suite + lint; docs (CHANGELOG Unreleased/Added + README); commit `feat: animated portraits as animated WebP`.
