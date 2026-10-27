import { DEFAULT_LIMIT, MODULE_ID } from './constants.js';
import {
  buildActorUpdate,
  buildPortraitUpdate,
  buildRevertHistoryFlagValue,
  buildRevertSnapshot,
  buildTokenScalePreviewUpdate,
  buildTokenUpdate,
  getApplyActionsForCandidate,
  getApplyTargets,
  getBaseTokenScale,
  getCandidatePreviewSrc,
  getCandidatePreviewSources,
  getLastRevertData,
  getRevertHistoryEntries,
  hasRevertTargets,
  REVERT_FLAG_PATH,
  revertTokenerChangeToOriginal,
  revertTokenerChangeToSnapshot,
  revertLastTokenerChange,
} from './actions.js';
import { getCandidatesForTokenDocument, searchCandidates } from './candidates.js';
import {
  filterFavoriteCandidates,
  getFavoriteIds,
  isFavoriteCandidate,
  toggleFavoriteCandidate,
} from './favorites.js';
import { ensureIndex } from './foundry-index.js';
import {
  getPickerGridMinSize,
  getPickerGridSize,
  normalizePickerGridSize,
  preparePickerGridSizeView,
  setPickerGridSize,
} from './grid-size.js';
import {
  downloadImageTagJson,
  getImageTagOverrideExport,
  parseImageTagOverrideImport,
  setImageTagOverrides,
} from './image-tags.js';
import { shouldRestrictTokenerToSelectedToken } from './permissions.js';
import { openImagePreview } from './preview.js';
import {
  filterCandidatesBySources,
  filterSourceOptionsByQuery,
  getPanelSourceFilterOptions,
  getSourceFilterLabel,
} from './sources.js';
import { getTagFilterOptions, getTagGroupSearchState, isTagOptionSearchMatch } from './tags.js';
import { canUseTokenCreator, openTokenCreator } from './token-creator.js';
import {
  getDocumentActor,
  labelFromPath,
  localize,
  normalizeLabel,
  normalizeHudElement,
  normalizePath,
  normalizeSearchText,
  pruneStaleDependentTokens,
} from './utils.js';

const PICKER_TEMPLATE = 'modules/pf2e-tokener/templates/picker.hbs';
const SCALE_MIN = 0.25;
const SCALE_MAX = 3;
const SCALE_STEP = 0.05;
const SCALE_TARGET_TOKEN = 'token';
const SCALE_TARGET_RING = 'ring';

let activePicker = null;
let TokenPickerApplicationBase = null;
let TokenPickerApplicationClass = null;
let TokenPickerApplicationMixin = null;

export function updateOpenPanelsCanvasZoom() {}

export function openTokenPicker(tokenDocument) {
  const ApplicationV2 = resolveApplicationV2Class();
  const HandlebarsApplicationMixin = resolveHandlebarsApplicationMixin();
  if (!ApplicationV2 || !HandlebarsApplicationMixin) return openFallbackPicker();

  if (activePicker?.rendered) {
    activePicker.tokenDocument = tokenDocument;
    activePicker.bringToFront?.();
    activePicker.render?.({ parts: ['main'] });
    return activePicker;
  }

  const PickerApplication = getTokenPickerApplicationClass(
    ApplicationV2,
    HandlebarsApplicationMixin,
  );
  activePicker = new PickerApplication({ tokenDocument });
  return activePicker.render(true);
}

export function resolveApplicationV2Class() {
  return (
    globalThis.foundry?.applications?.api?.ApplicationV2 ??
    globalThis.foundry?.applications?.ApplicationV2 ??
    null
  );
}

export function resolveHandlebarsApplicationMixin() {
  return (
    globalThis.foundry?.applications?.api?.HandlebarsApplicationMixin ??
    globalThis.foundry?.applications?.HandlebarsApplicationMixin ??
    null
  );
}

export function getTokenPickerApplicationClass(
  ApplicationV2 = resolveApplicationV2Class(),
  HandlebarsApplicationMixin = resolveHandlebarsApplicationMixin(),
) {
  if (!ApplicationV2 || !HandlebarsApplicationMixin) return null;
  if (
    TokenPickerApplicationClass &&
    TokenPickerApplicationBase === ApplicationV2 &&
    TokenPickerApplicationMixin === HandlebarsApplicationMixin
  )
    return TokenPickerApplicationClass;

  const HandlebarsApplication = HandlebarsApplicationMixin(ApplicationV2);

  TokenPickerApplicationClass = class Pf2eTokenerApplication extends HandlebarsApplication {
    static DEFAULT_OPTIONS = {
      id: 'pf2e-tokener-picker',
      classes: ['pf2e-tokener-app'],
      tag: 'section',
      window: {
        icon: 'fas fa-images',
        resizable: true,
        title: 'Tokener',
      },
      position: {
        width: 720,
      },
    };

    static PARTS = {
      main: {
        template: PICKER_TEMPLATE,
      },
    };

    constructor({ tokenDocument } = {}) {
      super();
      this.tokenDocument = tokenDocument;
      this.searchQuery = '';
      this.selectedSourceIds = null;
      this.sourceMenuOpen = false;
      this.sourceFilterQuery = '';
      this.tagMenuOpen = false;
      this.activeTagGroup = null;
      this.tagFilterQuery = '';
      this.selectedTagIds = new Set();
      this.selectedExcludedTagIds = new Set();
      this.favoritesOnly = false;
      this.gridSize = getPickerGridSize();
      this.resultLimit = DEFAULT_LIMIT;
      this._candidateMap = new Map();
      this._pendingScalePreview = null;
      this._scalePreviewScheduled = false;
      this._scalePreviewSnapshots = new Map();
      this._tagMap = new Map();
    }

    get title() {
      return localize('HUD.Tooltip', 'Tokener');
    }

    async _prepareContext(options) {
      const context = (await super._prepareContext?.(options)) ?? {};
      return {
        ...context,
        ...(await preparePickerContext(this)),
      };
    }

    async _onRender(context, options) {
      await super._onRender?.(context, options);
      activatePickerListeners(this);
    }

    _attachPartListeners(partId, html, options) {
      super._attachPartListeners?.(partId, html, options);
      if (partId === 'main') activatePickerListeners(this, html);
    }

    async _onClose(options) {
      if (activePicker === this) activePicker = null;
      await super._onClose?.(options);
    }
  };

  TokenPickerApplicationBase = ApplicationV2;
  TokenPickerApplicationMixin = HandlebarsApplicationMixin;
  return TokenPickerApplicationClass;
}

async function preparePickerContext(app) {
  const index = await ensureIndex();
  const sourceOptions = getPanelSourceFilterOptions(index);
  syncSelectedSources(app, sourceOptions);

  const sourceScopedCandidates = filterCandidatesBySources(index, app.selectedSourceIds, {
    emptyMeansAll: false,
  });
  const tagOptions = getTagFilterOptions(sourceScopedCandidates);
  syncSelectedTags(app, tagOptions);
  const favoriteIds = getFavoriteIds();
  const candidatePool = getPickerCandidatePool(index, app, { favoriteIds, sourceOptions });
  const sections = prepareCandidateSections(candidatePool.candidates, app, favoriteIds);

  return {
    count: candidatePool.countLabel,
    emptyMessage: localize('HUD.NoTokenArt', 'No token art found.'),
    hasResults: candidatePool.candidates.length > 0,
    paging: preparePagingView(candidatePool),
    searchPlaceholder: localize('HUD.SearchPlaceholder', 'Search tokens'),
    searchQuery: app.searchQuery,
    sections,
    favorites: prepareFavoritesView(favoriteIds, app),
    gridSize: preparePickerGridSizeView(app.gridSize),
    revert: prepareRevertView(app.tokenDocument),
    creator: prepareCreatorView(),
    source: prepareSourceFilterView(sourceOptions, app),
    tags: prepareTagFilterView(tagOptions, app),
  };
}

