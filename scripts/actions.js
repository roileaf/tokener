import { MODULE_ID } from './constants.js';
import { getProjectFlagUpdate } from './creator-project.js';
import { getCurrentSystemProfile } from './system-profile.js';
import {
  getDocumentActor,
  isObject,
  localize,
  normalizePath,
  numberOr,
  pruneStaleDependentTokens,
} from './utils.js';

export const REVERT_FLAG_KEY = 'lastRevert';
export const REVERT_FLAG_PATH = `flags.${MODULE_ID}.${REVERT_FLAG_KEY}`;
export const BREAKOUT_FLAG_KEY = 'breakout';
export const BREAKOUT_FLAG_PATH = `flags.${MODULE_ID}.${BREAKOUT_FLAG_KEY}`;
const PF2E_AUTOSCALE_PATH = 'flags.pf2e.autoscale';

/**
 * Created tokens with breakout room draw their frame smaller inside the art, so the token is
 * enlarged by this factor on top of its normal scale to keep the frame at grid size.
 */
export function getBreakoutScale(candidate) {
  const scale = Number(candidate?.breakoutScale);
  return Number.isFinite(scale) && scale > 1 ? scale : 1;
}

/**
 * Breakout room recorded on the token by the Token Creator. It only counts while that art is
 * still shown, so reverting or replacing the art outside Tokener never leaves a stale record.
 */
export function readBreakoutState(documentLike, { current = true } = {}) {
  const state =
    readPath(documentLike?._source, BREAKOUT_FLAG_PATH) ??
    readPath(documentLike, BREAKOUT_FLAG_PATH);
  const scale = Number(state?.scale);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  if (current && normalizePath(readDocumentPath(documentLike, 'texture.src')).trim() !== state.src)
    return null;
  return { ...state, scale };
}

/** A token's scale without any breakout enlargement, i.e. what the creature normally uses. */
export function getBaseTokenScale(documentLike, scale) {
  const breakout = readBreakoutState(documentLike);
  return breakout ? scale / breakout.scale : scale;
}

export function getApplyActions() {
  return [
    {
      action: 'token',
      label: localize('Actions.Token', 'Token'),
      tooltip: localize('ActionTooltips.Token', 'Update only the selected token on this scene.'),
    },
    {
      action: 'actor',
      label: localize('Actions.Actor', 'Actor'),
      tooltip: localize('ActionTooltips.Actor', 'Update the actor portrait and default token art.'),
    },
    {
      action: 'portrait',
      label: localize('Actions.Portrait', 'Portrait'),
      tooltip: localize('ActionTooltips.Portrait', 'Update only the actor portrait.'),
    },
    {
      action: 'both',
      label: localize('Actions.Both', 'Both'),
      tooltip: localize(
        'ActionTooltips.Both',
        'Update the selected token and the actor default token art.',
      ),
    },
  ];
}

export function getApplyActionsForCandidate(candidate) {
  const hasTokenArt = hasImageSource(candidate?.tokenSrc);
  const hasPortraitArt = hasImageSource(candidate?.portraitSrc) || hasTokenArt;
  return getApplyActions().filter((option) => {
    switch (option.action) {
      case 'token':
      case 'actor':
      case 'both':
        return hasTokenArt;
      case 'portrait':
        return hasPortraitArt;
      default:
        return false;
    }
  });
}

export function getCandidatePreviewSrc(candidate) {
  return getCandidatePreviewSources(candidate)[0] ?? '';
}

export function getCandidatePreviewSources(candidate) {
  const sources = [
    getImageSource(candidate?.tokenSrc),
    getImageSource(candidate?.portraitSrc),
    getImageSource(candidate?.subjectSrc),
  ].filter(Boolean);
  return [...new Set(sources)];
}

export function getApplyTargets(action) {
  switch (action) {
    case 'token':
      return { token: true, actor: false, portrait: false };
    case 'actor':
      return { token: false, actor: true, portrait: false };
    case 'portrait':
      return { token: false, actor: false, portrait: true };
    case 'both':
      return { token: true, actor: true, portrait: false };
    default:
      return { token: false, actor: false, portrait: false };
  }
}

