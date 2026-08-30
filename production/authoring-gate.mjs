const NORMAL_PREREQUISITES = Object.freeze([
  'productionHealthValid',
  'previewExcluded',
  'identityResolved',
  'compositionServicesReady',
  'uniqueListenersReady',
  'uniqueGenerationInterceptorReady',
  'callIntegrationReady',
  'shellMountHealthy',
  'heartbeatQualified',
]);

function prerequisitesSatisfied(prerequisites, requiredKeys) {
  return prerequisites && typeof prerequisites === 'object'
    && requiredKeys.every(key => prerequisites[key] === true);
}

function statusOf(state, reason) {
  return Object.freeze({ state, reason });
}

export class ProductionAuthoringGate {
  #runtimeGuard;
  #state = 'closed';
  #reason = 'initial-closed';

  constructor({ runtimeGuard }) {
    if (!runtimeGuard || typeof runtimeGuard.validateLease !== 'function') {
      throw new TypeError('ProductionAuthoringGate requires a V3RuntimeGuard');
    }
    this.#runtimeGuard = runtimeGuard;
  }

  get state() {
    return this.#state;
  }

  get status() {
    return statusOf(this.#state, this.#reason);
  }

  allows(capability) {
    if (capability === 'normal') return this.#state === 'open';
    if (capability === 'transition') return this.#state === 'transition';
    return false;
  }

  close(reason = 'closed') {
    this.#state = 'closed';
    this.#reason = reason;
    return this.status;
  }

  async open(prerequisites) {
    if (this.#state === 'transition') {
      this.close('transition-must-close-before-normal');
      return Object.freeze({ opened: false, ...this.status });
    }
    if (!prerequisitesSatisfied(prerequisites, NORMAL_PREREQUISITES)) {
      this.close('normal-prerequisites-unproven');
      return Object.freeze({ opened: false, ...this.status });
    }

    let validation;
    try {
      validation = await this.#runtimeGuard.validateLease();
    } catch {
      this.close('lease-validation-unavailable');
      return Object.freeze({ opened: false, ...this.status });
    }
    if (!validation?.valid) {
      this.close(`lease-${validation?.reason || 'unproven'}`);
      return Object.freeze({ opened: false, ...this.status });
    }

    this.#state = 'open';
    this.#reason = 'normal-authoring-open';
    return Object.freeze({ opened: true, ...this.status });
  }

  async enterTransition({ previewQuiesced = false } = {}) {
    if (this.#state === 'open') {
      this.close('normal-must-close-before-transition');
      return Object.freeze({ opened: false, ...this.status });
    }
    if (previewQuiesced !== true) {
      this.close('preview-not-quiesced');
      return Object.freeze({ opened: false, ...this.status });
    }

    let validation;
    try {
      validation = await this.#runtimeGuard.validateLease();
    } catch {
      this.close('lease-validation-unavailable');
      return Object.freeze({ opened: false, ...this.status });
    }
    if (!validation?.valid) {
      this.close(`lease-${validation?.reason || 'unproven'}`);
      return Object.freeze({ opened: false, ...this.status });
    }

    this.#state = 'transition';
    this.#reason = 'transition-authoring-open';
    return Object.freeze({ opened: true, ...this.status });
  }

  createFence() {
    return new AuthoringFence({ gate: this });
  }
}

export class AuthoringFence {
  #gate;

  constructor({ gate }) {
    if (!gate || typeof gate.allows !== 'function' || typeof gate.close !== 'function') {
      throw new TypeError('AuthoringFence requires a ProductionAuthoringGate');
    }
    this.#gate = gate;
  }

  get status() {
    return this.#gate.status;
  }

  assertCapability(capability) {
    if (capability !== 'normal' && capability !== 'transition') {
      throw new TypeError(`Unknown authoring capability: ${capability}`);
    }
    if (!this.#gate.allows(capability)) {
      const error = new Error(`Authoring capability ${capability} is not permitted while gate is ${this.#gate.state}`);
      error.code = 'TMRW_AUTHORING_DENIED';
      throw error;
    }
    return true;
  }

  failClosed(reason = 'authoring-authority-lost') {
    return this.#gate.close(reason);
  }
}
