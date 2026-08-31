import { V3SchemaError, V3StorageUnavailableError, V3UniqueConstraintError } from './errors.mjs';
import {
  assertExactV3DatabaseName,
  V3_DATABASE_NAME,
  V3_SCHEMA_ID,
  V3_SCHEMA_METADATA_KEY,
  V3_SCHEMA_VERSION,
  normalizePreviewMigrationCurrentStorage,
  V3_STORE_DEFINITIONS,
  schemaMetadata,
} from './schema.mjs';

const clone = value => value === undefined ? undefined : structuredClone(value);
const keyValue = (record, keyPath) => Array.isArray(keyPath) ? keyPath.map(key => record?.[key]) : record?.[keyPath];
const encodedIndexKey = value => JSON.stringify(value);
const memoryIndexCache = new WeakMap();

function assertPreviewMigrationCurrentStorageValue(storeName, value) {
  if (storeName !== 'previewMigrationItems') return;
  if (value !== 0 && value !== 1) throw new V3SchemaError('previewMigrationItems.current must be persisted as numeric 0 or 1');
}

function assertPreviewMigrationCurrentIndexQuery(storeName, indexName, query) {
  if (storeName !== 'previewMigrationItems' || indexName !== 'by_source_current') return;
  if (!Array.isArray(query) || query.length !== 3) throw new V3SchemaError('previewMigrationItems.by_source_current requires a three-part compound key');
  assertPreviewMigrationCurrentStorageValue(storeName, query[2]);
}

function upgradePreviewMigrationCurrentStorage(stores) {
  const records = stores.get('previewMigrationItems');
  if (!records) return;
  for (const [key, record] of records.entries()) {
    let current;
    try {
      current = normalizePreviewMigrationCurrentStorage(record?.current);
    } catch {
      throw new V3SchemaError('Existing previewMigrationItems.current state is malformed and cannot be upgraded safely');
    }
    records.set(key, { ...record, current });
  }
}

function indexedRecords(records, storeName, indexName) {
  let storeIndexes = memoryIndexCache.get(records);
  if (!storeIndexes) {
    storeIndexes = new Map();
    memoryIndexCache.set(records, storeIndexes);
  }
  if (!storeIndexes.has(indexName)) {
    const definition = V3_STORE_DEFINITIONS[storeName].indexes.find(row => row.name === indexName);
    if (!definition) throw new V3SchemaError(`Unknown index ${indexName} on ${storeName}`);
    const index = new Map();
    for (const record of records.values()) {
      const encoded = encodedIndexKey(keyValue(record, definition.keyPath));
      if (!index.has(encoded)) index.set(encoded, []);
      index.get(encoded).push(record);
    }
    storeIndexes.set(indexName, index);
  }
  return storeIndexes.get(indexName);
}

function updateCachedIndexes(records, storeName, previous, next) {
  const storeIndexes = memoryIndexCache.get(records);
  if (!storeIndexes) return;
  const definitions = new Map(V3_STORE_DEFINITIONS[storeName].indexes.map(index => [index.name, index]));
  for (const [indexName, index] of storeIndexes.entries()) {
    const definition = definitions.get(indexName);
    if (previous !== undefined) {
      const previousKey = encodedIndexKey(keyValue(previous, definition.keyPath));
      const values = index.get(previousKey) || [];
      const remaining = values.filter(record => record !== previous);
      if (remaining.length) index.set(previousKey, remaining);
      else index.delete(previousKey);
    }
    if (next !== undefined) {
      const nextKey = encodedIndexKey(keyValue(next, definition.keyPath));
      if (!index.has(nextKey)) index.set(nextKey, []);
      index.get(nextKey).push(next);
    }
  }
}

function emptyState(version = 0) {
  return { version, stores: new Map(), connections: 0, writeCommits: 0, lastCommit: null };
}

function cloneStores(stores) {
  return new Map([...stores.entries()].map(([name, records]) => [name, new Map([...records.entries()].map(([key, value]) => [key, clone(value)]))]));
}

