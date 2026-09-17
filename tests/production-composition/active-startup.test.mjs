import test from 'node:test';
import assert from 'node:assert/strict';

import { ProductionActiveStartupSession } from '../../production/active-startup.mjs';
import { createTmrwV3ProductionRuntime } from '../../production/composition-root.mjs';
import { MemoryKeyValueStorage, V3BetaFeatureFlag } from '../../beta/feature-flag.mjs';
import { MemoryV3Database } from '../../storage/memory-v3-database.mjs';
import { V3IdentityKernel } from '../../domain/identity/identity-kernel.mjs';
import { deterministicIdentityId } from '../../domain/identity/id.mjs';
import { createIdentityMapping } from '../../domain/identity/identity-mapping.mjs';
import { V3_RUNTIME_LEASE_KEY } from '../../storage/schema.mjs';
import { V3_ROOT_ID, V3_LAUNCHER_ID } from '../../production/constants.mjs';
import { setupPhase17 } from '../phase17/notification-fixtures.mjs';
import { identitySeed } from '../phase2/identity-fixtures.mjs';
import { preview37Project } from '../phase12/preview37-fixtures.mjs';
import { FakeDocument, FakeNode } from '../phase7/fake-dom.mjs';

const EVENT_TYPES = Object.freeze({
  CHAT_CHANGED: 'chat-changed',
  MESSAGE_SENT: 'sent',
  MESSAGE_RECEIVED: 'received',
  MESSAGE_SWIPED: 'swiped',
  MESSAGE_EDITED: 'edited',
  MESSAGE_DELETED: 'deleted',
  IMPERSONATE_READY: 'impersonate',
});

class FakeEventSource {
  listeners = new Map();
  on(type, handler) { const rows = this.listeners.get(type) || []; rows.push(handler); this.listeners.set(type, rows); }
  removeListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(row => row !== handler)); }
  async emit(type, ...args) { for (const handler of [...(this.listeners.get(type) || [])]) await handler(...args); }
}

function fakeTimers() {
  let next = 1;
  const timers = new Map();
  return {
    timers,
    setIntervalFn(fn) { const id = next++; timers.set(id, fn); return id; },
    clearIntervalFn(id) { timers.delete(id); },
  };
}

function mutableClock(start = 1_000) {
  let value = start;
  return {
    now: () => value,
    advance(delta) { value += delta; return value; },
  };
}

function controlledLeaseWait() {
  let enteredResolve;
  let releaseWait = null;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  return {
    entered,
    waitFn(ms, conflict) {
      enteredResolve({ ms, conflict });
      return new Promise(resolve => { releaseWait = resolve; });
    },
    release() { releaseWait?.(); },
  };
}