export function getPickerCandidatePool(
  index,
  app,
  { favoriteIds = new Set(), sourceOptions = getPanelSourceFilterOptions(index) } = {},
) {
  const resultLimit = Math.max(DEFAULT_LIMIT, Number(app?.resultLimit) || DEFAULT_LIMIT);
  const selectedSourceIds =
    app?.selectedSourceIds ?? new Set(sourceOptions.map((option) => option.id));
  const selectedTagIds = app?.selectedTagIds ?? new Set();
  const excludedTagIds = app?.selectedExcludedTagIds ?? app?.excludedTagIds ?? new Set();
  const query = buildCandidateSearchQuery(app?.searchQuery, selectedTagIds, excludedTagIds);
  let browseMode = shouldBrowseAllResults(app, sourceOptions);
  let allCandidates = browseMode
    ? searchCandidates(index, query, { limit: Number.POSITIVE_INFINITY })
    : getCandidatesForTokenDocument(index, app?.tokenDocument, query, {
        limit: Number.POSITIVE_INFINITY,
      });
  if (!browseMode && !query && index.length && !allCandidates.length) {
    browseMode = true;
    allCandidates = searchCandidates(index, '', { limit: Number.POSITIVE_INFINITY });
  }
  const sourceFilteredCandidates = filterCandidatesBySources(allCandidates, selectedSourceIds, {
    emptyMeansAll: false,
  });
  const filteredCandidates = filterFavoriteCandidates(
    sourceFilteredCandidates,
    favoriteIds,
    Boolean(app?.favoritesOnly),
  );
  const candidates = filteredCandidates.slice(0, resultLimit);

  return {
    browseMode,
    candidates,
    countLabel:
      candidates.length < filteredCandidates.length
        ? `${candidates.length} / ${filteredCandidates.length}`
        : String(filteredCandidates.length),
    hasMore: candidates.length < filteredCandidates.length,
    limit: resultLimit,
    shown: candidates.length,
    total: filteredCandidates.length,
  };
}

function shouldBrowseAllResults(app, sourceOptions) {
  const hasSearch = Boolean(String(app?.searchQuery ?? '').trim());
  if (hasSearch) return false;
  return (
    isSourceFilterChanged(app?.selectedSourceIds, sourceOptions) ||
    collectionSize(app?.selectedTagIds) > 0 ||
    collectionSize(app?.selectedExcludedTagIds ?? app?.excludedTagIds) > 0 ||
    Boolean(app?.favoritesOnly)
  );
}

function isSourceFilterChanged(selectedSourceIds, sourceOptions) {
  if (!selectedSourceIds) return false;
  const selected = new Set(selectedSourceIds);
  if (selected.size !== sourceOptions.length) return true;
  return sourceOptions.some((option) => !selected.has(option.id));
}

function collectionSize(collection) {
  return collection?.size ?? collection?.length ?? 0;
}

function activatePickerListeners(app, html) {
  const root =
    normalizeHudElement(html) ??
    normalizeHudElement(app.parts?.main) ??
    normalizeHudElement(app.element);
  if (!root) return;
  if (!isPickerRootBound(root)) {
    markPickerRootBound(root);
    root.addEventListener?.('input', (event) => handlePickerInput(app, event));
    root.addEventListener?.('click', (event) => void handlePickerClick(app, event));
    root.addEventListener?.('contextmenu', (event) => handlePickerContextMenu(app, event));
    root.addEventListener?.('keydown', (event) => handlePickerKeyDown(event));
    root.addEventListener?.('error', (event) => handlePickerImageError(app, event), true);
  }

  restorePickerFocus(app, root);
  restorePickerScroll(app, root);
}

function isPickerRootBound(root) {
  return Boolean(root.dataset?.pf2eTokenerBound || root._pf2eTokenerBound);
}

function markPickerRootBound(root) {
  if (root.dataset) root.dataset.pf2eTokenerBound = 'true';
  else root._pf2eTokenerBound = true;
}

function handlePickerInput(app, event) {
  const target = event.target;
  if (matchesTarget(target, '.pf2e-tokener-scale-slider')) {
    handleScaleSliderInput(app, target);
    return;
  }

  if (matchesTarget(target, '.pf2e-tokener-grid-size-slider')) {
    handlePickerGridSizeInput(app, target);
    return;
  }

  if (matchesTarget(target, '.pf2e-tokener-search')) {
    app.searchQuery = target.value;
    resetResultLimit(app);
    app._focusSearch = true;
    renderMainPart(app);
    return;
  }

  if (matchesTarget(target, '.pf2e-tokener-source-search')) {
    app.sourceFilterQuery = target.value;
    app._focusSourceSearch = true;
    renderMainPart(app);
    return;
  }

  if (matchesTarget(target, '.pf2e-tokener-tag-search')) {
    app.tagFilterQuery = target.value;
    app._focusTagSearch = true;
    renderMainPart(app);
  }
}

async function handlePickerClick(app, event) {
  const target = event.target;
  const scaleReset = closestTarget(target, '[data-scale-reset]');
  if (scaleReset) {
    event.preventDefault?.();
    event.stopPropagation?.();
    handleScaleResetClick(app, scaleReset);
    return;
  }

  if (closestTarget(target, '.pf2e-tokener-scale-control')) {
    event.stopPropagation?.();
    return;
  }

  if (closestTarget(target, '[data-revert-action="last"]')) {
    event.preventDefault?.();
    await handleRevertControlClick(app);
    return;
  }

  if (closestTarget(target, '[data-picker-action="create-token"]')) {
    event.preventDefault?.();
    openTokenCreator(app.tokenDocument, {
      onApplied: () => renderMainPart(app, { preserveScroll: true }),
    });
    return;
  }

  if (closestTarget(target, '[data-favorites-filter="toggle"]')) {
    event.preventDefault?.();
    event.stopPropagation?.();
    app.favoritesOnly = !app.favoritesOnly;
    resetResultLimit(app);
    renderMainPart(app);
    return;
  }

  const favoriteButton = closestTarget(target, '[data-favorite-candidate-id]');
  if (favoriteButton) {
    event.preventDefault?.();
    event.stopPropagation?.();
    const candidate = app._candidateMap.get(favoriteButton.dataset.favoriteCandidateId);
    if (candidate) await toggleFavoriteCandidate(candidate);
    renderMainPart(app);
    return;
  }

  const customImageTagsButton = closestTarget(target, '[data-custom-image-tags-candidate-id]');
  if (customImageTagsButton) {
    event.preventDefault?.();
    event.stopPropagation?.();
    const candidate = app._candidateMap.get(
      customImageTagsButton.dataset.customImageTagsCandidateId,
    );
    if (candidate) await openCustomImageTagsDialog(app, candidate);
    return;
  }

  const applyButton = closestTarget(target, '[data-apply-action]');
  if (applyButton) {
    event.preventDefault?.();
    event.stopPropagation?.();
    const card = closestTarget(applyButton, '.pf2e-tokener-card');
    const candidate = app._candidateMap.get(card?.dataset?.candidateId);
    if (candidate)
      await applyCandidateAction(
        applyButton.dataset.applyAction,
        candidate,
        app.tokenDocument,
        card,
        app,
      );
    return;
  }

  if (closestTarget(target, '[data-results-action="more"]')) {
    event.preventDefault?.();
    app.resultLimit = (Number(app.resultLimit) || DEFAULT_LIMIT) + DEFAULT_LIMIT;
    renderMainPart(app);
    return;
  }

  if (closestTarget(target, '.pf2e-tokener-source-button')) {
    event.preventDefault?.();
    event.stopPropagation?.();
    app.sourceMenuOpen = !app.sourceMenuOpen;
    app.tagMenuOpen = false;
    renderMainPart(app);
    return;
  }

  const sourceAction = closestTarget(target, '[data-source-action]');
  if (sourceAction) {
    event.preventDefault?.();
    if (sourceAction.dataset.sourceAction === 'all') {
      app.selectedSourceIds.clear();
      for (const option of app.sourceOptions ?? []) app.selectedSourceIds.add(option.id);
    } else if (sourceAction.dataset.sourceAction === 'clear') {
      app.selectedSourceIds.clear();
    }
    resetResultLimit(app);
    renderMainPart(app);
    return;
  }

  const sourceOption = closestTarget(target, '.pf2e-tokener-source-option[data-source-id]');
  if (sourceOption) {
    event.preventDefault?.();
    const sourceId = sourceOption.dataset.sourceId;
    if (app.selectedSourceIds.has(sourceId)) app.selectedSourceIds.delete(sourceId);
    else app.selectedSourceIds.add(sourceId);
    resetResultLimit(app);
    renderMainPart(app);
    return;
  }

  if (closestTarget(target, '.pf2e-tokener-tag-filter-button')) {
    event.preventDefault?.();
    event.stopPropagation?.();
    app.tagMenuOpen = !app.tagMenuOpen;
    app.sourceMenuOpen = false;
    renderMainPart(app);
    return;
  }

  if (closestTarget(target, '[data-tag-action="clear"]')) {
    event.preventDefault?.();
    app.selectedTagIds.clear();
    app.selectedExcludedTagIds.clear();
    app.tagFilterQuery = '';
    resetResultLimit(app);
    renderMainPart(app, { preserveScroll: true });
    return;
  }

  const tagExcludeButton = closestTarget(target, '[data-tag-exclude-id]');
  if (tagExcludeButton) {
    event.preventDefault?.();
    const tag = app._tagMap.get(tagExcludeButton.dataset.tagExcludeId);
    if (!tag) return;
    toggleExcludedTag(app, tag.id);
    resetResultLimit(app);
    renderMainPart(app, { preserveScroll: true });
    return;
  }

  const tagButton = closestTarget(target, '[data-tag-id]');
  if (tagButton) {
    event.preventDefault?.();
    const tag = app._tagMap.get(tagButton.dataset.tagId);
    if (!tag) return;
    toggleIncludedTag(app, tag.id);
    resetResultLimit(app);
    renderMainPart(app, { preserveScroll: true });
    return;
  }

  const card = closestTarget(target, '.pf2e-tokener-card');
  if (card) toggleCardActions(card);
}

