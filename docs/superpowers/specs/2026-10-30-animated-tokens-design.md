# Animated tokens (puppet warp + keyframes) — design

## Intent

Let a GM turn a still token into a short looping animation inside the Token Creator: place pins on
the art, give some pins keyframed motion (a dragon's head bobbing, wings flapping, tail swaying),
preview it live, and save a transparent looping WebM that works as a plain token or with Foundry's
dynamic token ring. No generative AI: only existing pixels are bent.

## Proven by the spike (2026-10-30, `C:\tmp\puppet-spike`)

- Rigid moving-least-squares warp (Schaefer et al. 2006), mapped backwards (deformed pins → rest
  pins) on an 8 px grid with bilinear sampling and premultiplied alpha: ~7 ms per 600×448 frame,
  no tearing for small moves.
- Chrome's `MediaRecorder` drops frames and paces by wall clock (42 of 60 frames, a 0.6 s gap), so
  loops stutter. Not used.
- WebCodecs `VideoEncoder` cannot encode alpha ("Alpha encoding is not currently supported"), but
  encoding colour (RGBX) and alpha (I420 frame whose luma is the alpha channel, chroma 128) as two
  VP9 streams and muxing the alpha into WebM `BlockAdditions` (BlockAddID 1, track `AlphaMode` 1)
  plays with transparency in Chrome. Verified with ffmpeg: 60/60 frames, 33 ms apart, duration
  2.000 s, seamless loop seam. 60 frames encode in ~0.3 s.
- Foundry accepts `.webm` as `texture.src` but `ring.subject.texture` is images only
  (`FilePathField({categories: ["IMAGE"]})`). With the ring on and the subject left empty, Foundry
  uses the token video as the subject but never plays it (it swaps the mesh to the shared cached
  texture and only plays its own clone). Calling `game.video.play(video, {volume: 0})` on the
  mesh's video source makes it animate — confirmed by the user in Foundry.

## Goals

- Pins on the token art: click to add, drag to move, right-click to remove. Pins without keyframes
  are anchors that hold the art still around them.
- Keyframes per pin on a looping timeline: offset (dx, dy) at a time in the loop, smooth
  cosine-eased interpolation, wrapping from the last keyframe back to the first.
- Presets that fill keyframes for the selected pins in one click: **Bob** (up and down),
  **Sway** (side to side), **Breathe** (small scale about the pins' centre).
- Loop length 1–4 s (default 2 s) at 30 fps; live preview with play/pause and a scrub slider.
- Art is bent before clipping: the frame or ring stays still, the pop-out mask and its shadow bend
  with the art, breakout room still applies.
- Save as a transparent WebM loop (VP9 + alpha) in the created token folder; works for the painted
  frame and for the dynamic ring.
- Ring tokens animate in Foundry for everyone, without console commands.

## Non-goals

- Layered parts or revealing hidden areas behind moving parts (big moves will tear; the UI says to
  keep moves small).
- Animated portraits (actor images must be images); the portrait stays a still image.
- A MediaRecorder fallback (it stutters); no animation on insecure (`http://<ip>`) games.
- Audio, per-frame painting, onion skinning, multiple animations per token.

## Decisions

- **Pins live in source-image coordinates** so they survive moving and zooming the art; they are
  mapped to token space each frame with the current layout.
- **Warp in token space at output size**: draw the cut-out (and the pop-out image) into a
  token-sized art layer at the current layout, warp that layer, then draw the frame/ring with the
  warped layer at identity layout (zoom 1, offset 0). This keeps per-frame cost proportional to the
  token size, not the source image.
- **Encoder**: WebCodecs, codec `vp09.00.10.08`, colour bitrate `outputSize² × 8` bits/s (2 Mbps at
  512), alpha at a quarter of that, keyframe on frame 0 only, `latencyMode: 'quality'`. Odd sizes
  are padded to even.
- **Availability**: animation is offered only when `isSecureContext && 'VideoEncoder' in window`;
  otherwise the Animate section shows why (needs https or localhost).
- **Foundry data**: animated painted-frame tokens set `texture.src` to the WebM. Animated ring
  tokens set `texture.src` to the WebM, `ring.enabled: true`, `ring.subject.texture: ''` and
  `ring.subject.scale` / texture scale exactly as still breakout tokens do. Whether Foundry's
  inferred-subject sizing matches the explicit-subject sizing must be checked in Foundry (risk).
- **Playback shim**: on `drawToken` and `refreshToken`, if the token's ring is enabled and its mesh
  texture source is a paused `<video>`, play it muted and looping.
- **Shortcut**: **P** selects the pin tool.

## Constraints

- Foundry v13–v14, PF2e and other systems the module already supports.
- No new runtime dependencies; plain ES modules like the rest of the module; node:test tests.
- Another session currently has uncommitted work in `scripts/token-creator.js`
  (`compose-ai-ranking`); implementation starts after that lands or in a separate worktree.

## Left to the builder

- Exact timeline markup and styling (match the creator's cards, segmented toggles and icon
  buttons).
- Pin hit radius, colours of selected/anchor pins.
