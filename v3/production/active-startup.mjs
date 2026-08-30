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
    voiceRuntimeAvailable: runtime?.voiceCapability?.runtimeAvailable ?? false,
    voiceProviderModelCalls: 0,
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
    this.started = false;
    this.disposed = false;
    this.lastError = null;
    this.startPromise = null;
    this.rollbackPromise = null;
  }

  get status() { return freezeStatus(this); }

  async start({ exclusionProof, gateFReport } = {}) {
    if (this.disposed) throw new Error('Production active startup session is disposed');
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#start({ exclusionProof, gateFReport }).catch(error => {
      this.lastError = String(error?.message || error);
      throw error;
    });
    return this.startPromise;
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
    const resolvedSourceIdentity = sourceIdentityResolver || (async () => Object.freeze({
      characterCardSourceId: mapping.characterCardSourceId,
      storySourceId: mapping.storySourceId,
      routeSourceId: mapping.routeSourceId,
    }));
    const resolvedMessageIdentity = messageIdentityResolver || defaultMessageIdentityResolver(mapping);
    const productionSourceIdentity = await resolvedSourceIdentity(getContext());
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
        if (!this.mountManager) throw new Error('Active production scope transition arrived before mount-manager readiness');
        await this.mountManager.transitionScope();
        this.launcherOwner?.reconcile?.();
      },
      migration: Object.freeze({
        previewQuiesced: true,
        previewReadSource,
        plan: this.migrationPlan,
        productionSourceIdentity: Object.freeze({
          characterCardSourceId: String(productionSourceIdentity.characterCardSourceId || ''),
          storySourceId: String(productionSourceIdentity.storySourceId || ''),
          routeSourceId: String(productionSourceIdentity.routeSourceId || ''),
        }),
        userDisplayName: String(getContext()?.name1 || '{{user}}'),
      }),
      globalObject,
      eventTarget,
      runtimeScope: globalObject,
    };
    for (const [key, value] of Object.entries({ databaseFactory, runtimeGuardFactory, heartbeatFactory, clock, leaseDurationMs, heartbeatIntervalMs, setIntervalFn, clearIntervalFn, now, stageObserver, imageProviderConfig })) {
      if (value !== undefined) runtimeOptions[key] = value;
    }

    try {
      this.runtime = await runtimeFactory(runtimeOptions);
      if (!this.runtime || this.runtime.role !== 'owner') throw new Error('Active production startup could not acquire the single owner runtime');
      this.identity = await this.runtime.resolveCurrentIdentity();

      this.mountManager = new ProductionMountManager({
        productionRuntime: this.runtime,
        runtimeArbiter: this.arbiter,
        document,
        hostParent: document.body,
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
