const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;
const RESUME_EVENTS = Object.freeze(['visibilitychange', 'focus', 'pageshow']);
const RECOVERABLE_SUSPENSION_REASONS = new Set(['expired', 'missing-lease']);

function statusSnapshot(heartbeat) {
  return Object.freeze({
    running: heartbeat.running,
    intervalMs: heartbeat.intervalMs,
    ownerId: heartbeat.ownerId,
    leaseId: heartbeat.leaseId,
    renewalCount: heartbeat.renewalCount,
    validationCount: heartbeat.validationCount,
    lastRenewalReason: heartbeat.lastRenewalReason,
    lastValidationReason: heartbeat.lastValidationReason,
    lastFailure: heartbeat.lastFailure,
  });
}

export class LeaseHeartbeat {
  #runtimeGuard;
  #authoringGate;
  #intervalMs;
  #setInterval;
  #clearInterval;
  #eventTarget;
  #visibilityState;
  #timer = null;
  #listeners = new Map();
  #running = false;
  #renewalCount = 0;
  #validationCount = 0;
  #lastRenewalReason = null;
  #lastValidationReason = null;
  #lastFailure = null;
  #operation = null;
  #startPromise = null;

  constructor({
    runtimeGuard,
    authoringGate,
    intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
    setIntervalFn = globalThis.setInterval?.bind(globalThis),
    clearIntervalFn = globalThis.clearInterval?.bind(globalThis),
    eventTarget = null,
    visibilityState = () => globalThis.document?.visibilityState ?? 'visible',
  }) {
    if (!runtimeGuard || typeof runtimeGuard.renew !== 'function' || typeof runtimeGuard.validateLease !== 'function') {
      throw new TypeError('LeaseHeartbeat requires a hardened V3RuntimeGuard');
    }
    if (!authoringGate || typeof authoringGate.close !== 'function') {
      throw new TypeError('LeaseHeartbeat requires a ProductionAuthoringGate');
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new TypeError('Heartbeat interval must be a positive finite number');
    if (typeof setIntervalFn !== 'function' || typeof clearIntervalFn !== 'function') {
      throw new TypeError('Heartbeat scheduling functions are required');
    }
    if (typeof visibilityState !== 'function') throw new TypeError('visibilityState must be a function');

    this.#runtimeGuard = runtimeGuard;
    this.#authoringGate = authoringGate;
    this.#intervalMs = intervalMs;
    this.#setInterval = setIntervalFn;
    this.#clearInterval = clearIntervalFn;
    this.#eventTarget = eventTarget;
    this.#visibilityState = visibilityState;
  }

  get running() { return this.#running; }
  get intervalMs() { return this.#intervalMs; }
  get ownerId() { return this.#runtimeGuard.ownerId ?? null; }
  get leaseId() { return this.#runtimeGuard.leaseId ?? null; }
  get renewalCount() { return this.#renewalCount; }
  get validationCount() { return this.#validationCount; }
  get lastRenewalReason() { return this.#lastRenewalReason; }
  get lastValidationReason() { return this.#lastValidationReason; }
  get lastFailure() { return this.#lastFailure; }
  get status() { return statusSnapshot(this); }

  async start() {
    if (this.#running) return this.status;
    if (this.#startPromise) return this.#startPromise;

    this.#startPromise = (async () => {
      const validation = await this.#validateAuthority('start');
      if (!validation.valid) return this.status;

      try {
        this.#running = true;
        this.#bindResumeSignals();
        this.#timer = this.#setInterval(() => this.#runExclusive(() => this.#renewOnce()), this.#intervalMs);
        return this.status;
      } catch (error) {
        this.#failClosed('schedule-failure', error);
        return this.status;
      }
    })();

    try {
      return await this.#startPromise;
    } finally {
      this.#startPromise = null;
    }
  }

  async stop() {
    if (this.#startPromise) await this.#startPromise.catch(() => {});
    this.#stopScheduling();
    const pending = this.#operation;
    if (pending) await pending.catch(() => {});
    return this.status;
  }

  async validateOnResume(reason = 'resume') {
    if (!this.#running) {
      this.#authoringGate.close('heartbeat-not-running');
      return Object.freeze({ valid: false, reason: 'heartbeat-not-running', status: this.status });
    }
    return this.#runExclusive(() => this.#validateAuthority(reason));
  }

  #runExclusive(work) {
    if (this.#operation) return this.#operation;
    let tracked;
    tracked = Promise.resolve().then(work).finally(() => {
      if (this.#operation === tracked) this.#operation = null;
    });
    this.#operation = tracked;
    return tracked;
  }

  async #renewOnce() {
    if (!this.#running) return Object.freeze({ renewed: false, reason: 'heartbeat-not-running', status: this.status });
    try {
      const result = await this.#runtimeGuard.renew();
      if (!result?.renewed) {
        const recovery = await this.#recoverSuspendedLease(result?.reason);
        if (recovery.acquired) {
          this.#renewalCount += 1;
          this.#lastRenewalReason = `reacquired:${result?.reason || 'unknown'}`;
          this.#lastFailure = null;
          return Object.freeze({ renewed: true, reacquired: true, reason: this.#lastRenewalReason, status: this.status });
        }
        this.#lastRenewalReason = result?.reason || 'renew-unproven';
        this.#failClosed(`renew-${recovery.reason || this.#lastRenewalReason}`);
        return Object.freeze({ renewed: false, reason: this.#lastRenewalReason, status: this.status });
      }
      this.#renewalCount += 1;
      this.#lastRenewalReason = result.reason || 'renewed';
      return Object.freeze({ renewed: true, reason: this.#lastRenewalReason, status: this.status });
    } catch (error) {
      this.#lastRenewalReason = 'renew-unavailable';
      this.#failClosed('renew-unavailable', error);
      return Object.freeze({ renewed: false, reason: 'renew-unavailable', status: this.status });
    }
  }

  async #validateAuthority(reason) {
    try {
      const validation = await this.#runtimeGuard.validateLease();
      this.#validationCount += 1;
      this.#lastValidationReason = validation?.reason || (validation?.valid ? 'valid' : 'unproven');
      if (!validation?.valid) {
        const recovery = await this.#recoverSuspendedLease(validation?.reason);
        if (recovery.acquired) {
          this.#lastValidationReason = `${reason}:reacquired:${validation?.reason || 'unknown'}`;
          this.#lastFailure = null;
          return Object.freeze({ valid: true, reacquired: true, reason: this.#lastValidationReason, status: this.status });
        }
        this.#failClosed(`validation-${recovery.reason || this.#lastValidationReason}`);
        return Object.freeze({ valid: false, reason: this.#lastValidationReason, status: this.status });
      }
      this.#lastValidationReason = `${reason}:${this.#lastValidationReason}`;
      return Object.freeze({ valid: true, reason: this.#lastValidationReason, status: this.status });
    } catch (error) {
      this.#validationCount += 1;
      this.#lastValidationReason = 'validation-unavailable';
      this.#failClosed('validation-unavailable', error);
      return Object.freeze({ valid: false, reason: 'validation-unavailable', status: this.status });
    }
  }

  async #recoverSuspendedLease(reason) {
    if (!RECOVERABLE_SUSPENSION_REASONS.has(reason)) return Object.freeze({ acquired: false, reason });
    if (typeof this.#runtimeGuard.acquire !== 'function') return Object.freeze({ acquired: false, reason: 'reacquire-unavailable' });
    try {
      const result = await this.#runtimeGuard.acquire();
      return Object.freeze({ ...result, reason: result?.reason || reason });
    } catch (error) {
      return Object.freeze({ acquired: false, reason: 'reacquire-unavailable', error });
    }
  }

  #failClosed(reason, error = null) {
    this.#lastFailure = error ? `${reason}: ${String(error?.message || error)}` : reason;
    this.#authoringGate.close(`heartbeat-${reason}`);
    this.#stopScheduling();
  }

  #bindResumeSignals() {
    if (!this.#eventTarget?.addEventListener || !this.#eventTarget?.removeEventListener) return;
    if (this.#listeners.size > 0) return;

    for (const type of RESUME_EVENTS) {
      const handler = () => {
        if (type === 'visibilitychange' && this.#visibilityState() !== 'visible') return;
        void this.validateOnResume(type);
      };
      this.#listeners.set(type, handler);
      this.#eventTarget.addEventListener(type, handler);
    }
  }

  #stopScheduling() {
    this.#running = false;
    if (this.#timer !== null) {
      try { this.#clearInterval(this.#timer); } catch {}
      this.#timer = null;
    }
    if (this.#eventTarget?.removeEventListener) {
      for (const [type, handler] of this.#listeners.entries()) {
        try { this.#eventTarget.removeEventListener(type, handler); } catch {}
      }
    }
    this.#listeners.clear();
  }
}