function handlePickerContextMenu(app, event) {
  if (closestTarget(event.target, '[data-revert-action="last"]')) {
    event.preventDefault?.();
    event.stopPropagation?.();
    void handleRevertControlContextMenu(app);
    return;
  }

  const card = closestTarget(event.target, '.pf2e-tokener-card');
  if (!card) return;

  event.preventDefault?.();
  event.stopPropagation?.();
  const candidate = app._candidateMap.get(card.dataset?.candidateId);
  if (candidate) openImagePreview(candidate);
}

function handlePickerKeyDown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const card = matchesTarget(event.target, '.pf2e-tokener-card') ? event.target : null;
  if (!card) return;

  event.preventDefault?.();
  toggleCardActions(card);
}

function handlePickerImageError(app, event) {
  const image = matchesTarget(event.target, '.pf2e-tokener-card img') ? event.target : null;
  if (!image) return;

  const card = closestTarget(image, '.pf2e-tokener-card');
  const candidate = app._candidateMap.get(card?.dataset?.candidateId);
  if (!card || !candidate) return;

  const failedSources = getFailedPreviewSources(image);
  failedSources.add(normalizePath(image.dataset.previewSrc || image.getAttribute?.('src')).trim());
  const availableCandidate = removeFailedCandidateSources(candidate, failedSources);
  app._candidateMap.set(card.dataset.candidateId, availableCandidate);
  syncCardActions(card, availableCandidate);

  const nextPreviewSrc = getCandidatePreviewSources(availableCandidate)[0];
  image.dataset.failedSources = [...failedSources].join('\n');
  if (nextPreviewSrc) {
    image.dataset.previewSrc = nextPreviewSrc;
    image.src = nextPreviewSrc;
    return;
  }

  image.remove?.();
  card.classList.add('has-no-preview', 'is-unavailable');
}

function getFailedPreviewSources(image) {
  return new Set(
    String(image.dataset.failedSources ?? '')
      .split('\n')
      .filter(Boolean),
  );
}

function removeFailedCandidateSources(candidate, failedSources) {
  const availableCandidate = {
    ...candidate,
    portraitSrc: failedSources.has(normalizePath(candidate?.portraitSrc).trim())
      ? ''
      : candidate?.portraitSrc,
    subjectSrc: failedSources.has(normalizePath(candidate?.subjectSrc).trim())
      ? ''
      : candidate?.subjectSrc,
    tokenSrc: failedSources.has(normalizePath(candidate?.tokenSrc).trim())
      ? ''
      : candidate?.tokenSrc,
  };
  return {
    ...availableCandidate,
    imageTagPath:
      getCandidatePreviewSources(availableCandidate)[0] ?? availableCandidate.imageTagPath,
  };
}

function syncCardActions(card, candidate) {
  const availableActions = new Set(
    getApplyActionsForCandidate(candidate).map((option) => option.action),
  );
  card.querySelectorAll?.('[data-apply-action]').forEach((button) => {
    if (!availableActions.has(button.dataset.applyAction)) button.remove?.();
  });

  if (availableActions.size === 0) {
    card.querySelector?.('.pf2e-tokener-actions')?.remove?.();
    card.classList.add('is-unavailable');
  }
}

function restorePickerFocus(app, root) {
  if (app._focusSearch) {
    app._focusSearch = false;
    const search = root.querySelector('.pf2e-tokener-search');
    search?.focus?.();
    search?.setSelectionRange?.(search.value.length, search.value.length);
  }

  if (app._focusSourceSearch) {
    app._focusSourceSearch = false;
    const search = root.querySelector('.pf2e-tokener-source-search');
    search?.focus?.();
    search?.setSelectionRange?.(search.value.length, search.value.length);
  }

  if (app._focusTagSearch) {
    app._focusTagSearch = false;
    const search = root.querySelector('.pf2e-tokener-tag-search');
    search?.focus?.();
    search?.setSelectionRange?.(search.value.length, search.value.length);
  }
}

function capturePickerScroll(app) {
  const root =
    normalizeHudElement(app?.parts?.main) ??
    normalizeHudElement(app?.element) ??
    normalizeHudElement(app);
  const content = root?.querySelector?.('.pf2e-tokener-content');
  const tagGroups = root?.querySelector?.('.pf2e-tokener-tag-groups');
  if (!content && !tagGroups) return null;
  return {
    contentLeft: content?.scrollLeft ?? 0,
    contentTop: content?.scrollTop ?? 0,
    tagGroupsLeft: tagGroups?.scrollLeft ?? 0,
    tagGroupsTop: tagGroups?.scrollTop ?? 0,
  };
}

function restorePickerScroll(app, root) {
  const scroll = app?._restoreScroll;
  if (!scroll) return;
  app._restoreScroll = null;

  const content = root?.querySelector?.('.pf2e-tokener-content');
  const tagGroups = root?.querySelector?.('.pf2e-tokener-tag-groups');
  if (!content && !tagGroups) return;

  const applyScroll = () => {
    if (content) {
      content.scrollLeft = scroll.contentLeft ?? 0;
      content.scrollTop = scroll.contentTop ?? 0;
    }
    if (tagGroups) {
      tagGroups.scrollLeft = scroll.tagGroupsLeft ?? 0;
      tagGroups.scrollTop = scroll.tagGroupsTop ?? 0;
    }
  };
  applyScroll();
  (globalThis.requestAnimationFrame ?? globalThis.setTimeout)?.(applyScroll, 0);
}

function handleScaleSliderInput(app, input) {
  const card = closestTarget(input, '.pf2e-tokener-card');
  const candidate = app?._candidateMap?.get(card?.dataset?.candidateId);
  if (!card || !candidate) return;

  const target = getScaleTarget(input);
  const scale = readCardScaleValue(card, candidate, target, app.tokenDocument);
  updateCardScaleValue(card, target, scale);
  ensureScalePreviewSnapshot(app, card, candidate);
  scheduleScalePreviewUpdate(app, candidate, scale, card.dataset.candidateId, target);
}

function handleScaleResetClick(app, button) {
  const card = closestTarget(button, '.pf2e-tokener-card');
  const candidate = app?._candidateMap?.get(card?.dataset?.candidateId);
  if (!card || !candidate) return;

  const dataScaleReset = button?.dataset?.scaleReset;
  const target = dataScaleReset === SCALE_TARGET_RING ? SCALE_TARGET_RING : SCALE_TARGET_TOKEN;
  const scale = readCardScaleDefaultValue(card, candidate, target, app.tokenDocument);
  updateCardScaleValue(card, target, scale);
  ensureScalePreviewSnapshot(app, card, candidate);
  scheduleScalePreviewUpdate(app, candidate, scale, card.dataset.candidateId, target);
}

function readCardScaleValue(card, candidate, target = SCALE_TARGET_TOKEN, tokenDocument) {
  const input = getScaleInput(card, target);
  return Number(
    formatScaleValue(
      input?.value ??
        input?.dataset?.scaleDefault ??
        getDefaultScaleValue(candidate, target, tokenDocument),
    ),
  );
}

function readCardScaleDefaultValue(card, candidate, target, tokenDocument) {
  const input = getScaleInput(card, target);
  return Number(
    formatScaleValue(
      input?.dataset?.scaleDefault ?? getDefaultScaleValue(candidate, target, tokenDocument),
    ),
  );
}

function getScaleInput(card, target) {
  return card?.querySelector?.(`.pf2e-tokener-scale-slider[data-scale-target="${target}"]`);
}

