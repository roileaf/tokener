import {
  getLastRevertData,
  getRevertHistoryEntries,
  hasRevertTargets,
  revertLastTokenerChange,
  revertTokenerChangeToOriginal,
} from './actions.js';
import { buildArtToggleUpdate, isShowingTopDown } from './art-views.js';
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
  root.querySelectorAll?.('.pf2e-tokener-button').forEach((element) => element.remove());
  if (!tokenDocument || !isTokenHudButtonEnabled() || !canUseTokener(tokenDocument)) return;

  const target = root.querySelector('.col.right') ?? root.querySelector('.right') ?? root;
  const button = document.createElement('div');
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
  const toggle = createArtToggleButton(tokenDocument);
  if (toggle) target.append(toggle);
}

/** Switches between a token's regular and top-down looks; shown only on tokens that have both. */
function createArtToggleButton(tokenDocument) {
  const showingTopDown = isShowingTopDown(tokenDocument);
  if (showingTopDown === null) return null;
  const button = document.createElement('div');
  button.className = 'control-icon pf2e-tokener-button pf2e-tokener-view-toggle';
  button.classList.toggle('active', showingTopDown);
  button.dataset.action = 'pf2e-tokener-view';
  button.dataset.tooltip = showingTopDown
    ? localize('HUD.ShowRegular', 'Show the regular token')
    : localize('HUD.ShowTopDown', 'Show the top-down token');
  button.innerHTML = `<i class="fas ${showingTopDown ? 'fa-person' : 'fa-circle-down'}"></i>`;
  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await toggleArtViews(tokenDocument, !showingTopDown);
  });
  return button;
}

/** Switches this token, and every other controlled token with both looks, to one look. */
async function toggleArtViews(tokenDocument, toTopDown) {
  const controlled = (globalThis.canvas?.tokens?.controlled ?? []).map((token) => token.document);
  const tokens = [...new Set([tokenDocument, ...controlled])].filter(
    (token) =>
      token?.isOwner !== false && canUseTokener(token) && isShowingTopDown(token) === !toTopDown,
  );
  try {
    await Promise.all(tokens.map((token) => token.update(buildArtToggleUpdate(token))));
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
