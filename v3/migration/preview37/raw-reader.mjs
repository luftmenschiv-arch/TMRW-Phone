import { LEGACY_PREVIEW_STORAGE } from '../../storage/schema.mjs';
import { PREVIEW37_SOURCE_AUTHORITY } from './constants.mjs';
import { previewDigest } from './digest.mjs';
import { normalizePreview37MigrationSource } from './source-normalizer.mjs';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error || new Error('Preview 37 read failed'));
  });
}

async function readIndexedDb(indexedDb) {
  if (!indexedDb || typeof indexedDb.databases !== 'function' || typeof indexedDb.open !== 'function') return null;
  const databases = await indexedDb.databases();
  if (!databases.some(row => row.name === LEGACY_PREVIEW_STORAGE.indexedDbName)) return null;
  const database = await new Promise((resolve, reject) => {
    const request = indexedDb.open(LEGACY_PREVIEW_STORAGE.indexedDbName);
    request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error('Refusing to create or upgrade Preview 37 storage')); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open Preview 37 storage read-only'));
  });
  try {
    if (!database.objectStoreNames.contains(LEGACY_PREVIEW_STORAGE.objectStore)) return null;
    const transaction = database.transaction([LEGACY_PREVIEW_STORAGE.objectStore], 'readonly');
    return await requestResult(transaction.objectStore(LEGACY_PREVIEW_STORAGE.objectStore).get(LEGACY_PREVIEW_STORAGE.recordKey));
  } finally { database.close(); }
}

export class Preview37RawReader {
  #readSource; #indexedDb; #localStorage; #metrics = Object.freeze({ operation: 'none' });
  constructor({ readSource = null, indexedDb = globalThis.indexedDB, localStorage = globalThis.localStorage } = {}) {
    if (readSource != null && typeof readSource !== 'function') throw new TypeError('readSource must be a read-only function');
    this.#readSource = readSource; this.#indexedDb = indexedDb; this.#localStorage = localStorage;
  }
  get lastOperationMetrics() { return structuredClone(this.#metrics); }
  async read() {
    let result;
    if (this.#readSource) result = await this.#readSource();
    else {
      const indexedRecord = await readIndexedDb(this.#indexedDb);
      let fallback = null;
      if (indexedRecord == null && this.#localStorage?.getItem) {
        const raw = this.#localStorage.getItem(LEGACY_PREVIEW_STORAGE.fallbackProjectKey);
        if (raw) { try { fallback = JSON.parse(raw); } catch { throw new TypeError('Preview 37 fallback record is malformed JSON'); } }
      }
      result = indexedRecord == null && fallback == null ? { available: false, reason: 'preview37-data-unavailable' } : { available: true, record: indexedRecord ?? fallback, sourceLocation: indexedRecord == null ? 'localstorage-fallback' : 'indexeddb' };
    }
    if (!result || result.available === false) {
      this.#metrics = Object.freeze({ operation: 'preview37-read', sourceReads: 1, sourceWrites: 0, recordsRead: 0 });
      return Object.freeze({ available: false, sourceAuthority: PREVIEW37_SOURCE_AUTHORITY, reason: result?.reason || 'preview37-data-unavailable', wrotePreview: false, invokedPreviewCode: false });
    }
    if (!result.record || typeof result.record !== 'object' || Array.isArray(result.record)) throw new TypeError('Preview 37 source root must be an object');
    const record = normalizePreview37MigrationSource(result.record); const sourceFingerprint = await previewDigest(record); const sourceVersion = String(result.sourceVersion || record.schemaVersion || 'unknown');
    this.#metrics = Object.freeze({ operation: 'preview37-read', sourceReads: 1, sourceWrites: 0, recordsRead: 1 });
    return Object.freeze({ available: true, sourceAuthority: PREVIEW37_SOURCE_AUTHORITY, sourceVersion, sourceFingerprint, sourceLocation: result.sourceLocation || 'injected-read-only', record, wrotePreview: false, invokedPreviewCode: false });
  }
}

