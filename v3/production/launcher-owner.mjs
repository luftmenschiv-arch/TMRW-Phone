import { V3_LAUNCHER_ID } from './constants.mjs';
import { PRODUCTION_RUNTIME_STATE } from './runtime-arbiter.mjs';

const LAUNCHER_OWNERS = new WeakMap();
const ALLOWED_RUNTIME_STATES = new Set([
  PRODUCTION_RUNTIME_STATE.V3_STARTING,
  PRODUCTION_RUNTIME_STATE.V3_AUTHORING,
]);

function nodeId(node) {
  if (!node) return null;
  if (typeof node.id === 'string' && node.id) return node.id;
  if (node.attributes?.get) return node.attributes.get('id') || null;
  return null;
}

function findById(document, root, id) {
  if (typeof document?.getElementById === 'function') {
    const found = document.getElementById(id);
    if (found) return found;
  }
  const visit = node => {
    if (!node) return null;
    if (nodeId(node) === id) return node;
    for (const child of node.children || []) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  return visit(root);
}

export class ProductionLauncherOwner {
  #runtime;
  #runtimeArbiter;
  #mountManager;
  #document;
  #hostParent;
  #label;
  #button = null;
  #opens = 0;
  #lastError = null;
  #disposed = false;
  #blocked = false;

  constructor({ productionRuntime, runtimeArbiter, mountManager, document, hostParent = document?.body, label = 'TMRW Phone' }) {
    if (!productionRuntime || productionRuntime.role !== 'owner' || !productionRuntime.composition) throw new TypeError('ProductionLauncherOwner requires the S08 owner composition root');
    if (!runtimeArbiter || typeof runtimeArbiter.inspect !== 'function') throw new TypeError('ProductionLauncherOwner requires ProductionRuntimeArbiter');
    if (!mountManager || typeof mountManager.open !== 'function' || !mountManager.status) throw new TypeError('ProductionLauncherOwner requires ProductionMountManager');
    if (!document?.createElement || !hostParent?.append) throw new TypeError('ProductionLauncherOwner requires a DOM document and host parent');
    this.#runtime = productionRuntime;
    this.#runtimeArbiter = runtimeArbiter;
    this.#mountManager = mountManager;
    this.#document = document;
    this.#hostParent = hostParent;
    this.#label = String(label || 'TMRW Phone');
  }

  #eligible() {
    const runtimeState = this.#runtimeArbiter.inspect()?.state;
    const runtimeStatus = this.#runtime.status;
    return this.#blocked !== true
      && runtimeStatus?.disposed !== true
      && runtimeStatus?.role === 'owner'
      && runtimeStatus?.ownsLease === true
      && ALLOWED_RUNTIME_STATES.has(runtimeState)
      && this.#mountManager.status.healthy === true;
  }

  get status() {
    return Object.freeze({
      mounted: Boolean(this.#button),
      eligible: this.#eligible(),
      launcherId: this.#button ? V3_LAUNCHER_ID : null,
      opens: this.#opens,
      disposed: this.#disposed,
      blocked: this.#blocked,
      lastError: this.#lastError,
    });
  }

  mount() {
    if (this.#disposed) return false;
    if (this.#button) return false;
    if (!this.#eligible()) return false;

    const owner = LAUNCHER_OWNERS.get(this.#hostParent);
    if (owner && owner !== this) {
      this.#runtime.composition.authoringGate?.close?.('production-launcher-ownership-conflict');
      this.#lastError = 'Production launcher already has another owner';
      return false;
    }
    const existing = findById(this.#document, this.#hostParent, V3_LAUNCHER_ID);
    if (existing) {
      this.#runtime.composition.authoringGate?.close?.('production-launcher-dom-conflict');
      this.#lastError = `Conflicting production launcher #${V3_LAUNCHER_ID} already exists`;
      return false;
    }

    const button = this.#document.createElement('button');
    button.setAttribute?.('id', V3_LAUNCHER_ID);
    if ('id' in button) button.id = V3_LAUNCHER_ID;
    button.type = 'button';
    button.textContent = this.#label;
    button.setAttribute?.('aria-label', 'Open TMRW Phone v3');
    button.addEventListener?.('click', () => { this.open(); });
    this.#hostParent.append(button);
    this.#button = button;
    LAUNCHER_OWNERS.set(this.#hostParent, this);
    this.#lastError = null;
    return true;
  }

  open() {
    if (!this.#button || !this.#eligible()) {
      this.#runtime.composition.authoringGate?.close?.('production-launcher-open-blocked');
      return false;
    }
    const opened = this.#mountManager.open() === true;
    if (opened) this.#opens += 1;
    return opened;
  }

  block(reason = 'production-launcher-shutdown-block') {
    if (this.#disposed) return false;
    this.#blocked = true;
    if (this.#button) this.#button.disabled = true;
    this.#runtime.composition.authoringGate?.close?.(reason);
    return true;
  }

  reconcile() {
    if (this.#disposed) return false;
    if (this.#eligible()) return this.#button ? true : this.mount();
    if (this.#button) this.#removeButton();
    return false;
  }

  #removeButton() {
    try { this.#button?.remove?.(); } finally {
      this.#button = null;
      if (LAUNCHER_OWNERS.get(this.#hostParent) === this) LAUNCHER_OWNERS.delete(this.#hostParent);
    }
  }

  dispose() {
    if (this.#disposed) return false;
    this.#removeButton();
    this.#disposed = true;
    return true;
  }
}
