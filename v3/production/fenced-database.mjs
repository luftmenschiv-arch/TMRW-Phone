import { V3_RUNTIME_LEASE_KEY } from '../storage/schema.mjs';

function assertCapability(capability) {
  if (capability !== 'normal' && capability !== 'transition') {
    throw new TypeError(`Unsupported authoring capability: ${capability}`);
  }
}

function withMetadata(storeNames) {
  if (!Array.isArray(storeNames) || storeNames.length === 0) throw new TypeError('At least one object store is required');
  return [...new Set([...storeNames, 'metadata'])];
}

export class FencedV3Database {
  #database;
  #runtimeGuard;
  #authoringFence;
  #capability;
  #activeReadwrite = 0;
  #quiescenceWaiters = new Set();

  constructor({ database, runtimeGuard, authoringFence, capability = 'normal' }) {
    if (!database || typeof database.transaction !== 'function') throw new TypeError('FencedV3Database requires a raw V3 database');
    if (!runtimeGuard || typeof runtimeGuard.validateLeaseRecord !== 'function') throw new TypeError('FencedV3Database requires a hardened V3RuntimeGuard');
    if (!authoringFence || typeof authoringFence.assertCapability !== 'function' || typeof authoringFence.failClosed !== 'function') {
      throw new TypeError('FencedV3Database requires an AuthoringFence');
    }
    assertCapability(capability);
    this.#database = database;
    this.#runtimeGuard = runtimeGuard;
    this.#authoringFence = authoringFence;
    this.#capability = capability;
  }

  get databaseName() {
    return this.#database.databaseName;
  }

  get schemaVersion() {
    return this.#database.schemaVersion;
  }

  get isOpen() {
    return this.#database.isOpen;
  }

  get diagnostics() {
    return this.#database.diagnostics;
  }

  get capability() {
    return this.#capability;
  }

  get activeReadwriteTransactions() {
    return this.#activeReadwrite;
  }

  waitForQuiescence() {
    if (this.#activeReadwrite === 0) return Promise.resolve();
    return new Promise(resolve => this.#quiescenceWaiters.add(resolve));
  }

  #finishReadwrite() {
    this.#activeReadwrite = Math.max(0, this.#activeReadwrite - 1);
    if (this.#activeReadwrite !== 0) return;
    const waiters = [...this.#quiescenceWaiters];
    this.#quiescenceWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  async open() {
    await this.#database.open();
    return this;
  }

  close() {
    return this.#database.close();
  }

  async transaction(storeNames, mode, work) {
    if (typeof work !== 'function') throw new TypeError('Transaction work callback is required');
    if (mode === 'readonly') return this.#database.transaction(storeNames, mode, work);
    if (mode !== 'readwrite') throw new TypeError(`Unsupported transaction mode: ${mode}`);

    this.#authoringFence.assertCapability(this.#capability);
    const fencedStoreNames = withMetadata(storeNames);
    let callbackStarted = false;
    let admitted = false;
    let workError = null;

    this.#activeReadwrite += 1;
    try {
      try {
        return await this.#database.transaction(fencedStoreNames, 'readwrite', async transaction => {
          callbackStarted = true;
          this.#authoringFence.assertCapability(this.#capability);

          let leaseRecord;
          try {
            leaseRecord = await transaction.store('metadata').get(V3_RUNTIME_LEASE_KEY);
          } catch (error) {
            this.#authoringFence.failClosed('lease-read-failed');
            throw error;
          }

          let validation;
          try {
            validation = this.#runtimeGuard.validateLeaseRecord(leaseRecord);
          } catch (error) {
            this.#authoringFence.failClosed('lease-validation-unavailable');
            throw error;
          }
          if (!validation.valid) {
            this.#authoringFence.failClosed(`lease-${validation.reason}`);
            const error = new Error(`Canonical write rejected: lease ${validation.reason}`);
            error.code = 'TMRW_LEASE_FENCE_REJECTED';
            throw error;
          }

          admitted = true;
          try {
            return await work(transaction);
          } catch (error) {
            workError = error;
            throw error;
          }
        });
      } catch (error) {
        // A rejected domain operation (validation, idempotency, etc.) normally
        // aborts the underlying IndexedDB transaction. Some browser adapters
        // surface that abort as a different Error instance, so object identity
        // is not sufficient to recognize it. The lease was already proven in
        // this transaction; do not turn one rejected action into a phone-wide
        // authoring shutdown.
        if (workError) throw error;
        if (!callbackStarted) this.#authoringFence.failClosed('database-transaction-unavailable');
        else if (admitted) this.#authoringFence.failClosed('database-transaction-failed');
        throw error;
      }
    } finally {
      this.#finishReadwrite();
    }
  }
}

export function createFencedV3Database(options) {
  return new FencedV3Database(options);
}
