import { V3Database } from '../storage/v3-database.mjs';
import { Milestone1HealthCheck } from '../beta/health-check.mjs';
import { V3RuntimeGuard } from '../beta/runtime-guard.mjs';
import { ProductionAuthoringGate } from './authoring-gate.mjs';
import { FencedV3Database } from './fenced-database.mjs';
import { LeaseHeartbeat } from './lease-heartbeat.mjs';
import { ProductionCompositionHealth } from './production-health.mjs';
import { ProductionSillyTavernContextAdapter } from './context-source-adapter.mjs';
import { ProductionIdentityBindingResolver } from './identity-binding-resolver.mjs';
import { ProductionListenerOwner } from './listener-owner.mjs';
import { GenerationInterceptorOwner } from './generation-interceptor-owner.mjs';
import { createProductionActivation } from './production-activation.mjs';
import { AUTHORING_CAPABILITY, V3_PRODUCTION_RUNTIME_ID } from './constants.mjs';
import { V3IdentityKernel } from '../domain/identity/identity-kernel.mjs';
import { deterministicIdentityId } from '../domain/identity/id.mjs';
import { createIdentityMapping } from '../domain/identity/identity-mapping.mjs';
import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { CanonicalEventEngine } from '../domain/events/event-transaction.mjs';
import { createPhase17EventTypeRegistry } from '../domain/notifications/notification-event-types.mjs';
import { createClockProjector } from '../domain/time/clock-projector.mjs';
import { createPendingProjector } from '../domain/time/pending-projector.mjs';
import { createActivitySessionProjector } from '../domain/time/activity-session-projector.mjs';
import { createKnowledgeGrantProjector } from '../domain/knowledge/grant-projector.mjs';
import { createPhoneProjector } from '../domain/phone/phone-projector.mjs';
import { createMessagingProjector } from '../domain/messaging/messaging-projector.mjs';
import { createCallHistoryProjector } from '../domain/calls/call-projector.mjs';
import { createAiJobProjector } from '../application/ai-jobs/ai-job-projector.mjs';
import { createHandoffProjector } from '../handoff/handoff-projector.mjs';
import { createDirectorProjector } from '../director/projector.mjs';
import { createSocialProjector } from '../domain/social/social-projector.mjs';
import { createLiveProjector } from '../domain/live/live-projector.mjs';
import { createNotificationProjector } from '../domain/notifications/notification-projector.mjs';
import { KnowledgeService } from '../domain/knowledge/knowledge-service.mjs';
import { StoryChronologyService } from '../domain/time/chronology-service.mjs';
import { PhoneStateService } from '../domain/phone/phone-state.mjs';
import { PlayerAccessOverrideRepository } from '../domain/phone/player-access-override.mjs';
import { ContactService } from '../domain/contacts/contact-service.mjs';
import { MessageService } from '../domain/messaging/message-service.mjs';
import { CallService } from '../domain/calls/call-service.mjs';
import { SocialService } from '../domain/social/social-service.mjs';
import { InsungramService } from '../domain/social/insungram-service.mjs';
import { DisabledSocialAiJobBoundary } from '../domain/social/social-ai-job.mjs';
import { ImageAssetCache } from '../domain/media/asset-cache.mjs';
import { ImageProviderService } from '../application/image-provider-service.mjs';
import { PostVisualResolver } from '../application/post-visual-resolver.mjs';
import { PixabayImageProvider } from '../platform/image-providers/pixabay.mjs';
import { LiveService } from '../domain/live/live-service.mjs';
import { DisabledLiveAiJobBoundary } from '../domain/live/live-ai-job.mjs';
import { NotificationService } from '../domain/notifications/notification-service.mjs';
import { BetaSettingsService } from '../ui/settings-beta.mjs';
import { CallCoordinator } from '../application/call-coordinator.mjs';
import { HandoffCommitCoordinator } from '../handoff/commit-coordinator.mjs';
import { PhoneContextInjector } from '../prompt/phone-context-injector.mjs';
import { SillyTavernCallContinuationDriver } from '../platform/sillytavern/call-continuation-driver.mjs';
import { CallStoryIntegrationCoordinator } from '../application/call-story-integration.mjs';
import { VoiceProfileService } from '../application/voice-profile-service.mjs';
import { VoiceAudioHistoryService } from '../application/voice-audio-history-service.mjs';
import { createPhase19VoiceCapabilityState } from '../domain/voice/voice-capability.mjs';
import { SillyTavernV3RuntimeIntegration } from '../platform/sillytavern/runtime-integration.mjs';
import { PhoneShellViewModels } from '../ui/view-models.mjs';
import { PhoneController } from '../application/phone-controller.mjs';
import { DirectorEventInspector } from '../director/event-inspector.mjs';
import { DirectorCorrectionService } from '../director/correction-service.mjs';
import { UndoCanonService } from '../director/undo-canon.mjs';
import { DirectorUserLockService } from '../director/user-locks.mjs';
import { DirectorAccessOverrideManager } from '../director/access-override-manager.mjs';
import { PromoteToCanonService } from '../director/promote-to-canon.mjs';
import { DirectorKnowledgeCorrection } from '../director/knowledge-correction.mjs';
import { DirectorMappingEditor } from '../director/mapping-editor.mjs';
import { DirectorConsole } from '../director/console.mjs';
import { EventScopedAiJobService } from '../application/ai-jobs/event-scoped-ai-job-service.mjs';
import { Preview37RawReader } from '../migration/preview37/raw-reader.mjs';
import { Preview37MigrationManifest } from '../migration/preview37/manifest.mjs';
import { Preview37CopyMigrationCoordinator } from '../migration/preview37/coordinator.mjs';

