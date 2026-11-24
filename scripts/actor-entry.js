import { REVERT_FLAG_PATH } from './actions.js';
import { canUseActorTokenerEntry } from './permissions.js';
import { openTokenPicker } from './picker-app.js';
import { canUseTokenCreator, openTokenCreator } from './token-creator.js';
import { localize, normalizeHudElement, pruneStaleDependentTokens } from './utils.js';

const ACTOR_SHEET_IMAGE_SELECTOR = [
  'img[data-edit="img"]',
  'img.profile-img',
  'img.actor-image',
  'img[data-action="editImage"]',
].join(',');
const ACTOR_SHEET_IMAGE_HOST_SELECTOR = [
  '.image-container',
  '.profile-img-container',
  '.portrait',
  '.avatar',
  '.sheet-profile',
  'figure',
].join(',');
const ACTOR_SHEET_BUTTON_CLASS = 'pf2e-tokener-actor-sheet-button';
const ACTOR_SHEET_CREATE_CLASS = 'pf2e-tokener-actor-sheet-create';
const ACTOR_SHEET_IMAGE_HOST_CLASS = 'pf2e-tokener-actor-sheet-image-host';
const ACTOR_DIRECTORY_ENTRY_SELECTOR = '[data-document-id],[data-entry-id],[data-actor-id]';

export function renderActorSheetTokenerEntry(app, html) {
  const root = normalizeHudElement(html);
  const actor = getSheetActor(app);
  if (!root || !canUseTokenerActor(actor)) return;
  installActorSheetTokenerButton(root, actor, app);
}

/**
 * What a sheet's Tokener buttons act on. A sheet opened from a token on the canvas (double-click)
 * gets that token, so the token itself can be updated as from the Token HUD; an unlinked token's
 * actor is its own copy, where updating "the actor" alone would change nothing on the scene. A
 * sheet opened from the Actors tab has no token and gets the actor's default token.
 */
export function getSheetTokenerDocument(app, actor) {
  const token = app?.token ?? app?.options?.token ?? actor?.token ?? null;
  return isTokenDocument(token) ? token : createActorTokenDocument(actor);
}

function isTokenDocument(document) {
  if (!document || typeof document.update !== 'function') return false;
  return (document.documentName ?? document.constructor?.documentName) === 'Token';
}

export function renderActorDirectoryTokenerEntry(_app, html) {
  const root = normalizeHudElement(html);
  if (!root || !globalThis.game?.user?.isGM || root.dataset.pf2eTokenerActorDirectoryBound) return;
  root.dataset.pf2eTokenerActorDirectoryBound = 'true';

  root.addEventListener?.('contextmenu', async (event) => {
    const image = event.target?.closest?.('img');
    const entry = image?.closest?.(ACTOR_DIRECTORY_ENTRY_SELECTOR);
    const actor = getDirectoryActor(entry);
    if (!actor || !canUseTokenerActor(actor)) return;

    event.preventDefault?.();
    event.stopPropagation?.();
    await openTokenPickerForActor(actor);
  });
}

export function openTokenPickerForActor(actor) {
  if (!canUseTokenerActor(actor)) return null;
  return openTokenPicker(createActorTokenDocument(actor));
}

export function createActorTokenDocument(actor) {
  const proxy = {
    actor,
    baseActor: actor,
    isTokenerActorProxy: true,
    get flags() {
      return actor?.flags;
    },
    get id() {
      return actor?.id;
    },
    get name() {
      return actor?.name;
    },
    get prototypeToken() {
      return getActorPrototypeToken(actor);
    },
    get texture() {
      return getActorPrototypeToken(actor)?.texture ?? {};
    },
    get ring() {
      return getActorPrototypeToken(actor)?.ring ?? {};
    },
    get randomImg() {
      return getActorPrototypeToken(actor)?.randomImg;
    },
    canUserModify(user, action) {
      return canActorUserModify(actor, user, action);
    },
    get(path) {
      return readActorPrototypePath(actor, path);
    },
    getFlag(moduleId, key) {
      return actor?.getFlag?.(moduleId, key) ?? actor?.flags?.[moduleId]?.[key] ?? null;
    },
    testUserPermission(user, level) {
      return actor?.testUserPermission?.(user, level) ?? Boolean(actor?.isOwner ?? user?.isGM);
    },
    async update(update) {
      const actorUpdate = {};
      for (const [key, value] of Object.entries(update ?? {})) {
        actorUpdate[key === REVERT_FLAG_PATH ? key : `prototypeToken.${key}`] = value;
      }
      pruneStaleDependentTokens(actor);
      return actor?.update?.(actorUpdate);
    },
  };
  return proxy;
}

