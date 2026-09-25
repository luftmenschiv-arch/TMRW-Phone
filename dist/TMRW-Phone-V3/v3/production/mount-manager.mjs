import { TmrwPhoneShell } from '../ui/shell.mjs';
import { V3_ROOT_ID } from './constants.mjs';
import { PRODUCTION_RUNTIME_STATE } from './runtime-arbiter.mjs';

const ROOT_OWNERS = new WeakMap();
const ALLOWED_RUNTIME_STATES = new Set([
  PRODUCTION_RUNTIME_STATE.V3_STARTING,
  PRODUCTION_RUNTIME_STATE.V3_AUTHORING,
]);

function text(value, field) {
  const out = String(value || '').trim();
  if (!out) throw new Error(`Production Phone mount requires exact ${field}`);
  return out;
}

function exactIdentity(value) {
  if (!value || typeof value !== 'object') throw new Error('Production Phone mount requires exact resolved scope identity');
  const scope = Object.freeze({
    storyId: text(value.scope?.storyId, 'Story identity'),
    branchId: text(value.scope?.branchId, 'Branch identity'),
  });
  const player = Object.freeze({
    actorId: text(value.player?.actorId, 'player Actor identity'),
    instanceId: text(value.player?.instanceId, 'player Instance identity'),
    accountId: text(value.player?.accountId, 'player Account identity'),
    deviceId: text(value.player?.deviceId, 'player Device identity'),
  });
  return Object.freeze({ scope, player });
}

function sameIdentity(left, right) {
  return Boolean(left && right
    && left.scope.storyId === right.scope.storyId
    && left.scope.branchId === right.scope.branchId
    && left.player.actorId === right.player.actorId
    && left.player.instanceId === right.player.instanceId
    && left.player.accountId === right.player.accountId
    && left.player.deviceId === right.player.deviceId);
}

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

export class ProductionMountManager {
  #runtime;
  #runtimeArbiter;
  #document;
  #hostParent;
  #shellFactory;
  #playerDisplayNameResolver;
  #playerAvatarUrlResolver;
  #activeCharacterDisplayNameResolver;
  #activeCharacterAvatarUrlResolver;
  #ensureAuthoringReady;
  #onVisibilityChange;
  #host = null;
  #shell = null;
  #identity = null;
  #healthy = false;
  #mountCount = 0;
  #transitionCount = 0;
  #lastError = null;
  #requiresAuthoringRevalidation = false;
  #blocked = false;

  constructor({ productionRuntime, runtimeArbiter, document, hostParent = document?.body, shellFactory = options => new TmrwPhoneShell(options), playerDisplayNameResolver = null, playerAvatarUrlResolver = null, activeCharacterDisplayNameResolver = null, activeCharacterAvatarUrlResolver = null, ensureAuthoringReady = null, onVisibilityChange = null }) {
    if (!productionRuntime || productionRuntime.role !== 'owner' || !productionRuntime.services || !productionRuntime.composition || typeof productionRuntime.resolveCurrentIdentity !== 'function') {
      throw new TypeError('ProductionMountManager requires the S08 owner composition root');
    }
    if (!runtimeArbiter || typeof runtimeArbiter.inspect !== 'function') throw new TypeError('ProductionMountManager requires ProductionRuntimeArbiter');
    if (!document?.createElement || !hostParent?.append) throw new TypeError('ProductionMountManager requires a DOM document and host parent');
    if (typeof shellFactory !== 'function') throw new TypeError('shellFactory must be a function');
    if (playerDisplayNameResolver != null && typeof playerDisplayNameResolver !== 'function') throw new TypeError('playerDisplayNameResolver must be a function when provided');
    if (playerAvatarUrlResolver != null && typeof playerAvatarUrlResolver !== 'function') throw new TypeError('playerAvatarUrlResolver must be a function when provided');
    if (activeCharacterDisplayNameResolver != null && typeof activeCharacterDisplayNameResolver !== 'function') throw new TypeError('activeCharacterDisplayNameResolver must be a function when provided');
    if (activeCharacterAvatarUrlResolver != null && typeof activeCharacterAvatarUrlResolver !== 'function') throw new TypeError('activeCharacterAvatarUrlResolver must be a function when provided');
    if (ensureAuthoringReady != null && typeof ensureAuthoringReady !== 'function') throw new TypeError('ensureAuthoringReady must be a function when provided');
    if (onVisibilityChange != null && typeof onVisibilityChange !== 'function') throw new TypeError('onVisibilityChange must be a function when provided');
    this.#runtime = productionRuntime;
    this.#runtimeArbiter = runtimeArbiter;
    this.#document = document;
    this.#hostParent = hostParent;
    this.#shellFactory = shellFactory;
    this.#playerDisplayNameResolver = playerDisplayNameResolver;
    this.#playerAvatarUrlResolver = playerAvatarUrlResolver;
    this.#activeCharacterDisplayNameResolver = activeCharacterDisplayNameResolver;
    this.#activeCharacterAvatarUrlResolver = activeCharacterAvatarUrlResolver;
    this.#ensureAuthoringReady = ensureAuthoringReady;
    this.#onVisibilityChange = onVisibilityChange;
  }