function getScaleTarget(input) {
  return input?.dataset?.scaleTarget === SCALE_TARGET_RING ? SCALE_TARGET_RING : SCALE_TARGET_TOKEN;
}

function getDefaultScaleValue(candidate, target, tokenDocument) {
  return target === SCALE_TARGET_RING
    ? getCandidateDynamicRingScale(candidate, tokenDocument)
    : getCandidateLinkedScale(candidate, tokenDocument);
}

function updateCardScaleValue(card, target, scale) {
  const value = formatScaleValue(scale);
  const input = getScaleInput(card, target);
  if (input) input.value = value;
  const display = card?.querySelector?.(`[data-scale-value="${target}"]`);
  if (display) display.textContent = `${value}x`;
}

function handlePickerGridSizeInput(app, input) {
  const size = normalizePickerGridSize(input?.value);
  app.gridSize = size;
  if (input) input.value = String(size);
  const root =
    input?.closest?.('.pf2e-tokener-panel') ??
    normalizeHudElement(app?.parts?.main) ??
    normalizeHudElement(app?.element);
  applyPickerGridSize(root, size);
  const value = root?.querySelector?.('[data-grid-size-value]');
  if (value) value.textContent = `${size}px`;
  void setPickerGridSize(size);
}

function applyPickerGridSize(root, size) {
  if (!root?.style) return;
  root.style.setProperty('--pf2e-tokener-art-size', `${size}px`);
  root.style.setProperty('--pf2e-tokener-grid-min-size', `${getPickerGridMinSize(size)}px`);
}

function ensureScalePreviewSnapshot(app, card, candidate) {
  const candidateId = card?.dataset?.candidateId;
  if (!app || !candidateId) return;
  if (!app._scalePreviewSnapshots) app._scalePreviewSnapshots = new Map();
  if (app._scalePreviewSnapshots.has(candidateId)) return;
  app._scalePreviewSnapshots.set(
    candidateId,
    buildRevertSnapshot({ action: 'token', candidate, tokenDocument: app.tokenDocument }),
  );
}

function scheduleScalePreviewUpdate(app, candidate, scale, candidateId, target) {
  if (!app?.tokenDocument?.update) return;
  const pendingScales =
    app._pendingScalePreview?.candidateId === candidateId
      ? { ...app._pendingScalePreview.scales }
      : {};
  pendingScales[target] = scale;
  app._pendingScalePreview = { candidate, candidateId, scales: pendingScales };
  if (app._scalePreviewScheduled) return;

  app._scalePreviewScheduled = true;
  const schedule =
    globalThis.requestAnimationFrame ??
    ((callback) => globalThis.setTimeout?.(callback, 0) ?? callback());
  schedule(() => void flushScalePreviewUpdate(app));
}

