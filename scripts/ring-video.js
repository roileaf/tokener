/** Start a paused ring-subject <video> on a ring-enabled token; returns true when it started one. */
export function playRingVideo(token, videoHelper = globalThis.game?.video) {
  if (!token?.document?.ring?.enabled) return false;
  const video = token.mesh?.texture?.baseTexture?.resource?.source;
  if (video?.tagName !== 'VIDEO' || !video.paused) return false;
  if (typeof videoHelper?.play !== 'function') return false;
  videoHelper.play(video, { volume: 0 });
  return true;
}

/**
 * Marks the created token folder as holding its own ring subjects. A token image there then counts
 * as a distinct ring subject, so Foundry sizes it like the explicit subjects still tokens use
 * instead of fitting it into the ring. Animated tokens rely on this: Foundry only accepts images as
 * `ring.subject.texture`, so their WebM is the token image with the subject left empty.
 */
export function registerCreatedTokenSubjectPath(
  folder,
  ringConfig = globalThis.CONFIG?.Token?.ring,
) {
  const prefix = String(folder ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (!prefix || !ringConfig) return false;
  ringConfig.subjectPaths ??= {};
  ringConfig.subjectPaths[`${prefix}/`] ??= `${prefix}/`;
  return true;
}

/** Keep animated ring-subject videos playing as tokens are drawn and refreshed. */
export function registerRingVideoPlayback(hooks = globalThis.Hooks) {
  if (typeof hooks?.on !== 'function') return;
  hooks.on('drawToken', (token) => playRingVideo(token));
  hooks.on('refreshToken', (token) => playRingVideo(token));
}
