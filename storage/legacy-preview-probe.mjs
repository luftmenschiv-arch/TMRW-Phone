import { LEGACY_PREVIEW_STORAGE } from './schema.mjs';

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Legacy read request failed'));
  });
}

function summarizeLegacyRecord(record) {
  if (!record || typeof record !== 'object') return { recordPresent: Boolean(record), schemaVersion: null, cardCount: 0 };
  return {
    recordPresent: true,
    schemaVersion: Number(record.schemaVersion || 0) || null,
    cardCount: record.cards && typeof record.cards === 'object' ? Object.keys(record.cards).length : 0,
  };
}

export async function probeLegacyPreview({ indexedDb = globalThis.indexedDB } = {}) {
  const unavailable = {
    available: false,
    reason: 'indexeddb-unavailable',
    storage: LEGACY_PREVIEW_STORAGE,
    wroteLegacyData: false,
    invokedPreviewCode: false,
  };
  if (!indexedDb || typeof indexedDb.databases !== 'function' || typeof indexedDb.open !== 'function') return unavailable;

  const databases = await indexedDb.databases();
  const descriptor = databases.find(row => row.name === LEGACY_PREVIEW_STORAGE.indexedDbName);
  if (!descriptor) return { ...unavailable, reason: 'legacy-database-not-present' };

  const database = await new Promise((resolve, reject) => {
    const request = indexedDb.open(LEGACY_PREVIEW_STORAGE.indexedDbName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open legacy Preview database read-only'));
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      reject(new Error('Refusing to create or upgrade the legacy Preview database during probe'));
    };
  });

  try {
    if (!database.objectStoreNames.contains(LEGACY_PREVIEW_STORAGE.objectStore)) {
      return { ...unavailable, reason: 'legacy-object-store-not-present', databaseVersion: database.version };
    }
    const transaction = database.transaction([LEGACY_PREVIEW_STORAGE.objectStore], 'readonly');
    const store = transaction.objectStore(LEGACY_PREVIEW_STORAGE.objectStore);
    const [recordCount, record] = await Promise.all([
      requestPromise(store.count()),
      requestPromise(store.get(LEGACY_PREVIEW_STORAGE.recordKey)),
    ]);
    return {
      available: true,
      reason: null,
      storage: LEGACY_PREVIEW_STORAGE,
      databaseVersion: database.version,
      recordCount,
      ...summarizeLegacyRecord(record),
      wroteLegacyData: false,
      invokedPreviewCode: false,
    };
  } finally {
    database.close();
  }
}
