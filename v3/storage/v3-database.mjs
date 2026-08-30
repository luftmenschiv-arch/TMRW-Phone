import { V3StorageUnavailableError } from './errors.mjs';
import { applyIndexedDbUpgrade, validateSchemaMetadata } from './migrations.mjs';
import { assertExactV3DatabaseName, V3_DATABASE_NAME, V3_SCHEMA_VERSION } from './schema.mjs';

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

class IndexedDbStoreView {
  #store;

  constructor(store) {
    this.#store = store;
  }

  get(key) {
    return requestPromise(this.#store.get(key));
  }

  getAll() {
    return requestPromise(this.#store.getAll());
  }

  count() {
    return requestPromise(this.#store.count());
  }

  put(record) {
    return requestPromise(this.#store.put(structuredClone(record)));
  }

  delete(key) {
    return requestPromise(this.#store.delete(key));
  }

  getAllByIndex(indexName, query) {
    return requestPromise(this.#store.index(indexName).getAll(query));
  }

  getByIndex(indexName, query) {
    return requestPromise(this.#store.index(indexName).get(query));
  }

  countByIndex(indexName, query) {
    return requestPromise(this.#store.index(indexName).count(query));
  }

  getAllByIndexRange(indexName, range, limit = undefined) {
    if (!globalThis.IDBKeyRange?.bound) throw new V3StorageUnavailableError('IndexedDB key ranges are unavailable');
    const query = globalThis.IDBKeyRange.bound(range.lower, range.upper, Boolean(range.lowerOpen), Boolean(range.upperOpen));
    return requestPromise(limit === undefined ? this.#store.index(indexName).getAll(query) : this.#store.index(indexName).getAll(query, limit));
  }
}

class IndexedDbTransactionView {
  #transaction;
  #mode;

  constructor(transaction, mode) {
    this.#transaction = transaction;
    this.#mode = mode;
  }

  get mode() {
    return this.#mode;
  }

  store(name) {
    return new IndexedDbStoreView(this.#transaction.objectStore(name));
  }
}

export class V3Database {
  #databaseName;
  #indexedDb;
  #database = null;
  #openPromise = null;

  constructor({ indexedDb = globalThis.indexedDB, databaseName = V3_DATABASE_NAME } = {}) {
    assertExactV3DatabaseName(databaseName);
    this.#databaseName = databaseName;
    this.#indexedDb = indexedDb;
  }

  get databaseName() {
    return this.#databaseName;
  }

  get schemaVersion() {
    return V3_SCHEMA_VERSION;
  }

  get isOpen() {
    return Boolean(this.#database);
  }

  async open() {
    if (this.#database) return this;
    if (this.#openPromise) return this.#openPromise;
    if (!this.#indexedDb || typeof this.#indexedDb.open !== 'function') {
      throw new V3StorageUnavailableError();
    }

    this.#openPromise = new Promise((resolve, reject) => {
      const request = this.#indexedDb.open(this.#databaseName, V3_SCHEMA_VERSION);
      request.onupgradeneeded = event => {
        try {
          applyIndexedDbUpgrade({
            database: request.result,
            transaction: request.transaction,
            oldVersion: event.oldVersion,
            newVersion: event.newVersion,
          });
        } catch (error) {
          request.transaction?.abort();
          reject(error);
        }
      };
      request.onblocked = () => reject(new V3StorageUnavailableError('The isolated v3 database upgrade is blocked by another window'));
      request.onerror = () => reject(request.error || new V3StorageUnavailableError('Opening the isolated v3 database failed'));
      request.onsuccess = async () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        this.#database = database;
        try {
          await validateSchemaMetadata(this);
          resolve(this);
        } catch (error) {
          database.close();
          this.#database = null;
          reject(error);
        }
      };
    });

    try {
      return await this.#openPromise;
    } finally {
      this.#openPromise = null;
    }
  }

  async transaction(storeNames, mode, work) {
    if (!this.#database) throw new V3StorageUnavailableError('The isolated v3 database is not open');
    if (!Array.isArray(storeNames) || storeNames.length === 0) throw new TypeError('At least one object store is required');
    if (mode !== 'readonly' && mode !== 'readwrite') throw new TypeError(`Unsupported transaction mode: ${mode}`);

    const transaction = this.#database.transaction(storeNames, mode);
    const completion = new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    });

    let result;
    try {
      result = await work(new IndexedDbTransactionView(transaction, mode));
    } catch (error) {
      try { transaction.abort(); } catch {}
      await completion.catch(() => {});
      throw error;
    }
    await completion;
    return result;
  }

  close() {
    this.#database?.close();
    this.#database = null;
    this.#openPromise = null;
  }

  static async deleteExact({ indexedDb = globalThis.indexedDB, databaseName, confirmation }) {
    assertExactV3DatabaseName(databaseName);
    if (confirmation !== `DELETE:${V3_DATABASE_NAME}`) throw new Error('Exact v3 database deletion confirmation is required');
    if (!indexedDb || typeof indexedDb.deleteDatabase !== 'function') throw new V3StorageUnavailableError();
    await new Promise((resolve, reject) => {
      const request = indexedDb.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Deleting isolated v3 database failed'));
      request.onblocked = () => reject(new Error('Deleting isolated v3 database is blocked by an open window'));
    });
  }
}