export function buildTokenUpdate(candidate, { scale, ringScale, profile, document } = {}) {
  const tokenSrc = getImageSource(candidate?.tokenSrc);
  if (!tokenSrc) throw new Error('Tokener candidate has no token image.');

  const systemProfile = resolveSystemProfile(profile);
  const scaleOverride = getScaleOverride(scale);
  const ringScaleOverride = getScaleOverride(ringScale);
  const baseScaleX = numberOr(candidate?.scaleX ?? candidate?.scale, 1);
  const baseScaleY = numberOr(candidate?.scaleY ?? candidate?.scale, baseScaleX);
  const breakout = getBreakoutScale(candidate);
  const scaleX = (scaleOverride ?? baseScaleX) * breakout;
  const scaleY = (scaleOverride ?? baseScaleY) * breakout;
  const update = {
    'texture.src': tokenSrc,
    'texture.scaleX': scaleX,
    'texture.scaleY': scaleY,
    randomImg: false,
    ...buildBreakoutUpdate(breakout, tokenSrc, document, systemProfile),
  };
  // Created tokens link to their Token Creator project so the creator can reopen it.
  const projectSrc = getImageSource(candidate?.projectSrc);
  if (projectSrc)
    Object.assign(update, getProjectFlagUpdate({ path: projectSrc, output: tokenSrc }));

  if (!supportsDynamicTokenRing(systemProfile)) return update;

  if (candidate?.subjectSrc) {
    update['ring.enabled'] = true;
    update['ring.subject.texture'] = candidate.subjectSrc;
    update['ring.subject.scale'] =
      ringScaleOverride ??
      numberOr(candidate.subjectScale, Math.max(Math.abs(scaleX), Math.abs(scaleY)));
    applyRingColors(update, candidate);
    applyRingEffects(update, candidate);
  } else if (candidate?.ringFromToken) {
    // Animated ring tokens: an empty subject makes Foundry use the token video as the subject.
    update['ring.enabled'] = true;
    update['ring.subject.texture'] = '';
    update['ring.subject.scale'] = ringScaleOverride ?? numberOr(candidate.subjectScale, breakout);
    applyRingColors(update, candidate);
    applyRingEffects(update, candidate);
  } else {
    update['ring.enabled'] = false;
  }

  return update;
}

function applyRingEffects(update, candidate) {
  if (Number.isFinite(candidate.ringEffects)) update['ring.effects'] = candidate.ringEffects;
}

function applyRingColors(update, candidate) {
  if (!isObject(candidate.ringColors)) return;
  update['ring.colors.ring'] = candidate.ringColors.ring ?? null;
  update['ring.colors.background'] = candidate.ringColors.background ?? null;
}

/**
 * PF2e's size-based autoscale rewrites the token scale every time it is prepared, which would
 * undo the breakout enlargement, so it is turned off while breakout art is applied and restored
 * when other art replaces it.
 */
function buildBreakoutUpdate(breakout, src, documentLike, profile) {
  const previous = readBreakoutState(documentLike, { current: false });
  const pf2e = profile?.id === 'pf2e';
  const update = {};
  if (breakout > 1) {
    const autoscale = previous
      ? previous.autoscale
      : (readPath(documentLike?._source, PF2E_AUTOSCALE_PATH) ?? null);
    update[BREAKOUT_FLAG_PATH] = { scale: breakout, src, autoscale: autoscale ?? null };
    if (pf2e) update[PF2E_AUTOSCALE_PATH] = false;
  } else if (previous) {
    update[BREAKOUT_FLAG_PATH] = null;
    if (pf2e && typeof previous.autoscale === 'boolean')
      update[PF2E_AUTOSCALE_PATH] = previous.autoscale;
  }
  return update;
}

export function buildActorUpdate(candidate, options = {}) {
  const profile = resolveSystemProfile(options.profile);
  const actorUpdate = {};
  if (profile.supportsPrototypeToken !== false) {
    for (const [key, value] of Object.entries(
      buildTokenUpdate(candidate, {
        ...options,
        profile,
        document: options.document ?? options.actor?.prototypeToken,
      }),
    )) {
      actorUpdate[`prototypeToken.${key}`] = value;
    }
  }
  if (profile.supportsActorPortrait !== false && candidate?.portraitSrc)
    actorUpdate.img = candidate.portraitSrc;
  return actorUpdate;
}