function cloneTransactionStores(stores, storeNames) {
  const draft = new Map(stores);
  for (const name of storeNames) {
    const records = stores.get(name);
    // Stored records are never exposed directly: every read and write crosses
    // a structured-clone boundary. A shallow Map copy therefore preserves
    // transaction rollback without deep-cloning an unchanged 100k-record
    // store on every incremental operation.
    const copy = new Map(records);
    const cached = memoryIndexCache.get(records);
    if (cached) {
      memoryIndexCache.set(copy, new Map([...cached.entries()].map(([indexName, index]) => [
        indexName,
        new Map([...index.entries()].map(([key, values]) => [key, [...values]])),
      ])));
    }
    draft.set(name, copy);
  }
  return draft;
}

function validateUniqueIndexes(stores, onlyStores = null, changedKeys = null) {
  const entries = onlyStores
    ? [...onlyStores].map(storeName => [storeName, V3_STORE_DEFINITIONS[storeName]])
    : Object.entries(V3_STORE_DEFINITIONS);
  for (const [storeName, definition] of entries) {
    const records = stores.get(storeName) || new Map();
    for (const index of definition.indexes.filter(row => row.unique)) {
      const indexed = indexedRecords(records, storeName, index.name);
      const changed = changedKeys?.get(storeName);
      if (changed) {
        for (const key of changed) {
          const record = records.get(key);
          if (!record) continue;
          const value = keyValue(record, index.keyPath);
          if (value === undefined || (Array.isArray(value) && value.some(part => part === undefined))) continue;
          if ((indexed.get(encodedIndexKey(value)) || []).length > 1) throw new V3UniqueConstraintError(storeName, index.name);
        }
      } else {
        for (const values of indexed.values()) {
          if (values.length > 1) throw new V3UniqueConstraintError(storeName, index.name);
        }
      }
    }
  }
}

function materializeDeclaredIndexes(stores, storeNames) {
  for (const storeName of storeNames) {
    const records = stores.get(storeName);
    for (const index of V3_STORE_DEFINITIONS[storeName].indexes) indexedRecords(records, storeName, index.name);
  }
}

class MemoryStoreView {
  #storeName;
  #records;
  #mode;
  #touched;

  constructor(storeName, records, mode, touched) {
    this.#storeName = storeName;
    this.#records = records;
    this.#mode = mode;
    this.#touched = touched;
  }