const ACTIVE_RUNTIMES = new WeakMap();

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  return value;
}

function productionProjectors() {
  return [
    createClockProjector(),
    createPendingProjector(),
    createActivitySessionProjector(),
    createKnowledgeGrantProjector(),
    createPhoneProjector(),
    createMessagingProjector(),
    createCallHistoryProjector(),
    createAiJobProjector(),
    createHandoffProjector(),
    createDirectorProjector(),
    createSocialProjector(),
    createLiveProjector(),
    createNotificationProjector(),
  ];
}

function createRuntimeBindingResolver({ identityResolver, messageIdentityResolver }) {
  return async input => {
    const exact = await messageIdentityResolver(input);
    if (!exact || typeof exact !== 'object') return Object.freeze({ actorBinding: null, mentionBindings: Object.freeze({}), explicitPhoneActions: Object.freeze([]) });
    const actor = exact.actor;
    if (!actor || typeof actor !== 'object') return Object.freeze({ actorBinding: null, mentionBindings: Object.freeze({}), explicitPhoneActions: Object.freeze(exact.explicitPhoneActions || []) });
    const actorBinding = actor.player === true
      ? await identityResolver.resolvePlayerIdentity({ scope: input.scope, accountId: actor.accountId, accountKey: actor.accountKey, deviceId: actor.deviceId, deviceKey: actor.deviceKey })
      : await identityResolver.resolveActorBinding({ scope: input.scope, sourceAuthority: actor.sourceAuthority, sourceActorId: actor.sourceActorId, sourceType: actor.sourceType || 'actor', accountId: actor.accountId, accountKey: actor.accountKey, deviceId: actor.deviceId, deviceKey: actor.deviceKey });
    const mentionBindings = await identityResolver.resolveMentionBindings({ scope: input.scope, labels: exact.mentionLabels || [], accountKey: exact.mentionAccountKey || null, deviceKey: exact.mentionDeviceKey || null });
    return Object.freeze({ actorBinding, mentionBindings, explicitPhoneActions: Object.freeze(exact.explicitPhoneActions || []) });
  };
}

function createTransitionMigrationCore(database, now) {
  const eventEngine = new CanonicalEventEngine({ database, eventTypes: createPhase17EventTypeRegistry(), projectors: productionProjectors(), now });
  const phones = new PhoneStateService({ database, eventEngine });
  const messages = new MessageService({ database, eventEngine });
  const calls = new CallService({ database, eventEngine });
  return Object.freeze({ eventEngine, phones, messages, calls });
}

