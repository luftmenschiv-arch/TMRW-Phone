import { MemoryV3Database } from '../storage/memory-v3-database.mjs';
import { V3BetaFeatureFlag } from '../beta/feature-flag.mjs';
import { V3RuntimeGuard } from '../beta/runtime-guard.mjs';
import { Milestone1HealthCheck } from '../beta/health-check.mjs';
import { Milestone1BetaOnboarding } from '../beta/onboarding.mjs';
import { V3IdentityKernel } from '../domain/identity/identity-kernel.mjs';
import { CanonicalEventEngine } from '../domain/events/event-transaction.mjs';
import { createCoreEventTypeRegistry } from '../domain/events/event-types.mjs';
import { PhoneStateService } from '../domain/phone/phone-state.mjs';
import { MessageService } from '../domain/messaging/message-service.mjs';
import { CallService } from '../domain/calls/call-service.mjs';
import { Preview37RawReader } from '../migration/preview37/raw-reader.mjs';
import { Preview37MigrationManifest } from '../migration/preview37/manifest.mjs';
import { Preview37CopyMigrationCoordinator } from '../migration/preview37/coordinator.mjs';
import { ProductionAuthoringGate } from './authoring-gate.mjs';
import { FencedV3Database } from './fenced-database.mjs';
import { ProductionCompositionHealth } from './production-health.mjs';
import { ProductionRuntimeArbiter } from './runtime-arbiter.mjs';
import { SillyTavernExtensionControl } from './sillytavern-extension-control.mjs';
import { AUTHORING_CAPABILITY } from './constants.mjs';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

export function createOfficialPreviewControl(officialExtensionApi) {
  if (!officialExtensionApi || typeof officialExtensionApi !== 'object') {
    throw new TypeError('Official SillyTavern extension API is required for production preflight');
  }
  return new SillyTavernExtensionControl({
    findExtension: requireFunction(officialExtensionApi.findExtension, 'findExtension'),
    disableExtension: requireFunction(officialExtensionApi.disableExtension, 'disableExtension'),
    enableExtension: requireFunction(officialExtensionApi.enableExtension, 'enableExtension'),
    extensionSettings: officialExtensionApi.extensionSettings,
  });
}

async function createDryRunGraph({ previewReadSource, now, databaseFactory }) {
  requireFunction(previewReadSource, 'previewReadSource');
  const rawDatabase = databaseFactory();
  if (!rawDatabase || typeof rawDatabase.open !== 'function' || typeof rawDatabase.close !== 'function' || typeof rawDatabase.transaction !== 'function') {
    throw new TypeError('Production preflight requires an isolated MemoryV3Database-compatible database');
  }
  await rawDatabase.open();

  const runtimeGuard = new V3RuntimeGuard({
    database: rawDatabase,
    ownerId: 'tmrw-v3-passive-preflight',
  });
  const gate = new ProductionAuthoringGate({ runtimeGuard });
  const transitionDatabase = new FencedV3Database({
    database: rawDatabase,
    runtimeGuard,
    authoringFence: gate.createFence(),
    capability: AUTHORING_CAPABILITY.TRANSITION,
  });

  const identityKernel = new V3IdentityKernel({ database: transitionDatabase, now });
  const eventEngine = new CanonicalEventEngine({
    database: transitionDatabase,
    // Dry-run services are deliberately non-emitting. The core registry is
    // sufficient for constructor integrity; any accidental Phone/Message/Call
    // emit would fail before a canonical transaction can be admitted.
    eventTypes: createCoreEventTypeRegistry(),
    projectors: [],
    now,
  });
  const phoneStateService = new PhoneStateService({ database: transitionDatabase, eventEngine });
  const messageService = new MessageService({ database: transitionDatabase, eventEngine });
  const callService = new CallService({ database: transitionDatabase, eventEngine });
  const rawReader = new Preview37RawReader({ readSource: previewReadSource });
  const manifest = new Preview37MigrationManifest({ database: transitionDatabase, now });
  const migrationCoordinator = new Preview37CopyMigrationCoordinator({
    database: transitionDatabase,
    rawReader,
    identityKernel,
    phoneStateService,
    messageService,
    callService,
    manifest,
  });
  const healthCheck = new Milestone1HealthCheck({ database: transitionDatabase, now });

  return {
    rawDatabase,
    runtimeGuard,
    gate,
    transitionDatabase,
    migrationCoordinator,
    healthCheck,
    baselineWriteCommits: rawDatabase.diagnostics?.writeCommits ?? null,
  };
}

export class ProductionPackagePreflightSession {
  #featureFlag;
  #previewControl;
  #productionHealth;
  #onboarding;
  #arbiter;
  #graph;
  #disposed = false;
  #lastResult = null;