  get status() {
    const arbiter = this.#runtimeArbiter.inspect();
    return Object.freeze({
      mounted: Boolean(this.#shell && this.#host),
      healthy: this.#healthy,
      visible: Boolean(this.#host && this.#host.hidden !== true),
      rootId: this.#host ? V3_ROOT_ID : null,
      storyId: this.#identity?.scope.storyId ?? null,
      branchId: this.#identity?.scope.branchId ?? null,
      playerActorId: this.#identity?.player.actorId ?? null,
      playerInstanceId: this.#identity?.player.instanceId ?? null,
      selectedDeviceId: this.#identity?.player.deviceId ?? null,
      mountCount: this.#mountCount,
      transitionCount: this.#transitionCount,
      runtimeState: arbiter?.state ?? null,
      requiresAuthoringRevalidation: this.#requiresAuthoringRevalidation,
      blocked: this.#blocked,
      lastError: this.#lastError,
    });
  }

  #closeGate(reason) {
    this.#runtime.composition.authoringGate?.close?.(reason);
  }

  #notifyVisibility() {
    try { this.#onVisibilityChange?.(Boolean(this.#host && this.#host.hidden !== true)); } catch {}
  }

  #assertEligible() {
    const state = this.#runtimeArbiter.inspect()?.state;
    const status = this.#runtime.status;
    if (this.#blocked) throw new Error('Production Phone mount rejected: shutdown has blocked new Phone actions');
    if (status?.disposed) throw new Error('Production Phone mount rejected: composition root is disposed');
    if (status?.role !== 'owner' || status?.ownsLease !== true) throw new Error('Production Phone mount rejected: runtime is not the active lease owner');
    if (!ALLOWED_RUNTIME_STATES.has(state)) throw new Error(`Production Phone mount rejected in runtime state ${state || 'unknown'}`);
  }

  async #resolveIdentity(expected = null) {
    const resolved = exactIdentity(await this.#runtime.resolveCurrentIdentity());
    if (expected != null && !sameIdentity(resolved, exactIdentity(expected))) {
      throw new Error('Production Phone mount rejected: supplied scope identity does not match exact S06 production resolution');
    }
    return resolved;
  }

  #claimRoot() {
    const owner = ROOT_OWNERS.get(this.#hostParent);
    if (owner && owner !== this) throw new Error('Production Phone root already has another owner');
    const existing = findById(this.#document, this.#hostParent, V3_ROOT_ID);
    if (existing && existing !== this.#host) throw new Error(`Conflicting production Phone root #${V3_ROOT_ID} already exists`);
    ROOT_OWNERS.set(this.#hostParent, this);
  }

  #releaseRoot() {
    if (ROOT_OWNERS.get(this.#hostParent) === this) ROOT_OWNERS.delete(this.#hostParent);
  }

  async #mountResolved(identity, { preserveOwnership = false } = {}) {
    this.#assertEligible();
    if (!preserveOwnership) this.#claimRoot();
    else if (ROOT_OWNERS.get(this.#hostParent) !== this) this.#claimRoot();

    let host = null;
    let shell = null;
    try {
      host = this.#document.createElement('div');
      host.setAttribute?.('id', V3_ROOT_ID);
      if ('id' in host) host.id = V3_ROOT_ID;
      host.hidden = true;
      this.#hostParent.append(host);

      const services = this.#runtime.services;
      shell = this.#shellFactory({
        document: this.#document,
        viewModels: services.viewModels,
        controller: services.phoneController,
        messageService: services.messages,
        callService: services.calls,
        callCoordinator: services.callCoordinator,
        callStoryIntegration: services.callStoryIntegration,
        callBotReply: services.callBotReply,
        callVoicePresenter: services.callVoicePresenter,
        storyContinuation: services.continuation,
        socialService: services.social,
        notificationService: services.notifications,
        scope: identity.scope,
        playerActorId: identity.player.actorId,
        playerInstanceId: identity.player.instanceId,
        playerDisplayName: this.#playerDisplayNameResolver?.() || null,
        playerDisplayNameResolver: this.#playerDisplayNameResolver,
        playerAvatarUrl: this.#playerAvatarUrlResolver?.() || null,
        activeCharacterDisplayName: this.#activeCharacterDisplayNameResolver?.() || null,
        activeCharacterAvatarUrl: this.#activeCharacterAvatarUrlResolver?.() || null,
        ensureAuthoringReady: this.#ensureAuthoringReady,
        selectedDeviceId: identity.player.deviceId,
        onClose: () => this.hide(),
      });
      if (!shell || typeof shell.mount !== 'function' || typeof shell.dispose !== 'function') throw new Error('Production shell factory did not return TmrwPhoneShell-compatible shell');
      const shellRoot = await shell.mount(host);
      if (!shellRoot || shell.root !== shellRoot || shellRoot.parentNode !== host) throw new Error('Production Phone shell root verification failed');

      this.#host = host;
      this.#shell = shell;
      this.#identity = identity;
      this.#healthy = true;
      this.#mountCount += 1;
      this.#requiresAuthoringRevalidation = true;
      this.#lastError = null;
      return this.status;
    } catch (error) {
      try { shell?.dispose?.(); } catch {}
      try { host?.remove?.(); } catch {}
      this.#host = null;
      this.#shell = null;
      this.#identity = null;
      this.#healthy = false;
      this.#requiresAuthoringRevalidation = true;
      this.#lastError = String(error?.message || error);
      this.#closeGate('production-phone-mount-failed');
      if (!preserveOwnership) this.#releaseRoot();
      throw error;
    }
  }

  async mount(scopeIdentity = null) {
    try {
      this.#assertEligible();
      const identity = await this.#resolveIdentity(scopeIdentity);
      if (this.#healthy && this.#identity) {
        if (sameIdentity(this.#identity, identity)) return this.status;
        throw new Error('Production Phone is already mounted for another scope; use transitionScope()');
      }
      return await this.#mountResolved(identity);
    } catch (error) {
      this.#lastError = String(error?.message || error);
      this.#closeGate('production-phone-mount-blocked');
      throw error;
    }
  }

  async transitionScope(nextScopeIdentity = null) {
    this.#closeGate('production-phone-scope-transition');
    this.#requiresAuthoringRevalidation = true;
    let identity;
    try {
      this.#assertEligible();
      identity = await this.#resolveIdentity(nextScopeIdentity);
    } catch (error) {
      await this.unmount({ reason: 'production-phone-scope-unresolved' });
      this.#lastError = String(error?.message || error);
      throw error;
    }

    if (this.#healthy && sameIdentity(this.#identity, identity)) return this.status;
    this.#claimRoot();
    await this.#disposeMounted({ releaseOwnership: false });
    try {
      const result = await this.#mountResolved(identity, { preserveOwnership: true });
      this.#transitionCount += 1;
      return result;
    } catch (error) {
      this.#releaseRoot();
      throw error;
    }
  }

  async refresh() {
    if (!this.#healthy || !this.#shell?.renderActive) return this.status;
    await this.#shell.renderActive();
    return this.status;
  }

  open() {
    try {
      this.#assertEligible();
      if (!this.#healthy || !this.#host || !this.#shell?.root) return false;
      this.#shell.open?.();
      this.#host.hidden = false;
      this.#notifyVisibility();
      return true;
    } catch (error) {
      this.#lastError = String(error?.message || error);
      this.#closeGate('production-phone-open-blocked');
      return false;
    }
  }

  hide() {
    if (!this.#host) return false;
    this.#host.hidden = true;
    this.#notifyVisibility();
    return true;
  }

  blockActions(reason = 'production-phone-shutdown-block') {
    this.#blocked = true;
    this.#closeGate(reason);
    if (this.#host) this.#host.hidden = true;
    this.#notifyVisibility();
    return this.status;
  }

  async disposeShellForShutdown() {
    this.#blocked = true;
    this.#healthy = false;
    const shell = this.#shell;
    this.#shell = null;
    if (!shell) return this.status;
    try {
      await shell.dispose?.();
    } catch (error) {
      this.#lastError = String(error?.message || error);
      this.#closeGate('production-phone-shell-dispose-error');
      throw error;
    }
    return this.status;
  }

  removeRootForShutdown() {
    this.#blocked = true;
    const host = this.#host;
    this.#host = null;
    this.#identity = null;
    try { host?.remove?.(); } finally { this.#releaseRoot(); }
    this.#notifyVisibility();
    return this.status;
  }

  async #disposeMounted({ releaseOwnership = true } = {}) {
    this.#healthy = false;
    const shell = this.#shell;
    const host = this.#host;
    this.#shell = null;
    this.#host = null;
    this.#identity = null;
    try { shell?.dispose?.(); } finally {
      try { host?.remove?.(); } finally {
        if (releaseOwnership) this.#releaseRoot();
      }
    }
    this.#notifyVisibility();
  }

  async unmount({ reason = 'production-phone-unmounted' } = {}) {
    this.#closeGate(reason);
    this.#requiresAuthoringRevalidation = true;
    if (!this.#shell && !this.#host) {
      this.#releaseRoot();
      return this.status;
    }
    await this.#disposeMounted({ releaseOwnership: true });
    return this.status;
  }
}
