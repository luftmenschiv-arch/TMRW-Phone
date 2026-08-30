import {
  V3_GENERATION_INTERCEPTOR_KEY,
  V3_PRODUCTION_RUNTIME_ID,
} from './constants.mjs';

const PASSIVE_SHIM_MARKER = Symbol.for('tmrw.v3.production.passive-generation-interceptor');
const OWNER_SHIM_MARKER = Symbol.for('tmrw.v3.production.generation-interceptor-owner');
const GLOBAL_OWNERS = new WeakMap();

function createPassiveShim() {
  const shim = async function tmrwV3PassiveGenerationInterceptor() {};
  Object.defineProperty(shim, PASSIVE_SHIM_MARKER, {
    value: V3_PRODUCTION_RUNTIME_ID,
    enumerable: false,
  });
  return shim;
}

export class GenerationInterceptorOwner {
  #authoringGate;
  #runtimeGuard;
  #globalObject;
  #globalKey;
  #delegate = null;
  #shim;
  #installed = false;
  #disposed = false;
  #conflict = false;
  #lastError = null;
  #abortCalls = 0;
  #invocations = 0;

  constructor({ authoringGate, runtimeGuard, globalObject = globalThis, globalKey = V3_GENERATION_INTERCEPTOR_KEY } = {}) {
    if (!authoringGate || typeof authoringGate.allows !== 'function' || typeof authoringGate.close !== 'function') {
      throw new TypeError('GenerationInterceptorOwner requires the Production Authoring Gate');
    }
    if (!runtimeGuard || typeof runtimeGuard.ownsLease !== 'boolean') {
      throw new TypeError('GenerationInterceptorOwner requires the acquired runtime guard');
    }
    if (!globalObject || (typeof globalObject !== 'object' && typeof globalObject !== 'function')) {
      throw new TypeError('GenerationInterceptorOwner requires a global object');
    }
    if (typeof globalKey !== 'string' || !globalKey) throw new TypeError('GenerationInterceptorOwner requires a global hook key');

    this.#authoringGate = authoringGate;
    this.#runtimeGuard = runtimeGuard;
    this.#globalObject = globalObject;
    this.#globalKey = globalKey;

    this.#shim = async (chat, contextSize, abort, type) => {
      this.#invocations += 1;
      let aborted = false;
      const abortOnce = immediately => {
        if (aborted) return false;
        aborted = true;
        this.#abortCalls += 1;
        if (typeof abort === 'function') abort(immediately);
        return true;
      };

      if (!this.#delegate) return;
      if (this.#runtimeGuard.ownsLease !== true) {
        this.#authoringGate.close('generation-interceptor-runtime-owner-lost');
        return;
      }
      if (!this.#authoringGate.allows('normal')) return;

      try {
        await this.#delegate.generateInterceptor(chat, contextSize, abortOnce, type);
      } catch (error) {
        this.#lastError = String(error?.message || error || 'unknown-generation-interceptor-error');
        this.#authoringGate.close('generation-interceptor-critical-error');
        abortOnce(true);
      }
    };
    Object.defineProperty(this.#shim, OWNER_SHIM_MARKER, {
      value: V3_PRODUCTION_RUNTIME_ID,
      enumerable: false,
    });
  }

  get status() {
    return Object.freeze({
      installed: this.#installed && this.#globalObject[this.#globalKey] === this.#shim,
      delegateActive: Boolean(this.#delegate),
      runtimeOwner: this.#runtimeGuard.ownsLease === true,
      gateOpen: this.#authoringGate.allows('normal') === true,
      conflict: this.#conflict,
      disposed: this.#disposed,
      lastError: this.#lastError,
      invocations: this.#invocations,
      abortCalls: this.#abortCalls,
    });
  }

  installShim() {
    if (this.#disposed) return false;
    if (this.#installed && this.#globalObject[this.#globalKey] === this.#shim) return false;

    const registeredOwner = GLOBAL_OWNERS.get(this.#globalObject);
    if (registeredOwner && registeredOwner !== this) {
      this.#conflict = true;
      this.#authoringGate.close('generation-interceptor-ownership-conflict');
      return false;
    }

    const current = this.#globalObject[this.#globalKey];
    const ownPassive = current?.[PASSIVE_SHIM_MARKER] === V3_PRODUCTION_RUNTIME_ID;
    if (current !== undefined && current !== null && current !== this.#shim && !ownPassive) {
      this.#conflict = true;
      this.#authoringGate.close('generation-interceptor-ownership-conflict');
      return false;
    }

    GLOBAL_OWNERS.set(this.#globalObject, this);
    this.#globalObject[this.#globalKey] = this.#shim;
    this.#installed = true;
    this.#conflict = false;
    this.#lastError = null;
    return true;
  }

  activateDelegate(runtimeIntegration) {
    if (this.#disposed) return false;
    if (!runtimeIntegration || typeof runtimeIntegration.generateInterceptor !== 'function') {
      throw new TypeError('GenerationInterceptorOwner requires SillyTavernV3RuntimeIntegration');
    }
    if (this.#runtimeGuard.ownsLease !== true) {
      this.#authoringGate.close('generation-interceptor-runtime-owner-lost');
      return false;
    }
    if (!this.#installed && !this.installShim()) return false;
    if (this.#delegate === runtimeIntegration) return false;
    if (this.#delegate) {
      this.#conflict = true;
      this.#authoringGate.close('generation-interceptor-delegate-conflict');
      return false;
    }
    this.#delegate = runtimeIntegration;
    this.#conflict = false;
    return true;
  }

  deactivateDelegate() {
    if (!this.#delegate) return false;
    this.#delegate = null;
    return true;
  }

  dispose() {
    if (this.#disposed) return false;
    this.deactivateDelegate();
    if (GLOBAL_OWNERS.get(this.#globalObject) === this) GLOBAL_OWNERS.delete(this.#globalObject);
    if (this.#globalObject[this.#globalKey] === this.#shim) this.#globalObject[this.#globalKey] = createPassiveShim();
    this.#installed = false;
    this.#disposed = true;
    return true;
  }
}
