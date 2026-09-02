import { V3_LAUNCHER_ID } from './constants.mjs';
import { PRODUCTION_RUNTIME_STATE } from './runtime-arbiter.mjs';
import { createPreviewIcon } from '../ui/app-icons.mjs';

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
  #drag = null;
  #suppressClickUntil = 0;
  #resizeHandler = null;

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
      visible: Boolean(this.#button && this.#button.hidden !== true),
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
    button.tabIndex = -1;
    button.setAttribute?.('aria-label', 'เปิด TMRW Phone');
    button.append(createPreviewIcon({ document: this.#document, name: 'phone', size: 24 }));
    const sparkle = this.#document.createElement('span');
    sparkle.className = 'tmrw-phone-launcher-spark';
    sparkle.append(createPreviewIcon({ document: this.#document, name: 'sparkle', size: 13 }));
    button.append(sparkle);
    button.style.right = '14px';
    button.style.top = '62vh';
    button.style.bottom = 'auto';
    button.addEventListener?.('click', event => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (Date.now() < this.#suppressClickUntil) return;
      this.open();
    });
    this.#bindPreviewDrag(button);
    this.#hostParent.append(button);
    this.#applyPreviewDefaultPosition(button);
    this.#button = button;
    button.hidden = this.#mountManager.status.visible === true;
    LAUNCHER_OWNERS.set(this.#hostParent, this);
    this.#lastError = null;
    return true;
  }

  #applyPreviewDefaultPosition(button) {
    const { view } = this.#viewport();
    const apply = () => {
      if (this.#button && this.#button !== button) return;
      const { width, height } = this.#viewport();
      if (!(width > 0) || !(height > 0)) return;
      const buttonWidth = Number(button.offsetWidth || 58);
      const buttonHeight = Number(button.offsetHeight || 58);
      const x = this.#clamp(width - buttonWidth - 14, 8, width - buttonWidth - 8);
      const y = this.#clamp(Math.round(height * 0.62), 8, height - buttonHeight - 8);
      button.style.left = `${x}px`;
      button.style.top = `${y}px`;
      button.style.right = 'auto';
      button.style.bottom = 'auto';
    };
    if (typeof view?.requestAnimationFrame === 'function') view.requestAnimationFrame(apply);
    else setTimeout(apply, 0);
  }

  #viewport() {
    const view = this.#document?.defaultView || globalThis.window;
    return {
      view,
      width: Number(view?.innerWidth || this.#document?.documentElement?.clientWidth || 0),
      height: Number(view?.innerHeight || this.#document?.documentElement?.clientHeight || 0),
    };
  }

  #clamp(value, min, max) {
    return Math.min(Math.max(Number(value) || 0, min), Math.max(min, max));
  }

  #snapPreviewLauncher(button) {
    const rect = button?.getBoundingClientRect?.();
    if (!rect) return;
    const { width, height } = this.#viewport();
    if (!(width > 0) || !(height > 0)) return;
    const buttonWidth = Number(button.offsetWidth || rect.width || 58);
    const buttonHeight = Number(button.offsetHeight || rect.height || 58);
    const x = rect.left + buttonWidth / 2 < width / 2 ? 10 : width - buttonWidth - 10;
    const y = this.#clamp(rect.top, 8, height - buttonHeight - 8);
    button.style.transition = 'left 180ms ease, top 180ms ease, transform 160ms ease';
    button.style.left = `${x}px`;
    button.style.top = `${y}px`;
    button.style.right = 'auto';
    button.style.bottom = 'auto';
    setTimeout(() => { if (this.#button === button) button.style.transition = ''; }, 220);
  }

  #bindPreviewDrag(button) {
    button.addEventListener?.('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      const rect = button.getBoundingClientRect?.() || { left: 0, top: 0 };
      this.#drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, moved: false };
      button.blur?.();
      button.setPointerCapture?.(event.pointerId);
      button.classList?.add?.('is-dragging');
      event.preventDefault?.();
    });
    button.addEventListener?.('pointermove', event => {
      if (!this.#drag || this.#drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - this.#drag.startX;
      const dy = event.clientY - this.#drag.startY;
      if (Math.hypot(dx, dy) > 6) this.#drag.moved = true;
      const { width, height } = this.#viewport();
      const buttonWidth = Number(button.offsetWidth || 58);
      const buttonHeight = Number(button.offsetHeight || 58);
      const rawX = event.clientX - this.#drag.offsetX;
      const rawY = event.clientY - this.#drag.offsetY;
      const x = width > 0 ? this.#clamp(rawX, 8, width - buttonWidth - 8) : rawX;
      const y = height > 0 ? this.#clamp(rawY, 8, height - buttonHeight - 8) : rawY;
      button.style.left = `${x}px`;
      button.style.top = `${y}px`;
      button.style.right = 'auto';
      button.style.bottom = 'auto';
      event.preventDefault?.();
    });
    button.addEventListener?.('pointerup', event => {
      if (!this.#drag || this.#drag.pointerId !== event.pointerId) return;
      const moved = this.#drag.moved;
      this.#drag = null;
      button.classList?.remove?.('is-dragging');
      button.releasePointerCapture?.(event.pointerId);
      this.#suppressClickUntil = Date.now() + 520;
      if (moved) this.#snapPreviewLauncher(button);
      else setTimeout(() => { if (this.#button === button) this.open(); }, 70);
    });
    button.addEventListener?.('pointercancel', () => { this.#drag = null; button.classList?.remove?.('is-dragging'); });
    const { view } = this.#viewport();
    if (view?.addEventListener) {
      this.#resizeHandler = () => {
        const rect = button.getBoundingClientRect?.();
        if (!rect) return;
        const { width, height } = this.#viewport();
        if (!(width > 0) || !(height > 0)) return;
        const x = this.#clamp(rect.left, 8, width - Number(button.offsetWidth || rect.width || 58) - 8);
        const y = this.#clamp(rect.top, 8, height - Number(button.offsetHeight || rect.height || 58) - 8);
        button.style.left = `${x}px`;
        button.style.top = `${y}px`;
        button.style.right = 'auto';
        button.style.bottom = 'auto';
      };
      view.addEventListener('resize', this.#resizeHandler);
    }
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
    if (this.#eligible()) {
      if (!this.#button && !this.mount()) return false;
      if (this.#button) this.#button.hidden = this.#mountManager.status.visible === true;
      return true;
    }
    if (this.#button) this.#removeButton();
    return false;
  }

  #removeButton() {
    const { view } = this.#viewport();
    if (this.#resizeHandler && view?.removeEventListener) view.removeEventListener('resize', this.#resizeHandler);
    this.#resizeHandler = null;
    this.#drag = null;
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
