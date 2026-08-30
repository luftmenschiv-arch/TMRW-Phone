import {
  decodePreviewMigrationCurrentStorage,
  encodePreviewMigrationCurrentStorage,
  SCOPED_V3_STORES,
  V3_STORE_DEFINITIONS,
} from './schema.mjs';
import { V3ScopeRequiredError } from './errors.mjs';

const PREVIEW_MIGRATION_ITEM_STORE = 'previewMigrationItems';
const PREVIEW_MIGRATION_CURRENT_INDEX = 'by_source_current';

function encodeRecordForStorage(storeName, record) {
  if (storeName !== PREVIEW_MIGRATION_ITEM_STORE || !record) return record;
  return { ...record, current: encodePreviewMigrationCurrentStorage(record.current) };
}

function decodeRecordFromStorage(storeName, record) {
  if (storeName !== PREVIEW_MIGRATION_ITEM_STORE || !record) return record;
  return { ...record, current: decodePreviewMigrationCurrentStorage(record.current) };
}

function decodeRecordsFromStorage(storeName, records) {
  return records.map(record => decodeRecordFromStorage(storeName, record));
}

function encodeIndexQueryForStorage(storeName, indexName, query) {
  if (storeName !== PREVIEW_MIGRATION_ITEM_STORE || indexName !== PREVIEW_MIGRATION_CURRENT_INDEX) return query;
  if (!Array.isArray(query) || query.length !== 3) throw new TypeError('Preview migration current lookup requires [sourceAuthority, sourceRecordId, current]');
  return [query[0], query[1], encodePreviewMigrationCurrentStorage(query[2])];
}

function validScope(scope) {
  return Boolean(scope && typeof scope.storyId === 'string' && scope.storyId && typeof scope.branchId === 'string' && scope.branchId);
}

function assertScope(storeName, scope) {
  if (SCOPED_V3_STORES.has(storeName) && !validScope(scope)) throw new V3ScopeRequiredError(storeName);
}

function assertRecordScope(storeName, scope, record) {
  if (!SCOPED_V3_STORES.has(storeName)) return;
  assertScope(storeName, scope);
  if (record?.storyId !== scope.storyId || record?.branchId !== scope.branchId) {
    throw new V3ScopeRequiredError(storeName);
  }
}

export class V3Repository {
  #storeName;
  #store;
  #scope;
  #privileged;

  constructor({ storeName, transaction, scope = null, privileged = false }) {
    if (!V3_STORE_DEFINITIONS[storeName]) throw new TypeError(`Unknown v3 repository: ${storeName}`);
    if (!privileged) assertScope(storeName, scope);
    this.#storeName = storeName;
    this.#store = transaction.store(storeName);
    this.#scope = scope;
    this.#privileged = privileged;
  }

  get storeName() {
    return this.#storeName;
  }

  async get(id) {
    const record = decodeRecordFromStorage(this.#storeName, await this.#store.get(id));
    if (!record || this.#privileged || !SCOPED_V3_STORES.has(this.#storeName)) return record;
    return record.storyId === this.#scope.storyId && record.branchId === this.#scope.branchId ? record : undefined;
  }

  async list() {
    const records = this.#privileged || !SCOPED_V3_STORES.has(this.#storeName)
      ? await this.#store.getAll()
      : await this.#store.getAllByIndex('by_story_branch', [this.#scope.storyId, this.#scope.branchId]);
    return decodeRecordsFromStorage(this.#storeName, records);
  }

  async count() {
    return (await this.list()).length;
  }

  async getByIndex(indexName, query) {
    const storageQuery = encodeIndexQueryForStorage(this.#storeName, indexName, query);
    const record = decodeRecordFromStorage(this.#storeName, await this.#store.getByIndex(indexName, storageQuery));
    if (!record || this.#privileged || !SCOPED_V3_STORES.has(this.#storeName)) return record;
    return record.storyId === this.#scope.storyId && record.branchId === this.#scope.branchId ? record : undefined;
  }

  async listByIndex(indexName, query) {
    const storageQuery = encodeIndexQueryForStorage(this.#storeName, indexName, query);
    const records = decodeRecordsFromStorage(this.#storeName, await this.#store.getAllByIndex(indexName, storageQuery));
    if (this.#privileged || !SCOPED_V3_STORES.has(this.#storeName)) return records;
    return records.filter(record => record.storyId === this.#scope.storyId && record.branchId === this.#scope.branchId);
  }

  async countByIndex(indexName, query) {
    if (SCOPED_V3_STORES.has(this.#storeName) && !this.#privileged) {
      const scoped = Array.isArray(query) && query[0] === this.#scope.storyId && query[1] === this.#scope.branchId;
      if (!scoped) throw new V3ScopeRequiredError(this.#storeName);
    }
    return this.#store.countByIndex(indexName, encodeIndexQueryForStorage(this.#storeName, indexName, query));
  }

  async listByIndexRange(indexName, range, { limit } = {}) {
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new TypeError('Index range limit must be a positive integer');
    if (limit !== undefined && SCOPED_V3_STORES.has(this.#storeName) && !this.#privileged) {
      const scoped = value => Array.isArray(value) && value[0] === this.#scope.storyId && value[1] === this.#scope.branchId;
      if (!scoped(range?.lower) || !scoped(range?.upper)) throw new V3ScopeRequiredError(this.#storeName);
    }
    const storageRange = this.#storeName === PREVIEW_MIGRATION_ITEM_STORE && indexName === PREVIEW_MIGRATION_CURRENT_INDEX
      ? {
          ...range,
          lower: range?.lower === undefined ? undefined : encodeIndexQueryForStorage(this.#storeName, indexName, range.lower),
          upper: range?.upper === undefined ? undefined : encodeIndexQueryForStorage(this.#storeName, indexName, range.upper),
        }
      : range;
    const records = decodeRecordsFromStorage(this.#storeName, await this.#store.getAllByIndexRange(indexName, storageRange, limit));
    if (this.#privileged || !SCOPED_V3_STORES.has(this.#storeName)) return records;
    return records.filter(record => record.storyId === this.#scope.storyId && record.branchId === this.#scope.branchId);
  }

  async put(record) {
    if (!this.#privileged) assertRecordScope(this.#storeName, this.#scope, record);
    return this.#store.put(encodeRecordForStorage(this.#storeName, record));
  }

  async delete(id) {
    if (!this.#privileged && SCOPED_V3_STORES.has(this.#storeName)) {
      const record = await this.get(id);
      if (!record) return false;
    }
    await this.#store.delete(id);
    return true;
  }
}

export function createRepository({ storeName, transaction, scope }) {
  return new V3Repository({ storeName, transaction, scope, privileged: false });
}

export function createPrivilegedRepository({ storeName, transaction, capability }) {
  if (capability !== PRIVILEGED_STORAGE_CAPABILITY) throw new Error('Privileged raw storage capability is required');
  return new V3Repository({ storeName, transaction, privileged: true });
}

export const PRIVILEGED_STORAGE_CAPABILITY = Symbol('TMRW v3 privileged storage');