async function flushScalePreviewUpdate(app) {
  const pending = app?._pendingScalePreview;
  app._pendingScalePreview = null;
  app._scalePreviewScheduled = false;
  if (!pending) return;

  const update = buildScalePreviewUpdate(pending, app.tokenDocument);
  if (!Object.keys(update).length || !app?.tokenDocument?.update) return;

  try {
    const snapshot = app._scalePreviewSnapshots?.get(pending.candidateId);
    await app.tokenDocument.update({
      ...update,
      ...(snapshot
        ? {
            [REVERT_FLAG_PATH]: buildRevertHistoryFlagValue(app.tokenDocument, snapshot, {
              replaceSnapshot: snapshot,
            }),
          }
        : {}),
    });
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to preview token scale`, error);
  }
}

function buildScalePreviewUpdate(pending, tokenDocument) {
  const update = {};
  for (const [target, scale] of Object.entries(pending?.scales ?? {})) {
    Object.assign(
      update,
      buildTokenScalePreviewUpdate(pending.candidate, scale, tokenDocument, { target }),
    );
  }
  return update;
}

function matchesTarget(target, selector) {
  return Boolean(target?.matches?.(selector));
}

function closestTarget(target, selector) {
  return target?.closest?.(selector) ?? (matchesTarget(target, selector) ? target : null);
}

function renderMainPart(app, { preserveScroll = false } = {}) {
  if (preserveScroll) app._restoreScroll = capturePickerScroll(app);
  return app?.render?.({ parts: ['main'] });
}

function resetResultLimit(app) {
  app.resultLimit = DEFAULT_LIMIT;
}

function toggleIncludedTag(app, tagId) {
  if (app.selectedTagIds.has(tagId)) {
    app.selectedTagIds.delete(tagId);
    return;
  }
  app.selectedExcludedTagIds.delete(tagId);
  app.selectedTagIds.add(tagId);
}

function toggleExcludedTag(app, tagId) {
  if (app.selectedExcludedTagIds.has(tagId)) {
    app.selectedExcludedTagIds.delete(tagId);
    return;
  }
  app.selectedTagIds.delete(tagId);
  app.selectedExcludedTagIds.add(tagId);
}

export function buildCandidateSearchQuery(searchQuery, selectedTagIds = [], excludedTagIds = []) {
  return [
    String(searchQuery ?? '').trim(),
    ...selectedTagIds,
    ...[...excludedTagIds].map((tagId) => `!${tagId}`),
  ]
    .filter(Boolean)
    .join(' ');
}

function syncSelectedSources(app, sourceOptions) {
  app.sourceOptions = sourceOptions;
  const validIds = new Set(sourceOptions.map((option) => option.id));
  if (!app.selectedSourceIds) {
    app.selectedSourceIds = new Set(validIds);
    return;
  }
  for (const id of [...app.selectedSourceIds]) {
    if (!validIds.has(id)) app.selectedSourceIds.delete(id);
  }
}

function syncSelectedTags(app, tagOptions) {
  const validIds = new Set(tagOptions.map((option) => option.id));
  if (!app.selectedTagIds) {
    app.selectedTagIds = new Set();
  }
  if (!app.selectedExcludedTagIds) app.selectedExcludedTagIds = new Set();
  for (const id of [...app.selectedTagIds]) {
    if (!validIds.has(id)) app.selectedTagIds.delete(id);
  }
  for (const id of [...app.selectedExcludedTagIds]) {
    if (!validIds.has(id)) app.selectedExcludedTagIds.delete(id);
  }
}

function prepareSourceFilterView(options, app) {
  const selected = app.selectedSourceIds ?? new Set();
  const visibleOptions = filterSourceOptionsByQuery(options, app.sourceFilterQuery);
  return {
    className: `pf2e-tokener-source-filter${app.sourceMenuOpen ? ' is-open' : ''}`,
    controls: options.length > 2,
    clearLabel: localize('HUD.ClearSources', 'Clear all'),
    expanded: app.sourceMenuOpen ? 'true' : 'false',
    filterQuery: app.sourceFilterQuery,
    isOpen: app.sourceMenuOpen,
    label: getSourceFilterLabel(options, selected, { emptyMeansAll: false }),
    menuClassName: `pf2e-tokener-source-menu${app.sourceMenuOpen ? ' is-open' : ''}`,
    options: visibleOptions.map((option) => {
      const isSelected = selected.has(option.id);
      return {
        ...option,
        ariaPressed: isSelected ? 'true' : 'false',
        className: `pf2e-tokener-source-option${isSelected ? ' is-selected' : ''}`,
        selected: isSelected,
        title: option.title,
      };
    }),
    searchPlaceholder: localize('HUD.SourceSearchPlaceholder', 'Search sources'),
    selectAllLabel: localize('HUD.SelectAllSources', 'Select all'),
  };
}

function prepareTagFilterView(options, app) {
  app._tagMap = new Map(options.map((option) => [option.id, option]));
  app._tagOptions = options;
  const preparedOptions = options.map((option) => ({
    ...option,
    excluded: app.selectedExcludedTagIds.has(option.id),
    included: app.selectedTagIds.has(option.id),
    groupLabel: normalizeLabel(option.group),
  }));
  const activeIncluded = preparedOptions.filter((option) => option.included);
  const activeExcluded = preparedOptions.filter((option) => option.excluded);
  const groups = groupTagOptions(preparedOptions);
  const tagFilter = normalizeSearchText(app.tagFilterQuery);
  const activeCount = activeIncluded.length + activeExcluded.length;

  return {
    activeExcluded: activeExcluded.map((option) => prepareActiveTagView(option, 'excluded')),
    activeIncluded: activeIncluded.map((option) => prepareActiveTagView(option, 'included')),
    buttonLabel: activeCount
      ? `${localize('HUD.Tags', 'Tags')} (${activeCount})`
      : localize('HUD.Tags', 'Tags'),
    className: [options.length ? '' : 'is-empty'].filter(Boolean).join(' '),
    clearLabel: localize('HUD.ClearTags', 'Clear tags'),
    filterQuery: app.tagFilterQuery,
    groups: groups.map((group) => {
      const searchState = getTagGroupSearchState(group, tagFilter);
      const visibleOptions = group.options.filter((option) =>
        isTagOptionSearchMatch(option, tagFilter),
      );
      return {
        ...group,
        ...searchState,
        className: [
          searchState.isFiltering && searchState.hasMatches ? 'is-match' : '',
          searchState.isFiltering && !searchState.hasMatches ? 'is-filtered-out' : '',
        ]
          .filter(Boolean)
          .join(' '),
        displayCount: searchState.isFiltering ? searchState.matchedOptionCount : group.count,
        open: !searchState.isFiltering || searchState.hasMatches,
        visibleOptions: visibleOptions.map(prepareTagOptionView),
      };
    }),
    hasActive: activeCount > 0,
    hasOptions: options.length > 0,
    searchPlaceholder: localize('HUD.TagSearchPlaceholder', 'Search tags'),
    title: localize('HUD.Filters', 'Filters'),
  };
}

function prepareActiveTagView(option, mode) {
  return {
    ...option,
    className: `pf2e-tokener-active-tag is-${mode}`,
    prefix: mode === 'excluded' ? '-' : '+',
  };
}

function prepareTagOptionView(option) {
  return {
    ...option,
    excludeAriaPressed: option.excluded ? 'true' : 'false',
    excludeClassName: `pf2e-tokener-tag-exclude${option.excluded ? ' is-excluded' : ''}`,
    excludeTooltip: localize('HUD.ExcludeTag', 'Exclude tag'),
    includeAriaPressed: option.included ? 'true' : 'false',
    includeClassName: [
      option.included ? 'is-included' : '',
      option.excluded ? 'is-excluded is-muted' : '',
    ]
      .filter(Boolean)
      .join(' '),
    includeTooltip: localize('HUD.IncludeTag', 'Include tag'),
  };
}

function prepareRevertView(tokenDocument) {
  const snapshot = getLastRevertData(tokenDocument);
  const available = hasRevertTargets(snapshot);
  return {
    available,
    buttonLabel: localize('HUD.RevertLast', 'Revert last'),
    detail: available ? getRevertDetail(snapshot) : '',
    tooltip: localize('HUD.RevertTooltip', 'Restore the art from before the last Tokener change.'),
  };
}

function prepareCreatorView() {
  return {
    available: canUseTokenCreator(),
    label: localize('Creator.Open', 'Create token'),
    tooltip: localize(
      'Creator.OpenTooltip',
      'Make a new token from any image, with automatic background removal.',
    ),
  };
}

function prepareFavoritesView(favoriteIds, app) {
  const count = favoriteIds.size;
  return {
    active: Boolean(app.favoritesOnly),
    ariaPressed: app.favoritesOnly ? 'true' : 'false',
    buttonLabel: count
      ? `${localize('HUD.Favorites', 'Favorites')} (${count})`
      : localize('HUD.Favorites', 'Favorites'),
    className: [
      'pf2e-tokener-favorites-filter-button',
      app.favoritesOnly ? 'is-active' : '',
      count ? '' : 'is-empty',
    ]
      .filter(Boolean)
      .join(' '),
    tooltip: localize('HUD.FavoritesTooltip', 'Show only favorite token art.'),
  };
}

function preparePagingView(candidatePool) {
  return {
    hasMore: candidatePool.hasMore,
    showMoreLabel: localize('HUD.ShowMore', 'Show more'),
  };
}

function prepareCandidateSections(candidates, app, favoriteIds = new Set()) {
  app._candidateMap = new Map();
  app._scalePreviewSnapshots?.clear?.();
  const pinned = candidates.filter(
    (candidate) => candidate.matchType === 'exact' || candidate.matchType === 'name',
  );
  const broad = candidates.filter(
    (candidate) => candidate.matchType !== 'exact' && candidate.matchType !== 'name',
  );
  return [
    {
      candidates: pinned.map((candidate, index) =>
        prepareCandidateView(candidate, app, `pinned-${index}`, favoriteIds),
      ),
      title: localize('HUD.BestMatches', 'Best matches'),
    },
    {
      candidates: broad.map((candidate, index) =>
        prepareCandidateView(candidate, app, `broad-${index}`, favoriteIds),
      ),
      title: localize('HUD.SearchResults', 'Search results'),
    },
  ].filter((section) => section.candidates.length);
}

function prepareCandidateView(candidate, app, viewId, favoriteIds = new Set()) {
  app._candidateMap.set(viewId, candidate);
  const actions = getPickerApplyActionsForCandidate(candidate, app.tokenDocument);
  const previewSrc = getCandidatePreviewSrc(candidate);
  const hasPreview = Boolean(previewSrc);
  const isUnavailable = actions.length === 0;
  const favorite = isFavoriteCandidate(candidate, favoriteIds);
  const scaleControls = hasTokenScaleAction(actions)
    ? prepareScaleControlViews(candidate, app.tokenDocument)
    : [];
  return {
    ...candidate,
    actions,
    className: [
      'pf2e-tokener-card',
      isCurrentTokenArt(candidate, app.tokenDocument) ? 'is-current' : '',
      hasPreview ? '' : 'has-no-preview',
      isUnavailable ? 'is-unavailable' : '',
    ]
      .filter(Boolean)
      .join(' '),
    current: isCurrentTokenArt(candidate, app.tokenDocument),
    currentLabel: localize('HUD.Current', 'Current'),
    hasActions: actions.length > 0,
    favoriteAriaPressed: favorite ? 'true' : 'false',
    favoriteClassName: `pf2e-tokener-favorite-toggle${favorite ? ' is-active' : ''}`,
    favoriteIconClass: favorite ? 'fas fa-star' : 'far fa-star',
    favoriteTooltip: favorite
      ? localize('HUD.RemoveFavorite', 'Remove favorite')
      : localize('HUD.AddFavorite', 'Add favorite'),
    hasMatchedTags: Array.isArray(candidate.matchedTags) && candidate.matchedTags.length > 0,
    hasPreview: hasPreview,
    previewSrc: previewSrc,
    cardTooltip: getCandidateCardTooltip(candidate),
    imageTagsTooltip: localize('HUD.EditCustomImageTags', 'Edit image tags'),
    hasScaleControls: scaleControls.length > 0,
    scaleControls,
    tabIndex: isUnavailable ? '-1' : '0',
    viewId,
  };
}

function getPickerApplyActionsForCandidate(candidate, tokenDocument) {
  const actions = getApplyActionsForCandidate(candidate);
  if (shouldRestrictTokenerToSelectedToken()) {
    return tokenDocument?.isTokenerActorProxy
      ? []
      : actions.filter((option) => option.action === 'token');
  }
  if (!tokenDocument?.isTokenerActorProxy) return actions;
  return actions.filter((option) => option.action !== 'token' && option.action !== 'both');
}

function hasTokenScaleAction(actions) {
  return actions.some(
    (option) => option.action === 'token' || option.action === 'actor' || option.action === 'both',
  );
}

function prepareScaleControlViews(candidate, tokenDocument) {
  const controls = [
    prepareScaleControlView(SCALE_TARGET_TOKEN, getCandidateLinkedScale(candidate, tokenDocument)),
  ];
  if (hasDynamicRingScaleControl(candidate)) {
    controls.push(
      prepareScaleControlView(
        SCALE_TARGET_RING,
        getCandidateDynamicRingScale(candidate, tokenDocument),
      ),
    );
  }
  return controls;
}

function prepareScaleControlView(target, scale) {
  const value = formatScaleValue(scale);
  const ring = target === SCALE_TARGET_RING;
  return {
    label: ring ? localize('HUD.RingScale', 'Ring') : localize('HUD.Scale', 'Scale'),
    max: SCALE_MAX,
    min: SCALE_MIN,
    resetLabel: ring
      ? localize('HUD.ResetRingScale', 'Reset ring scale')
      : localize('HUD.ResetScale', 'Reset scale'),
    step: SCALE_STEP,
    target,
    tooltip: ring
      ? localize(
          'HUD.RingScaleTooltip',
          'Preview dynamic ring scale. Lower values make the ring larger.',
        )
      : localize('HUD.ScaleTooltip', 'Preview token scale'),
    value,
    valueLabel: `${value}x`,
  };
}

function hasDynamicRingScaleControl(candidate) {
  return Boolean(candidate?.subjectSrc);
}

function getCandidateLinkedScale(candidate, tokenDocument) {
  const currentScale = getCurrentTokenScale(tokenDocument);
  if (currentScale !== null) return currentScale;

  const scaleX = Number(candidate?.scaleX ?? candidate?.scale ?? 1);
  const scaleY = Number(candidate?.scaleY ?? candidate?.scale ?? scaleX);
  const scale = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : scaleY;
  return clampScaleValue(scale);
}

function getCurrentTokenScale(tokenDocument) {
  const tokenScale = getDocumentLinkedScale(tokenDocument);
  if (tokenScale !== null) return tokenScale;

  const actor = getDocumentActor(tokenDocument);
  return getDocumentLinkedScale(actor?.prototypeToken ?? actor?._source?.prototypeToken);
}

function getDocumentLinkedScale(documentLike) {
  if (!documentLike) return null;
  const scaleX = Number(readDocumentValue(documentLike, 'texture.scaleX'));
  const scaleY = Number(readDocumentValue(documentLike, 'texture.scaleY'));
  const scale = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : scaleY;
  return Number.isFinite(scale) && scale > 0
    ? clampScaleValue(getBaseTokenScale(documentLike, scale))
    : null;
}

function getCandidateDynamicRingScale(candidate, tokenDocument) {
  return clampScaleValue(
    candidate?.subjectScale ?? readDocumentValue(tokenDocument, 'ring.subject.scale') ?? 1,
  );
}

function readDocumentValue(documentLike, path) {
  return (
    documentLike?.get?.(path) ??
    readObjectPath(documentLike, path) ??
    readObjectPath(documentLike?._source, path)
  );
}

function readObjectPath(object, path) {
  return String(path)
    .split('.')
    .reduce((value, part) => value?.[part], object);
}

function clampScaleValue(value) {
  const scale = Number(value);
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale));
}

function formatScaleValue(value) {
  return String(Number(clampScaleValue(value).toFixed(2)));
}

async function openCustomImageTagsDialog(app, candidate) {
  if (!candidate?.imageTagsEditable || !candidate.imageTagPath) return;
  const DialogV2 = resolveDialogV2Class();
  if (!DialogV2?.input) return;

  const tagOptions = getTagFilterOptions(await ensureIndex());
  const content = renderCustomImageTagsContent(candidate, tagOptions);
  await DialogV2.input({
    window: {
      icon: 'fas fa-tags',
      title: localize('HUD.EditCustomImageTags', 'Edit image tags'),
    },
    position: {
      width: 640,
    },
    content,
    render: (_event, dialog) => activateCustomImageTagsDialog(dialog),
    ok: {
      label: localize('HUD.SaveImageTags', 'Save tags'),
      icon: 'fas fa-save',
      callback: async (_event, button) => {
        const tags = tagIdsToTags(getEditableCheckedImageTagIds(button.form));
        await setImageTagOverrides(candidate.imageTagPath, tags);
        await globalThis.game?.modules?.get?.(MODULE_ID)?.api?.rebuildIndex?.();
        renderMainPart(app, { preserveScroll: true });
        return tags;
      },
    },
  });
}

function activateCustomImageTagsDialog(dialog) {
  const root = normalizeHudElement(dialog?.element);
  if (!root || root.dataset.pf2eTokenerCustomImageTagsBound) return;
  root.dataset.pf2eTokenerCustomImageTagsBound = 'true';

  root.addEventListener?.('change', (event) => {
    if (!matchesTarget(event.target, '[name="imageTagIds"]')) return;
    updateCustomImageSelectedTags(root);
  });

  root.addEventListener?.('click', (event) => {
    const addButton = closestTarget(event.target, '[data-custom-image-tag-action="add"]');
    if (addButton) {
      event.preventDefault?.();
      addCustomImageTag(root);
      return;
    }

    const exportButton = closestTarget(
      event.target,
      '[data-custom-image-tag-action="export-json"]',
    );
    if (exportButton) {
      event.preventDefault?.();
      exportCustomImageTags(root);
      return;
    }

    const importButton = closestTarget(
      event.target,
      '[data-custom-image-tag-action="import-json"]',
    );
    if (importButton) {
      event.preventDefault?.();
      importCustomImageTags(root);
      return;
    }

    const chip = closestTarget(event.target, '[data-custom-image-tag-remove]');
    if (!chip) return;

    event.preventDefault?.();
    const input = root.querySelector?.(
      `[name="imageTagIds"][value="${cssEscape(chip.dataset.customImageTagRemove)}"]`,
    );
    if (input) input.checked = false;
    updateCustomImageSelectedTags(root);
  });
}

function resolveDialogV2Class() {
  return (
    globalThis.foundry?.applications?.api?.DialogV2 ??
    globalThis.foundry?.applications?.DialogV2 ??
    null
  );
}

function renderCustomImageTagsContent(candidate, tagOptions) {
  const originalIds = new Set(tagsToIds(candidate.originalTags));
  const selected = new Set(tagsToIds(candidate.imageTagOverrides));
  const preparedOptions = tagOptions.map((option) => ({
    ...option,
    groupLabel: normalizeLabel(option.group),
    original: originalIds.has(option.id),
    selected: selected.has(option.id),
  }));
  const groups = groupTagOptions(preparedOptions);
  const selectedOptions = getSelectedCustomImageTagOptions(
    candidate.tags,
    preparedOptions,
    originalIds,
  );

  return `<div
    class="pf2e-tokener-custom-image-tags"
    data-image-tag-path="${escapeHtml(candidate.imageTagPath)}"
  >
    <p class="notes">${escapeHtml(
      localize('HUD.CustomImageTagsHint', 'Choose tags to add to this custom folder image.'),
    )}</p>
    <div class="pf2e-tokener-custom-image-tags-selected">
      <div class="pf2e-tokener-custom-image-tags-selected-title">${escapeHtml(
        localize('HUD.SelectedImageTags', 'Selected tags'),
      )}</div>
      <div class="pf2e-tokener-custom-image-tags-chips" data-custom-image-tags-selected>
        ${renderCustomImageSelectedTags(selectedOptions)}
      </div>
    </div>
    <div class="pf2e-tokener-custom-image-tags-create">
      <input
        type="text"
        data-custom-image-tag-group
        placeholder="${escapeHtml(localize('HUD.CustomTagGroupPlaceholder', 'Custom group'))}"
      >
      <input
        type="text"
        data-custom-image-tag-value
        placeholder="${escapeHtml(localize('HUD.CustomTagValuePlaceholder', 'Custom value'))}"
      >
      <button type="button" data-custom-image-tag-action="add">
        <i class="fas fa-plus" aria-hidden="true"></i>
        ${escapeHtml(localize('HUD.AddCustomTag', 'Add tag'))}
      </button>
    </div>
    <div data-custom-image-tags-hidden>
      ${renderCustomImageHiddenTagInputs(selectedOptions, preparedOptions)}
    </div>
    <details class="pf2e-tokener-custom-image-tags-json">
      <summary>${escapeHtml(localize('HUD.ImageTagsJson', 'Import / export JSON'))}</summary>
      <p class="notes">${escapeHtml(
        localize(
          'HUD.ImageTagsJsonHint',
          'Per-image JSON uses only GM-added tags. Source tags stay read-only.',
        ),
      )}</p>
      <textarea name="customImageTagsJson" data-custom-image-tags-json spellcheck="false">${escapeHtml(
        getImageTagOverrideExport(candidate.imageTagOverrides),
      )}</textarea>
      <div class="pf2e-tokener-custom-image-tags-json-actions">
        <button type="button" data-custom-image-tag-action="export-json">
          <i class="fas fa-download" aria-hidden="true"></i>
          ${escapeHtml(localize('HUD.ExportImageTags', 'Export JSON'))}
        </button>
        <button type="button" data-custom-image-tag-action="import-json">
          <i class="fas fa-upload" aria-hidden="true"></i>
          ${escapeHtml(localize('HUD.ImportImageTags', 'Import JSON'))}
        </button>
      </div>
    </details>
    <div class="pf2e-tokener-custom-image-tags-groups">
      ${groups
        .map(
          (group) => `<details class="pf2e-tokener-custom-image-tags-group" open>
            <summary>${escapeHtml(group.label)}</summary>
            <div class="pf2e-tokener-custom-image-tags-options">
              ${group.options
                .map(
                  (option) => `<label>
                    <input
                      type="checkbox"
                      name="imageTagIds"
                      value="${escapeHtml(option.id)}"
                      data-group="${escapeHtml(option.group)}"
                      data-label="${escapeHtml(option.label)}"
                      ${option.original || option.selected ? 'checked' : ''}
                      ${option.original ? 'disabled' : ''}
                    >
                    <span>${escapeHtml(option.label)}</span>
                  </label>`,
                )
                .join('')}
            </div>
          </details>`,
        )
        .join('')}
    </div>
  </div>`;
}

function updateCustomImageSelectedTags(root) {
  const target = root.querySelector?.('[data-custom-image-tags-selected]');
  if (!target) return;

  const selectedOptions = [...(root.querySelectorAll?.('[name="imageTagIds"]:checked') ?? [])].map(
    (input) => ({
      id: input.value,
      label: input.dataset.label || input.value,
      group: input.dataset.group || '',
      original: input.disabled,
    }),
  );
  target.innerHTML = renderCustomImageSelectedTags(selectedOptions);
}

function addCustomImageTag(root) {
  const groupInput = root.querySelector?.('[data-custom-image-tag-group]');
  const valueInput = root.querySelector?.('[data-custom-image-tag-value]');
  const group = normalizeSearchText(groupInput?.value);
  const value = normalizeSearchText(valueInput?.value);
  if (!group || !value) return;

  const id = `${group}:${value}`;
  if (!root.querySelector?.(`[name="imageTagIds"][value="${cssEscape(id)}"]`)) {
    const hidden = root.querySelector?.('[data-custom-image-tags-hidden]');
    hidden?.insertAdjacentHTML?.(
      'beforeend',
      renderCustomImageHiddenTagInput({
        group,
        id,
        label: normalizeLabel(value),
      }),
    );
  }

  const input = root.querySelector?.(`[name="imageTagIds"][value="${cssEscape(id)}"]`);
  if (input) input.checked = true;
  if (valueInput) valueInput.value = '';
  updateCustomImageSelectedTags(root);
}

function exportCustomImageTags(root) {
  const contentRoot = getCustomImageTagsRoot(root);
  const imagePath = contentRoot?.dataset?.imageTagPath ?? '';
  const tags = tagIdsToTags(getEditableCheckedImageTagIds(contentRoot));
  const json = getImageTagOverrideExport(tags);
  const textarea = contentRoot?.querySelector?.('[data-custom-image-tags-json]');
  if (textarea) textarea.value = json;
  downloadImageTagJson(json, getImageTagExportFilename(imagePath));
}

function importCustomImageTags(root) {
  const contentRoot = getCustomImageTagsRoot(root);
  const textarea = contentRoot?.querySelector?.('[data-custom-image-tags-json]');
  let tags;
  try {
    tags = parseImageTagOverrideImport(
      textarea?.value ?? '{}',
      contentRoot?.dataset?.imageTagPath ?? '',
    );
  } catch {
    globalThis.ui?.notifications?.error?.(
      localize('Notifications.ImageTagsImportFailed', 'Tokener: failed to import image tags.'),
    );
    return false;
  }

  setEditableCustomImageTags(contentRoot, tags);
  if (textarea) {
    textarea.value = getImageTagOverrideExport(tags);
  }
  return true;
}

function getCustomImageTagsRoot(root) {
  return matchesTarget(root, '.pf2e-tokener-custom-image-tags')
    ? root
    : root?.querySelector?.('.pf2e-tokener-custom-image-tags');
}

function setEditableCustomImageTags(root, tags) {
  const ids = tagsToIds(tags);
  root?.querySelectorAll?.('[name="imageTagIds"]').forEach((input) => {
    if (!input.disabled) input.checked = false;
  });

  for (const id of ids) {
    const input = ensureCustomImageTagInput(root, id);
    if (input && !input.disabled) input.checked = true;
  }
  updateCustomImageSelectedTags(root);
}

function ensureCustomImageTagInput(root, id) {
  const existing = root?.querySelector?.(`[name="imageTagIds"][value="${cssEscape(id)}"]`);
  if (existing) return existing;

  const [group, ...rest] = String(id ?? '').split(':');
  const value = rest.join(':');
  if (!group || !value) return null;

  const hidden = root?.querySelector?.('[data-custom-image-tags-hidden]');
  hidden?.insertAdjacentHTML?.(
    'beforeend',
    renderCustomImageHiddenTagInput({
      group,
      id,
      label: normalizeLabel(value),
    }),
  );
  return root?.querySelector?.(`[name="imageTagIds"][value="${cssEscape(id)}"]`);
}

function getImageTagExportFilename(imagePath) {
  const base = normalizePath(imagePath).split('/').filter(Boolean).pop() || 'image';
  return `tokener-image-tags-${base.replace(/\.[^.]+$/, '')}.json`;
}

function getSelectedCustomImageTagOptions(tags, indexedOptions, originalIds = new Set()) {
  const indexedById = new Map(indexedOptions.map((option) => [option.id, option]));
  return tagsToIds(tags).map((id) => {
    const indexed = indexedById.get(id);
    if (indexed) return { ...indexed, original: originalIds.has(id) };
    const [group, ...rest] = id.split(':');
    const value = rest.join(':');
    return {
      group,
      id,
      label: normalizeLabel(value),
      original: originalIds.has(id),
    };
  });
}

function renderCustomImageHiddenTagInputs(selectedOptions, visibleOptions) {
  const visibleIds = new Set(visibleOptions.map((option) => option.id));
  return selectedOptions
    .filter((option) => !visibleIds.has(option.id))
    .map(renderCustomImageHiddenTagInput)
    .join('');
}

function renderCustomImageHiddenTagInput(option) {
  return `<input
    type="checkbox"
    name="imageTagIds"
    value="${escapeHtml(option.id)}"
    data-group="${escapeHtml(option.group)}"
    data-label="${escapeHtml(option.label)}"
    checked
    ${option.original ? 'disabled' : ''}
    hidden
  >`;
}

function renderCustomImageSelectedTags(options) {
  if (!options.length) {
    return `<span class="pf2e-tokener-custom-image-tags-empty">${escapeHtml(
      localize('HUD.NoSelectedImageTags', 'No image tags selected.'),
    )}</span>`;
  }

  return options
    .map(
      (option) => `<button
        class="pf2e-tokener-custom-image-tags-chip"
        type="button"
        ${option.original ? 'disabled' : `data-custom-image-tag-remove="${escapeHtml(option.id)}"`}
        data-tooltip="${escapeHtml(option.group)}: ${escapeHtml(option.label)}"
        data-tooltip-direction="UP"
      >
        <span>${escapeHtml(option.label)}</span>
        ${option.original ? '' : '<i class="fas fa-times" aria-hidden="true"></i>'}
      </button>`,
    )
    .join('');
}

function getEditableCheckedImageTagIds(form) {
  if (!form || typeof FormData === 'undefined') return [];
  return [...(form.querySelectorAll?.('[name="imageTagIds"]:checked') ?? [])]
    .filter((field) => !field.disabled)
    .map((field) => field.value);
}

function tagIdsToTags(tagIds) {
  const ids = Array.isArray(tagIds) ? tagIds : tagIds ? [tagIds] : [];
  const tags = {};
  for (const id of ids) {
    const [group, ...rest] = String(id ?? '').split(':');
    const value = rest.join(':');
    if (!group || !value) continue;
    tags[group] = [...new Set([...(tags[group] ?? []), value])];
  }
  return Object.keys(tags).length ? tags : undefined;
}

function tagsToIds(tags) {
  if (!tags || typeof tags !== 'object') return [];
  return Object.entries(tags).flatMap(([group, values]) =>
    (Array.isArray(values) ? values : [values])
      .map((value) => normalizeSearchText(value))
      .filter(Boolean)
      .map((value) => `${normalizeSearchText(group)}:${value}`),
  );
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function cssEscape(value) {
  const escape = globalThis.CSS?.escape;
  if (typeof escape === 'function') return escape(String(value ?? ''));
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"');
}

function groupTagOptions(options) {
  const groups = [];
  let current = null;
  for (const option of options) {
    if (option.group !== current?.name) {
      current = {
        count: 0,
        id: option.group,
        label: option.groupLabel,
        name: option.group,
        options: [],
      };
      groups.push(current);
    }
    current.count += option.count;
    current.options.push(option);
  }
  return groups;
}

function getCandidateCardTooltip(candidate) {
  return [candidate.label, candidate.moduleTitle].filter(Boolean).join(' | ');
}

function openFallbackPicker() {
  globalThis.ui?.notifications?.warn?.(
    localize('Notifications.AppV2Unavailable', 'Tokener requires Foundry ApplicationV2.'),
  );
  return null;
}

function isCurrentTokenArt(candidate, tokenDocument) {
  const current = normalizePath(
    tokenDocument?.texture?.src ?? tokenDocument?._source?.texture?.src ?? '',
  );
  return Boolean(current && (current === candidate.tokenSrc || current === candidate.subjectSrc));
}

function toggleCardActions(card) {
  if (card.classList.contains('is-unavailable')) return;

  const grid = card.closest('.pf2e-tokener-grid');
  grid?.querySelectorAll('.pf2e-tokener-card.is-open').forEach((openCard) => {
    if (openCard !== card) openCard.classList.remove('is-open');
  });
  card.classList.toggle('is-open');
}

export function getCreatedTokenApplyActions(tokenDocument) {
  return getPickerApplyActionsForCandidate(
    { tokenSrc: 'created', portraitSrc: 'created' },
    tokenDocument,
  );
}

export function applyCreatedTokenCandidate(action, candidate, tokenDocument) {
  return applyCandidateAction(action, candidate, tokenDocument, null, activePicker);
}

async function applyCandidateAction(action, candidate, tokenDocument, card, app = activePicker) {
  const actor = getDocumentActor(tokenDocument);
  const availableAction = getPickerApplyActionsForCandidate(candidate, tokenDocument).some(
    (option) => option.action === action,
  );
  if (!availableAction) return;

  const targets = getApplyTargets(action);
  const scale = readCardScaleValue(card, candidate, SCALE_TARGET_TOKEN, tokenDocument);
  const ringScale = readCardScaleValue(card, candidate, SCALE_TARGET_RING, tokenDocument);
  const previewSnapshot = getScalePreviewSnapshot(app, card);
  const revertSnapshot = buildApplyRevertSnapshot(
    action,
    candidate,
    tokenDocument,
    previewSnapshot,
  );
  card?.classList.add('is-applying');

  try {
    if (targets.token) {
      await tokenDocument.update({
        ...buildTokenUpdate(candidate, { scale, ringScale, document: tokenDocument }),
        [REVERT_FLAG_PATH]: buildRevertHistoryFlagValue(tokenDocument, revertSnapshot, {
          replaceSnapshot: previewSnapshot,
        }),
      });
    }

    if (targets.actor && actor) {
      pruneStaleDependentTokens(actor);
      await actor.update({
        ...buildActorUpdate(candidate, { scale, ringScale, actor }),
        [REVERT_FLAG_PATH]: buildRevertHistoryFlagValue(actor, revertSnapshot),
      });
    }

    if (targets.portrait && actor) {
      pruneStaleDependentTokens(actor);
      await actor.update({
        ...buildPortraitUpdate(candidate, actor),
        [REVERT_FLAG_PATH]: buildRevertHistoryFlagValue(actor, revertSnapshot),
      });
    }

    globalThis.ui?.notifications?.info?.(
      localize('Notifications.Applied', 'Tokener: token art applied.'),
    );
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to apply token art`, error);
    globalThis.ui?.notifications?.error?.(
      localize('Notifications.ApplyFailed', 'Tokener: failed to apply token art.'),
    );
  } finally {
    card?.classList.remove('is-applying');
    renderMainPart(activePicker, { preserveScroll: true });
  }
}

