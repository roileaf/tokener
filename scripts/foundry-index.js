import {
  CUSTOM_FOLDERS_SETTING_KEY,
  IMAGE_TAGS_SETTING_KEY,
  MODULE_ID,
  MIXED_ART_FOLDER_ROOTS,
  PORTRAIT_FOLDER_ROOTS,
  SUBJECT_FOLDER_ROOTS,
  TOKEN_FOLDER_ROOTS,
} from './constants.js';
import {
  createDatasheetCandidates,
  createCustomFolderCandidates,
  createFolderCandidates,
  createMappedCandidates,
  dedupeCandidates,
  getCandidatesForTokenDocument,
  searchCandidates,
} from './candidates.js';
import { getCustomFolderSources } from './custom-folders.js';
import { applyImageTagOverrides } from './image-tags.js';
import { getIndexSignature, readIndexCache, writeIndexCache } from './index-cache.js';
import { getCurrentSystemProfile } from './system-profile.js';
import { isObject, normalizePath } from './utils.js';

const DATASHEET_BROWSE_ROOTS = [
  { root: 'assets/datasheet', recursive: true },
  { root: 'data', recursive: true },
  { root: 'datasheets', recursive: true },
  { root: '', recursive: false },
];
const DATASHEET_JSON = /(?:^|\/)[^/]*datasheet[^/]*\.json$/i;
const INDEX_SCAN_CONCURRENCY = 4;

export const state = {
  index: [],
  indexing: null,
  errors: [],
  rescanning: false,
  builtIndex: null,
  generation: 0,
  // The latest build threw: nothing is loaded (`builtIndex` stays null), so the next open retries.
  failed: false,
};

const WARM_UP_DELAY_MS = 3000;

/**
 * Loads the art index: a matching IndexedDB cache is used as-is, otherwise every source is
 * browsed and the cache overwritten. `force` (the picker's Rescan) always browses.
 */
export async function rebuildIndex({ force = false } = {}) {
  const generation = ++state.generation;
  // A rescan (or a rebuild started during one) never trusts the cache.
  const skipCache = force || state.rescanning;
  if (force) state.rescanning = true;
  let failed = false;
  const indexing = loadIndex({ skipCache, generation })
    .catch((error) => {
      failed = true;
      state.errors.push(error);
      console.error(`${MODULE_ID} | Failed to build token index`, error);
      return [];
    })
    .then((index) => {
      // A newer rebuild started meanwhile: let it own the result.
      if (generation !== state.generation) return state.indexing ?? state.index;
      state.index = index;
      // A failed build loads nothing, so the next open builds again.
      state.builtIndex = failed ? null : index;
      state.failed = failed;
      state.rescanning = false;
      state.indexing = null;
      return index;
    });
  state.indexing = indexing;
  return indexing;
}

export async function ensureIndex() {
  while (state.indexing) await state.indexing;
  if (!hasLoadedIndex()) await rebuildIndex();
  return state.index;
}

/** True when an index is available to show and no forced rescan is replacing it. */
export function isIndexReady() {
  return !state.rescanning && hasLoadedIndex() && !(state.indexing && !state.index.length);
}

/** True when the latest build threw and no build is running: there is nothing to wait for. */
export function hasIndexFailed() {
  return state.failed && !state.indexing;
}

/** Builds (or loads) the index once the world is idle so the first picker open is instant. */
export function warmIndexInBackground({ schedule = scheduleIdle } = {}) {
  schedule(() => {
    if (state.indexing || hasLoadedIndex()) return;
    void ensureIndex();
  });
}

function scheduleIdle(callback) {
  if (typeof globalThis.requestIdleCallback === 'function')
    globalThis.requestIdleCallback(callback, { timeout: WARM_UP_DELAY_MS });
  else globalThis.setTimeout(callback, WARM_UP_DELAY_MS);
}

function hasLoadedIndex() {
  return state.index.length > 0 || (state.builtIndex !== null && state.index === state.builtIndex);
}