function installActorSheetTokenerButton(root, actor, app = null) {
  const image = root.querySelector?.(ACTOR_SHEET_IMAGE_SELECTOR);
  const host = getActorSheetImageHost(image);
  if (!host || host.querySelector?.(`.${ACTOR_SHEET_BUTTON_CLASS}`)) return;

  // Read on click: the sheet can be handed a token after it first renders.
  const getDocument = () => getSheetTokenerDocument(app, actor);
  const button = createActorSheetTokenerButton(root, actor, getDocument);
  if (!button) return;

  host.classList?.add(ACTOR_SHEET_IMAGE_HOST_CLASS);
  host.append?.(button);
  // Straight to the Token Creator, without loading the art list first (slow on big libraries).
  if (canUseTokenCreator()) {
    const create = createActorSheetButton(root, {
      className: `${ACTOR_SHEET_BUTTON_CLASS} ${ACTOR_SHEET_CREATE_CLASS}`,
      tooltip: localize('HUD.ActorSheetCreateTooltip', 'Create token image'),
      icon: 'fa-wand-magic-sparkles',
      onClick: () => openTokenCreator(getDocument()),
    });
    if (create) host.append?.(create);
  }
}

function createActorSheetTokenerButton(root, actor, getDocument) {
  return createActorSheetButton(root, {
    className: ACTOR_SHEET_BUTTON_CLASS,
    tooltip: localize('HUD.ActorSheetButtonTooltip', 'Open Tokener'),
    icon: 'fa-images',
    onClick: () => {
      const document = getDocument();
      return document.isTokenerActorProxy
        ? openTokenPickerForActor(actor)
        : openTokenPicker(document);
    },
  });
}

function createActorSheetButton(root, { className, tooltip, icon, onClick }) {
  const document = root?.ownerDocument ?? globalThis.document;
  const button = document?.createElement?.('button');
  if (!button) return null;

  button.type = 'button';
  button.className = className;
  button.dataset.tooltip = tooltip;
  button.dataset.tooltipDirection = 'UP';
  button.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i>`;
  button.addEventListener?.('click', async (event) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    await onClick();
  });
  return button;
}

function getActorSheetImageHost(image) {
  if (!image) return null;
  const closestHost = image.closest?.(ACTOR_SHEET_IMAGE_HOST_SELECTOR);
  if (closestHost && closestHost !== image) return closestHost;
  return image.parentElement ?? null;
}

function getSheetActor(app) {
  return app?.actor ?? app?.object?.actor ?? app?.object ?? app?.document ?? null;
}

function getDirectoryActor(entry) {
  const id =
    entry?.dataset?.documentId ?? entry?.dataset?.entryId ?? entry?.dataset?.actorId ?? null;
  return id ? (globalThis.game?.actors?.get?.(id) ?? null) : null;
}

function canUseTokenerActor(actor) {
  return canUseActorTokenerEntry(actor);
}

function canActorUserModify(actor, user, action) {
  try {
    if (typeof actor?.canUserModify === 'function') return actor.canUserModify(user, action);
    if (typeof actor?.testUserPermission === 'function')
      return actor.testUserPermission(user, 'OWNER');
  } catch {
    return false;
  }
  return Boolean(actor?.isOwner ?? user?.isGM);
}

function getActorPrototypeToken(actor) {
  return actor?.prototypeToken ?? actor?._source?.prototypeToken ?? {};
}

function readActorPrototypePath(actor, path) {
  const prototypeToken = getActorPrototypeToken(actor);
  return (
    prototypeToken?.get?.(path) ??
    readPath(prototypeToken, path) ??
    readPath(actor?._source?.prototypeToken, path)
  );
}

function readPath(object, path) {
  if (!object) return undefined;
  return String(path)
    .split('.')
    .reduce((value, part) => value?.[part], object);
}