function getScalePreviewSnapshot(app, card) {
  return app?._scalePreviewSnapshots?.get(card?.dataset?.candidateId) ?? null;
}

function buildApplyRevertSnapshot(action, candidate, tokenDocument, previewSnapshot) {
  const snapshot = buildRevertSnapshot({ action, candidate, tokenDocument });
  if (previewSnapshot?.token) snapshot.token = previewSnapshot.token;
  return snapshot;
}

async function handleRevertControlClick(app) {
  const entries = getRevertHistoryEntries(app.tokenDocument);
  if (entries.length <= 1) {
    await revertLastChange(app);
    return;
  }
  await openRevertHistoryDialog(app.tokenDocument, {
    onReverted: () => renderMainPart(app),
  });
}

async function handleRevertControlContextMenu(app) {
  const reverted = await revertSnapshotDocument(app.tokenDocument, null, {
    original: true,
  });
  if (reverted) renderMainPart(app);
}

async function revertLastChange(app) {
  const reverted = await revertSnapshotDocument(
    app.tokenDocument,
    getLastRevertData(app.tokenDocument),
  );
  if (reverted) renderMainPart(app);
}

export async function openRevertHistoryDialog(tokenDocument, { onReverted } = {}) {
  const entries = getRevertHistoryEntries(tokenDocument);
  if (!entries.length) return false;

  const DialogV2 = resolveDialogV2Class();
  if (!DialogV2?.input) return false;

  await DialogV2.input({
    window: {
      icon: 'fas fa-history',
      title: localize('HUD.RevertHistory', 'Tokener history'),
    },
    position: {
      width: 420,
    },
    content: renderRevertHistoryDialogContent(entries),
    render: (_event, dialog) =>
      activateRevertHistoryDialog(dialog, tokenDocument, entries, onReverted),
    ok: {
      label: localize('HUD.Close', 'Close'),
      icon: 'fas fa-times',
    },
  });
  return true;
}