export function buildPortraitUpdate(candidate, actor, { profile } = {}) {
  const systemProfile = resolveSystemProfile(profile);
  if (systemProfile.supportsActorPortrait === false) return {};

  const update = {
    img: getImageSource(candidate?.portraitSrc || candidate?.tokenSrc),
  };
  if (systemProfile.supportsPrototypeToken !== false) {
    update['prototypeToken.texture.src'] = getImageSource(
      readDocumentPath(actor?.prototypeToken, 'texture.src'),
    );
  }
  return update;
}

export function buildTokenScalePreviewUpdate(
  candidate,
  scale,
  tokenDocument,
  { target = 'token', profile } = {},
) {
  const scaleOverride = getScaleOverride(scale);
  if (scaleOverride === null) return {};
  if (target === 'ring') {
    return supportsDynamicTokenRing(resolveSystemProfile(profile)) &&
      hasDynamicRingSubjectScaleTarget(candidate, tokenDocument)
      ? { 'ring.subject.scale': scaleOverride }
      : {};
  }
  return {
    'texture.scaleX': scaleOverride,
    'texture.scaleY': scaleOverride,
  };
}

function hasDynamicRingSubjectScaleTarget(candidate, tokenDocument) {
  return Boolean(
    candidate?.subjectSrc ||
    candidate?.ringFromToken ||
    readDocumentPath(tokenDocument, 'ring.subject.texture'),
  );
}

export function buildRevertSnapshot({ action, candidate, tokenDocument, profile } = {}) {
  const systemProfile = resolveSystemProfile(profile);
  const actor = getDocumentActor(tokenDocument);
  const targets = getApplyTargets(action);
  const actorUpdate =
    targets.actor && candidate ? buildActorUpdate(candidate, { profile: systemProfile }) : {};
  const changesPortrait =
    targets.portrait || Object.prototype.hasOwnProperty.call(actorUpdate, 'img');
  return {
    action,
    label: candidate?.label ?? '',
    time: Date.now(),
    token: targets.token ? captureTokenState(tokenDocument, systemProfile) : undefined,
    actor:
      targets.actor && actor && systemProfile.supportsPrototypeToken !== false
        ? captureTokenState(actor.prototypeToken, systemProfile)
        : undefined,
    portrait: changesPortrait && actor ? { img: actor.img ?? actor._source?.img ?? '' } : undefined,
  };
}

export function getLastRevertData(tokenDocument) {
  const actor = getDocumentActor(tokenDocument);
  const tokenSnapshot = getLatestRevertSnapshot(tokenDocument);
  const actorSnapshot = getLatestRevertSnapshot(actor);
  if (tokenSnapshot && actorSnapshot) {
    return numberOr(actorSnapshot.time, 0) > numberOr(tokenSnapshot.time, 0)
      ? actorSnapshot
      : tokenSnapshot;
  }
  return tokenSnapshot ?? actorSnapshot ?? null;
}

export function getOriginalRevertData(tokenDocument) {
  const entries = getRevertHistoryEntries(tokenDocument);
  return entries[entries.length - 1]?.snapshot ?? null;
}

export function getRevertHistory(documentLike) {
  return normalizeRevertHistory(readFlag(documentLike, REVERT_FLAG_KEY));
}

export function getRevertHistoryEntries(tokenDocument) {
  const actor = getDocumentActor(tokenDocument);
  const snapshots = [...getRevertHistory(tokenDocument), ...getRevertHistory(actor)].sort(
    (left, right) => numberOr(right?.time, 0) - numberOr(left?.time, 0),
  );
  const entries = [];
  for (const snapshot of snapshots) {
    if (!entries.some((entry) => isSameRevertSnapshot(entry.snapshot, snapshot))) {
      entries.push({ snapshot });
    }
  }
  return entries;
}

export function buildRevertHistoryFlagValue(documentLike, snapshot, { replaceSnapshot } = {}) {
  if (!hasRevertTargets(snapshot)) return getRevertHistoryFlagValue(documentLike);

  const history = getRevertHistory(documentLike);
  const replaceIndex = findSnapshotIndex(history, replaceSnapshot);
  if (replaceIndex === history.length - 1) {
    return [...history.slice(0, replaceIndex), snapshot];
  }
  return [...history, snapshot];
}

