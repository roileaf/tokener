/** Start a paused ring-subject <video> on a ring-enabled token; returns true when it started one. */
export function playRingVideo(token, videoHelper = globalThis.game?.video) {
  if (!token?.document?.ring?.enabled) return false;
  const video = token.mesh?.texture?.baseTexture?.resource?.source;
  if (video?.tagName !== 'VIDEO' || !video.paused) return false;
  if (typeof videoHelper?.play !== 'function') return false;
  videoHelper.play(video, { volume: 0 });
  return true;
}

/** Keep animated ring-subject videos playing as tokens are drawn and refreshed. */
export function registerRingVideoPlayback(hooks = globalThis.Hooks) {
  if (typeof hooks?.on !== 'function') return;
  hooks.on('drawToken', (token) => playRingVideo(token));
  hooks.on('refreshToken', (token) => playRingVideo(token));
}