async function loadIndex({ skipCache, generation }) {
  const modules = getIndexedModules();
  const signature = getCurrentIndexSignature(modules);
  if (!skipCache) {
    const cached = await readIndexCache(signature);
    if (cached) {
      console.info(`${MODULE_ID} | art index loaded from cache (${cached.length} candidates)`);
      return cached;
    }
  }

  const started = now();
  const index = applyImageTagOverrides(dedupeCandidates(await buildFoundryIndex(modules)));
  console.info(
    `${MODULE_ID} | art index built in ${Math.round(now() - started)} ms (${index.length} candidates, ${modules.length} modules)`,
  );
  // A newer rebuild owns the result (and the cache): an older, slower one never overwrites it.
  if (generation === state.generation) await writeIndexCache(signature, index);
  return index;
}

function getCurrentIndexSignature(modules) {
  return getIndexSignature({
    systemId: getCurrentSystemProfile().id ?? globalThis.game?.system?.id,
    modules,
    customFolders: readSetting(CUSTOM_FOLDERS_SETTING_KEY),
    imageTags: readSetting(IMAGE_TAGS_SETTING_KEY),
    version: globalThis.game?.modules?.get?.(MODULE_ID)?.version,
  });
}

function readSetting(key) {
  try {
    return globalThis.game?.settings?.get?.(MODULE_ID, key);
  } catch {
    return undefined;
  }
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function installApi() {
  const module = globalThis.game?.modules?.get?.(MODULE_ID);
  if (!module) return;
  module.api = {
    get index() {
      return state.index;
    },
    ensureIndex,
    rebuildIndex,
    search: (query) => searchCandidates(state.index, query),
    getCandidatesForToken: (tokenDocument, query = '') =>
      getCandidatesForTokenDocument(state.index, tokenDocument, query),
  };
}

function getIndexedModules() {
  return getFoundryModules().filter((module) => module && module.id !== MODULE_ID);
}

async function buildFoundryIndex(modules = getIndexedModules()) {
  const profile = getCurrentSystemProfile();
  const candidates = [];

  const mappedCandidates = await mapWithConcurrency(modules, INDEX_SCAN_CONCURRENCY, (module) =>
    collectMappedModuleCandidates(module, profile),
  );
  for (const moduleCandidates of mappedCandidates) candidates.push(...moduleCandidates);

  const folderCandidates = await mapWithConcurrency(
    modules,
    INDEX_SCAN_CONCURRENCY,
    collectFolderModuleCandidates,
  );
  for (const moduleCandidates of folderCandidates) candidates.push(...moduleCandidates);

  candidates.push(...(await collectCustomFolderCandidates()));

  return candidates;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function collectMappedModuleCandidates(module, profile = getCurrentSystemProfile()) {
  const candidates = [];
  const seenDatasheets = new Set();
  for (const key of profile.nativeMappingKeys) {
    const native = module.flags?.compendiumArtMappings?.[key];
    if (!native?.mapping) continue;
    try {
      const mapping = await fetchJsonCompat(native.mapping);
      candidates.push(
        ...createMappedCandidates({
          module,
          mapping,
          sourceType: 'native',
          systemId: profile.id,
        }),
      );
    } catch (error) {
      state.errors.push(error);
      console.warn(`${MODULE_ID} | Failed ${key} native mapping for ${module.id}`, error);
    }
  }

  for (const flag of Object.values(module.flags ?? {})) {
    if (!isObject(flag)) continue;
    const legacyKey = profile.legacyMappingFlagKeys.find((key) => flag[key]);
    if (!legacyKey) continue;
    try {
      const mapping = await fetchJsonCompat(flag[legacyKey]);
      candidates.push(
        ...createMappedCandidates({
          module,
          mapping,
          sourceType: legacyKey,
          systemId: profile.id,
        }),
      );
    } catch (error) {
      state.errors.push(error);
      console.warn(`${MODULE_ID} | Failed ${legacyKey} mapping for ${module.id}`, error);
    }
  }

  for (const datasheet of Object.values(module.flags?.galleryDatasheets ?? {})) {
    if (!isObject(datasheet) || !datasheet.sheet) continue;
    await addDatasheetCandidates({ module, candidates, seenDatasheets, sheet: datasheet.sheet });
  }

  if (isTokenDataModule(module, profile)) {
    for (const sheet of await discoverDatasheetSheets(module)) {
      await addDatasheetCandidates({ module, candidates, seenDatasheets, sheet });
    }
  }

  return candidates;
}

async function addDatasheetCandidates({ module, candidates, seenDatasheets, sheet }) {
  const normalizedSheet = normalizePath(sheet);
  if (!normalizedSheet || seenDatasheets.has(normalizedSheet)) return;
  seenDatasheets.add(normalizedSheet);

  try {
    const data = await fetchJsonCompat(normalizedSheet);
    candidates.push(...createDatasheetCandidates({ module, datasheet: data }));
  } catch (error) {
    state.errors.push(error);
    console.warn(`${MODULE_ID} | Failed gallery datasheet for ${module.id}`, error);
  }
}

async function discoverDatasheetSheets(module) {
  const sheets = new Set();
  for (const { root, recursive } of DATASHEET_BROWSE_ROOTS) {
    const target = root ? `modules/${module.id}/${root}` : `modules/${module.id}`;
    for (const file of await browseFilesCompat(target, { recursive })) {
      const normalized = normalizePath(file);
      if (DATASHEET_JSON.test(normalized)) sheets.add(normalized);
    }
  }
  return [...sheets];
}

async function collectFolderModuleCandidates(module) {
  const candidates = [];
  const tokenFiles = [];
  for (const root of [...TOKEN_FOLDER_ROOTS, ...MIXED_ART_FOLDER_ROOTS]) {
    const target = `modules/${module.id}/${root}`;
    tokenFiles.push(...(await browseFilesCompat(target)));
  }
  if (!tokenFiles.length) return candidates;

  const relatedFiles = [...tokenFiles];
  for (const root of [...PORTRAIT_FOLDER_ROOTS, ...SUBJECT_FOLDER_ROOTS]) {
    const target = `modules/${module.id}/${root}`;
    relatedFiles.push(...(await browseFilesCompat(target)));
  }
  candidates.push(...createFolderCandidates({ module, files: relatedFiles }));
  return candidates;
}

async function collectCustomFolderCandidates() {
  const candidates = [];
  for (const source of getCustomFolderSources()) {
    const files = [];
    for (const path of getCustomFolderBrowsePaths(source)) {
      files.push(...(await browseFilesCompat(path, { recursive: true })));
    }
    candidates.push(...createCustomFolderCandidates({ source, files }));
  }
  return candidates;
}

function getCustomFolderBrowsePaths(source) {
  return [source?.path, source?.portraitPath, source?.subjectPath]
    .map(normalizePath)
    .filter(Boolean)
    .filter((path, index, paths) => paths.indexOf(path) === index);
}

function getFoundryModules() {
  const modules = globalThis.game?.modules;
  if (!modules) return [];
  if (typeof modules.values === 'function') return [...modules.values()];
  if (Array.isArray(modules)) return modules;
  return [...modules];
}

function isTokenDataModule(module, profile = getCurrentSystemProfile()) {
  return profile.tokenDataModulePattern.test(`${module.id ?? ''} ${module.title ?? ''}`);
}

async function fetchJsonCompat(path) {
  const fetcher = globalThis.foundry?.utils?.fetchJsonWithTimeout;
  if (typeof fetcher === 'function') return fetcher(path);

  const response = await globalThis.fetch(path);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
  return response.json();
}

async function browseFilesCompat(target, { recursive = true } = {}) {
  const picker = getFilePickerImplementation();
  if (!picker || typeof picker.browse !== 'function') return [];

  try {
    const result = await picker.browse('data', target, { recursive });
    return Array.isArray(result?.files) ? result.files : [];
  } catch {
    return [];
  }
}

function getFilePickerImplementation() {
  return (
    globalThis.foundry?.applications?.apps?.FilePicker?.implementation ??
    globalThis.CONFIG?.ux?.FilePicker ??
    globalThis.FilePicker ??
    null
  );
}