async function addProductionScopeAliases({ transitionDatabase, manifest, plan, sourceIdentity, now }) {
  if (!sourceIdentity) return Object.freeze({ added: false, mappings: Object.freeze([]) });
  const characterCardSourceId = String(sourceIdentity.characterCardSourceId || '').trim();
  const storySourceId = String(sourceIdentity.storySourceId || '').trim();
  const routeSourceId = String(sourceIdentity.routeSourceId || '').trim();
  if (!characterCardSourceId || !storySourceId || !routeSourceId) throw new Error('Production scope aliasing requires exact SillyTavern Character Card, Story, and Branch source IDs');
  const identityItem = plan?.items?.find(row => row?.sourceType === 'identity-scope' && ['ready', 'already-migrated'].includes(row?.state));
  if (!identityItem) throw new Error('Production scope aliasing requires one committed Preview identity item');
  const committed = await manifest.getItem(plan.batchId, identityItem.sourceRecordId);
  const identity = committed?.canonical?.identity;
  if (!identity?.cardId || !identity?.storyId || !identity?.branchId) throw new Error('Production scope aliasing requires committed canonical identity IDs');
  const at = now();
  const manifestId = `${plan.batchId}:s13-sillytavern-scope-alias`;
  const rows = [
    { sourceType: 'character-card', sourceId: characterCardSourceId, canonicalType: 'character-card', canonicalId: identity.cardId, parentCanonicalId: null, storyId: null, branchId: null, scopeParts: [] },
    { sourceType: 'story', sourceId: storySourceId, canonicalType: 'story', canonicalId: identity.storyId, parentCanonicalId: identity.cardId, storyId: null, branchId: null, scopeParts: [] },
    { sourceType: 'branch', sourceId: routeSourceId, canonicalType: 'branch', canonicalId: identity.branchId, parentCanonicalId: identity.storyId, storyId: identity.storyId, branchId: identity.branchId, scopeParts: [identity.storyId, identity.branchId] },
  ];
  const unit = new V3UnitOfWork(transitionDatabase);
  const saved = [];
  await unit.readwrite({ stores: ['identityMappings'], privileged: true }, async repositories => {
    for (const spec of rows) {
      const id = await deterministicIdentityId('identity-mapping', { sourceAuthority: 'sillytavern', stableSourceId: `${spec.sourceType}:${spec.sourceId}`, scopeParts: spec.scopeParts });
      const existing = await repositories.identityMappings.get(id);
      if (existing && (existing.canonicalId !== spec.canonicalId || existing.sourceId !== spec.sourceId || existing.sourceType !== spec.sourceType || existing.sourceAuthority !== 'sillytavern')) {
        throw new Error(`Production scope alias conflict for ${spec.sourceType}:${spec.sourceId}`);
      }
      const row = createIdentityMapping({
        id,
        sourceAuthority: 'sillytavern',
        sourceType: spec.sourceType,
        sourceId: spec.sourceId,
        canonicalType: spec.canonicalType,
        canonicalId: spec.canonicalId,
        parentCanonicalId: spec.parentCanonicalId,
        storyId: spec.storyId,
        branchId: spec.branchId,
        createdAt: existing?.createdAt || at,
        updatedAt: at,
        manifestId,
        existingManifestIds: existing?.manifestIds || [],
      });
      await repositories.identityMappings.put(row);
      saved.push(row);
    }
  });
  return Object.freeze({ added: true, mappings: Object.freeze(saved.map(row => Object.freeze({ id: row.id, sourceType: row.sourceType, sourceId: row.sourceId, canonicalId: row.canonicalId }))) });
}

async function runTransitionMigration({ rawDatabase, runtimeGuard, gate, migration, now, activation }) {
  if (!migration) return Object.freeze({ attempted: false, committed: false, plan: null, result: null });
  if (!migration.previewQuiesced) throw new Error('Preview must be quiesced before transition migration');
  requireFunction(migration.previewReadSource, 'migration.previewReadSource');

  const transitionFence = gate.createFence();
  const transitionDatabase = new FencedV3Database({ database: rawDatabase, runtimeGuard, authoringFence: transitionFence, capability: AUTHORING_CAPABILITY.TRANSITION });
  await activation.mark('transition-fenced-database');

  const transitionIdentity = new V3IdentityKernel({ database: transitionDatabase, now });
  const transitionCore = createTransitionMigrationCore(transitionDatabase, now);
  const reader = new Preview37RawReader({ readSource: migration.previewReadSource });
  const manifest = new Preview37MigrationManifest({ database: transitionDatabase, now });
  const coordinator = new Preview37CopyMigrationCoordinator({
    database: transitionDatabase,
    rawReader: reader,
    identityKernel: transitionIdentity,
    phoneStateService: transitionCore.phones,
    messageService: transitionCore.messages,
    callService: transitionCore.calls,
    manifest,
  });
  const plan = migration.plan || await coordinator.dryRun({ userDisplayName: migration.userDisplayName || '{{user}}' });
  if (plan?.fatal) throw new Error('Preview migration plan is fatally invalid');

  const entered = await gate.enterTransition({ previewQuiesced: true });
  if (!entered.opened) throw new Error(`Transition authoring capability unavailable: ${entered.reason}`);
  await activation.mark('migration-transition-open');
  try {
    const result = await coordinator.commit(plan, migration.commitOptions || {});
    const scopeAliases = await addProductionScopeAliases({ transitionDatabase, manifest, plan, sourceIdentity: migration.productionSourceIdentity || null, now });
    return Object.freeze({ attempted: true, committed: true, plan, result, metrics: coordinator.lastOperationMetrics, scopeAliases });
  } catch (error) {
    gate.close('migration-transition-failed');
    throw error;
  } finally {
    gate.close('migration-transition-complete');
  }
}

