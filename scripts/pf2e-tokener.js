import { MODULE_ID } from './constants.js';
import { renderActorDirectoryTokenerEntry, renderActorSheetTokenerEntry } from './actor-entry.js';
import { registerCustomFolderSettings } from './custom-folders.js';
import { registerFavoriteSettings } from './favorites.js';
import { installApi } from './foundry-index.js';
import { registerPickerGridSizeSetting } from './grid-size.js';
import { renderTokenHud, updateOpenPanelsCanvasZoom } from './hud.js';
import { registerImageTagSettings } from './image-tags.js';
import { registerPermissionSettings } from './permissions.js';
import { registerTokenCreatorSettings } from './token-creator.js';

export { MODULE_ID } from './constants.js';
export {
  createActorTokenDocument,
  openTokenPickerForActor,
  renderActorDirectoryTokenerEntry,
  renderActorSheetTokenerEntry,
} from './actor-entry.js';
export {
  buildActorUpdate,
  buildActorRevertUpdate,
  buildPortraitUpdate,
  buildRevertSnapshot,
  buildTokenUpdate,
  buildTokenRevertUpdate,
  buildTokenScalePreviewUpdate,
  getApplyActions,
  getApplyActionsForCandidate,
  getApplyTargets,
  getCandidatePreviewSrc,
  getCandidatePreviewSources,
  getLastRevertData,
  getOriginalRevertData,
  getRevertHistoryEntries,
  hasRevertTargets,
  REVERT_FLAG_PATH,
  revertTokenerChangeToOriginal,
  revertTokenerChangeToSnapshot,
  revertLastTokenerChange,
} from './actions.js';
export {
  createDatasheetCandidates,
  createCustomFolderCandidates,
  createFolderCandidates,
  createMappedCandidates,
  dedupeCandidates,
  getCandidatesForTokenDocument,
  searchCandidates,
} from './candidates.js';
export {
  filterFavoriteCandidates,
  getFavoriteIds,
  isFavoriteCandidate,
  registerFavoriteSettings,
  toggleFavoriteCandidate,
} from './favorites.js';
export {
  DEFAULT_PICKER_GRID_SIZE,
  getPickerGridMinSize,
  getPickerGridSize,
  MAX_PICKER_GRID_SIZE,
  MIN_PICKER_GRID_SIZE,
  normalizePickerGridSize,
  preparePickerGridSizeView,
  registerPickerGridSizeSetting,
  setPickerGridSize,
} from './grid-size.js';
export {
  getCustomFolderSettingsApplicationClass,
  getCustomFolderSources,
  registerCustomFolderSettings,
  setCustomFolderImageTags,
} from './custom-folders.js';
export {
  applyImageTagOverrides,
  downloadImageTagJson,
  getImageTagOverridesApplicationClass,
  getImageTagOverrideExport,
  getImageTagOverridesExport,
  importImageTagOverrides,
  getImageTagOverrides,
  parseImageTagOverrideImport,
  registerImageTagSettings,
  setImageTagOverrides,
} from './image-tags.js';
export { ensureIndex, rebuildIndex, state } from './foundry-index.js';
export { renderTokenHud, updateOpenPanelsCanvasZoom } from './hud.js';
export {
  buildCandidateSearchQuery,
  getTokenPickerApplicationClass,
  getPickerCandidatePool,
  openTokenPicker,
  resolveApplicationV2Class,
  resolveHandlebarsApplicationMixin,
} from './picker-app.js';
export {
  canUseTokenHudDocument,
  canUseActorTokenerEntry,
  canUserUpdateDocument,
  registerPermissionSettings,
  shouldRestrictTokenerToSelectedToken,
} from './permissions.js';
export {
  canUseTokenCreator,
  normalizeTokenCreatorOptions,
  openTokenCreator,
  registerTokenCreatorSettings,
} from './token-creator.js';
export {
  buildCreatedTokenCandidate,
  buildCreatedTokenFileName,
  getCreatedTokenFolder,
  getTokenFrameLayout,
} from './token-composer.js';
export { getAlphaBounds, getBorderPalette, removeImageBackground } from './background-removal.js';
export { getCandidatePreviewTagGroups, getImagePreviewItems, openImagePreview } from './preview.js';
export {
  filterSourceOptionsByQuery,
  filterCandidatesBySources,
  getPanelSourceFilterOptions,
  getSourceFilterLabel,
  getSourceFilterOptions,
} from './sources.js';
export {
  clearTagFilterTerms,
  getTagGroupSearchState,
  getTagFilterOptions,
  getTagListCountLabel,
  isTagFilterTermActive,
  isTagOptionSearchMatch,
  toggleTagFilterTerm,
} from './tags.js';
export {
  getCanvasZoom,
  getDocumentActor,
  getPanelZoomData,
  localize,
  normalizeHudElement,
  pruneStaleDependentTokens,
  setTextTooltip,
} from './utils.js';
export {
  getCurrentSystemId,
  getCurrentSystemProfile,
  getSystemProfile,
  normalizeSystemPackKey,
} from './system-profile.js';

const ACTOR_SHEET_RENDER_HOOKS = [
  'renderActorSheet',
  'renderActorSheetPF2e',
  'renderCreatureSheetPF2e',
  'renderCharacterSheetPF2e',
  'renderNPCSheetPF2e',
  'renderSimpleNPCSheet',
  'renderHazardSheetPF2e',
  'renderLootSheetPF2e',
  'renderFamiliarSheetPF2e',
  'renderVehicleSheetPF2e',
  'renderPartySheetPF2e',
  'renderArmySheetPF2e',
];

function registerFoundryIntegration() {
  const hooks = globalThis.Hooks;
  if (!hooks || typeof hooks.once !== 'function') return;

  hooks.once('init', () => {
    registerFavoriteSettings();
    registerCustomFolderSettings();
    registerImageTagSettings();
    registerPickerGridSizeSetting();
    registerPermissionSettings();
    registerTokenCreatorSettings();
  });

  hooks.once('ready', () => {
    installApi();
    hooks.on('renderTokenHUD', renderTokenHud);
    for (const hook of ACTOR_SHEET_RENDER_HOOKS) {
      hooks.on(hook, renderActorSheetTokenerEntry);
    }
    hooks.on('renderActorDirectory', renderActorDirectoryTokenerEntry);
    hooks.on('canvasPan', updateOpenPanelsCanvasZoom);
  });
}

registerFoundryIntegration();