export function buildTokenRevertUpdate(snapshot, { profile } = {}) {
  if (!isObject(snapshot?.token)) return {};
  return tokenStateToUpdate(snapshot.token, resolveSystemProfile(profile));
}

export function buildActorRevertUpdate(snapshot, { actor, profile } = {}) {
  const systemProfile = resolveSystemProfile(profile);
  const update = {};
  if (isObject(snapshot?.actor) && systemProfile.supportsPrototypeToken !== false) {
    for (const [key, value] of Object.entries(tokenStateToUpdate(snapshot.actor, systemProfile))) {
      update[`prototypeToken.${key}`] = value;
    }
  }
  if (isObject(snapshot?.portrait) && systemProfile.supportsActorPortrait !== false) {
    update.img = snapshot.portrait.img ?? '';
    if (!isObject(snapshot?.actor) && systemProfile.supportsPrototypeToken !== false) {
      update['prototypeToken.texture.src'] = getImageSource(
        readDocumentPath(actor?.prototypeToken, 'texture.src'),
      );
    }
  }
  return update;
}

export function hasRevertTargets(snapshot) {
  return Boolean(
    isObject(snapshot?.token) || isObject(snapshot?.actor) || isObject(snapshot?.portrait),
  );
}

export async function revertLastTokenerChange(tokenDocument, { profile } = {}) {
  return revertTokenerChangeToSnapshot(tokenDocument, getLastRevertData(tokenDocument), {
    profile,
  });
}

export async function revertTokenerChangeToOriginal(tokenDocument, { profile } = {}) {
  return revertTokenerChangeToSnapshot(tokenDocument, getOriginalRevertData(tokenDocument), {
    profile,
  });
}

export async function revertTokenerChangeToSnapshot(tokenDocument, snapshot, { profile } = {}) {
  const systemProfile = resolveSystemProfile(profile);
  const actor = getDocumentActor(tokenDocument);
  if (!hasRevertTargets(snapshot)) return false;

  if (snapshot.token && tokenDocument?.update) {
    await tokenDocument.update({
      ...buildTokenRevertUpdate(snapshot, { profile: systemProfile }),
      [REVERT_FLAG_PATH]: truncateRevertHistoryFlagValue(tokenDocument, snapshot),
    });
  }

  if ((snapshot.actor || snapshot.portrait) && actor?.update) {
    pruneStaleDependentTokens(actor);
    await actor.update({
      ...buildActorRevertUpdate(snapshot, { actor, profile: systemProfile }),
      [REVERT_FLAG_PATH]: truncateRevertHistoryFlagValue(actor, snapshot),
    });
  }

  return true;
}

function getLatestRevertSnapshot(documentLike) {
  const history = getRevertHistory(documentLike);
  return history[history.length - 1] ?? null;
}

function getRevertHistoryFlagValue(documentLike) {
  const history = getRevertHistory(documentLike);
  return history.length ? history : null;
}

function truncateRevertHistoryFlagValue(documentLike, snapshot) {
  const history = getRevertHistory(documentLike);
  const snapshotIndex = findSnapshotIndex(history, snapshot);
  if (snapshotIndex < 0) return history.length ? history : null;

  const nextHistory = history.slice(0, snapshotIndex);
  return nextHistory.length ? nextHistory : null;
}

function normalizeRevertHistory(value) {
  if (Array.isArray(value)) return value.filter(hasRevertTargets);
  return hasRevertTargets(value) ? [value] : [];
}

function findSnapshotIndex(history, snapshot) {
  if (!hasRevertTargets(snapshot)) return -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (isSameRevertSnapshot(history[index], snapshot)) return index;
  }
  return -1;
}

function isSameRevertSnapshot(left, right) {
  if (left === right) return true;
  if (!hasRevertTargets(left) || !hasRevertTargets(right)) return false;
  return (
    String(left.action ?? '') === String(right.action ?? '') &&
    String(left.label ?? '') === String(right.label ?? '') &&
    numberOr(left.time, 0) === numberOr(right.time, 0) &&
    JSON.stringify(left.token ?? null) === JSON.stringify(right.token ?? null) &&
    JSON.stringify(left.actor ?? null) === JSON.stringify(right.actor ?? null) &&
    JSON.stringify(left.portrait ?? null) === JSON.stringify(right.portrait ?? null)
  );
}