  async get(key) {
    return clone(this.#records.get(key));
  }

  async getAll() {
    return [...this.#records.values()].map(clone);
  }

  async count() {
    return this.#records.size;
  }

  async put(record) {
    if (this.#mode !== 'readwrite') throw new Error('Readonly transaction cannot write');
    if (this.#storeName === 'previewMigrationItems') assertPreviewMigrationCurrentStorageValue(this.#storeName, record?.current);
    const definition = V3_STORE_DEFINITIONS[this.#storeName];
    const key = keyValue(record, definition.keyPath);
    if (key === undefined || key === null || key === '') throw new V3SchemaError(`Missing key for ${this.#storeName}`);
    const previous = this.#records.get(key);
    const next = clone(record);
    this.#records.set(key, next);
    updateCachedIndexes(this.#records, this.#storeName, previous, next);
    if (!this.#touched.has(this.#storeName)) this.#touched.set(this.#storeName, new Set());
    this.#touched.get(this.#storeName).add(key);
    return key;
  }

  async delete(key) {
    if (this.#mode !== 'readwrite') throw new Error('Readonly transaction cannot write');
    const previous = this.#records.get(key);
    const changed = this.#records.delete(key);
    if (changed) updateCachedIndexes(this.#records, this.#storeName, previous, undefined);
    if (changed) {
      if (!this.#touched.has(this.#storeName)) this.#touched.set(this.#storeName, new Set());
      this.#touched.get(this.#storeName).add(key);
    }
  }

  async getAllByIndex(indexName, query) {
    assertPreviewMigrationCurrentIndexQuery(this.#storeName, indexName, query);
    const encoded = encodedIndexKey(query);
    return (indexedRecords(this.#records, this.#storeName, indexName).get(encoded) || []).map(clone);
  }

  async getByIndex(indexName, query) {
    return (await this.getAllByIndex(indexName, query))[0];
  }

  async countByIndex(indexName, query) {
    assertPreviewMigrationCurrentIndexQuery(this.#storeName, indexName, query);
    const encoded = encodedIndexKey(query);
    return (indexedRecords(this.#records, this.#storeName, indexName).get(encoded) || []).length;
  }

  async getAllByIndexRange(indexName, range, limit = undefined) {
    if (range?.lower !== undefined) assertPreviewMigrationCurrentIndexQuery(this.#storeName, indexName, range.lower);
    if (range?.upper !== undefined) assertPreviewMigrationCurrentIndexQuery(this.#storeName, indexName, range.upper);
    const definition = V3_STORE_DEFINITIONS[this.#storeName].indexes.find(row => row.name === indexName);
    if (!definition) throw new V3SchemaError(`Unknown index ${indexName} on ${this.#storeName}`);
    const compare = (left, right) => {
      if (Array.isArray(left) && Array.isArray(right)) {
        for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
          const result = compare(left[index], right[index]);
          if (result !== 0) return result;
        }
        return 0;
      }
      if (left === right) return 0;
      if (left === undefined) return -1;
      if (right === undefined) return 1;
      return left < right ? -1 : 1;
    };
    const records = [...this.#records.values()]
      .filter(record => {
        const value = keyValue(record, definition.keyPath);
        const lower = range?.lower === undefined ? 1 : compare(value, range.lower);
        const upper = range?.upper === undefined ? -1 : compare(value, range.upper);
        return (range?.lower === undefined || (range.lowerOpen ? lower > 0 : lower >= 0))
          && (range?.upper === undefined || (range.upperOpen ? upper < 0 : upper <= 0));
      })
      .sort((left, right) => compare(keyValue(left, definition.keyPath), keyValue(right, definition.keyPath)));
    return (limit === undefined ? records : records.slice(0, limit)).map(clone);
  }
}

class MemoryTransactionView {
  #stores;
  #storeNames;
  #mode;
  #touched;

  constructor(stores, storeNames, mode, touched) {
    this.#stores = stores;
    this.#storeNames = new Set(storeNames);
    this.#mode = mode;
    this.#touched = touched;
  }

  get mode() {
    return this.#mode;
  }

  store(name) {
    if (!this.#storeNames.has(name)) throw new Error(`Store ${name} is not in this transaction`);
    return new MemoryStoreView(name, this.#stores.get(name), this.#mode, this.#touched);
  }
}

export class MemoryV3Database {
  #registry;
  #databaseName;
  #opened = false;
  #available;
  #failNextUpgrade;

  constructor({ registry = new Map(), databaseName = V3_DATABASE_NAME, available = true, failNextUpgrade = false } = {}) {
    assertExactV3DatabaseName(databaseName);
    this.#registry = registry;
    this.#databaseName = databaseName;
    this.#available = available;
    this.#failNextUpgrade = failNextUpgrade;
  }

  static createRegistry() {
    return new Map();
  }

  get databaseName() {
    return this.#databaseName;
  }

  get schemaVersion() {
    return V3_SCHEMA_VERSION;
  }

  get isOpen() {
    return this.#opened;
  }

  get diagnostics() {
    const state = this.#registry.get(this.#databaseName);
    return state ? clone({ version: state.version, connections: state.connections, writeCommits: state.writeCommits, lastCommit: state.lastCommit }) : { version: 0, connections: 0, writeCommits: 0, lastCommit: null };
  }

  async open() {
    if (this.#opened) return this;
    if (!this.#available) throw new V3StorageUnavailableError('Synthetic IndexedDB capability is unavailable');
    let state = this.#registry.get(this.#databaseName);
    if (!state) state = emptyState();
    if (state.version > V3_SCHEMA_VERSION) throw new V3SchemaError('Stored schema is newer than this runtime');
    if (state.version < V3_SCHEMA_VERSION) {
      const upgraded = emptyState(V3_SCHEMA_VERSION);
      upgraded.stores = cloneStores(state.stores);
      for (const storeName of Object.keys(V3_STORE_DEFINITIONS)) {
        if (!upgraded.stores.has(storeName)) upgraded.stores.set(storeName, new Map());
      }
      if (state.version < 19) upgradePreviewMigrationCurrentStorage(upgraded.stores);
      if (this.#failNextUpgrade) {
        this.#failNextUpgrade = false;
        throw new V3SchemaError('Injected interrupted schema upgrade');
      }
      const now = new Date().toISOString();
      upgraded.stores.get('metadata').set(V3_SCHEMA_METADATA_KEY, schemaMetadata(now));
      if (state.version < 1) upgraded.stores.get('migrations').set('schema-1', {
        id: 'schema-1', fromVersion: 0, toVersion: 1, name: 'initialize-empty-isolated-v3-schema', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID, legacyDataRead: false, legacyDataWritten: false,
      });
      if (state.version < 2) upgraded.stores.get('migrations').set('schema-2', {
        id: 'schema-2', fromVersion: 1, toVersion: 2, name: 'add-normalized-identity-kernel-stores-and-indexes', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID, legacyDataRead: false, legacyDataWritten: false,
      });
      if (state.version < 3) upgraded.stores.get('migrations').set('schema-3', {
        id: 'schema-3', fromVersion: 2, toVersion: 3, name: 'add-canonical-event-journal-causality-and-projection-engine-stores', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID, legacyDataRead: false, legacyDataWritten: false,
      });
      if (state.version < 4) upgraded.stores.get('migrations').set('schema-4', {
        id: 'schema-4', fromVersion: 3, toVersion: 4, name: 'add-branch-clock-pending-activity-heads-and-chronology-projection-indexes', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID, legacyDataRead: false, legacyDataWritten: false,
      });
      if (state.version < 5) upgraded.stores.get('migrations').set('schema-5', {
        id: 'schema-5', fromVersion: 4, toVersion: 5, name: 'add-scoped-claims-audience-evidence-and-knowledge-grant-projections', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID, legacyDataRead: false, legacyDataWritten: false,
      });
      if (state.version < 6) upgraded.stores.get('migrations').set('schema-6', {
        id: 'schema-6', fromVersion: 5, toVersion: 6, name: 'add-scoped-phone-state-account-session-and-player-access-override-projections', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID, legacyDataRead: false, legacyDataWritten: false,
      });
      if (state.version < 7) upgraded.stores.get('migrations').set('schema-7', {
        id: 'schema-7', fromVersion: 6, toVersion: 7, name: 'add-scoped-contact-number-provenance-and-phone-ui-preference-stores', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID, legacyDataRead: false, legacyDataWritten: false,
      });
      if (state.version < 8) upgraded.stores.get('migrations').set('schema-8', {
        id: 'schema-8', fromVersion: 7, toVersion: 8, name: 'add-scoped-canonical-thread-membership-message-and-recipient-projections', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID, legacyDataRead: false, legacyDataWritten: false,
      });
      if (state.version < 9) upgraded.stores.get('migrations').set('schema-9', {
        id: 'schema-9', fromVersion: 8, toVersion: 9, name: 'add-scoped-canonical-call-session-participant-and-transcript-projections', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID, legacyDataRead: false, legacyDataWritten: false,
      });
      if (state.version < 10) upgraded.stores.get('migrations').set('schema-10', {
        id: 'schema-10', fromVersion: 9, toVersion: 10, name: 'add-scoped-main-rp-handoff-proposal-link-and-live-source-cursor-stores', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID, legacyDataRead: false, legacyDataWritten: false,
      });
      if (state.version < 11) upgraded.stores.get('migrations').set('schema-11', {
        id: 'schema-11', fromVersion: 10, toVersion: 11, name: 'add-isolated-read-only-pocket-shadow-capability-mapping-cursor-observation-quarantine-parity-and-call-fingerprint-stores', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID,
        legacyDataRead: false, legacyDataWritten: false,
      });
      if (state.version < 12) upgraded.stores.get('migrations').set('schema-12', {
        id: 'schema-12', fromVersion: 11, toVersion: 12, name: 'add-preview37-copy-migration-manifest-item-mapping-quarantine-import-and-activation-stores', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID, legacyDataRead: false, legacyDataWritten: false,
      });
      if (state.version < 13) upgraded.stores.get('migrations').set('schema-13', {
        id: 'schema-13', fromVersion: 12, toVersion: 13, name: 'add-milestone1-draft-reaction-sticker-voicemail-and-event-scoped-job-foundations', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID, legacyDataRead: false, legacyDataWritten: false,
      });
      if (state.version < 14) upgraded.stores.get('migrations').set('schema-14', {
        id: 'schema-14', fromVersion: 13, toVersion: 14, name: 'add-director-correction-preview-lock-promotion-audit-and-scope-move-foundations', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID, legacyDataRead: false, legacyDataWritten: false,
      });
      if (state.version < 15) upgraded.stores.get('migrations').set('schema-15', {
        id: 'schema-15', fromVersion: 14, toVersion: 15, name: 'add-scoped-social-persona-graph-post-comment-engagement-decision-and-asset-projections', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID, legacyDataRead: false, legacyDataWritten: false,
      });
      if (state.version < 16) upgraded.stores.get('migrations').set('schema-16', {
        id: 'schema-16', fromVersion: 15, toVersion: 16, name: 'add-scoped-live-session-viewer-message-reaction-persona-and-archive-projections', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID, legacyDataRead: false, legacyDataWritten: false,
      });
      if (state.version < 17) upgraded.stores.get('migrations').set('schema-17', {
        id: 'schema-17', fromVersion: 16, toVersion: 17, name: 'add-scoped-bounded-notification-and-phone-world-projections', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID, legacyDataRead: false, legacyDataWritten: false,
      });
      if (state.version < 18) upgraded.stores.get('migrations').set('schema-18', {
        id: 'schema-18', fromVersion: 17, toVersion: 18, name: 'add-provider-neutral-voice-profile-instance-override-and-derived-audio-artifact-foundations', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID, legacyDataRead: false, legacyDataWritten: false,
      });
      if (state.version < 19) upgraded.stores.get('migrations').set('schema-19', {
        id: 'schema-19', fromVersion: 18, toVersion: 19, name: 'normalize-preview-migration-current-index-key-to-numeric-sentinel', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID, legacyDataRead: false, legacyDataWritten: false,
      });
      if (state.version < 20) upgraded.stores.get('migrations').set('schema-20', {
        id: 'schema-20', fromVersion: 19, toVersion: 20, name: 'add-scoped-phone-world-utility-projection-stores', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID, legacyDataRead: false, legacyDataWritten: false,
      });
      if (state.version < 21) upgraded.stores.get('migrations').set('schema-21', {
        id: 'schema-21', fromVersion: 20, toVersion: 21, name: 'version-preview-migration-batch-source-fingerprint-index', status: 'applied', appliedAt: now,
        databaseName: V3_DATABASE_NAME, schemaId: V3_SCHEMA_ID, legacyDataRead: false, legacyDataWritten: false,
      });
      validateUniqueIndexes(upgraded.stores);
      this.#registry.set(this.#databaseName, upgraded);
      state = upgraded;
    }
    state.connections += 1;
    this.#opened = true;
    return this;
  }

  async transaction(storeNames, mode, work) {
    if (!this.#opened) throw new V3StorageUnavailableError('The isolated memory v3 database is not open');
    if (mode !== 'readonly' && mode !== 'readwrite') throw new TypeError(`Unsupported transaction mode: ${mode}`);
    const state = this.#registry.get(this.#databaseName);
    for (const storeName of storeNames) {
      if (!V3_STORE_DEFINITIONS[storeName] || !state.stores.has(storeName)) throw new V3SchemaError(`Unknown store ${storeName}`);
    }
    const draft = mode === 'readwrite' ? cloneTransactionStores(state.stores, storeNames) : state.stores;
    const touched = new Map();
    const result = await work(new MemoryTransactionView(draft, storeNames, mode, touched));
    if (mode === 'readwrite' && touched.size > 0) {
      validateUniqueIndexes(draft, touched.keys(), touched);
      materializeDeclaredIndexes(draft, touched.keys());
      state.stores = draft;
      state.writeCommits += 1;
      const touchedStores = [...touched.keys()].sort();
      state.lastCommit = { stores: touchedStores, recordCounts: Object.fromEntries(touchedStores.map(name => [name, draft.get(name).size])) };
    }
    return result;
  }

  close() {
    if (!this.#opened) return;
    const state = this.#registry.get(this.#databaseName);
    if (state) state.connections = Math.max(0, state.connections - 1);
    this.#opened = false;
  }

  static deleteExact({ registry, databaseName, confirmation }) {
    assertExactV3DatabaseName(databaseName);
    if (confirmation !== `DELETE:${V3_DATABASE_NAME}`) throw new Error('Exact v3 database deletion confirmation is required');
    registry.delete(databaseName);
  }
}
