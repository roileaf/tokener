import {
  getLastRevertData,
  getRevertHistoryEntries,
  hasRevertTargets,
  revertLastTokenerChange,
  revertTokenerChangeToOriginal,
} from './actions.js';
import {
  ART_VIEWS_FLAG_PATH,
  buildFlipFacingUpdate,
  buildLookUpdate,
  buildSetFacingUpdate,
  getShownLook,
  listLooks,
} from './art-views.js';
import { getDefaultTopDownFacing } from './top-down.js';
import { canUseTokenHudDocument, isTokenHudButtonEnabled } from './permissions.js';
import {
  openRevertHistoryDialog,
  openTokenPicker,
  updateOpenPanelsCanvasZoom,
} from './picker-app.js';
import { localize, normalizeHudElement } from './utils.js';

export { updateOpenPanelsCanvasZoom } from './picker-app.js';

export function renderTokenHud(app, html) {
  const root = normalizeHudElement(html);
  const tokenDocument = getHudTokenDocument(app);
  if (!root) return;
  root
    .querySelectorAll?.('.pf2e-tokener-button, .pf2e-tokener-look-control')
    .forEach((element) => element.remove());
  if (!tokenDocument || !isTokenHudButtonEnabled() || !canUseTokener(tokenDocument)) return;

  const target = root.querySelector('.col.right') ?? root.querySelector('.right') ?? root;
  // A button like Foundry's own HUD controls, so its styles size and centre the icon.
  const button = createHudButton();
  setHudButtonRevertState(button, tokenDocument);
  button.dataset.action = 'pf2e-tokener';
  button.innerHTML = '<i class="fas fa-images"></i>';
  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await openTokenPicker(tokenDocument);
  });
  button.addEventListener('contextmenu', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await revertFromHudButton(button, tokenDocument, { resetToOriginal: event.shiftKey });
  });
  target.append(button);
  const looks = createLookPickerButton(tokenDocument);
  if (looks) target.append(looks);
}

/**
 * The token's looks (regular, top-down, stances), shown only on tokens that have more than one.
 * A click opens a strip of thumbnails beside the HUD; picking one switches the token, and every
 * other selected token that has that look, to it.
 */
function createLookPickerButton(tokenDocument) {
  if (listLooks(tokenDocument).length < 2) return null;
  // The strip sits next to the button, not inside it (no buttons inside a button).
  const control = document.createElement('div');
  control.className = 'pf2e-tokener-look-control';
  const button = createHudButton();
  button.className = 'control-icon pf2e-tokener-button pf2e-tokener-look-button';
  button.dataset.action = 'pf2e-tokener-looks';
  button.dataset.tooltip = localize('HUD.Looks', 'Token looks');
  button.innerHTML = '<i class="fas fa-person-rays"></i>';
  syncLookButton(button, tokenDocument);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const open = control.querySelector('.pf2e-tokener-look-palette');
    if (open) open.remove();
    else control.append(createLookPalette(button, tokenDocument));
  });
  control.append(button);
  return control;
}

function createHudButton() {
  const button = document.createElement('button');
  button.type = 'button';
  return button;
}

/** Lit while the token shows anything but its regular look. */
function syncLookButton(button, tokenDocument) {
  button.classList.toggle('active', getShownLook(tokenDocument) !== 'regular');
}

function createLookPalette(button, tokenDocument) {
  const palette = document.createElement('div');
  palette.className = 'pf2e-tokener-look-palette';
  const shown = getShownLook(tokenDocument);
  for (const { id, art } of listLooks(tokenDocument)) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'pf2e-tokener-look';
    item.classList.toggle('is-active', id === shown);
    item.dataset.look = id;
    const name = localize(`HUD.Look.${id}`, id);
    item.dataset.tooltip =
      id === 'regular'
        ? name
        : `${name} — ${localize('HUD.LookFlipHint', 'right-click if it walks backwards')}`;
    item.setAttribute('aria-label', item.dataset.tooltip);
    const media = /\.(webm|mp4)$/i.test(art.src)
      ? Object.assign(document.createElement('video'), { muted: true, autoplay: true, loop: true })
      : document.createElement('img');
    media.src = art.src;
    media.alt = '';
    item.append(media);
    item.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      palette.remove();
      await switchLook(tokenDocument, id);
      syncLookButton(button, tokenDocument);
    });
    // A look made facing the other way than recorded walks backwards: turn it around.
    item.addEventListener('contextmenu', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (id === 'regular') return;
      palette.remove();
      await flipLookFacing(tokenDocument, id);
    });
    palette.append(item);
  }
  return palette;
}

