import {
  MODULE_ID,
  PLAYER_OWNED_TOKENER_SETTING_KEY,
  TOKEN_HUD_BUTTON_SETTING_KEY,
} from './constants.js';
import { localize } from './utils.js';

export function registerPermissionSettings(settings = globalThis.game?.settings) {
  settings?.register?.(MODULE_ID, PLAYER_OWNED_TOKENER_SETTING_KEY, {
    name: localize('Settings.PlayerOwned.Name', 'Allow player-owned token access'),
    hint: localize(
      'Settings.PlayerOwned.Hint',
      'Let players open Tokener from Token HUD for tokens they can update. Actor sheet and actor directory controls remain GM-only.',
    ),
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
  });
  settings?.register?.(MODULE_ID, TOKEN_HUD_BUTTON_SETTING_KEY, {
    name: localize('Settings.TokenHudButton.Name', 'Show Token HUD button'),
    hint: localize(
      'Settings.TokenHudButton.Hint',
      'Show the Tokener button on the Token HUD. Turn it off to keep the HUD tidy; Tokener stays available from the actor sheet and actor directory.',
    ),
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
  });
}

export function isTokenHudButtonEnabled(settings = globalThis.game?.settings) {
  try {
    return settings?.get?.(MODULE_ID, TOKEN_HUD_BUTTON_SETTING_KEY) !== false;
  } catch {
    return true;
  }
}

export function canUseTokenHudDocument(tokenDocument, settings = globalThis.game?.settings) {
  const user = globalThis.game?.user;
  if (!user || !tokenDocument) return false;
  if (user.isGM) return canUserUpdateDocument(tokenDocument, user);
  return isPlayerOwnedTokenerAllowed(settings) && canUserUpdateDocument(tokenDocument, user);
}

export function canUseActorTokenerEntry(actor) {
  const user = globalThis.game?.user;
  return Boolean(user?.isGM && actor);
}

export function shouldRestrictTokenerToSelectedToken() {
  return Boolean(globalThis.game?.user && !globalThis.game.user.isGM);
}

export function canUserUpdateDocument(document, user = globalThis.game?.user) {
  if (!document || !user) return false;
  try {
    if (typeof document.canUserModify === 'function') return document.canUserModify(user, 'update');
    if (typeof document.testUserPermission === 'function')
      return document.testUserPermission(user, 'OWNER');
  } catch {
    return false;
  }
  return Boolean(document.isOwner ?? user.isGM);
}

function isPlayerOwnedTokenerAllowed(settings = globalThis.game?.settings) {
  try {
    return Boolean(settings?.get?.(MODULE_ID, PLAYER_OWNED_TOKENER_SETTING_KEY));
  } catch {
    return false;
  }
}