function nodesById(root, id) {
  const rows = [];
  const walk = node => {
    if (!node) return;
    const nodeId = node.id || node.attributes?.get?.('id') || null;
    if (nodeId === id) rows.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(root);
  return rows;
}

function officialPreviewApi({ restoreFails = false, installed = true } = {}) {
  const name = 'third-party/TMRW-Phone-Preview';
  const extensionSettings = { disabledExtensions: [name] };
  let enabled = false;
  let enableCalls = 0;
  let disableCalls = 0;
  return {
    extensionSettings,
    findExtension() { return installed ? { name, enabled } : null; },
    async disableExtension() { disableCalls += 1; enabled = false; if (!extensionSettings.disabledExtensions.includes(name)) extensionSettings.disabledExtensions.push(name); },
    async enableExtension() {
      enableCalls += 1;
      if (restoreFails) throw new Error('injected Preview restore failure');
      enabled = true;
      extensionSettings.disabledExtensions = extensionSettings.disabledExtensions.filter(row => row !== name);
    },
    get enableCalls() { return enableCalls; },
    get disableCalls() { return disableCalls; },
    get previewEnabled() { return enabled; },
  };
}

async function seedProductionScope(registry, suffix, castSize = 2) {
  const bootstrap = await setupPhase17({ registry, castSize: 1, manifestId: `s13-bootstrap-${suffix}` });
  const kernel = new V3IdentityKernel({ database: bootstrap.database, now: () => '2026-08-29T00:00:00.000Z' });
  const identity = await kernel.seedIdentityGraph({
    ...identitySeed({
      castSize,
      manifestId: `s13-production-${suffix}`,
      cardSourceId: `card-${suffix}`,
      storySourceId: `card-${suffix}:story-${suffix}`,
      routeSourceId: `branch-${suffix}`,
    }),
    sourceAuthority: 'sillytavern',
  });
  await bootstrap.phones.initializeScope({ storyId: identity.storyId, branchId: identity.branchId });
  bootstrap.database.close();
  return identity;
}

function previewScopeProject({ cardKey, storyKey, branchKey, suffix }) {
  const base = preview37Project({ castSize: 2, suffix, includeGroup: false, includeCall: true });
  const baseCard = base.cards[`card-${suffix}`];
  const baseStory = baseCard.stories[`story-${suffix}`];
  const baseBranch = baseStory.branches[`branch-${suffix}`];
  return {
    schemaVersion: base.schemaVersion,
    cards: {
      [cardKey]: {
        ...baseCard,
        cardKey,
        cardName: cardKey,
        stories: {
          [storyKey]: {
            ...baseStory,
            storyId: storyKey,
            branches: { [branchKey]: { ...baseBranch, branchId: branchKey } },
          },
        },
      },
    },
  };
}

function mergePreviewProjects(...projects) {
  return { schemaVersion: 2, cards: Object.assign({}, ...projects.map(project => project.cards)) };
}

async function readStoreRows(registry, storeName) {
  const db = new MemoryV3Database({ registry });
  await db.open();
  const rows = await db.transaction([storeName], 'readonly', tx => tx.store(storeName).getAll());
  db.close();
  return rows;
}

async function seedKnownStaleS13AliasChain(registry, sourceIdentity, suffix = 'stale-s13') {
  const bootstrap = await setupPhase17({ registry, castSize: 1, manifestId: `s13-stale-bootstrap-${suffix}` });
  const kernel = new V3IdentityKernel({ database: bootstrap.database, now: () => '2026-08-29T00:00:00.000Z' });
  const wrong = await kernel.seedIdentityGraph({
    ...identitySeed({
      castSize: 1,
      manifestId: `s13-stale-wrong-${suffix}`,
      cardSourceId: `wrong-card-${suffix}`,
      storySourceId: `wrong-card-${suffix}:wrong-story-${suffix}`,
      routeSourceId: `wrong-branch-${suffix}`,
    }),
    sourceAuthority: 'preview37',
  });
  const at = '2026-08-29T00:00:00.000Z';
  const manifestId = `legacy-${suffix}:s13-sillytavern-scope-alias`;
  const specs = [
    { sourceType: 'character-card', sourceId: sourceIdentity.characterCardSourceId, canonicalType: 'character-card', canonicalId: wrong.cardId, parentCanonicalId: null, storyId: null, branchId: null, scopeParts: [] },
    { sourceType: 'story', sourceId: sourceIdentity.storySourceId, canonicalType: 'story', canonicalId: wrong.storyId, parentCanonicalId: wrong.cardId, storyId: null, branchId: null, scopeParts: [wrong.cardId] },
    { sourceType: 'branch', sourceId: sourceIdentity.routeSourceId, canonicalType: 'branch', canonicalId: wrong.branchId, parentCanonicalId: wrong.storyId, storyId: wrong.storyId, branchId: wrong.branchId, scopeParts: [wrong.storyId, wrong.branchId] },
  ];
  await bootstrap.database.transaction(['identityMappings'], 'readwrite', async tx => {
    const store = tx.store('identityMappings');
    for (const spec of specs) {
      const id = await deterministicIdentityId('identity-mapping', { sourceAuthority: 'sillytavern', stableSourceId: `${spec.sourceType}:${spec.sourceId}`, scopeParts: spec.scopeParts });
      await store.put(createIdentityMapping({
        id,
        sourceAuthority: 'sillytavern',
        sourceType: spec.sourceType,
        sourceId: spec.sourceId,
        canonicalType: spec.canonicalType,
        canonicalId: spec.canonicalId,
        parentCanonicalId: spec.parentCanonicalId,
        storyId: spec.storyId,
        branchId: spec.branchId,
        createdAt: at,
        updatedAt: at,
        manifestId,
      }));
    }
  });
  bootstrap.database.close();
  return wrong;
}

async function storedLease(registry) {
  const db = new MemoryV3Database({ registry });
  await db.open();
  const row = await db.transaction(['metadata'], 'readonly', tx => tx.store('metadata').get(V3_RUNTIME_LEASE_KEY));
  db.close();
  return row;
}

async function seedRuntimeLease(registry, { ownerId, leaseId, acquiredAt, expiresAt }) {
  const db = new MemoryV3Database({ registry });
  await db.open();
  await db.transaction(['metadata'], 'readwrite', tx => tx.store('metadata').put({
    key: V3_RUNTIME_LEASE_KEY,
    ownerId,
    leaseId,
    acquiredAt,
    renewedAt: acquiredAt,
    expiresAt,
    phase: 1,
  }));
  db.close();
}

async function harness({ suffix = `case-${Math.random().toString(36).slice(2)}`, ownerId = null, restoreFails = false, previewInstalled = true, appendFailureId = null, previewReadSource = null, previewSource = null, stageObserver = null, sourceIdentityResolver = undefined, getContext = null, runtimeFactory = undefined, preseedProductionScope = true, registry = MemoryV3Database.createRegistry(), clock = undefined, leaseDurationMs = undefined, heartbeatIntervalMs = 10_000, leaseRecoveryWaitFn = undefined } = {}) {
  const source = previewSource ? structuredClone(previewSource) : preview37Project({ castSize: 2, suffix, includeGroup: false, includeCall: true });
  if (preseedProductionScope) await seedProductionScope(registry, suffix, 2);
  const rawDatabases = [];
  const document = new FakeDocument();
  const body = new FakeNode('body');
  const originalAppend = body.append.bind(body);
  body.append = (...nodes) => {
    for (const node of nodes) {
      const id = node?.id || node?.attributes?.get?.('id') || null;
      if (appendFailureId && id === appendFailureId) throw new Error(`injected append failure:${id}`);
    }
    originalAppend(...nodes);
  };
  document.body = body;
  document.visibilityState = 'visible';
  const globalObject = { document };
  const timers = fakeTimers();
  const eventSource = new FakeEventSource();
  const api = officialPreviewApi({ restoreFails, installed: previewInstalled });
  const featureFlagStorage = new MemoryKeyValueStorage();
  new V3BetaFeatureFlag({ storage: featureFlagStorage, now: () => '2026-08-29T00:00:00.000Z' }).requestEnable();
  const readSource = previewReadSource || (async () => ({ available: true, sourceVersion: source.schemaVersion, sourceLocation: `s13-${suffix}`, record: structuredClone(source) }));
  const options = {
    ownerId: ownerId || `s13-owner-${suffix}`,
    officialExtensionApi: api,
    previewReadSource: readSource,
    featureFlagStorage,
    getContext: getContext || (() => ({ name1: 'Player', chatId: `chat-${suffix}`, chat: [] })),
    Generate: async () => {},
    eventSource,
    sillyTavernEventTypes: EVENT_TYPES,
    document,
    globalObject,
    eventTarget: null,
    databaseFactory: () => { const db = new MemoryV3Database({ registry }); rawDatabases.push(db); return db; },
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
    heartbeatIntervalMs,
    clock,
    leaseDurationMs,
    leaseRecoveryWaitFn,
    now: () => '2026-08-29T00:00:00.000Z',
    stageObserver,
  };
  if (sourceIdentityResolver !== undefined) options.sourceIdentityResolver = sourceIdentityResolver;
  if (runtimeFactory !== undefined) options.runtimeFactory = runtimeFactory;
  const session = new ProductionActiveStartupSession(options);
  return { session, api, featureFlagStorage, registry, rawDatabases, document, body, timers, source, options, eventSource };
}

async function phase24FreshHarness({ suffix, ownerId, registry, clock, leaseDurationMs = 100, heartbeatIntervalMs = 25, leaseRecoveryWaitFn = undefined }) {
  const sourceIdentity = Object.freeze({
    characterCardSourceId: `character:${suffix}.png`,
    storySourceId: `story:chat-${suffix}`,
    routeSourceId: 'branch:main',
  });
  return harness({
    suffix,
    ownerId,
    registry,
    previewInstalled: false,
    preseedProductionScope: false,
    previewReadSource: async () => ({ available: false, reason: 'preview-project-database-missing' }),
    sourceIdentityResolver: async () => sourceIdentity,
    clock: clock?.now,
    leaseDurationMs,
    heartbeatIntervalMs,
    leaseRecoveryWaitFn,
  });
}

const exclusionProof = Object.freeze({ launcherAbsent: true, rootAbsent: true, runtimeGlobalAbsent: true });
const gateFReport = Object.freeze({ status: 'pass' });

async function assertRecovered(h, { expectRuntime = false } = {}) {
  const status = h.session.status;
  assert.equal(status.authoringAuthority, false);
  assert.notEqual(status.authoringGateState, 'open');
  assert.equal(nodesById(h.body, V3_ROOT_ID).length, 0);
  assert.equal(nodesById(h.body, V3_LAUNCHER_ID).length, 0);
  if (expectRuntime && h.session.runtime) {
    assert.equal(h.session.runtime.status.disposed, true);
    assert.equal(h.session.runtime.status.ownsLease, false);
    assert.equal(h.session.runtime.status.databaseOpen, false);
    assert.equal(h.session.runtime.composition.listenerOwner.status.registered, false);
    assert.equal(h.session.runtime.composition.generationOwner.status.delegateActive, false);
  }
  assert.equal(await storedLease(h.registry), undefined);
  assert.equal(new V3BetaFeatureFlag({ storage: h.featureFlagStorage }).read().requested, true);
  assert.equal(h.session.arbiter.inspect().state, 'FAILED_SAFE');
  assert.equal(h.api.previewEnabled, false);
  const beforeWrites = h.rawDatabases.at(-1)?.diagnostics?.writeCommits ?? null;
  await h.session.shutdown('repeat-cleanup-1');
  await h.session.shutdown('repeat-cleanup-2');
  const afterWrites = h.rawDatabases.at(-1)?.diagnostics?.writeCommits ?? null;
  if (beforeWrites !== null && afterWrites !== null) assert.equal(afterWrites, beforeWrites);
}

test('S13 incomplete post-reload exclusion proof enters common official Preview recovery and never creates authority', async () => {
  const h = await harness({ suffix: 'exclusion' });
  await assert.rejects(() => h.session.start({ exclusionProof: { launcherAbsent: false, rootAbsent: true, runtimeGlobalAbsent: true }, gateFReport }), /incomplete Preview exclusion/);
  assert.equal(h.api.enableCalls, 0);
  assert.equal(h.rawDatabases.length, 0);
  await assertRecovered(h);
});

test('S13 migration-plan recomputation failure is caught before runtime creation and restores Preview officially', async () => {
  const h = await harness({ suffix: 'plan', previewReadSource: async () => { throw new Error('injected migration-plan failure'); } });
  await assert.rejects(() => h.session.start({ exclusionProof, gateFReport }), /migration-plan failure/);
  assert.equal(h.rawDatabases.length, 0);
  assert.equal(h.api.enableCalls, 0);
  await assertRecovered(h);
});

test('S13 migration-transition failure reverse-unwinds DB/heartbeat/lease before official Preview recovery', async () => {
  const h = await harness({ suffix: 'transition', stageObserver: stage => { if (stage === 'migration-transition-open') throw new Error('injected migration transition failure'); } });
  await assert.rejects(() => h.session.start({ exclusionProof, gateFReport }), /migration transition failure/);
  assert.equal(h.api.enableCalls, 0);
  assert.equal(h.timers.timers.size, 0);
  await assertRecovered(h);
});

test('S13 exact identity failure disposes the constructed runtime and performs no canonical rollback writes', async () => {
  const h = await harness({ suffix: 'identity', sourceIdentityResolver: async () => ({ characterCardSourceId: '', storySourceId: '', routeSourceId: '' }) });
  await assert.rejects(() => h.session.start({ exclusionProof, gateFReport }), /scope aliasing requires exact SillyTavern/i);
  assert.equal(h.api.enableCalls, 0);
  await assertRecovered(h, { expectRuntime: true });
});

test('S13 composition construction failure reverse-unwinds partial listeners/heartbeat/lease and restores Preview', async () => {
  const h = await harness({ suffix: 'composition', preseedProductionScope: false, stageObserver: stage => { if (stage === 'contacts-service') throw new Error('injected composition construction failure'); } });
  await assert.rejects(() => h.session.start({ exclusionProof, gateFReport }), /composition construction failure/);
  assert.equal(h.api.enableCalls, 0);
  await assertRecovered(h);
});

test('S13 mount failure leaves no root/launcher/delegate and restores Preview through official control', async () => {
  const h = await harness({ suffix: 'mount', preseedProductionScope: false, appendFailureId: V3_ROOT_ID });
  await assert.rejects(() => h.session.start({ exclusionProof, gateFReport }), /append failure:tmrw-v3-phone-root/);
  assert.equal(h.api.enableCalls, 0);
  await assertRecovered(h, { expectRuntime: true });
});

test('S13 launcher failure removes the already-mounted shell/root and restores Preview through common rollback', async () => {
  const h = await harness({ suffix: 'launcher', preseedProductionScope: false, appendFailureId: V3_LAUNCHER_ID });
  await assert.rejects(() => h.session.start({ exclusionProof, gateFReport }), /append failure:tmrw-v3-phone-launcher/);
  assert.equal(h.api.enableCalls, 0);
  await assertRecovered(h, { expectRuntime: true });
});

test('S13 final lease validation failure closes and disposes the mounted runtime before Preview recovery', async () => {
  const h = await harness({
    suffix: 'lease',
    preseedProductionScope: false,
    runtimeFactory: async options => {
      const runtime = await createTmrwV3ProductionRuntime(options);
      const original = runtime.composition.runtimeGuard.validateLease.bind(runtime.composition.runtimeGuard);
      runtime.composition.runtimeGuard.validateLease = async () => ({ valid: false, reason: 'injected-final-lease' });
      runtime.composition.runtimeGuard.__restoreValidate = original;
      return runtime;
    },
  });
  await assert.rejects(() => h.session.start({ exclusionProof, gateFReport }), /final lease validation failed: injected-final-lease/);
  assert.equal(h.api.enableCalls, 0);
  await assertRecovered(h, { expectRuntime: true });
});

test('S13 final Production Health failure closes mounted runtime and cannot transition arbiter to authoring', async () => {
  const h = await harness({
    suffix: 'health',
    preseedProductionScope: false,
    runtimeFactory: async options => {
      const runtime = await createTmrwV3ProductionRuntime(options);
      runtime.composition.productionHealth.readyToOpenAuthoring = async () => Object.freeze({ ready: false, blockers: Object.freeze(['injected-final-health']), checks: Object.freeze({}) });
      return runtime;
    },
  });
  await assert.rejects(() => h.session.start({ exclusionProof, gateFReport }), /final health blocked: injected-final-health/);
  assert.equal(h.api.enableCalls, 0);
  await assertRecovered(h, { expectRuntime: true });
});

test('S13 startup exclusion failure remains FAILED_SAFE without attempting Preview restoration', async () => {
  const h = await harness({ suffix: 'no-preview-fallback', restoreFails: true });
  await assert.rejects(() => h.session.start({ exclusionProof: { launcherAbsent: false, rootAbsent: true, runtimeGlobalAbsent: true }, gateFReport }), /incomplete Preview exclusion/);
  assert.equal(h.api.enableCalls, 0);
  await assertRecovered(h);
});

test('S13 isolated happy path reaches one V3_AUTHORING graph/root/launcher with Voice unavailable and restores Preview cleanly', async () => {
  const h = await harness({ suffix: 'happy', preseedProductionScope: false });
  const started = await h.session.start({ exclusionProof, gateFReport });
  assert.equal(started.started, true);
  assert.equal(started.runtimeState, 'V3_AUTHORING');
  assert.equal(started.authoringAuthority, true);
  assert.equal(started.ownsLease, true);
  assert.equal(started.authoringGateState, 'open');
  assert.equal(started.listenerRegistered, true);
  assert.equal(started.interceptorDelegateActive, true);
  assert.equal(started.phoneRootMounted, true);
  assert.equal(started.launcherMounted, true);
  assert.equal(nodesById(h.body, V3_ROOT_ID).length, 1);
  assert.equal(nodesById(h.body, V3_LAUNCHER_ID).length, 1);
  assert.equal(started.voiceRuntimeAvailable, false);
  assert.equal(started.voiceProviderModelCalls, 0);
  assert.ok(await storedLease(h.registry));
  const restored = await h.session.returnToPreview37();
  assert.equal(restored.restored, true);
  assert.equal(nodesById(h.body, V3_ROOT_ID).length, 0);
  assert.equal(nodesById(h.body, V3_LAUNCHER_ID).length, 0);
  assert.equal(await storedLease(h.registry), undefined);
  assert.equal(h.api.previewEnabled, true);
  assert.equal(h.session.arbiter.inspect().authoringAuthority, false);
});

test('Phase24 retired Preview package reaches V3_AUTHORING from retained Preview data without a live Preview runtime', async () => {
  const h = await harness({ suffix: 'phase24-retired-preview', previewInstalled: false, preseedProductionScope: false });
  const started = await h.session.start({ exclusionProof, gateFReport });
  assert.equal(started.runtimeState, 'V3_AUTHORING');
  assert.equal(started.authoringAuthority, true);
  assert.equal(started.ownsLease, true);
  assert.equal(started.databaseOpen, true);
  assert.equal(started.launcherMounted, true);
  assert.equal(h.session.arbiter.inspect().preview, null);
  assert.equal(h.api.enableCalls, 0);
  assert.equal(h.api.disableCalls, 0);
  await h.session.shutdown('phase24-retired-preview-test');
  assert.equal(await storedLease(h.registry), undefined);
});

test('Phase24 fresh user with no Preview package or data bootstraps native Production identity and reaches V3_AUTHORING', async () => {
  const suffix = 'phase24-fresh-user';
  const sourceIdentity = Object.freeze({
    characterCardSourceId: 'character:fresh-user.png',
    storySourceId: `story:chat-${suffix}`,
    routeSourceId: 'branch:main',
  });
  const h = await harness({
    suffix,
    previewInstalled: false,
    preseedProductionScope: false,
    previewReadSource: async () => ({ available: false, reason: 'preview-project-database-missing' }),
    sourceIdentityResolver: async () => sourceIdentity,
  });
  const started = await h.session.start({ exclusionProof, gateFReport });
  assert.equal(started.runtimeState, 'V3_AUTHORING');
  assert.equal(started.authoringAuthority, true);
  assert.equal(started.ownsLease, true);
  assert.equal(started.databaseOpen, true);
  assert.equal(started.launcherMounted, true);
  assert.equal(started.migrationCommitted, false);
  assert.equal(started.productionBootstrapCommitted, true);
  assert.equal(started.canonicalWritesDuringMigration, 0);
  assert.ok(started.storyId);
  assert.ok(started.branchId);
  assert.equal(h.session.arbiter.inspect().preview, null);
  assert.equal(h.api.enableCalls, 0);
  assert.equal(h.api.disableCalls, 0);
  await h.session.shutdown('phase24-fresh-user-test');
  assert.equal(await storedLease(h.registry), undefined);
});

test('Phase24 lease recovery waits behind a valid owner without stealing and resumes after early release', async () => {
  const registry = MemoryV3Database.createRegistry();
  const clock = mutableClock(10_000);
  const first = await phase24FreshHarness({ suffix: 'phase24-valid-owner', ownerId: 'phase24-owner-old', registry, clock });
  const firstStarted = await first.session.start({ exclusionProof, gateFReport });
  assert.equal(firstStarted.runtimeState, 'V3_AUTHORING');
  const firstLease = await storedLease(registry);
  assert.equal(firstLease.ownerId, 'phase24-owner-old');

  const waiter = controlledLeaseWait();
  const second = await phase24FreshHarness({
    suffix: 'phase24-valid-owner',
    ownerId: 'phase24-owner-new',
    registry,
    clock,
    leaseRecoveryWaitFn: waiter.waitFn,
  });
  const startPromise = second.session.start({ exclusionProof, gateFReport });
  const wait = await waiter.entered;
  assert.equal(wait.ms, 25);
  assert.equal(wait.conflict.reason, 'foreign-owner');
  assert.equal(second.session.status.runtimeState, 'V3_STARTING');
  assert.equal(second.session.status.role, 'standby');
  assert.equal(second.session.status.ownsLease, false);
  assert.equal(nodesById(second.body, V3_ROOT_ID).length, 0);
  assert.equal(nodesById(second.body, V3_LAUNCHER_ID).length, 0);
  assert.deepEqual(await storedLease(registry), firstLease);

  await first.session.shutdown('phase24-old-owner-released-early');
  assert.equal(await storedLease(registry), undefined);
  waiter.release();
  const recovered = await startPromise;
  assert.equal(recovered.runtimeState, 'V3_AUTHORING');
  assert.equal(recovered.authoringAuthority, true);
  assert.equal(recovered.ownsLease, true);
  assert.equal(recovered.databaseOpen, true);
  assert.equal(recovered.finalHealthReady, true);
  assert.equal(recovered.lastError, null);
  assert.equal((await storedLease(registry)).ownerId, 'phase24-owner-new');
  await second.session.shutdown('phase24-early-release-recovered');
});

test('Phase24 lease recovery remains bounded and never steals from a continuously valid owner', async () => {
  const registry = MemoryV3Database.createRegistry();
  const clock = mutableClock(15_000);
  await seedRuntimeLease(registry, { ownerId: 'phase24-renewing-old', leaseId: 'phase24-renewing-generation', acquiredAt: 15_000, expiresAt: 15_100 });
  const current = await phase24FreshHarness({
    suffix: 'phase24-renewing-owner',
    ownerId: 'phase24-renewing-new',
    registry,
    clock,
    leaseRecoveryWaitFn: async ms => {
      clock.advance(ms);
      await seedRuntimeLease(registry, {
        ownerId: 'phase24-renewing-old',
        leaseId: 'phase24-renewing-generation',
        acquiredAt: 15_000,
        expiresAt: clock.now() + 100,
      });
    },
  });
  await assert.rejects(() => current.session.start({ exclusionProof, gateFReport }), /lease recovery timed out while blocked by foreign-owner/);
  const lease = await storedLease(registry);
  assert.equal(lease.ownerId, 'phase24-renewing-old');
  assert.equal(lease.leaseId, 'phase24-renewing-generation');
  assert.equal(current.session.status.ownsLease, false);
  assert.equal(current.session.status.runtimeState, 'FAILED_SAFE');
  assert.equal(nodesById(current.body, V3_ROOT_ID).length, 0);
  assert.equal(nodesById(current.body, V3_LAUNCHER_ID).length, 0);
});

test('Phase24 lease recovery automatically reacquires when a blocking persisted lease expires', async () => {
  const registry = MemoryV3Database.createRegistry();
  const clock = mutableClock(20_000);
  await seedRuntimeLease(registry, { ownerId: 'phase24-expired-old', leaseId: 'phase24-expired-generation', acquiredAt: 20_000, expiresAt: 20_100 });
  const waits = [];
  const current = await phase24FreshHarness({
    suffix: 'phase24-expiry-recovery',
    ownerId: 'phase24-expiry-new',
    registry,
    clock,
    leaseRecoveryWaitFn: async (ms, conflict) => {
      waits.push({ ms, reason: conflict.reason, ownerId: conflict.ownerId, expiresAt: conflict.expiresAt });
      clock.advance(ms);
    },
  });
  const recovered = await current.session.start({ exclusionProof, gateFReport });
  assert.deepEqual(waits.map(row => row.ms), [25, 25, 25, 25]);
  assert.ok(waits.every(row => row.reason === 'foreign-owner' && row.ownerId === 'phase24-expired-old'));
  assert.equal(recovered.runtimeState, 'V3_AUTHORING');
  assert.equal(recovered.authoringAuthority, true);
  assert.equal(recovered.ownsLease, true);
  assert.equal(recovered.databaseOpen, true);
  assert.equal(recovered.finalHealthReady, true);
  assert.equal(recovered.lastError, null);
  const lease = await storedLease(registry);
  assert.equal(lease.ownerId, 'phase24-expiry-new');
  assert.notEqual(lease.leaseId, 'phase24-expired-generation');
  await current.session.shutdown('phase24-expiry-recovered');
});

test('Phase24 reload regression automatically recovers one new document after the prior document lease expires with no split brain', async () => {
  const registry = MemoryV3Database.createRegistry();
  const clock = mutableClock(30_000);
  const previous = await phase24FreshHarness({ suffix: 'phase24-reload-regression', ownerId: 'phase24-reload-old', registry, clock });
  const previousStarted = await previous.session.start({ exclusionProof, gateFReport });
  assert.equal(previousStarted.runtimeState, 'V3_AUTHORING');
  assert.equal(previousStarted.ownsLease, true);
  const previousLease = await storedLease(registry);

  const waits = [];
  const current = await phase24FreshHarness({
    suffix: 'phase24-reload-regression',
    ownerId: 'phase24-reload-new',
    registry,
    clock,
    leaseRecoveryWaitFn: async ms => { waits.push(ms); clock.advance(ms); },
  });
  const recovered = await current.session.start({ exclusionProof, gateFReport });
  assert.ok(waits.length > 0);
  assert.equal(recovered.runtimeState, 'V3_AUTHORING');
  assert.equal(recovered.authoringAuthority, true);
  assert.equal(recovered.role, 'owner');
  assert.equal(recovered.ownsLease, true);
  assert.equal(recovered.databaseOpen, true);
  assert.equal(recovered.finalHealthReady, true);
  assert.equal(recovered.lastError, null);
  assert.equal(nodesById(current.body, V3_ROOT_ID).length, 1);
  assert.equal(nodesById(current.body, V3_LAUNCHER_ID).length, 1);

  const currentLease = await storedLease(registry);
  assert.equal(currentLease.ownerId, 'phase24-reload-new');
  assert.notEqual(currentLease.leaseId, previousLease.leaseId);
  const previousValidation = await previous.session.runtime.composition.runtimeGuard.validateLease();
  assert.equal(previousValidation.valid, false);
  assert.equal(previous.session.runtime.composition.runtimeGuard.ownsLease, false);
  assert.equal(current.session.runtime.composition.runtimeGuard.ownsLease, true);
  assert.equal((await storedLease(registry)).ownerId, 'phase24-reload-new');

  await current.session.shutdown('phase24-reload-current-complete');
  await previous.session.shutdown('phase24-reload-old-cleanup');
});

test('S13 first active startup can resolve the migrated production scope from an empty V3 database', async () => {
  const h = await harness({ suffix: 'first-start', preseedProductionScope: false });
  const started = await h.session.start({ exclusionProof, gateFReport });
  assert.equal(started.runtimeState, 'V3_AUTHORING');
  assert.equal(started.authoringAuthority, true);
  assert.ok(started.storyId);
  assert.ok(started.branchId);
  await h.session.returnToPreview37();
});

test('S13 multi-card scope aliasing selects the exact current Preview identity instead of the first ready plan item', async () => {
  const registry = MemoryV3Database.createRegistry();
  const firstScope = previewScopeProject({ cardKey: 'character:first-card.png', storyKey: 'story:first-chat', branchKey: 'branch:main', suffix: 'multi-first' });
  const currentScope = previewScopeProject({ cardKey: 'character:current-card.png', storyKey: 'story:current-chat', branchKey: 'branch:main', suffix: 'multi-current' });
  const source = mergePreviewProjects(firstScope, currentScope);
  const sourceIdentity = Object.freeze({ characterCardSourceId: 'character:current-card.png', storySourceId: 'story:current-chat', routeSourceId: 'branch:main' });
  const h = await harness({ suffix: 'multi-card-exact', registry, previewSource: source, preseedProductionScope: false, sourceIdentityResolver: async () => sourceIdentity });
  const started = await h.session.start({ exclusionProof, gateFReport });
  assert.equal(started.runtimeState, 'V3_AUTHORING');

  const cards = await readStoreRows(registry, 'characterCards');
  const mappings = await readStoreRows(registry, 'identityMappings');
  const firstCard = cards.find(row => row.sourceAuthority === 'preview37' && row.sourceCardId === 'character:first-card.png');
  const currentCard = cards.find(row => row.sourceAuthority === 'preview37' && row.sourceCardId === sourceIdentity.characterCardSourceId);
  const alias = mappings.find(row => row.status === 'active' && row.sourceAuthority === 'sillytavern' && row.sourceType === 'character-card' && row.sourceId === sourceIdentity.characterCardSourceId);
  assert.ok(firstCard && currentCard && alias);
  assert.equal(alias.canonicalId, currentCard.id);
  assert.notEqual(alias.canonicalId, firstCard.id);
  await h.session.shutdown('multi-card-exact-complete');
});

test('S13 stale known s13 generic fallback alias chain is reconciled only to the exact current canonical scope', async () => {
  const registry = MemoryV3Database.createRegistry();
  const sourceIdentity = Object.freeze({ characterCardSourceId: 'character:Character card', storySourceId: 'story:current', routeSourceId: 'branch:main' });
  const source = previewScopeProject({ cardKey: sourceIdentity.characterCardSourceId, storyKey: sourceIdentity.storySourceId, branchKey: sourceIdentity.routeSourceId, suffix: 'stale-generic' });
  const wrong = await seedKnownStaleS13AliasChain(registry, sourceIdentity);
  const h = await harness({ suffix: 'stale-generic', registry, previewSource: source, preseedProductionScope: false, sourceIdentityResolver: async () => sourceIdentity });
  const started = await h.session.start({ exclusionProof, gateFReport });
  assert.equal(started.runtimeState, 'V3_AUTHORING');

  const cards = await readStoreRows(registry, 'characterCards');
  const mappings = await readStoreRows(registry, 'identityMappings');
  const currentCard = cards.find(row => row.sourceAuthority === 'preview37' && row.sourceCardId === sourceIdentity.characterCardSourceId);
  const cardAlias = mappings.find(row => row.status === 'active' && row.sourceAuthority === 'sillytavern' && row.sourceType === 'character-card' && row.sourceId === sourceIdentity.characterCardSourceId);
  const legacyStory = mappings.find(row => row.status === 'active' && row.sourceAuthority === 'sillytavern' && row.sourceType === 'story' && row.sourceId === sourceIdentity.storySourceId);
  const legacyBranch = mappings.find(row => row.status === 'active' && row.sourceAuthority === 'sillytavern' && row.sourceType === 'branch' && row.sourceId === sourceIdentity.routeSourceId && row.storyId === started.storyId);
  const scopedStoryId = `card-story:${JSON.stringify([sourceIdentity.characterCardSourceId, sourceIdentity.storySourceId])}`;
  const scopedBranchId = `card-story-branch:${JSON.stringify([sourceIdentity.characterCardSourceId, sourceIdentity.storySourceId, sourceIdentity.routeSourceId])}`;
  const scopedStory = mappings.find(row => row.status === 'active' && row.sourceAuthority === 'sillytavern' && row.sourceType === 'story' && row.sourceId === scopedStoryId);
  const scopedBranch = mappings.find(row => row.status === 'active' && row.sourceAuthority === 'sillytavern' && row.sourceType === 'branch' && row.sourceId === scopedBranchId);
  assert.ok(currentCard && cardAlias && legacyStory && legacyBranch && scopedStory && scopedBranch);
  assert.notEqual(cardAlias.canonicalId, wrong.cardId);
  assert.equal(cardAlias.canonicalId, currentCard.id);
  assert.equal(legacyStory.canonicalId, started.storyId);
  assert.equal(legacyBranch.canonicalId, started.branchId);
  assert.equal(scopedStory.canonicalId, started.storyId);
  assert.equal(scopedBranch.canonicalId, started.branchId);
  assert.equal(cardAlias.reason, 'reconciled-known-s13-first-item-alias');
  assert.equal(legacyStory.reason, 'reconciled-known-s13-first-item-alias');
  assert.equal(legacyBranch.reason, 'reconciled-known-s13-first-item-alias');
  assert.ok([cardAlias, legacyStory, legacyBranch].every(row => row.manifestIds.every(id => id.endsWith(':s13-sillytavern-scope-alias'))));
  await h.session.shutdown('stale-generic-complete');
});

test('S13 same raw SillyTavern Story/Branch source IDs remain card-scoped and isolated across Character Cards', async () => {
  const registry = MemoryV3Database.createRegistry();
  const sharedStorySourceId = 'story:shared-chat';
  const sharedRouteSourceId = 'branch:main';
  const source = mergePreviewProjects(
    previewScopeProject({ cardKey: 'character:card-a.png', storyKey: sharedStorySourceId, branchKey: sharedRouteSourceId, suffix: 'card-scope-a' }),
    previewScopeProject({ cardKey: 'character:card-b.png', storyKey: sharedStorySourceId, branchKey: sharedRouteSourceId, suffix: 'card-scope-b' }),
  );
  const first = await harness({
    suffix: 'card-scope-a', registry, previewSource: source, preseedProductionScope: false,
    sourceIdentityResolver: async () => ({ characterCardSourceId: 'character:card-a.png', storySourceId: sharedStorySourceId, routeSourceId: sharedRouteSourceId }),
  });
  const startedA = await first.session.start({ exclusionProof, gateFReport });
  assert.equal(startedA.runtimeState, 'V3_AUTHORING');
  await first.session.shutdown('card-scope-a-complete');

  const second = await harness({
    suffix: 'card-scope-b', registry, previewSource: source, preseedProductionScope: false,
    sourceIdentityResolver: async () => ({ characterCardSourceId: 'character:card-b.png', storySourceId: sharedStorySourceId, routeSourceId: sharedRouteSourceId }),
  });
  const startedB = await second.session.start({ exclusionProof, gateFReport });
  assert.equal(startedB.runtimeState, 'V3_AUTHORING');
  assert.notEqual(startedA.storyId, startedB.storyId);
  assert.notEqual(startedA.branchId, startedB.branchId);
  const mappings = await readStoreRows(registry, 'identityMappings');
  const scopedStories = mappings.filter(row => row.status === 'active' && row.sourceAuthority === 'sillytavern' && row.sourceType === 'story' && row.sourceId.startsWith('card-story:'));
  assert.ok(scopedStories.some(row => row.sourceId.includes('character:card-a.png') && row.canonicalId === startedA.storyId));
  assert.ok(scopedStories.some(row => row.sourceId.includes('character:card-b.png') && row.canonicalId === startedB.storyId));
  await second.session.shutdown('card-scope-b-complete');
});

test('S13 genuine non-s13 SillyTavern scope alias conflict still fails closed', async () => {
  const h = await harness({ suffix: 'alias-conflict', preseedProductionScope: true });
  const before = (await readStoreRows(h.registry, 'identityMappings')).filter(row => row.sourceAuthority === 'sillytavern' && row.sourceType === 'character-card' && row.sourceId === 'card-alias-conflict');
  assert.ok(before.length > 0);
  assert.ok(before.every(row => !(row.manifestIds || []).some(id => String(id).endsWith(':s13-sillytavern-scope-alias'))));
  await assert.rejects(() => h.session.start({ exclusionProof, gateFReport }), /Production scope alias conflict/);
  assert.equal(h.api.enableCalls, 0);
  await assertRecovered(h);
});

test('S15 scope transition aliases provision startup fallback to the exact real chat before remount and reopen authoring', async () => {
  const registry = MemoryV3Database.createRegistry();
  const fallback = Object.freeze({ characterCardSourceId: 'character:Character card', storySourceId: 'story:current', routeSourceId: 'branch:main' });
  const real = Object.freeze({ characterCardSourceId: 'character:Kaelan Vance Alt.png', storySourceId: 'story:current-chat', routeSourceId: 'branch:current' });
  const source = mergePreviewProjects(
    previewScopeProject({ cardKey: fallback.characterCardSourceId, storyKey: fallback.storySourceId, branchKey: fallback.routeSourceId, suffix: 'transition-fallback' }),
    previewScopeProject({ cardKey: real.characterCardSourceId, storyKey: real.storySourceId, branchKey: real.routeSourceId, suffix: 'transition-real' }),
  );
  let currentSource = fallback;
  const h = await harness({ suffix: 'transition-fallback-real', registry, previewSource: source, preseedProductionScope: false, sourceIdentityResolver: async () => currentSource });
  const started = await h.session.start({ exclusionProof, gateFReport });
  assert.equal(started.runtimeState, 'V3_AUTHORING');
  const initialStoryId = h.session.mountManager.status.storyId;
  const oldRoot = nodesById(h.body, V3_ROOT_ID)[0];

  currentSource = real;
  await h.eventSource.emit(EVENT_TYPES.CHAT_CHANGED, 'real-chat-loaded');

  const mappings = await readStoreRows(registry, 'identityMappings');
  const scopedStoryId = `card-story:${JSON.stringify([real.characterCardSourceId, real.storySourceId])}`;
  const scopedBranchId = `card-story-branch:${JSON.stringify([real.characterCardSourceId, real.storySourceId, real.routeSourceId])}`;
  assert.ok(mappings.some(row => row.status === 'active' && row.sourceAuthority === 'sillytavern' && row.sourceType === 'character-card' && row.sourceId === real.characterCardSourceId));
  assert.ok(mappings.some(row => row.status === 'active' && row.sourceAuthority === 'sillytavern' && row.sourceType === 'story' && row.sourceId === scopedStoryId));
  assert.ok(mappings.some(row => row.status === 'active' && row.sourceAuthority === 'sillytavern' && row.sourceType === 'branch' && row.sourceId === scopedBranchId));
  assert.notEqual(h.session.mountManager.status.storyId, initialStoryId);
  assert.equal(h.session.mountManager.status.transitionCount, 1);
  assert.equal(h.session.runtime.status.gateState, 'open');
  assert.equal(h.session.runtime.composition.listenerOwner.status.gateOpen, true);
  const nextRoot = nodesById(h.body, V3_ROOT_ID)[0];
  assert.ok(nextRoot && nextRoot !== oldRoot);
  assert.equal(oldRoot.parentNode, null);
  assert.equal(nodesById(h.body, V3_LAUNCHER_ID).length, 1);
  assert.equal(h.session.launcherOwner.open(), true);
  assert.equal(nextRoot.hidden, false);
  await h.session.shutdown('transition-fallback-real-complete');
});

test('S15 scope transition aliases keep two valid Character Cards isolated without first-plan-item leakage', async () => {
  const registry = MemoryV3Database.createRegistry();
  const first = Object.freeze({ characterCardSourceId: 'character:first-plan-card.png', storySourceId: 'story:first-plan', routeSourceId: 'branch:main' });
  const cardA = Object.freeze({ characterCardSourceId: 'character:scope-a.png', storySourceId: 'story:a', routeSourceId: 'branch:main' });
  const cardB = Object.freeze({ characterCardSourceId: 'character:scope-b.png', storySourceId: 'story:b', routeSourceId: 'branch:main' });
  const source = mergePreviewProjects(
    previewScopeProject({ cardKey: first.characterCardSourceId, storyKey: first.storySourceId, branchKey: first.routeSourceId, suffix: 'transition-first' }),
    previewScopeProject({ cardKey: cardA.characterCardSourceId, storyKey: cardA.storySourceId, branchKey: cardA.routeSourceId, suffix: 'transition-a' }),
    previewScopeProject({ cardKey: cardB.characterCardSourceId, storyKey: cardB.storySourceId, branchKey: cardB.routeSourceId, suffix: 'transition-b' }),
  );
  let currentSource = cardA;
  const h = await harness({ suffix: 'transition-two-cards', registry, previewSource: source, preseedProductionScope: false, sourceIdentityResolver: async () => currentSource });
  await h.session.start({ exclusionProof, gateFReport });
  const storyA = h.session.mountManager.status.storyId;

  currentSource = cardB;
  await h.eventSource.emit(EVENT_TYPES.CHAT_CHANGED, 'card-b');
  const storyB = h.session.mountManager.status.storyId;
  assert.notEqual(storyA, storyB);
  assert.equal(h.session.runtime.status.gateState, 'open');

  const cards = await readStoreRows(registry, 'characterCards');
  const mappings = await readStoreRows(registry, 'identityMappings');
  const canonicalA = cards.find(row => row.sourceAuthority === 'preview37' && row.sourceCardId === cardA.characterCardSourceId);
  const canonicalB = cards.find(row => row.sourceAuthority === 'preview37' && row.sourceCardId === cardB.characterCardSourceId);
  const firstCard = cards.find(row => row.sourceAuthority === 'preview37' && row.sourceCardId === first.characterCardSourceId);
  const aliasA = mappings.find(row => row.status === 'active' && row.sourceAuthority === 'sillytavern' && row.sourceType === 'character-card' && row.sourceId === cardA.characterCardSourceId);
  const aliasB = mappings.find(row => row.status === 'active' && row.sourceAuthority === 'sillytavern' && row.sourceType === 'character-card' && row.sourceId === cardB.characterCardSourceId);
  assert.ok(canonicalA && canonicalB && firstCard && aliasA && aliasB);
  assert.equal(aliasA.canonicalId, canonicalA.id);
  assert.equal(aliasB.canonicalId, canonicalB.id);
  assert.notEqual(aliasA.canonicalId, firstCard.id);
  assert.notEqual(aliasB.canonicalId, firstCard.id);
  await h.session.shutdown('transition-two-cards-complete');
});

test('S15 migrated runtime fresh-seeds a newly visited Character Card instead of retaining the previous card feed', async () => {
  const registry = MemoryV3Database.createRegistry();
  const cardA = Object.freeze({ characterCardSourceId: 'character:migrated-card.png', storySourceId: 'story:chat-migrated', routeSourceId: 'branch:main' });
  const cardB = Object.freeze({ characterCardSourceId: 'character:new-card.png', storySourceId: 'story:chat-new', routeSourceId: 'branch:main' });
  const source = previewScopeProject({ cardKey: cardA.characterCardSourceId, storyKey: cardA.storySourceId, branchKey: cardA.routeSourceId, suffix: 'migrated-to-fresh' });
  let currentSource = cardA;
  let currentContext = {
    name1: 'Player',
    chatId: 'chat-migrated',
    chat: [],
    characterId: 0,
    characters: [{ name: 'Migrated Card', avatar: 'migrated-card.png' }],
  };
  const h = await harness({
    suffix: 'migrated-to-fresh',
    registry,
    previewSource: source,
    preseedProductionScope: false,
    sourceIdentityResolver: async () => currentSource,
    getContext: () => currentContext,
  });
  await h.session.start({ exclusionProof, gateFReport });
  const migratedStoryId = h.session.mountManager.status.storyId;

  currentSource = cardB;
  currentContext = {
    name1: 'Player',
    chatId: 'chat-new',
    chat: [],
    characterId: 0,
    characters: [{ name: 'New Card', avatar: 'new-card.png' }],
  };
  await h.eventSource.emit(EVENT_TYPES.CHAT_CHANGED, 'chat-new');

  const freshStoryId = h.session.mountManager.status.storyId;
  const mappings = await readStoreRows(registry, 'identityMappings');
  const cards = await readStoreRows(registry, 'characterCards');
  const newCard = cards.find(row => row.sourceAuthority === 'sillytavern' && row.sourceCardId === cardB.characterCardSourceId);
  const newCardAlias = mappings.find(row => row.status === 'active'
    && row.sourceAuthority === 'sillytavern'
    && row.sourceType === 'character-card'
    && row.sourceId === cardB.characterCardSourceId);
  assert.notEqual(freshStoryId, migratedStoryId);
  assert.ok(newCard);
  assert.equal(newCardAlias?.canonicalId, newCard.id);
  assert.equal(h.session.mountManager.status.transitionCount, 1);
  assert.equal(h.session.runtime.status.gateState, 'open');
  assert.equal(h.session.runtime.composition.listenerOwner.status.lastError, null);
  await h.session.shutdown('migrated-to-fresh-complete');
});

test('S15 repeated CHAT_CHANGED to the same scope is idempotent and does not duplicate aliases', async () => {
  const registry = MemoryV3Database.createRegistry();
  const start = Object.freeze({ characterCardSourceId: 'character:repeat-start.png', storySourceId: 'story:start', routeSourceId: 'branch:main' });
  const target = Object.freeze({ characterCardSourceId: 'character:repeat-target.png', storySourceId: 'story:target', routeSourceId: 'branch:main' });
  const source = mergePreviewProjects(
    previewScopeProject({ cardKey: start.characterCardSourceId, storyKey: start.storySourceId, branchKey: start.routeSourceId, suffix: 'repeat-start' }),
    previewScopeProject({ cardKey: target.characterCardSourceId, storyKey: target.storySourceId, branchKey: target.routeSourceId, suffix: 'repeat-target' }),
  );
  let currentSource = start;
  const h = await harness({ suffix: 'transition-repeat', registry, previewSource: source, preseedProductionScope: false, sourceIdentityResolver: async () => currentSource });
  await h.session.start({ exclusionProof, gateFReport });
  currentSource = target;
  await h.eventSource.emit(EVENT_TYPES.CHAT_CHANGED, 'target-first');
  const firstMappings = (await readStoreRows(registry, 'identityMappings')).filter(row => row.sourceAuthority === 'sillytavern');
  const transitionCount = h.session.mountManager.status.transitionCount;
  await h.eventSource.emit(EVENT_TYPES.CHAT_CHANGED, 'target-repeat');
  const secondMappings = (await readStoreRows(registry, 'identityMappings')).filter(row => row.sourceAuthority === 'sillytavern');
  assert.equal(secondMappings.length, firstMappings.length);
  assert.equal(h.session.mountManager.status.transitionCount, transitionCount);
  assert.equal(h.session.runtime.status.gateState, 'open');
  assert.equal(h.session.runtime.composition.listenerOwner.status.lastError, null);
  await h.session.shutdown('transition-repeat-complete');
});

test('S15 known stale s13 alias encountered during CHAT_CHANGED reconciles only to exact current canonical scope', async () => {
  const registry = MemoryV3Database.createRegistry();
  const start = Object.freeze({ characterCardSourceId: 'character:stale-start.png', storySourceId: 'story:start', routeSourceId: 'branch:main' });
  const target = Object.freeze({ characterCardSourceId: 'character:stale-target.png', storySourceId: 'story:target', routeSourceId: 'branch:main' });
  const source = mergePreviewProjects(
    previewScopeProject({ cardKey: start.characterCardSourceId, storyKey: start.storySourceId, branchKey: start.routeSourceId, suffix: 'stale-transition-start' }),
    previewScopeProject({ cardKey: target.characterCardSourceId, storyKey: target.storySourceId, branchKey: target.routeSourceId, suffix: 'stale-transition-target' }),
  );
  const wrong = await seedKnownStaleS13AliasChain(registry, target, 'transition-stale');
  let currentSource = start;
  const h = await harness({ suffix: 'transition-stale', registry, previewSource: source, preseedProductionScope: false, sourceIdentityResolver: async () => currentSource });
  await h.session.start({ exclusionProof, gateFReport });
  currentSource = target;
  await h.eventSource.emit(EVENT_TYPES.CHAT_CHANGED, 'stale-target');

  const cards = await readStoreRows(registry, 'characterCards');
  const mappings = await readStoreRows(registry, 'identityMappings');
  const canonicalTarget = cards.find(row => row.sourceAuthority === 'preview37' && row.sourceCardId === target.characterCardSourceId);
  const cardAlias = mappings.find(row => row.status === 'active' && row.sourceAuthority === 'sillytavern' && row.sourceType === 'character-card' && row.sourceId === target.characterCardSourceId);
  const legacyStory = mappings.find(row => row.status === 'active' && row.sourceAuthority === 'sillytavern' && row.sourceType === 'story' && row.sourceId === target.storySourceId);
  assert.ok(canonicalTarget && cardAlias && legacyStory);
  assert.notEqual(cardAlias.canonicalId, wrong.cardId);
  assert.equal(cardAlias.canonicalId, canonicalTarget.id);
  assert.equal(cardAlias.reason, 'reconciled-known-s13-first-item-alias');
  assert.equal(legacyStory.reason, 'reconciled-known-s13-first-item-alias');
  assert.ok(cardAlias.manifestIds.every(id => id.endsWith(':s13-sillytavern-scope-alias')));
  assert.equal(h.session.runtime.status.gateState, 'open');
  await h.session.shutdown('transition-stale-complete');
});

test('S15 same raw Story and Branch IDs under different Character Cards remain isolated across CHAT_CHANGED', async () => {
  const registry = MemoryV3Database.createRegistry();
  const sharedStory = 'story:shared-chat';
  const sharedBranch = 'branch:main';
  const cardA = Object.freeze({ characterCardSourceId: 'character:shared-a.png', storySourceId: sharedStory, routeSourceId: sharedBranch });
  const cardB = Object.freeze({ characterCardSourceId: 'character:shared-b.png', storySourceId: sharedStory, routeSourceId: sharedBranch });
  const source = mergePreviewProjects(
    previewScopeProject({ cardKey: cardA.characterCardSourceId, storyKey: sharedStory, branchKey: sharedBranch, suffix: 'shared-transition-a' }),
    previewScopeProject({ cardKey: cardB.characterCardSourceId, storyKey: sharedStory, branchKey: sharedBranch, suffix: 'shared-transition-b' }),
  );
  let currentSource = cardA;
  const h = await harness({ suffix: 'transition-shared-raw', registry, previewSource: source, preseedProductionScope: false, sourceIdentityResolver: async () => currentSource });
  await h.session.start({ exclusionProof, gateFReport });
  const storyA = h.session.mountManager.status.storyId;
  currentSource = cardB;
  await h.eventSource.emit(EVENT_TYPES.CHAT_CHANGED, 'shared-b');
  const storyB = h.session.mountManager.status.storyId;
  assert.notEqual(storyA, storyB);

  const mappings = await readStoreRows(registry, 'identityMappings');
  const scopedA = `card-story:${JSON.stringify([cardA.characterCardSourceId, sharedStory])}`;
  const scopedB = `card-story:${JSON.stringify([cardB.characterCardSourceId, sharedStory])}`;
  const aliasA = mappings.find(row => row.status === 'active' && row.sourceAuthority === 'sillytavern' && row.sourceType === 'story' && row.sourceId === scopedA);
  const aliasB = mappings.find(row => row.status === 'active' && row.sourceAuthority === 'sillytavern' && row.sourceType === 'story' && row.sourceId === scopedB);
  assert.ok(aliasA && aliasB);
  assert.notEqual(aliasA.canonicalId, aliasB.canonicalId);
  assert.equal(h.session.runtime.status.gateState, 'open');
  await h.session.shutdown('transition-shared-raw-complete');
});

test('S15 genuine non-s13 alias conflict during CHAT_CHANGED still fails closed without remounting the wrong scope', async () => {
  const registry = MemoryV3Database.createRegistry();
  const start = Object.freeze({ characterCardSourceId: 'character:conflict-start.png', storySourceId: 'story:start', routeSourceId: 'branch:main' });
  const targetSuffix = 'transition-conflict-target';
  const target = Object.freeze({ characterCardSourceId: `card-${targetSuffix}`, storySourceId: `story-${targetSuffix}`, routeSourceId: `branch-${targetSuffix}` });
  const source = mergePreviewProjects(
    previewScopeProject({ cardKey: start.characterCardSourceId, storyKey: start.storySourceId, branchKey: start.routeSourceId, suffix: 'conflict-transition-start' }),
    previewScopeProject({ cardKey: target.characterCardSourceId, storyKey: target.storySourceId, branchKey: target.routeSourceId, suffix: 'conflict-transition-target' }),
  );
  await seedProductionScope(registry, targetSuffix, 1);
  let currentSource = start;
  const h = await harness({ suffix: 'transition-genuine-conflict', registry, previewSource: source, preseedProductionScope: false, sourceIdentityResolver: async () => currentSource });
  await h.session.start({ exclusionProof, gateFReport });
  const initialStoryId = h.session.mountManager.status.storyId;
  const before = (await readStoreRows(registry, 'identityMappings')).filter(row => row.sourceAuthority === 'sillytavern' && row.sourceType === 'character-card' && row.sourceId === target.characterCardSourceId);
  assert.ok(before.length > 0);
  assert.ok(before.every(row => !(row.manifestIds || []).some(id => String(id).endsWith(':s13-sillytavern-scope-alias'))));

  currentSource = target;
  await h.eventSource.emit(EVENT_TYPES.CHAT_CHANGED, 'conflict-target');
  assert.match(h.session.runtime.composition.listenerOwner.status.lastError || '', /Production scope alias conflict/);
  assert.equal(h.session.runtime.status.gateState, 'closed');
  assert.equal(h.session.mountManager.status.storyId, initialStoryId);
  assert.equal(h.session.mountManager.status.transitionCount, 0);
  await h.session.shutdown('transition-genuine-conflict-complete');
});