  static async create({
    officialExtensionApi,
    previewReadSource,
    featureFlagStorage = globalThis.localStorage,
    databaseFactory = () => new MemoryV3Database(),
    now = () => new Date().toISOString(),
  } = {}) {
    if (!featureFlagStorage || typeof featureFlagStorage.getItem !== 'function' || typeof featureFlagStorage.setItem !== 'function') {
      throw new TypeError('Production preflight requires explicit v3 feature-flag storage');
    }
    requireFunction(databaseFactory, 'databaseFactory');
    const previewControl = createOfficialPreviewControl(officialExtensionApi);
    const graph = await createDryRunGraph({ previewReadSource, now, databaseFactory });
    try {
      const featureFlag = new V3BetaFeatureFlag({ storage: featureFlagStorage, now });
      const onboarding = new Milestone1BetaOnboarding({
        migrationCoordinator: graph.migrationCoordinator,
        healthCheck: graph.healthCheck,
      });
      const productionHealth = new ProductionCompositionHealth({
        previewControl,
        milestone1HealthCheck: graph.healthCheck,
      });
      const arbiter = new ProductionRuntimeArbiter({
        featureFlag,
        extensionControl: previewControl,
        productionHealth,
        onboarding,
      });
      return new ProductionPackagePreflightSession({ featureFlag, previewControl, productionHealth, onboarding, arbiter, graph });
    } catch (error) {
      graph.gate.close('preflight-construction-failed');
      await graph.rawDatabase.close();
      throw error;
    }
  }

  constructor({ featureFlag, previewControl, productionHealth, onboarding, arbiter, graph }) {
    this.#featureFlag = featureFlag;
    this.#previewControl = previewControl;
    this.#productionHealth = productionHealth;
    this.#onboarding = onboarding;
    this.#arbiter = arbiter;
    this.#graph = graph;
  }

  get status() {
    const metrics = this.#graph.migrationCoordinator.lastOperationMetrics;
    return Object.freeze({
      configured: true,
      disposed: this.#disposed,
      productionDatabaseOpen: false,
      ephemeralPreflightDatabaseOpen: this.#graph.rawDatabase.isOpen === true,
      leaseAcquired: this.#graph.runtimeGuard.ownsLease === true,
      authoringGateOpen: this.#graph.gate.allows(AUTHORING_CAPABILITY.NORMAL) === true,
      transitionGateOpen: this.#graph.gate.allows(AUTHORING_CAPABILITY.TRANSITION) === true,
      migrationDatabaseCapability: this.#graph.transitionDatabase.capability,
      requestedIntent: this.#featureFlag.read().requested === true,
      authoringAuthority: false,
      canonicalWrites: Number(metrics?.canonicalWrites || 0),
      previewWrites: Number(metrics?.previewWrites || 0),
      runtime: this.#arbiter.inspect(),
    });
  }

  async preflight() {
    if (this.#disposed) throw new Error('Production package preflight session is disposed');
    const beforeWrites = this.#graph.rawDatabase.diagnostics?.writeCommits ?? null;
    const onboarding = await this.#onboarding.inspect();
    const runtime = await this.#arbiter.requestV3({ confirmed: false, onboarding });
    const afterWrites = this.#graph.rawDatabase.diagnostics?.writeCommits ?? null;
    if (beforeWrites !== null && afterWrites !== beforeWrites) {
      this.#graph.gate.close('passive-preflight-write-detected');
      throw new Error('Production package preflight performed an unexpected canonical write');
    }
    const result = Object.freeze({
      onboarding,
      health: runtime.preflight,
      runtime,
      migrationMetrics: this.#graph.migrationCoordinator.lastOperationMetrics,
      status: this.status,
    });
    this.#lastResult = result;
    return result;
  }

  async inspectMigrationPlan() {
    if (this.#disposed) throw new Error('Production package preflight session is disposed');
    const onboarding = await this.#onboarding.inspect();
    return Object.freeze({
      onboarding,
      migrationPlan: onboarding.migrationPlan,
      migrationMetrics: this.#graph.migrationCoordinator.lastOperationMetrics,
      status: this.status,
    });
  }

  async requestTakeover({ gateFReport } = {}) {
    if (this.#disposed) throw new Error('Production package preflight session is disposed');
    if (!gateFReport || gateFReport.status !== 'pass') throw new Error('Confirmed production takeover requires accepted Gate F PASS evidence');
    const beforeWrites = this.#graph.rawDatabase.diagnostics?.writeCommits ?? null;
    const onboarding = await this.#onboarding.inspect();
    const qualifiedOnboarding = Object.freeze({ ...onboarding, gateF: 'pass', gateFReport });
    const runtime = await this.#arbiter.requestV3({ confirmed: true, onboarding: qualifiedOnboarding });
    const afterWrites = this.#graph.rawDatabase.diagnostics?.writeCommits ?? null;
    if (beforeWrites !== null && afterWrites !== beforeWrites) {
      this.#graph.gate.close('confirmed-preflight-write-detected');
      throw new Error('Confirmed production preflight performed an unexpected canonical write');
    }
    return Object.freeze({
      onboarding: qualifiedOnboarding,
      runtime,
      migrationMetrics: this.#graph.migrationCoordinator.lastOperationMetrics,
      status: this.status,
    });
  }

  async checkPostReloadSelection({ exclusionProof = null } = {}) {
    if (this.#disposed) throw new Error('Production package preflight session is disposed');
    return this.#arbiter.startSelectedRuntime({ exclusionProof });
  }

  inspect() {
    return Object.freeze({
      status: this.status,
      lastResult: this.#lastResult,
      preview: this.#previewControl.findPreview37(),
      healthStage: this.#lastResult?.health?.stage || null,
    });
  }

  async dispose() {
    if (this.#disposed) return false;
    this.#graph.gate.close('passive-preflight-disposed');
    await this.#graph.rawDatabase.close();
    this.#disposed = true;
    return true;
  }
}

export function createProductionPackagePreflightSession(options) {
  return ProductionPackagePreflightSession.create(options);
}