function renderRevertHistoryDialogContent(entries) {
  return `<div class="pf2e-tokener-revert-history-dialog">
    ${entries
      .map((entry, index) => {
        const snapshot = entry.snapshot;
        const imageSrc = getSnapshotArtSrc(snapshot);
        const name = getSnapshotArtLabel(snapshot);
        const action = normalizeLabel(snapshot?.action);
        return `<button
          type="button"
          class="pf2e-tokener-revert-history-choice"
          data-revert-index="${index}"
          data-tooltip="${escapeHtml(
            localize('HUD.RevertHistoryTooltip', 'Restore this art from Tokener history.'),
          )}"
        >
          ${imageSrc ? `<img class="pf2e-tokener-revert-history-image" src="${escapeHtml(imageSrc)}" alt="${escapeHtml(name)}" loading="lazy" />` : ''}
          <span class="pf2e-tokener-revert-history-text">
            <span class="pf2e-tokener-revert-history-name">${escapeHtml(name)}</span>
            <span class="pf2e-tokener-revert-history-kind">${escapeHtml(action)}</span>
          </span>
        </button>`;
      })
      .join('')}
  </div>`;
}

function activateRevertHistoryDialog(dialog, tokenDocument, entries, onReverted) {
  const root = normalizeHudElement(dialog?.element);
  if (!root || root.dataset.pf2eTokenerRevertHistoryBound) return;
  root.dataset.pf2eTokenerRevertHistoryBound = 'true';

  root.addEventListener?.('click', async (event) => {
    const button = closestTarget(event.target, '[data-revert-index]');
    if (!button) return;

    event.preventDefault?.();
    const snapshot = entries[Number(button.dataset.revertIndex)]?.snapshot;
    const reverted = await revertSnapshotDocument(tokenDocument, snapshot);
    if (!reverted) return;

    dialog?.close?.();
    await onReverted?.();
  });
}

