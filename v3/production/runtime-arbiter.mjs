export const PRODUCTION_RUNTIME_STATE = Object.freeze({
  PREVIEW_DEFAULT: 'PREVIEW_DEFAULT',
  V3_PREFLIGHT: 'V3_PREFLIGHT',
  SWITCH_TO_V3_QUIESCING: 'SWITCH_TO_V3_QUIESCING',
  RELOAD_REQUIRED_FOR_V3: 'RELOAD_REQUIRED_FOR_V3',
  V3_STARTING: 'V3_STARTING',
  V3_AUTHORING: 'V3_AUTHORING',
  V3_BLOCKED_READONLY: 'V3_BLOCKED_READONLY',
  SWITCH_TO_PREVIEW_QUIESCING: 'SWITCH_TO_PREVIEW_QUIESCING',
  RELOAD_REQUIRED_FOR_PREVIEW: 'RELOAD_REQUIRED_FOR_PREVIEW',
  FAILED_SAFE: 'FAILED_SAFE',
});

export class ProductionRuntimeArbiter {
  #featureFlag;
  #extensionControl;
  #productionHealth;
  #onboarding;
  #quiesceV3;
  #state = PRODUCTION_RUNTIME_STATE.PREVIEW_DEFAULT;
  #lastError = null;

  constructor({ featureFlag, extensionControl, productionHealth, onboarding = null, quiesceV3 = null }) {
    if (!featureFlag || typeof featureFlag.read !== 'function' || typeof featureFlag.requestEnable !== 'function' || typeof featureFlag.requestDisable !== 'function') {
      throw new TypeError('ProductionRuntimeArbiter requires V3BetaFeatureFlag');
    }
    if (!extensionControl || typeof extensionControl.verifyPreview37Excluded !== 'function') {
      throw new TypeError('ProductionRuntimeArbiter requires SillyTavernExtensionControl');
    }
    if (!productionHealth || typeof productionHealth.preflight !== 'function') {
      throw new TypeError('ProductionRuntimeArbiter requires ProductionCompositionHealth');
    }
    if (onboarding && typeof onboarding.inspect !== 'function') throw new TypeError('onboarding must expose inspect()');
    if (quiesceV3 && typeof quiesceV3 !== 'function') throw new TypeError('quiesceV3 must be a function');
    this.#featureFlag = featureFlag;
    this.#extensionControl = extensionControl;
    this.#productionHealth = productionHealth;
    this.#onboarding = onboarding;
    this.#quiesceV3 = quiesceV3;
  }