async function buildRuntime(options, entry) {
  const {
    ownerId,
    previewControl,
    startupEvidence,
    getContext,
    Generate,
    eventSource,
    sillyTavernEventTypes,
    sourceIdentityResolver,
    messageIdentityResolver,
    migration = null,
    onScopeChange = null,
    discardPartialAssistant = null,
    databaseFactory = () => new V3Database(),
    runtimeGuardFactory = input => new V3RuntimeGuard(input),
    heartbeatFactory = input => new LeaseHeartbeat(input),
    globalObject = globalThis,
    eventTarget = null,
    clock = () => Date.now(),
    leaseDurationMs = 30_000,
    heartbeatIntervalMs = 10_000,
    setIntervalFn = globalThis.setInterval?.bind(globalThis),
    clearIntervalFn = globalThis.clearInterval?.bind(globalThis),
    now = () => new Date().toISOString(),
    stageObserver = null,
    imageProviderConfig = null,
  } = options;

  if (typeof ownerId !== 'string' || !ownerId) throw new TypeError('Production runtime ownerId is required');
  if (!previewControl) throw new TypeError('Production runtime requires official Preview extension control');
  requireFunction(getContext, 'getContext');
  requireFunction(Generate, 'Generate');
  requireFunction(sourceIdentityResolver, 'sourceIdentityResolver');
  requireFunction(messageIdentityResolver, 'messageIdentityResolver');
  if (!eventSource?.on || !eventSource?.removeListener) throw new TypeError('Production runtime requires SillyTavern eventSource');
  if (!sillyTavernEventTypes || typeof sillyTavernEventTypes !== 'object') throw new TypeError('Production runtime requires SillyTavern event types');

  let rootRef = null;
  const activation = createProductionActivation({
    stageObserver,
    onDisposed: () => {
      if (ACTIVE_RUNTIMES.get(options.runtimeScope || globalObject) === entry) ACTIVE_RUNTIMES.delete(options.runtimeScope || globalObject);
      rootRef = null;
    },
  });

  let rawDatabase = null;
  let gate = null;
  try {
    await activation.mark('production-runtime-owner', { ownerId, runtimeId: V3_PRODUCTION_RUNTIME_ID });

    rawDatabase = databaseFactory();
    if (!rawDatabase || typeof rawDatabase.open !== 'function' || typeof rawDatabase.close !== 'function') throw new TypeError('databaseFactory must create a V3 database');
    await rawDatabase.open();
    activation.addResource('raw-database', () => rawDatabase.close());
    await activation.mark('raw-database');

    if (!rawDatabase.isOpen) throw new Error('V3 database failed to open');
    await activation.mark('schema-ready', { schemaVersion: rawDatabase.schemaVersion });

    const milestone1HealthCheck = new Milestone1HealthCheck({ database: rawDatabase, now });
    const productionHealth = new ProductionCompositionHealth({ previewControl, milestone1HealthCheck });
    const startupHealth = await productionHealth.startup({ ...(startupEvidence || {}), schemaReady: true });
    await activation.mark('production-health', startupHealth);
    if (!startupHealth.ready) throw new Error(`Production startup health blocked: ${startupHealth.blockers.join(', ')}`);

    const runtimeGuard = runtimeGuardFactory({ database: rawDatabase, ownerId, clock, leaseDurationMs });
    const lease = await runtimeGuard.acquire();
    if (lease?.acquired) activation.addResource('lease-release', () => runtimeGuard.release());
    await activation.mark(lease?.acquired ? 'lease-acquired' : 'lease-standby', lease);
    if (!lease?.acquired) {
      const standby = Object.freeze({
        runtimeId: V3_PRODUCTION_RUNTIME_ID,
        ownerId,
        role: 'standby',
        authoringAvailable: false,
        phoneMountAvailable: false,
        launcherAvailable: false,
        voiceCapability: createPhase19VoiceCapabilityState(),
        startupHealth,
        get status() { return Object.freeze({ role: 'standby', gateState: 'absent', databaseOpen: rawDatabase.isOpen, ownsLease: false, disposed: activation.status.disposed, constructionOrder: activation.status.constructionOrder, disposalOrder: activation.status.disposalOrder }); },
        dispose: reason => activation.dispose(reason || 'standby-disposed'),
      });
      rootRef = standby;
      return standby;
    }

    gate = new ProductionAuthoringGate({ runtimeGuard });
    activation.setAuthoringGate(gate);
    gate.close('s08-construction');
    await activation.mark('authoring-gate-closed');

    const heartbeat = heartbeatFactory({ runtimeGuard, authoringGate: gate, intervalMs: heartbeatIntervalMs, setIntervalFn, clearIntervalFn, eventTarget, visibilityState: () => globalObject.document?.visibilityState ?? 'visible' });
    const heartbeatStatus = await heartbeat.start();
    if (!heartbeatStatus?.running) throw new Error(`Production heartbeat failed to start: ${heartbeatStatus?.lastFailure || 'unproven'}`);
    activation.addResource('heartbeat-stop', () => heartbeat.stop());
    await activation.mark('heartbeat-started', heartbeatStatus);

    const migrationResult = await runTransitionMigration({ rawDatabase, runtimeGuard, gate, migration, now, activation });
    gate.close('s08-normal-graph-construction');

    const normalFence = gate.createFence();
    const normalDatabase = new FencedV3Database({ database: rawDatabase, runtimeGuard, authoringFence: normalFence, capability: AUTHORING_CAPABILITY.NORMAL });
    await activation.mark('normal-fenced-database');

    const identityKernel = new V3IdentityKernel({ database: normalDatabase, now });
    await activation.mark('identity-kernel');

    const contextAdapter = new ProductionSillyTavernContextAdapter({ getContext, sourceIdentityResolver, database: normalDatabase });
    await activation.mark('context-adapter');
    const scopeResolver = context => contextAdapter.resolveScope(context);
    await activation.mark('mapped-scope-resolver');

    const identityResolver = new ProductionIdentityBindingResolver({ identityKernel, database: normalDatabase });
    const bindingResolver = createRuntimeBindingResolver({ identityResolver, messageIdentityResolver });
    await activation.mark('identity-binding-resolver');

    const eventEngine = new CanonicalEventEngine({ database: normalDatabase, eventTypes: createPhase17EventTypeRegistry(), projectors: productionProjectors(), now });
    await activation.mark('canonical-event-engine');

    const knowledge = new KnowledgeService({ database: normalDatabase, eventEngine });
    const chronology = new StoryChronologyService({ database: normalDatabase, eventEngine });
    await activation.mark('knowledge-audience-services');

    const phones = new PhoneStateService({ database: normalDatabase, eventEngine });
    const overrides = new PlayerAccessOverrideRepository({ database: normalDatabase });
    await activation.mark('phone-state-services');

    const contacts = new ContactService({ database: normalDatabase });
    await activation.mark('contacts-service');
    const messages = new MessageService({ database: normalDatabase, eventEngine });
    await activation.mark('messages-service');
    const calls = new CallService({ database: normalDatabase, eventEngine });
    await activation.mark('calls-service');
    const social = new SocialService({ database: normalDatabase, eventEngine });
    const insungram = new InsungramService({ messageService: messages, socialService: social });
    const socialAi = new DisabledSocialAiJobBoundary();
    const configuredImageProvider = imageProviderConfig?.provider || new PixabayImageProvider({
      apiKey: imageProviderConfig?.apiKey || null,
      fetchImpl: imageProviderConfig?.fetchImpl || globalObject.fetch?.bind?.(globalObject),
    });
    const imageAssets = new ImageProviderService({ provider: configuredImageProvider, cache: new ImageAssetCache({ database: normalDatabase }), clock });
    const postVisuals = new PostVisualResolver({ imageProviderService: imageAssets });
    await activation.mark('social-insungram-services');
    const live = new LiveService({ database: normalDatabase, eventEngine });
    const liveAi = new DisabledLiveAiJobBoundary();
    await activation.mark('live-service');
    const notifications = new NotificationService({ database: normalDatabase, now });
    await activation.mark('notification-service');
    const settings = new BetaSettingsService({ database: normalDatabase });
    await activation.mark('beta-settings');

    const undo = new UndoCanonService({ database: normalDatabase, eventEngine });
    const director = Object.freeze({
      inspector: new DirectorEventInspector({ database: normalDatabase }),
      corrections: new DirectorCorrectionService({ database: normalDatabase, eventEngine }),
      undo,
      locks: new DirectorUserLockService({ database: normalDatabase, eventEngine }),
      access: new DirectorAccessOverrideManager({ database: normalDatabase }),
      promotions: new PromoteToCanonService({ database: normalDatabase, eventEngine }),
      knowledgeCorrections: new DirectorKnowledgeCorrection({ eventEngine, undoCanon: undo }),
      mappings: new DirectorMappingEditor({ database: normalDatabase, eventEngine }),
      console: new DirectorConsole({ database: normalDatabase, eventEngine }),
      jobs: new EventScopedAiJobService({ database: normalDatabase, eventEngine, knowledgeService: knowledge }),
    });

    const callCoordinator = new CallCoordinator({ database: normalDatabase, callService: calls, phoneStateService: phones });
    await activation.mark('call-coordinator');
    const handoff = new HandoffCommitCoordinator({ database: normalDatabase, eventEngine, messageService: messages, callService: calls });
    await activation.mark('handoff-coordinator');
    const phoneContext = new PhoneContextInjector({ knowledgeService: knowledge });
    await activation.mark('phone-context-injector');
    const continuation = new SillyTavernCallContinuationDriver({ Generate, getContext });
    await activation.mark('call-continuation-driver');
    const callStoryIntegration = new CallStoryIntegrationCoordinator({ handoffCoordinator: handoff, callService: calls, callCoordinator, knowledgeService: knowledge, phoneContextBuilder: phoneContext, settingsService: settings });
    await activation.mark('call-story-integration');

    const voiceProfiles = new VoiceProfileService({ database: normalDatabase });
    await activation.mark('voice-profile-service');
    const voiceAudioHistory = new VoiceAudioHistoryService({ database: normalDatabase });
    await activation.mark('voice-audio-history-service');
    const voiceCapability = createPhase19VoiceCapabilityState();
    if (voiceCapability.runtimeAvailable !== false) throw new Error('S08 must preserve Voice runtimeAvailable=false');
    await activation.mark('voice-runtime-unavailable', voiceCapability);

    const runtimeIntegration = new SillyTavernV3RuntimeIntegration({
      eventSource,
      eventTypes: sillyTavernEventTypes,
      getContext,
      scopeResolver,
      bindingResolver,
      handoffCoordinator: handoff,
      phoneContextBuilder: phoneContext,
      callStoryIntegration,
      discardPartialAssistant,
      authoringEnabled: () => gate.allows(AUTHORING_CAPABILITY.NORMAL),
    });
    await activation.mark('runtime-integration');

    const scopeChange = async (...args) => {
      gate.close('story-branch-scope-change-requires-remount');
      if (typeof onScopeChange === 'function') await onScopeChange(...args);
    };
    const listenerOwner = new ProductionListenerOwner({ runtimeIntegration, eventSource, eventTypes: sillyTavernEventTypes, authoringGate: gate, runtimeGuard, onScopeChange: scopeChange });
    if (!listenerOwner.register()) throw new Error('Production listener ownership could not be proven');
    activation.addResource('listener-owner', () => listenerOwner.unregister());
    await activation.mark('listener-owner');

    const generationOwner = new GenerationInterceptorOwner({ authoringGate: gate, runtimeGuard, globalObject });
    if (!generationOwner.installShim() && !generationOwner.status.installed) throw new Error('Production generation shim ownership could not be proven');
    if (!generationOwner.activateDelegate(runtimeIntegration) && !generationOwner.status.delegateActive) throw new Error('Production generation delegate ownership could not be proven');
    activation.addResource('generation-interceptor-owner', () => generationOwner.dispose());
    await activation.mark('generation-interceptor-owner');

    const viewModels = new PhoneShellViewModels({ database: normalDatabase, phoneStateService: phones, contactService: contacts, settingsService: settings, messageService: messages, callService: calls, callCoordinator, socialService: social, insungramService: insungram, liveService: live, notificationService: notifications, voiceProfileService: voiceProfiles, voiceAudioHistoryService: voiceAudioHistory, voiceCapability });
    await activation.mark('phone-shell-view-models');
    const phoneController = new PhoneController({ phoneStateService: phones, playerAccessOverrides: overrides });
    activation.addResource('phone-controller', () => phoneController.disableBeta());
    await activation.mark('phone-controller');

    const leaseValidation = await runtimeGuard.validateLease();
    if (!leaseValidation?.valid) throw new Error(`Final S08 lease validation failed: ${leaseValidation?.reason || 'unproven'}`);
    const finalHealth = await productionHealth.readyToOpenAuthoring({ ...(startupEvidence || {}), schemaReady: true, leaseValid: true, identityResolved: false, compositionServicesReady: true, uniqueListenersReady: listenerOwner.status.registered, uniqueGenerationInterceptorReady: generationOwner.status.delegateActive, callIntegrationReady: true, shellMountHealthy: false, heartbeatQualified: heartbeat.status.running });
    gate.close('s08-awaiting-s09-mount-launcher');
    await activation.mark('s08-ready-without-mount', finalHealth);

    const services = Object.freeze({ knowledge, chronology, phones, overrides, contacts, messages, calls, social, insungram, socialAi, imageAssets, postVisuals, live, liveAi, notifications, settings, director, callCoordinator, handoff, phoneContext, continuation, callStoryIntegration, voiceProfiles, voiceAudioHistory, viewModels, phoneController });
    const composition = Object.freeze({ normalDatabase, identityKernel, contextAdapter, identityResolver, eventEngine, runtimeIntegration, listenerOwner, generationOwner, heartbeat, authoringGate: gate, runtimeGuard, productionHealth });

    const root = Object.freeze({
      runtimeId: V3_PRODUCTION_RUNTIME_ID,
      ownerId,
      role: 'owner',
      services,
      composition,
      voiceCapability,
      imageCapability: imageAssets.capability(),
      migration: migrationResult,
      startupHealth,
      finalHealth,
      authoringAvailable: false,
      phoneMountAvailable: false,
      launcherAvailable: false,
      get status() { return Object.freeze({ role: 'owner', gateState: gate.state, ownsLease: runtimeGuard.ownsLease, databaseOpen: rawDatabase.isOpen, heartbeatRunning: heartbeat.status.running, listenerRegistered: listenerOwner.status.registered, interceptorDelegateActive: generationOwner.status.delegateActive, voiceRuntimeAvailable: voiceCapability.runtimeAvailable, phoneMounted: false, launcherMounted: false, disposed: activation.status.disposed, constructionOrder: activation.status.constructionOrder, disposalOrder: activation.status.disposalOrder }); },
      async resolveCurrentIdentity() {
        const scope = await contextAdapter.resolveScope();
        const player = await identityResolver.resolvePlayerIdentity({ scope });
        return Object.freeze({ scope, player });
      },
      dispose(reason = 'production-runtime-disposed') { return activation.dispose(reason); },
    });
    rootRef = root;
    return root;
  } catch (error) {
    await activation.fail(activation.status.stage || 'unknown', error);
  }
}

export async function createTmrwV3ProductionRuntime(options = {}) {
  const runtimeScope = options.runtimeScope || options.globalObject || globalThis;
  if (!runtimeScope || (typeof runtimeScope !== 'object' && typeof runtimeScope !== 'function')) throw new TypeError('runtimeScope must be an object');
  const existing = ACTIVE_RUNTIMES.get(runtimeScope);
  if (existing) return existing.promise;
  const entry = { promise: null };
  entry.promise = buildRuntime({ ...options, runtimeScope }, entry).catch(error => {
    if (ACTIVE_RUNTIMES.get(runtimeScope) === entry) ACTIVE_RUNTIMES.delete(runtimeScope);
    throw error;
  });
  ACTIVE_RUNTIMES.set(runtimeScope, entry);
  return entry.promise;
}