async function revertSnapshotDocument(tokenDocument, snapshot, { original = false } = {}) {
  try {
    let reverted;
    if (original) reverted = await revertTokenerChangeToOriginal(tokenDocument);
    else if (snapshot) reverted = await revertTokenerChangeToSnapshot(tokenDocument, snapshot);
    else reverted = await revertLastTokenerChange(tokenDocument);

    if (!reverted) return false;

    globalThis.ui?.notifications?.info?.(
      localize('Notifications.Reverted', 'Tokener: previous art restored.'),
    );
    return true;
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to revert token art`, error);
    globalThis.ui?.notifications?.error?.(
      localize('Notifications.RevertFailed', 'Tokener: failed to restore previous art.'),
    );
    return false;
  }
}

function getRevertDetail(snapshot) {
  return [normalizeLabel(snapshot?.action), getSnapshotArtLabel(snapshot)]
    .filter(Boolean)
    .join(': ');
}

function getSnapshotArtLabel(snapshot) {
  const source = getSnapshotArtSrc(snapshot);
  return source ? labelFromPath(source) : snapshot?.label;
}

function getSnapshotArtSrc(snapshot) {
  return (
    snapshot?.token?.texture?.src ?? snapshot?.actor?.texture?.src ?? snapshot?.portrait?.img ?? ''
  );
}
