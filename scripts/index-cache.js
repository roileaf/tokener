// Persistent IndexedDB cache for the art index, keyed by a signature of everything the index build
// reads (system, installed modules, folder and tag settings, Tokener's own version). Every failure
// is swallowed: the caller falls back to an in-memory build.

const DB_NAME = 'pf2e-tokener';
const DB_VERSION = 1;
const STORE_NAME = 'index';
// Bump whenever the candidate shape or how candidates are built changes, so caches written by an
// older build (even one with the same Tokener version) are never reused.
const SIGNATURE_VERSION = 2;

export function getIndexSignature({
  systemId,
  modules = [],
  customFolders,
  imageTags,
  version,
} = {}) {
  const moduleKeys = (Array.isArray(modules) ? modules : [])
    .filter(Boolean)
    .map((module) =>
      typeof module === 'string'
        ? module
        : `${module.id ?? ''}@${module.version ?? ''}${module.active === false ? ':inactive' : ''}`,
    )
    .sort();
  return JSON.stringify({
    v: SIGNATURE_VERSION,
    system: String(systemId ?? ''),
    modules: moduleKeys,
    customFolders: stableStringify(customFolders),
    imageTags: stableStringify(imageTags),
    version: String(version ?? ''),
  });
}

export async function readIndexCache(signature, idb = globalThis.indexedDB, { key } = {}) {
  try {
    if (!signature || typeof idb?.open !== 'function') return null;
    const db = await openDatabase(idb);
    try {
      const record = await requestResult(
        db
          .transaction(STORE_NAME, 'readonly')
          .objectStore(STORE_NAME)
          .get(key ?? getRecordKey()),
      );
      if (!record || record.signature !== signature || !Array.isArray(record.candidates))
        return null;
      return record.candidates.filter((candidate) => candidate && typeof candidate === 'object');
    } finally {
      db.close?.();
    }
  } catch {
    return null;
  }
}

export async function writeIndexCache(
  signature,
  candidates,
  idb = globalThis.indexedDB,
  { key } = {},
) {
  try {
    if (!signature || typeof idb?.open !== 'function' || !Array.isArray(candidates)) return;
    const record = {
      signature,
      savedAt: Date.now(),
      candidates: toPlainCandidates(candidates),
    };
    const db = await openDatabase(idb);
    try {
      await requestResult(
        db
          .transaction(STORE_NAME, 'readwrite')
          .objectStore(STORE_NAME)
          .put(record, key ?? getRecordKey()),
      );
    } finally {
      db.close?.();
    }
  } catch {
    // The cache is an optimisation only.
  }
}

// Candidates are plain data already; a JSON round trip guarantees nothing non-cloneable (functions,
// documents, DOM nodes) can reach IndexedDB and that a cached candidate equals a fresh one minus
// undefined fields, which every reader treats as absent.
function toPlainCandidates(candidates) {
  return JSON.parse(JSON.stringify(candidates));
}

function getRecordKey() {
  return String(globalThis.game?.world?.id || 'default');
}

function openDatabase(idb) {
  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames?.contains?.(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function stableStringify(value) {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(sortKeys(value)) ?? '';
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}
