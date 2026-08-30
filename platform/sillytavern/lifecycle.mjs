import { V3RuntimeGuard } from '../../beta/runtime-guard.mjs';

class LifecycleResources {
  #resources = new Map();

  add(kind, key, dispose) {
    const id = `${kind}:${key}`;
    if (this.#resources.has(id)) return false;
    if (typeof dispose !== 'function') throw new TypeError('Lifecycle cleanup must be a function');
    this.#resources.set(id, { kind, key, dispose });
    return true;
  }

  counts() {
    const result = { listeners: 0, timers: 0, jobs: 0, adapters: 0, other: 0 };
    for (const resource of this.#resources.values()) {
      if (resource.kind in result) result[resource.kind] += 1;
      else result.other += 1;
    }
    return result;
  }

  async disposeAll() {
    const resources = [...this.#resources.values()].reverse();
    this.#resources.clear();
    const errors = [];
    for (const resource of resources) {
      try { await resource.dispose(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'One or more v3 lifecycle resources failed to stop');
  }
}

export class V3BetaLifecycle {
  #featureFlag;
  #databaseFactory;
  #ownerId;
  #eventTarget;
  #activation;
  #state = 'disabled';
  #database = null;
  #guard = null;
  #resources = new LifecycleResources();
  #initializationPromise = null;
  #generation = 0;
  #lastError = null;
  #authoringEnabled = false;

  constructor({ featureFlag, databaseFactory, ownerId, eventTarget = null, activation = null }) {
    if (!featureFlag || !databaseFactory || !ownerId) throw new TypeError('featureFlag, databaseFactory, and ownerId are required');
    this.#featureFlag = featureFlag;
    this.#databaseFactory = databaseFactory;
    this.#ownerId = ownerId;
    this.#eventTarget = eventTarget;
    this.#activation = activation;
  }

  get status() {
    return Object.freeze({
      state: this.#state,
      ownerId: this.#ownerId,
      ownsRuntimeLease: Boolean(this.#guard?.ownsLease),
      runtimeLeaseId: this.#guard?.leaseId ?? null,
      authoringEnabled: this.#authoringEnabled,
      databaseOpen: Boolean(this.#database?.isOpen),
      resources: this.#resources.counts(),
      lastError: this.#lastError,
    });
  }

  async initializeIfOptedIn() {
    if (!this.#featureFlag.read().requested) return this.status;
    return this.#initialize();
  }

  async enable() {
    this.#featureFlag.requestEnable();
    return this.#initialize();
  }

  async #initialize() {
    if (this.#state === 'enabled-owner' || this.#state === 'enabled-standby') return this.status;
    if (this.#initializationPromise) return this.#initializationPromise;
    const generation = ++this.#generation;
    this.#state = 'initializing';
    this.#lastError = null;
    this.#initializationPromise = (async () => {
      const database = this.#databaseFactory();
      try {
        await database.open();
        if (generation !== this.#generation || !this.#featureFlag.read().requested) {
          database.close();
          this.#state = 'disabled';
          return this.status;
        }
        const guard = new V3RuntimeGuard({ database, ownerId: this.#ownerId });
        const lease = await guard.acquire();
        if (generation !== this.#generation || !this.#featureFlag.read().requested) {
          if (lease.acquired) await guard.release();
          database.close();
          this.#state = 'disabled';
          return this.status;
        }
        this.#database = database;
        this.#guard = guard;
        this.#state = lease.acquired ? 'enabled-owner' : 'enabled-standby';
        this.#featureFlag.recordInitialized(lease.acquired ? 'boundary-owner' : 'boundary-standby');
        this.#bindCrossWindowDisable();
        if (this.#activation) {
          const activation = await this.#activation({
            role: this.#state,
            database,
            runtimeGuard: lease.acquired ? guard : null,
            resources: this.#resources,
            authoringEnabled: false,
          });
          this.#authoringEnabled = Boolean(activation?.authoringEnabled);
        }
        return this.status;
      } catch (error) {
        try { await this.#resources.disposeAll(); } catch {}
        try { await this.#guard?.release(); } catch {}
        database.close();
        this.#database = null;
        this.#guard = null;
        this.#state = 'failed';
        this.#authoringEnabled = false;
        this.#lastError = String(error?.message || error);
        this.#featureFlag.recordFailure(error);
        return this.status;
      }
    })();
    try {
      return await this.#initializationPromise;
    } finally {
      this.#initializationPromise = null;
    }
  }

  #bindCrossWindowDisable() {
    if (!this.#eventTarget?.addEventListener || !this.#eventTarget?.removeEventListener) return;
    const handler = event => {
      if (event?.key === this.#featureFlag.key && !this.#featureFlag.read().requested) {
        void this.disable({ updateFlag: false });
      }
    };
    this.#eventTarget.addEventListener('storage', handler);
    this.#resources.add('listeners', 'beta-storage-flag', () => this.#eventTarget.removeEventListener('storage', handler));
  }

  async reconcile() {
    if (!this.#featureFlag.read().requested && this.#state !== 'disabled') return this.disable({ updateFlag: false });
    if (this.#featureFlag.read().requested && this.#state === 'disabled') return this.#initialize();
    return this.status;
  }

  async disable({ updateFlag = true } = {}) {
    ++this.#generation;
    if (updateFlag) this.#featureFlag.requestDisable();
    if (this.#initializationPromise) await this.#initializationPromise.catch(() => {});
    const errors = [];
    try { await this.#resources.disposeAll(); } catch (error) { errors.push(error); }
    try { await this.#guard?.release(); } catch (error) { errors.push(error); }
    this.#database?.close();
    this.#database = null;
    this.#guard = null;
    this.#state = 'disabled';
    this.#authoringEnabled = false;
    this.#lastError = errors.length ? String(new AggregateError(errors, 'Disable cleanup failed').message) : null;
    return this.status;
  }
}

export function createSillyTavernLifecycle(options) {
  return new V3BetaLifecycle(options);
}