  inspect() {
    const intent = this.#featureFlag.read();
    const preview = this.#extensionControl.findPreview37();
    return Object.freeze({
      state: this.#state,
      requested: intent.requested === true,
      requestedIntentOnly: this.#state !== PRODUCTION_RUNTIME_STATE.V3_AUTHORING,
      authoringAuthority: this.#state === PRODUCTION_RUNTIME_STATE.V3_AUTHORING,
      preview: preview ? Object.freeze({ ...preview, disabled: this.#extensionControl.isPreview37Disabled() }) : null,
      lastError: this.#lastError,
    });
  }

  async requestV3({ confirmed = false, onboarding = null } = {}) {
    this.#state = PRODUCTION_RUNTIME_STATE.V3_PREFLIGHT;
    this.#lastError = null;
    const inspection = onboarding || (this.#onboarding ? await this.#onboarding.inspect() : null);
    const preflight = await this.#productionHealth.preflight({ onboarding: inspection });
    if (!preflight.ready || confirmed !== true) {
      if (this.#extensionControl.isPreview37Disabled()) return this.failSafe(new Error('Preview 37 was not safely active during v3 preflight'));
      this.#state = PRODUCTION_RUNTIME_STATE.PREVIEW_DEFAULT;
      return Object.freeze({ ...this.inspect(), preflight, confirmed: confirmed === true });
    }

    this.#featureFlag.requestEnable();
    this.#state = PRODUCTION_RUNTIME_STATE.SWITCH_TO_V3_QUIESCING;
    try {
      const control = await this.#extensionControl.disablePreview37AndReload();
      this.#state = PRODUCTION_RUNTIME_STATE.RELOAD_REQUIRED_FOR_V3;
      return Object.freeze({ ...this.inspect(), preflight, control });
    } catch (error) {
      return this.failSafe(error);
    }
  }

  async startSelectedRuntime({ exclusionProof = null } = {}) {
    const requested = this.#featureFlag.read().requested === true;
    if (!requested) {
      this.#state = PRODUCTION_RUNTIME_STATE.V3_BLOCKED_READONLY;
      this.#lastError = 'TMRW Phone startup intent is not established';
      return Object.freeze({ ...this.inspect(), activationRequired: false });
    }

    const exclusion = this.#extensionControl.verifyPreview37Excluded(exclusionProof || {});
    if (!exclusion.excluded) {
      this.#state = PRODUCTION_RUNTIME_STATE.V3_BLOCKED_READONLY;
      return Object.freeze({ ...this.inspect(), exclusion, activationRequired: false });
    }

    this.#state = PRODUCTION_RUNTIME_STATE.V3_STARTING;
    return Object.freeze({ ...this.inspect(), exclusion, activationRequired: true });
  }

  markV3Authoring(evidence = {}) {
    if (this.#state !== PRODUCTION_RUNTIME_STATE.V3_STARTING) {
      throw new Error(`V3 authoring transition requires V3_STARTING, received ${this.#state}`);
    }
    const checks = Object.freeze({
      authoringGateOpen: evidence.authoringGateOpen === true,
      leaseValid: evidence.leaseValid === true,
      identityResolved: evidence.identityResolved === true,
      compositionServicesReady: evidence.compositionServicesReady === true,
      uniqueListenersReady: evidence.uniqueListenersReady === true,
      uniqueGenerationInterceptorReady: evidence.uniqueGenerationInterceptorReady === true,
      shellMountHealthy: evidence.shellMountHealthy === true,
      launcherMounted: evidence.launcherMounted === true,
      heartbeatQualified: evidence.heartbeatQualified === true,
      productionHealthReady: evidence.productionHealthReady === true,
    });
    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    if (blockers.length) {
      this.#state = PRODUCTION_RUNTIME_STATE.V3_BLOCKED_READONLY;
      this.#lastError = `V3 authoring prerequisites unproven: ${blockers.join(', ')}`;
      return Object.freeze({ ...this.inspect(), activationCommitted: false, blockers: Object.freeze(blockers), checks });
    }
    this.#state = PRODUCTION_RUNTIME_STATE.V3_AUTHORING;
    this.#lastError = null;
    return Object.freeze({ ...this.inspect(), activationCommitted: true, blockers: Object.freeze([]), checks });
  }

  async returnToPreview37() {
    this.#state = PRODUCTION_RUNTIME_STATE.SWITCH_TO_PREVIEW_QUIESCING;
    this.#lastError = null;
    if (this.#quiesceV3) await this.#quiesceV3();
    this.#featureFlag.requestDisable();
    try {
      const preview = this.#extensionControl.findPreview37();
      if (!preview) {
        this.#state = PRODUCTION_RUNTIME_STATE.FAILED_SAFE;
        this.#lastError = 'Internal legacy Preview development recovery is unavailable because the archived package is not installed';
        return Object.freeze({ ...this.inspect(), reloadRequired: false, recoveryRequired: 'internal-development-preview-recovery' });
      }
      if (!this.#extensionControl.isPreview37Disabled()) {
        this.#state = PRODUCTION_RUNTIME_STATE.PREVIEW_DEFAULT;
        return Object.freeze({ ...this.inspect(), reloadRequired: false });
      }
      const control = await this.#extensionControl.enablePreview37AndReload();
      this.#state = control.reloadRequested ? PRODUCTION_RUNTIME_STATE.RELOAD_REQUIRED_FOR_PREVIEW : PRODUCTION_RUNTIME_STATE.PREVIEW_DEFAULT;
      return Object.freeze({ ...this.inspect(), control, reloadRequired: control.reloadRequested === true });
    } catch (error) {
      this.#state = PRODUCTION_RUNTIME_STATE.FAILED_SAFE;
      this.#lastError = String(error?.message || error);
      return Object.freeze({ ...this.inspect(), reloadRequired: false });
    }
  }

  async failSafe(error) {
    this.#state = PRODUCTION_RUNTIME_STATE.FAILED_SAFE;
    this.#lastError = String(error?.message || error || 'unknown runtime-arbiter failure');
    return Object.freeze({ ...this.inspect(), failedSafe: true });
  }
}
