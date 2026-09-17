import { V3BetaFeatureFlag } from '../beta/feature-flag.mjs';
import { createPhase19VoiceCapabilityState } from '../domain/voice/voice-capability.mjs';
import { createOfficialPreviewControl, createProductionPackagePreflightSession } from './passive-preflight.mjs';
import { ProductionCompositionHealth } from './production-health.mjs';
import { ProductionRuntimeArbiter, PRODUCTION_RUNTIME_STATE } from './runtime-arbiter.mjs';
import { createTmrwV3ProductionRuntime } from './composition-root.mjs';
import { ProductionMountManager } from './mount-manager.mjs';
import { ProductionLauncherOwner } from './launcher-owner.mjs';
import { ProductionShutdownController } from './shutdown-controller.mjs';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function requireGateFPass(gateFReport) {
  if (!gateFReport || gateFReport.status !== 'pass') throw new Error('Active production startup requires accepted Gate F PASS evidence');
  return gateFReport;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;

function leaseRecoveryNow(clock) {
  const value = (typeof clock === 'function' ? clock : Date.now)();
  if (!Number.isFinite(value)) throw new Error('Lease recovery clock is not a finite epoch millisecond value');
  return value;
}

function defaultLeaseRecoveryWait(ms) {
  if (typeof globalThis.setTimeout !== 'function') throw new Error('Lease recovery requires setTimeout');
  return new Promise(resolve => globalThis.setTimeout(resolve, Math.max(0, ms)));
}

function recoverableLeaseConflict(runtime) {
  if (!runtime || runtime.role !== 'standby') return null;
  const lease = runtime.leaseAcquisition;
  if (!lease || lease.acquired === true) return null;
  if (lease.reason !== 'foreign-owner' && lease.reason !== 'generation-mismatch') return null;
  const expiresAt = Number(lease.expiresAt);
  if (!Number.isFinite(expiresAt)) return null;
  return Object.freeze({ reason: lease.reason, ownerId: lease.ownerId ?? null, leaseId: lease.leaseId ?? null, expiresAt });
}

function previewRecordContainsSourceIdentity(record, sourceIdentity) {
  if (!record || typeof record !== 'object' || !sourceIdentity) return false;
  return Boolean(record.cards?.[sourceIdentity.characterCardSourceId]
    ?.stories?.[sourceIdentity.storySourceId]
    ?.branches?.[sourceIdentity.routeSourceId]);
}

function sourceMappingFromPlan(plan) {
  const item = plan?.items?.find(row => row?.state === 'ready' && row?.mapping?.state === 'ready');
  const mapping = item?.mapping;
  if (!mapping?.cardSourceId || !mapping?.storySourceId || !mapping?.branchSourceId) {
    throw new Error('Active production startup requires one exact ready Preview migration scope mapping');
  }
  const cast = Array.isArray(item?.data?.cast) ? item.data.cast.filter(row => row?.sourceActorId) : [];
  return Object.freeze({
    sourceAuthority: String(mapping.sourceAuthority || plan?.sourceAuthority || 'preview37'),
    characterCardSourceId: String(mapping.cardSourceId),
    storySourceId: String(mapping.storySourceId),
    routeSourceId: String(mapping.branchSourceId),
    cast: Object.freeze(cast.map(row => Object.freeze({ sourceActorId: String(row.sourceActorId), displayName: String(row.displayName || '') }))),
  });
}

function defaultMessageIdentityResolver(mapping) {
  return async input => {
    const role = String(input?.role || '').toLowerCase();
    if (role === 'user') {
      return Object.freeze({
        actor: Object.freeze({ player: true }),
        mentionLabels: Object.freeze([]),
        explicitPhoneActions: Object.freeze([]),
      });
    }
    const actor = mapping.cast[0];
    if (!actor) return null;
    return Object.freeze({
      actor: Object.freeze({
        player: false,
        sourceAuthority: mapping.sourceAuthority,
        sourceType: 'actor',
        sourceActorId: actor.sourceActorId,
      }),
      mentionLabels: Object.freeze([]),
      explicitPhoneActions: Object.freeze([]),
    });
  };
}

function freshCastFromContext(context, sourceIdentity) {
  const characters = Array.isArray(context?.characters) ? context.characters : [];
  if (!context?.groupId) {
    const character = characters[context?.characterId] || null;
    const displayName = String(character?.name || 'Character').trim() || 'Character';
    return Object.freeze([Object.freeze({ sourceActorId: String(sourceIdentity.characterCardSourceId), displayName })]);
  }
  const group = Array.isArray(context?.groups) ? context.groups.find(row => String(row?.id) === String(context.groupId)) : null;
  const members = Array.isArray(group?.members) ? group.members : [];
  const rows = [];
  const seen = new Set();
  for (const member of members) {
    const token = typeof member === 'object' && member !== null ? (member.avatar ?? member.name ?? member.id) : member;
    const character = characters.find(row => String(row?.avatar ?? '') === String(token)
      || String(row?.name ?? '') === String(token)
      || String(row?.id ?? '') === String(token));
    const sourceActorId = `character:${String(character?.avatar ?? token ?? '').trim()}`;
    if (sourceActorId === 'character:' || seen.has(sourceActorId)) continue;
    seen.add(sourceActorId);
    rows.push(Object.freeze({ sourceActorId, displayName: String(character?.name ?? token ?? 'Character').trim() || 'Character' }));
  }
  if (rows.length === 0) throw new Error('Fresh Production group bootstrap requires stable SillyTavern group members');
  return Object.freeze(rows);
}

function freshIdentitySeedFromContext(context, sourceIdentity) {
  if (!context || typeof context !== 'object') throw new Error('Fresh Production bootstrap requires current SillyTavern context');
  if (!sourceIdentity?.characterCardSourceId || !sourceIdentity?.storySourceId || !sourceIdentity?.routeSourceId) {
    throw new Error('Fresh Production bootstrap requires stable Character/Story/Branch source identity');
  }
  const characters = Array.isArray(context.characters) ? context.characters : [];
  const group = context.groupId && Array.isArray(context.groups) ? context.groups.find(row => String(row?.id) === String(context.groupId)) : null;
  const character = !context.groupId ? characters[context.characterId] : null;
  const cardName = String(group?.name || character?.name || 'Character card').trim() || 'Character card';
  const userDisplayName = String(context.name1 || '{{user}}').trim() || '{{user}}';
  const manifestId = `production-fresh:v1:${JSON.stringify([sourceIdentity.characterCardSourceId, sourceIdentity.storySourceId, sourceIdentity.routeSourceId])}`;
  return Object.freeze({
    manifestId,
    sourceAuthority: 'sillytavern',
    card: Object.freeze({ sourceCardId: String(sourceIdentity.characterCardSourceId), displayName: cardName }),
    story: Object.freeze({ sourceStoryId: String(sourceIdentity.storySourceId), title: String(context.chatId || context.chatMetadata?.chat_id || cardName) }),
    branch: Object.freeze({ sourceRouteId: String(sourceIdentity.routeSourceId), label: String(context.chatMetadata?.branch_id || context.chatMetadata?.branchId || context.chatMetadata?.main_chat || 'main') }),
    user: Object.freeze({ displayName: userDisplayName }),
    cast: freshCastFromContext(context, sourceIdentity),
  });
}

function normalizedAvatarUrl(value, kind) {
  const avatar = String(value || '').trim();
  if (!avatar) return null;
  if (/^(?:https?:|data:|blob:|\/)/iu.test(avatar)) return avatar;
  if (/^User Avatars\//iu.test(avatar)) return `/${avatar}`;
  if (/^characters\//iu.test(avatar)) return `/${avatar}`;
  const directory = kind === 'character' ? 'characters' : 'User Avatars';
  return `/${directory}/${encodeURIComponent(avatar)}`;
}

function firstImageSource(document, selectors) {
  for (const selector of selectors) {
    const source = String(document?.querySelector?.(selector)?.src || '').trim();
    if (source) return source;
  }
  return null;
}

function freshMessageIdentityResolver(sourceIdentityResolver) {
  return async input => {
    const role = String(input?.role || '').toLowerCase();
    if (role === 'user') return Object.freeze({ actor: Object.freeze({ player: true }), mentionLabels: Object.freeze([]), explicitPhoneActions: Object.freeze([]) });
    const sourceIdentity = await sourceIdentityResolver(input?.context);
    const seed = freshIdentitySeedFromContext(input?.context, sourceIdentity);
    let actor = seed.cast[0] || null;
    if (seed.cast.length > 1) {
      const label = String(input?.message?.name || input?.message?.extra?.name || '').trim();
      actor = label ? seed.cast.find(row => row.displayName === label) || null : null;
    }
    if (!actor) return null;
    return Object.freeze({
      actor: Object.freeze({ player: false, sourceAuthority: 'sillytavern', sourceType: 'actor', sourceActorId: actor.sourceActorId }),
      mentionLabels: Object.freeze([]),
      explicitPhoneActions: Object.freeze([]),
    });
  };
}

async function synchronizePlayableScope(runtime, identity) {
  const service = runtime?.services?.playableBootstrap;
  if (!service || !identity?.scope || !identity?.player?.instanceId) return null;
  const state = await service.status({ scope: identity.scope, playerInstanceId: identity.player.instanceId });
  const approvedSourceActorIds = state?.selectionConfirmed === true ? (state.selectedSourceActorIds || []) : [];
  if (!approvedSourceActorIds.length) return null;
  return service.run({
    scope: identity.scope,
    playerInstanceId: identity.player.instanceId,
    approvedSourceActorIds,
    selectionConfirmed: true,
    recentMessages: 64,
    deepBackfill: true,
  });
}

function freezeStatus(session) {
  const runtime = session.runtime;
  const runtimeStatus = runtime?.status || null;
  const mount = session.mountManager?.status || null;
  const launcher = session.launcherOwner?.status || null;
  const arbiter = session.arbiter?.inspect?.() || null;
  return Object.freeze({
    started: session.started,
    disposed: session.disposed,
    lastError: session.lastError,
    runtimeState: arbiter?.state || null,
    authoringAuthority: arbiter?.authoringAuthority === true,
    role: runtime?.role || null,
    ownerId: runtime?.ownerId || session.ownerId,
    leaseId: runtime?.composition?.runtimeGuard?.leaseId || null,
    ownsLease: runtimeStatus?.ownsLease === true,
    authoringGateState: runtime?.composition?.authoringGate?.state || null,
    databaseOpen: runtimeStatus?.databaseOpen === true,
    heartbeatRunning: runtimeStatus?.heartbeatRunning === true,
    listenerRegistered: runtimeStatus?.listenerRegistered === true,
    interceptorDelegateActive: runtimeStatus?.interceptorDelegateActive === true,
    phoneRootMounted: mount?.mounted === true,
    phoneMountHealthy: mount?.healthy === true,
    launcherMounted: launcher?.mounted === true,
    storyId: session.identity?.scope?.storyId || null,
    branchId: session.identity?.scope?.branchId || null,
    playerActorId: session.identity?.player?.actorId || null,
    playerInstanceId: session.identity?.player?.instanceId || null,
    playerDeviceId: session.identity?.player?.deviceId || null,
    canonicalWritesDuringMigration: Number(runtime?.migration?.metrics?.canonicalOperations ?? 0),
    migrationCommitted: runtime?.migration?.committed === true,
    productionBootstrapCommitted: runtime?.bootstrap?.committed === true,
    voiceRuntimeAvailable: runtime?.voiceCapability?.runtimeAvailable ?? false,
    voiceProviderModelCalls: 0,
    smartContactReconciliation: session.smartContactReconciliation ? structuredClone(session.smartContactReconciliation) : null,
    finalHealthReady: session.finalHealth?.ready === true,
  });
}

export class ProductionActiveStartupSession {
  constructor(options = {}) {
    this.options = options;
    this.ownerId = String(options.ownerId || '').trim();
    if (!this.ownerId) throw new TypeError('ProductionActiveStartupSession requires a stable per-document ownerId');
    this.runtime = null;
    this.arbiter = null;
    this.mountManager = null;
    this.launcherOwner = null;
    this.shutdownController = null;
    this.identity = null;
    this.finalHealth = null;
    this.selection = null;
    this.migrationPlan = null;
    this.smartContactReconciliation = null;
    this.started = false;
    this.disposed = false;
    this.lastError = null;
    this.startPromise = null;
    this.rollbackPromise = null;
  }

  get status() { return freezeStatus(this); }

  async ensureAuthoringReady() {
    if (this.disposed || !this.started) throw new Error('มือถือยังไม่พร้อมบันทึกข้อมูล กรุณาเปิดส่วนขยายใหม่');
    const composition = this.runtime?.composition;
    const gate = composition?.authoringGate;
    const guard = composition?.runtimeGuard;
    const heartbeat = composition?.heartbeat;
    if (this.runtime?.role !== 'owner' || !gate || !guard || !heartbeat) throw new Error('ไม่พบ runtime เจ้าของมือถือที่พร้อมใช้งาน');

    let validation = await guard.validateLease();
    if (gate.allows?.('normal') && validation?.valid) return true;

    const gateReason = String(gate.status?.reason || '');
    const leaseReason = String(validation?.reason || '');
    const suspensionLease = leaseReason === 'expired' || leaseReason === 'missing-lease';
    const suspensionGate = gateReason.startsWith('heartbeat-') || gateReason === 'lease-expired' || gateReason === 'lease-missing-lease';
    if (!suspensionLease && !suspensionGate) throw new Error('มือถือหยุดการบันทึกเพื่อป้องกันข้อมูลชนกัน กรุณาโหลดหน้าใหม่');

    const heartbeatStatus = await heartbeat.start();
    if (heartbeatStatus?.running !== true) throw new Error('ปลุกการเชื่อมต่อของมือถือไม่สำเร็จ กรุณาลองอีกครั้ง');
    validation = await guard.validateLease();
    if (!validation?.valid) throw new Error('สิทธิ์บันทึกของมือถือหมดอายุ กรุณาลองอีกครั้ง');

    const checks = Object.freeze({
      ...(this.finalHealth?.checks || {}),
      productionHealthValid: this.finalHealth?.checks?.productionHealthValid === true,
      previewExcluded: this.finalHealth?.checks?.previewExcluded === true,
      identityResolved: Boolean(this.identity),
      compositionServicesReady: true,
      uniqueListenersReady: composition.listenerOwner?.status?.registered === true,
      uniqueGenerationInterceptorReady: composition.generationOwner?.status?.delegateActive === true,
      callIntegrationReady: true,
      shellMountHealthy: this.mountManager?.status?.healthy === true,
      heartbeatQualified: heartbeat.status?.running === true,
    });
    const opened = await gate.open(checks);
    if (!opened?.opened) throw new Error('เปิดสิทธิ์บันทึกของมือถือไม่สำเร็จ กรุณาลองอีกครั้ง');
    this.launcherOwner?.reconcile?.();
    return true;
  }

  async #createOwnerRuntimeWithRecovery({ runtimeFactory, runtimeOptions, clock, heartbeatIntervalMs, leaseRecoveryWaitFn }) {
    const waitFn = leaseRecoveryWaitFn === undefined ? defaultLeaseRecoveryWait : requireFunction(leaseRecoveryWaitFn, 'leaseRecoveryWaitFn');
    const retryIntervalMs = Number.isFinite(heartbeatIntervalMs) && heartbeatIntervalMs > 0
      ? heartbeatIntervalMs
      : DEFAULT_HEARTBEAT_INTERVAL_MS;
    let recoveryDeadline = null;

    while (true) {
      if (this.disposed) throw new Error('Production active startup session was disposed during lease recovery');
      const runtime = await runtimeFactory(runtimeOptions);
      this.runtime = runtime;
      if (runtime?.role === 'owner') return runtime;

      const conflict = recoverableLeaseConflict(runtime);
      if (!conflict) throw new Error('Active production startup could not acquire the single owner runtime');

      const nowMs = leaseRecoveryNow(clock);
      if (recoveryDeadline === null) recoveryDeadline = Math.max(nowMs, conflict.expiresAt) + retryIntervalMs;
      if (nowMs >= recoveryDeadline) {
        await runtime.dispose?.('s13-lease-recovery-timeout');
        throw new Error(`Active production startup lease recovery timed out while blocked by ${conflict.reason}`);
      }

      const untilExpiry = Math.max(0, conflict.expiresAt - nowMs);
      const remaining = Math.max(0, recoveryDeadline - nowMs);
      const waitMs = Math.min(retryIntervalMs, remaining, untilExpiry > 0 ? untilExpiry : retryIntervalMs);
      await runtime.dispose?.('s13-lease-recovery-wait');
      await waitFn(waitMs, conflict);
    }
  }

  async start({ exclusionProof, gateFReport } = {}) {
    if (this.disposed) throw new Error('Production active startup session is disposed');
    if (this.startPromise) return this.startPromise;
    if (this.lastError) {
      // A failed attempt has already completed its fail-safe rollback. Clear only
      // the disposed attempt handles so Retry can create a fresh runtime/lease
      // generation without weakening the underlying single-owner guard.
      this.runtime = null;
      this.arbiter = null;
      this.mountManager = null;
      this.launcherOwner = null;
      this.shutdownController = null;
      this.identity = null;
      this.finalHealth = null;
      this.selection = null;
      this.migrationPlan = null;
      this.smartContactReconciliation = null;
      this.rollbackPromise = null;
      this.lastError = null;
    }
    const attempt = this.#start({ exclusionProof, gateFReport }).catch(error => {
      this.lastError = String(error?.message || error);
      throw error;
    });
    this.startPromise = attempt;
    try {
      return await attempt;
    } finally {
      // Successful startup remains singleton/idempotent. Only a completed failed
      // attempt releases the cached promise so an explicit Retry can re-evaluate
      // current lease state and fail closed again if the conflict is still real.
      if (!this.started && this.startPromise === attempt) this.startPromise = null;
    }
  }

  async #start({ exclusionProof, gateFReport } = {}) {
    const acceptedGateF = requireGateFPass(gateFReport);
    const {
      officialExtensionApi,
      previewReadSource,
      featureFlagStorage = globalThis.localStorage,
      getContext,
      Generate,
      eventSource,
      sillyTavernEventTypes,
      document = globalThis.document,
      globalObject = globalThis,
      eventTarget = globalThis,
      sourceIdentityResolver = null,
      messageIdentityResolver = null,
      databaseFactory,
      runtimeGuardFactory,
      heartbeatFactory,
      clock,
      leaseDurationMs,
      heartbeatIntervalMs,
      leaseRecoveryWaitFn,
      setIntervalFn,
      clearIntervalFn,
      now,
      stageObserver,
      imageProviderConfig,
      runtimeFactory = createTmrwV3ProductionRuntime,
    } = this.options;

    requireFunction(previewReadSource, 'previewReadSource');
    requireFunction(getContext, 'getContext');
    requireFunction(Generate, 'Generate');
    requireFunction(runtimeFactory, 'runtimeFactory');
    if (!eventSource?.on || !eventSource?.removeListener) throw new TypeError('Production active startup requires real SillyTavern eventSource');
    if (!sillyTavernEventTypes || typeof sillyTavernEventTypes !== 'object') throw new TypeError('Production active startup requires real SillyTavern event types');
    if (!document?.createElement || !document?.body?.append) throw new TypeError('Production active startup requires the real document/body');

    const previewControl = createOfficialPreviewControl(officialExtensionApi);
    const featureFlag = new V3BetaFeatureFlag({ storage: featureFlagStorage });
    const productionHealth = new ProductionCompositionHealth({ previewControl });
    this.arbiter = new ProductionRuntimeArbiter({ featureFlag, extensionControl: previewControl, productionHealth });
    this.selection = await this.arbiter.startSelectedRuntime({ exclusionProof });
    if (this.selection.state !== PRODUCTION_RUNTIME_STATE.V3_STARTING || this.selection.activationRequired !== true) {
      if (this.selection.state === PRODUCTION_RUNTIME_STATE.V3_BLOCKED_READONLY && this.selection.requested === true) {
        const error = new Error(`Active production startup blocked by incomplete Preview exclusion: ${(this.selection.exclusion?.blockers || []).join(', ') || 'unproven'}`);
        await this.#rollbackFailure(error);
        throw error;
      }
      return this.status;
    }

    try {
      const previewSnapshot = await previewReadSource();
      const currentContext = getContext();
      let resolvedSourceIdentity = sourceIdentityResolver || null;
      let resolvedMessageIdentity = messageIdentityResolver || null;
      let productionSourceIdentity = resolvedSourceIdentity ? await resolvedSourceIdentity(currentContext) : null;
      let freshIdentitySeed = null;
      const sourceIdentityComplete = Boolean(
        String(productionSourceIdentity?.characterCardSourceId || '').trim()
        && String(productionSourceIdentity?.storySourceId || '').trim()
        && String(productionSourceIdentity?.routeSourceId || '').trim(),
      );
      const legacyPreviewScopeAvailable = previewSnapshot?.available === true
        && Boolean(previewSnapshot?.record)
        && (!productionSourceIdentity || !sourceIdentityComplete || previewRecordContainsSourceIdentity(previewSnapshot.record, productionSourceIdentity));

      if (legacyPreviewScopeAvailable) {
        const planner = await createProductionPackagePreflightSession({
          officialExtensionApi,
          previewReadSource,
          featureFlagStorage,
          now,
        });
        try {
          const inspection = await planner.inspectMigrationPlan();
          this.migrationPlan = inspection.migrationPlan;
        } finally {
          await planner.dispose();
        }
        if (!this.migrationPlan || this.migrationPlan.fatal === true) throw new Error('Active production startup migration plan is unavailable or fatal');
        const mapping = sourceMappingFromPlan(this.migrationPlan);
        resolvedSourceIdentity = resolvedSourceIdentity || (async () => Object.freeze({
          characterCardSourceId: mapping.characterCardSourceId,
          storySourceId: mapping.storySourceId,
          routeSourceId: mapping.routeSourceId,
        }));
        resolvedMessageIdentity = resolvedMessageIdentity || defaultMessageIdentityResolver(mapping);
        productionSourceIdentity = productionSourceIdentity || await resolvedSourceIdentity(currentContext);
      } else {
        if (!resolvedSourceIdentity) throw new Error('Fresh Production startup requires stable SillyTavern source identity without Preview data');
        this.migrationPlan = null;
        productionSourceIdentity = productionSourceIdentity || await resolvedSourceIdentity(currentContext);
        freshIdentitySeed = freshIdentitySeedFromContext(currentContext, productionSourceIdentity);
        resolvedMessageIdentity = resolvedMessageIdentity || freshMessageIdentityResolver(resolvedSourceIdentity);
      }
      if (!productionSourceIdentity || typeof productionSourceIdentity !== 'object') throw new Error('Active production startup requires exact SillyTavern source identity');

    const startupEvidence = Object.freeze({
      requested: true,
      cleanReloadProven: true,
      exclusionProof: Object.freeze({ ...(exclusionProof || {}) }),
      gateFReport: acceptedGateF,
    });
    const runtimeOptions = {
      ownerId: this.ownerId,
      previewControl,
      startupEvidence,
      getContext,
      Generate,
      eventSource,
      sillyTavernEventTypes,
      sourceIdentityResolver: resolvedSourceIdentity,
      messageIdentityResolver: resolvedMessageIdentity,
      onScopeChange: async () => {
        if (!this.mountManager || !this.runtime) throw new Error('Active production scope transition arrived before mount-manager readiness');
        const currentContext = getContext();
        const currentSourceIdentity = await resolvedSourceIdentity(currentContext);
        await this.runtime.provisionProductionScopeAliases(currentSourceIdentity);
        const nextIdentity = await this.runtime.resolveCurrentIdentity();
        await this.mountManager.transitionScope(nextIdentity);

        const leaseValidation = await this.runtime.composition.runtimeGuard.validateLease();
        if (!leaseValidation?.valid) throw new Error(`Active production scope transition lease validation failed: ${leaseValidation?.reason || 'unproven'}`);
        const scopeHealth = await this.runtime.composition.productionHealth.readyToOpenAuthoring({
          ...startupEvidence,
          schemaReady: true,
          leaseValid: true,
          identityResolved: true,
          compositionServicesReady: true,
          uniqueListenersReady: this.runtime.composition.listenerOwner.status.registered === true,
          uniqueGenerationInterceptorReady: this.runtime.composition.generationOwner.status.delegateActive === true,
          callIntegrationReady: true,
          shellMountHealthy: this.mountManager.status.healthy === true,
          heartbeatQualified: this.runtime.composition.heartbeat.status.running === true,
        });
        if (!scopeHealth.ready) throw new Error(`Active production scope transition health blocked: ${scopeHealth.blockers.join(', ')}`);
        const gateResult = await this.runtime.composition.authoringGate.open(scopeHealth.checks);
        if (!gateResult.opened) throw new Error(`Active production scope transition Authoring Gate failed to reopen: ${gateResult.reason}`);
        try {
          await synchronizePlayableScope(this.runtime, nextIdentity);
          await this.mountManager.refresh();
        } catch (error) {
          console.warn('[TMRW Phone] automatic Story/Branch phone synchronization was incomplete:', error);
        }
        this.smartContactReconciliation = await this.runtime.composition.runtimeIntegration.reconcileSmartContactDiscovery?.() || null;

        this.identity = nextIdentity;
        this.finalHealth = scopeHealth;
        this.launcherOwner?.reconcile?.();
      },
      globalObject,
      eventTarget,
      runtimeScope: globalObject,
    };
    if (this.migrationPlan) {
      runtimeOptions.migration = Object.freeze({
        previewQuiesced: true,
        previewReadSource,
        plan: this.migrationPlan,
        productionSourceIdentity: Object.freeze({
          characterCardSourceId: String(productionSourceIdentity.characterCardSourceId || ''),
          storySourceId: String(productionSourceIdentity.storySourceId || ''),
          routeSourceId: String(productionSourceIdentity.routeSourceId || ''),
        }),
        userDisplayName: String(getContext()?.name1 || '{{user}}'),
      });
    } else {
      runtimeOptions.freshIdentitySeed = freshIdentitySeed;
    }
    // A migrated Preview project may later visit a Character Card that was not
    // present in the original migration plan. Keep a fresh-scope authority
    // available so that card receives its own Story/Branch instead of inheriting
    // the previously migrated phone state.
    runtimeOptions.freshIdentitySeedResolver = async sourceIdentity => freshIdentitySeedFromContext(getContext(), sourceIdentity);
    for (const [key, value] of Object.entries({ databaseFactory, runtimeGuardFactory, heartbeatFactory, clock, leaseDurationMs, heartbeatIntervalMs, setIntervalFn, clearIntervalFn, now, stageObserver, imageProviderConfig })) {
      if (value !== undefined) runtimeOptions[key] = value;
    }

    try {
      this.runtime = await this.#createOwnerRuntimeWithRecovery({ runtimeFactory, runtimeOptions, clock, heartbeatIntervalMs, leaseRecoveryWaitFn });
      this.identity = await this.runtime.resolveCurrentIdentity();

      this.mountManager = new ProductionMountManager({
        productionRuntime: this.runtime,
        runtimeArbiter: this.arbiter,
        document,
        hostParent: document.body,
        playerDisplayNameResolver: () => String(getContext()?.name1 || '').trim() || null,
        playerAvatarUrlResolver: () => {
          const context = getContext();
          const direct = context?.userAvatar || context?.user_avatar || context?.persona?.avatar || context?.personaAvatar || context?.powerUserSettings?.persona?.avatar || context?.powerUser?.persona || globalObject?.user_avatar;
          return normalizedAvatarUrl(direct, 'user') || firstImageSource(document, [
            '#user_avatar_block .avatar-container.selected img',
            '#user_avatar_block img.selected',
            '#user_avatar img',
            '[data-testid="user-avatar"] img',
            '#persona-management-button img',
            '.mes[is_user="true"] .avatar img',
            '.mes.is_user .avatar img',
          ]);
        },
        activeCharacterDisplayNameResolver: () => {
          const context = getContext();
          if (context?.groupId) return null;
          const characters = Array.isArray(context?.characters) ? context.characters : [];
          return String(characters[context?.characterId]?.name || '').trim() || null;
        },
        activeCharacterAvatarUrlResolver: () => {
          const context = getContext(); if (context?.groupId) return null;
          const character = Array.isArray(context?.characters) ? context.characters[context?.characterId] : null;
          return normalizedAvatarUrl(character?.avatar, 'character') || firstImageSource(document, [
            '.mes:not([is_user="true"]) .avatar img',
            '.mes[is_user="false"] .avatar img',
          ]);
        },
        ensureAuthoringReady: () => this.ensureAuthoringReady(),
        onVisibilityChange: () => this.launcherOwner?.reconcile?.(),
      });
      await this.mountManager.mount(this.identity);
      if (!this.mountManager.status.healthy) throw new Error('Active production startup shell mount health is unproven');

      this.launcherOwner = new ProductionLauncherOwner({
        productionRuntime: this.runtime,
        runtimeArbiter: this.arbiter,
        mountManager: this.mountManager,
        document,
        hostParent: document.body,
      });
      if (!this.launcherOwner.mount() || !this.launcherOwner.status.mounted) throw new Error('Active production startup launcher ownership is unproven');

      const leaseValidation = await this.runtime.composition.runtimeGuard.validateLease();
      if (!leaseValidation?.valid) throw new Error(`Active production final lease validation failed: ${leaseValidation?.reason || 'unproven'}`);
      this.finalHealth = await this.runtime.composition.productionHealth.readyToOpenAuthoring({
        ...startupEvidence,
        schemaReady: true,
        leaseValid: true,
        identityResolved: true,
        compositionServicesReady: true,
        uniqueListenersReady: this.runtime.composition.listenerOwner.status.registered === true,
        uniqueGenerationInterceptorReady: this.runtime.composition.generationOwner.status.delegateActive === true,
        callIntegrationReady: true,
        shellMountHealthy: this.mountManager.status.healthy === true,
        heartbeatQualified: this.runtime.composition.heartbeat.status.running === true,
      });
      if (!this.finalHealth.ready) throw new Error(`Active production final health blocked: ${this.finalHealth.blockers.join(', ')}`);

      const gateResult = await this.runtime.composition.authoringGate.open(this.finalHealth.checks);
      if (!gateResult.opened) throw new Error(`Active production Authoring Gate failed to open: ${gateResult.reason}`);
      const committed = this.arbiter.markV3Authoring({
        authoringGateOpen: true,
        leaseValid: true,
        identityResolved: true,
        compositionServicesReady: true,
        uniqueListenersReady: this.runtime.composition.listenerOwner.status.registered === true,
        uniqueGenerationInterceptorReady: this.runtime.composition.generationOwner.status.delegateActive === true,
        shellMountHealthy: this.mountManager.status.healthy === true,
        launcherMounted: this.launcherOwner.status.mounted === true,
        heartbeatQualified: this.runtime.composition.heartbeat.status.running === true,
        productionHealthReady: this.finalHealth.ready === true,
      });
      if (committed.activationCommitted !== true) throw new Error(`Runtime Arbiter refused V3 authoring: ${(committed.blockers || []).join(', ')}`);
      try {
        await synchronizePlayableScope(this.runtime, this.identity);
        await this.mountManager.refresh();
      } catch (error) {
        console.warn('[TMRW Phone] automatic startup phone synchronization was incomplete:', error);
      }
      this.smartContactReconciliation = await this.runtime.composition.runtimeIntegration.reconcileSmartContactDiscovery?.() || null;

      this.shutdownController = new ProductionShutdownController({
        productionRuntime: this.runtime,
        mountManager: this.mountManager,
        launcherOwner: this.launcherOwner,
        runtimeArbiter: this.arbiter,
      });
      this.started = true;
      return this.status;
    } catch (error) {
      await this.#rollbackFailure(error);
      throw error;
    }
    } catch (error) {
      await this.#rollbackFailure(error);
      throw error;
    }
  }

  async #rollbackFailure(error) {
    if (this.rollbackPromise) return this.rollbackPromise;
    this.rollbackPromise = (async () => {
      try { this.runtime?.composition?.authoringGate?.close?.('s13-startup-failed'); } catch {}
      try {
        if (this.runtime && this.mountManager && this.launcherOwner) {
          const controller = new ProductionShutdownController({
            productionRuntime: this.runtime,
            mountManager: this.mountManager,
            launcherOwner: this.launcherOwner,
            runtimeArbiter: this.arbiter,
          });
          await controller.shutdown({ reason: 's13-startup-failed' });
        } else if (this.runtime?.dispose) {
          await this.runtime.dispose('s13-startup-failed');
        }
      } catch {}
      try { await this.arbiter?.failSafe?.(error); } catch {}
      this.started = false;
      return this.status;
    })();
    return this.rollbackPromise;
  }

  async shutdown(reason = 's13-active-runtime-shutdown') {
    if (this.disposed) return this.status;
    if (this.shutdownController) await this.shutdownController.shutdown({ reason });
    else if (this.runtime?.dispose) await this.runtime.dispose(reason);
    this.started = false;
    this.disposed = true;
    return this.status;
  }

  async returnToPreview37() {
    if (!this.shutdownController) throw new Error('Active runtime has no shutdown controller');
    const result = await this.shutdownController.returnToPreview37();
    this.started = false;
    this.disposed = true;
    return result;
  }
}

export function createProductionActiveStartupSession(options) {
  return new ProductionActiveStartupSession(options);
}

export function productionVoiceCapabilityForS13() {
  return createPhase19VoiceCapabilityState();
}