/** Turns look `id` around on this token and every other controlled token that has it. */
async function flipLookFacing(tokenDocument, id) {
  const controlled = (globalThis.canvas?.tokens?.controlled ?? []).map((token) => token.document);
  const updates = [...new Set([tokenDocument, ...controlled])]
    .filter((token) => token?.isOwner !== false && canUseTokener(token))
    .map((token) => [token, buildFlipFacingUpdate(token, id, getDefaultTopDownFacing(token))])
    .filter(([, update]) => update);
  try {
    await Promise.all(updates.map(([token, update]) => token.update(update)));
  } catch (error) {
    console.error('pf2e-tokener | Failed to turn the token look around', error);
  }
  // The actor's default token gets the same facing, so tokens placed later face the right way.
  const actors = new Map();
  for (const [token, update] of updates) {
    const actor = token.actor;
    const look = update[ART_VIEWS_FLAG_PATH]?.[id];
    if (actor?.isOwner && actor.prototypeToken && look?.facing) actors.set(actor, look);
  }
  for (const [actor, look] of actors) {
    const update = buildSetFacingUpdate(actor.prototypeToken, id, look.facing, {
      src: look.src,
      prefix: 'prototypeToken.',
    });
    if (update) await actor.update(update).catch((error) => console.error(error));
  }
}

/** Switches this token, and every other controlled token that has look `id`, to it. */
async function switchLook(tokenDocument, id) {
  const controlled = (globalThis.canvas?.tokens?.controlled ?? []).map((token) => token.document);
  const updates = [...new Set([tokenDocument, ...controlled])]
    .filter((token) => token?.isOwner !== false && canUseTokener(token))
    .map((token) => [token, buildLookUpdate(token, id)])
    .filter(([, update]) => update);
  try {
    await Promise.all(updates.map(([token, update]) => token.update(update)));
  } catch (error) {
    console.error('pf2e-tokener | Failed to switch the token look', error);
    globalThis.ui?.notifications?.error?.(
      localize('Notifications.ViewToggleFailed', 'Tokener: failed to switch the token look.'),
    );
  }
}

function setHudButtonRevertState(button, tokenDocument) {
  const hasRevert = hasRevertTargets(getLastRevertData(tokenDocument));
  button.className = `control-icon pf2e-tokener-button${hasRevert ? ' is-overridden' : ''}`;
  button.dataset.tooltip = hasRevert
    ? localize('HUD.RevertButtonTooltip', 'Tokener - right-click to revert last change.')
    : localize('HUD.Tooltip', 'Tokener');
}

async function revertFromHudButton(button, tokenDocument, { resetToOriginal = false } = {}) {
  const entries = getRevertHistoryEntries(tokenDocument);
  if (!entries.length) return;

  if (entries.length > 1 && !resetToOriginal) {
    await openRevertHistoryDialog(tokenDocument, {
      onReverted: () => setHudButtonRevertState(button, tokenDocument),
    });
    return;
  }

  try {
    const reverted = resetToOriginal
      ? await revertTokenerChangeToOriginal(tokenDocument)
      : await revertLastTokenerChange(tokenDocument);
    if (!reverted) return;
    setHudButtonRevertState(button, tokenDocument);
    globalThis.ui?.notifications?.info?.(
      localize('Notifications.Reverted', 'Tokener: previous art restored.'),
    );
  } catch (error) {
    console.error('pf2e-tokener | Failed to revert token art from HUD button', error);
    globalThis.ui?.notifications?.error?.(
      localize('Notifications.RevertFailed', 'Tokener: failed to restore previous art.'),
    );
  }
}

function getHudTokenDocument(app) {
  return app?.object?.document ?? app?.document ?? app?.object ?? null;
}

function canUseTokener(tokenDocument) {
  return canUseTokenHudDocument(tokenDocument);
}
