const LISTENER_OWNERS = new WeakMap();

export class ProductionListenerOwner {
  #runtimeIntegration;
  #eventSource;
  #eventTypes;
  #authoringGate;
  #runtimeGuard;
  #onScopeChange;
  #scopeListener = null;
  #scopeTransition = Promise.resolve();
  #scopeRecoveryArmed = false;
  #registered = false;
  #lastError = null;

  constructor({ runtimeIntegration, eventSource, eventTypes, authoringGate, runtimeGuard, onScopeChange }) {
    if (!runtimeIntegration || typeof runtimeIntegration.register !== 'function' || typeof runtimeIntegration.unregister !== 'function') {
      throw new TypeError('ProductionListenerOwner requires SillyTavernV3RuntimeIntegration');
    }
    if (!eventSource || typeof eventSource.on !== 'function' || typeof eventSource.removeListener !== 'function') {
      throw new TypeError('ProductionListenerOwner requires the SillyTavern eventSource');
    }
    if (!eventTypes?.CHAT_CHANGED) throw new TypeError('ProductionListenerOwner requires the SillyTavern CHAT_CHANGED event type');
    if (!authoringGate || typeof authoringGate.allows !== 'function' || typeof authoringGate.close !== 'function') {
      throw new TypeError('ProductionListenerOwner requires the Production Authoring Gate');
    }
    if (!runtimeGuard || typeof runtimeGuard.ownsLease !== 'boolean') {
      throw new TypeError('ProductionListenerOwner requires the acquired runtime guard');
    }
    if (typeof onScopeChange !== 'function') throw new TypeError('ProductionListenerOwner requires an explicit scope transition callback');
    this.#runtimeIntegration = runtimeIntegration;
    this.#eventSource = eventSource;
    this.#eventTypes = eventTypes;
    this.#authoringGate = authoringGate;
    this.#runtimeGuard = runtimeGuard;
    this.#onScopeChange = onScopeChange;
  }

  get status() {
    return Object.freeze({
      registered: this.#registered,
      runtimeOwner: this.#runtimeGuard.ownsLease === true,
      gateOpen: this.#authoringGate.allows('normal') === true,
      scopeListenerRegistered: Boolean(this.#scopeListener),
      lastError: this.#lastError,
    });
  }

  register() {
    if (this.#registered) return false;
    if (this.#runtimeGuard.ownsLease !== true) return false;
    const current = LISTENER_OWNERS.get(this.#eventSource);
    if (current && current !== this) return false;

    LISTENER_OWNERS.set(this.#eventSource, this);
    let runtimeRegistered = false;
    try {
      runtimeRegistered = this.#runtimeIntegration.register() === true;
      if (!runtimeRegistered) {
        this.#authoringGate.close('listener-registration-unproven');
        return false;
      }

      this.#scopeListener = async (...args) => {
        if (!this.#registered) return;
        if (this.#runtimeGuard.ownsLease !== true) {
          this.#authoringGate.close('listener-runtime-owner-lost');
          return;
        }
        // A failed remount deliberately closes authoring. The next CHAT_CHANGED
        // event must still be allowed to repair that scope; otherwise one bad
        // transition permanently leaves the phone bound to the previous chat.
        if (!this.#authoringGate.allows('normal') && !this.#scopeRecoveryArmed) return;
        const transition = async () => {
          if (!this.#registered || this.#runtimeGuard.ownsLease !== true) return;
          try {
            await this.#onScopeChange(...args);
            this.#lastError = null;
            this.#scopeRecoveryArmed = false;
          } catch (error) {
            this.#lastError = String(error?.message || error || 'unknown-listener-error');
            this.#scopeRecoveryArmed = true;
            this.#authoringGate.close('listener-critical-error');
          }
        };
        this.#scopeTransition = this.#scopeTransition.then(transition, transition);
        await this.#scopeTransition;
      };
      this.#eventSource.on(this.#eventTypes.CHAT_CHANGED, this.#scopeListener);
      this.#registered = true;
      this.#lastError = null;
      this.#scopeRecoveryArmed = false;
      return true;
    } catch (error) {
      this.#lastError = String(error?.message || error || 'listener-registration-error');
      this.#authoringGate.close('listener-registration-error');
      if (runtimeRegistered) {
        try { this.#runtimeIntegration.unregister(); } catch {}
      }
      this.#scopeListener = null;
      return false;
    } finally {
      if (!this.#registered && LISTENER_OWNERS.get(this.#eventSource) === this) LISTENER_OWNERS.delete(this.#eventSource);
    }
  }

  unregister() {
    if (!this.#registered) return false;
    this.#registered = false;
    this.#scopeRecoveryArmed = false;
    try {
      if (this.#scopeListener) this.#eventSource.removeListener(this.#eventTypes.CHAT_CHANGED, this.#scopeListener);
      this.#scopeListener = null;
      this.#runtimeIntegration.unregister();
      return true;
    } catch (error) {
      this.#lastError = String(error?.message || error || 'listener-cleanup-error');
      this.#authoringGate.close('listener-cleanup-error');
      return true;
    } finally {
      this.#scopeListener = null;
      if (LISTENER_OWNERS.get(this.#eventSource) === this) LISTENER_OWNERS.delete(this.#eventSource);
    }
  }
}
