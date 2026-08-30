import { V3_BETA_SETTINGS_KEY } from '../storage/schema.mjs';

const defaultState = () => ({
  contractVersion: 1,
  requested: false,
  releaseChannel: 'beta',
  boundaryPhase: 1,
  authoringEnabled: false,
  lastInitialization: 'never',
  lastError: null,
  updatedAt: null,
});

export class V3BetaFeatureFlag {
  #storage;
  #key;
  #now;

  constructor({ storage = globalThis.localStorage, key = V3_BETA_SETTINGS_KEY, now = () => new Date().toISOString() } = {}) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      throw new TypeError('An explicit key-value storage implementation is required for the v3 beta flag');
    }
    if (key !== V3_BETA_SETTINGS_KEY) throw new Error(`Refusing unexpected v3 beta settings key: ${String(key)}`);
    this.#storage = storage;
    this.#key = key;
    this.#now = now;
  }

  get key() {
    return this.#key;
  }

  read() {
    try {
      const parsed = JSON.parse(this.#storage.getItem(this.#key) || 'null');
      return parsed && typeof parsed === 'object' ? { ...defaultState(), ...parsed, authoringEnabled: false } : defaultState();
    } catch {
      return defaultState();
    }
  }

  requestEnable() {
    return this.#write({ ...this.read(), requested: true, authoringEnabled: false, lastError: null });
  }

  recordInitialized(role) {
    return this.#write({ ...this.read(), requested: true, authoringEnabled: false, lastInitialization: role, lastError: null });
  }

  recordFailure(error) {
    return this.#write({ ...this.read(), authoringEnabled: false, lastInitialization: 'failed', lastError: String(error?.message || error || 'unknown') });
  }

  requestDisable() {
    return this.#write({ ...this.read(), requested: false, authoringEnabled: false, lastInitialization: 'disabled', lastError: null });
  }

  #write(value) {
    const next = { ...defaultState(), ...value, boundaryPhase: 1, authoringEnabled: false, updatedAt: this.#now() };
    this.#storage.setItem(this.#key, JSON.stringify(next));
    return next;
  }
}

export class MemoryKeyValueStorage {
  #values;

  constructor(values = new Map()) {
    this.#values = values;
  }

  getItem(key) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }

  setItem(key, value) {
    this.#values.set(String(key), String(value));
  }

  removeItem(key) {
    this.#values.delete(String(key));
  }

  snapshot() {
    return Object.fromEntries(this.#values);
  }
}