function captureTokenState(documentLike, profile = resolveSystemProfile()) {
  const state = {
    texture: {
      src: normalizePath(readDocumentPath(documentLike, 'texture.src')).trim(),
      scaleX: numberOr(readDocumentPath(documentLike, 'texture.scaleX'), 1),
      scaleY: numberOr(readDocumentPath(documentLike, 'texture.scaleY'), 1),
    },
    randomImg: Boolean(readDocumentPath(documentLike, 'randomImg')),
  };
  if (profile?.id === 'pf2e') {
    const autoscale = readPath(documentLike?._source ?? documentLike, PF2E_AUTOSCALE_PATH);
    if (typeof autoscale === 'boolean') state.autoscale = autoscale;
  }
  if (supportsDynamicTokenRing(profile)) {
    state.ring = {
      enabled: Boolean(readDocumentPath(documentLike, 'ring.enabled')),
      effects: numberOr(readDocumentPath(documentLike, 'ring.effects'), 1),
      subject: {
        texture: normalizePath(readDocumentPath(documentLike, 'ring.subject.texture')).trim(),
        scale: numberOr(readDocumentPath(documentLike, 'ring.subject.scale'), 1),
      },
    };
    const ringColor = readDocumentPath(documentLike, 'ring.colors.ring');
    const backgroundColor = readDocumentPath(documentLike, 'ring.colors.background');
    if (ringColor !== undefined || backgroundColor !== undefined) {
      state.ring.colors = { ring: ringColor ?? null, background: backgroundColor ?? null };
    }
  }
  return state;
}

function tokenStateToUpdate(state, profile = resolveSystemProfile()) {
  const subjectTexture = normalizePath(state?.ring?.subject?.texture).trim();
  const update = {
    'texture.src': normalizePath(state?.texture?.src).trim(),
    'texture.scaleX': numberOr(state?.texture?.scaleX, 1),
    'texture.scaleY': numberOr(state?.texture?.scaleY, 1),
    randomImg: Boolean(state?.randomImg),
  };
  if (profile?.id === 'pf2e' && typeof state?.autoscale === 'boolean')
    update[PF2E_AUTOSCALE_PATH] = state.autoscale;
  if (supportsDynamicTokenRing(profile)) {
    update['ring.enabled'] = Boolean(state?.ring?.enabled);
    update['ring.subject.texture'] = subjectTexture;
    update['ring.subject.scale'] = numberOr(state?.ring?.subject?.scale, 1);
    if (Number.isFinite(state?.ring?.effects)) update['ring.effects'] = state.ring.effects;
    if (isObject(state?.ring?.colors)) {
      update['ring.colors.ring'] = state.ring.colors.ring ?? null;
      update['ring.colors.background'] = state.ring.colors.background ?? null;
    }
  }
  return update;
}

function readDocumentPath(documentLike, path) {
  if (!documentLike) return undefined;
  return readPath(documentLike, path) ?? readPath(documentLike._source, path);
}

function readFlag(documentLike, key) {
  return (
    documentLike?.getFlag?.(MODULE_ID, key) ??
    documentLike?.flags?.[MODULE_ID]?.[key] ??
    documentLike?._source?.flags?.[MODULE_ID]?.[key] ??
    null
  );
}

function readPath(object, path) {
  if (!object) return undefined;
  return String(path)
    .split('.')
    .reduce((value, part) => value?.[part], object);
}

function getImageSource(source) {
  return normalizePath(source).trim();
}

function hasImageSource(source) {
  return Boolean(getImageSource(source));
}

function getScaleOverride(value) {
  const scale = Number(value);
  return Number.isFinite(scale) && scale > 0 ? scale : null;
}

function resolveSystemProfile(profile = getCurrentSystemProfile()) {
  return profile ?? getCurrentSystemProfile();
}

function supportsDynamicTokenRing(profile) {
  return profile?.supportsDynamicTokenRing !== false;
}
