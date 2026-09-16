import test from 'node:test';
import assert from 'node:assert/strict';

import { createTmrwV3ProductionRuntime } from '../../production/composition-root.mjs';
import { V3_GENERATION_INTERCEPTOR_KEY, V3_PRODUCTION_RUNTIME_ID } from '../../production/constants.mjs';
import { ProductionSillyTavernContextAdapter } from '../../production/context-source-adapter.mjs';
import { ProductionIdentityBindingResolver } from '../../production/identity-binding-resolver.mjs';
import { MemoryV3Database } from '../../storage/memory-v3-database.mjs';
import { V3RuntimeGuard } from '../../beta/runtime-guard.mjs';
import { V3_RUNTIME_LEASE_KEY } from '../../storage/schema.mjs';

const PASSIVE_SHIM_MARKER = Symbol.for('tmrw.v3.production.passive-generation-interceptor');

class FakeEventSource {
  listeners = new Map();
  on(type, handler) { const rows = this.listeners.get(type) || []; rows.push(handler); this.listeners.set(type, rows); }
  removeListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(row => row !== handler)); }
  count(type) { return (this.listeners.get(type) || []).length; }
  async emit(type, ...args) { for (const handler of [...(this.listeners.get(type) || [])]) await handler(...args); }
}

const EVENT_TYPES = Object.freeze({
  CHAT_CHANGED: 'chat-changed',
  MESSAGE_SENT: 'sent',
  MESSAGE_RECEIVED: 'received',
  MESSAGE_SWIPED: 'swiped',
  MESSAGE_EDITED: 'edited',
  MESSAGE_DELETED: 'deleted',
  IMPERSONATE_READY: 'impersonate',
});

function passiveGlobal() {
  const globalObject = { document: { visibilityState: 'visible' } };
  const shim = async () => {};
  Object.defineProperty(shim, PASSIVE_SHIM_MARKER, { value: V3_PRODUCTION_RUNTIME_ID });
  globalObject[V3_GENERATION_INTERCEPTOR_KEY] = shim;
  return globalObject;
}

function previewControl() {
  return {
    findPreview37: () => ({ name: 'third-party/TMRW-Phone-Preview', enabled: false }),
    isPreview37Disabled: () => true,
    verifyPreview37Excluded: proof => Object.freeze({ excluded: proof?.previewExcluded !== false }),
  };
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

function baseOptions({ registry = MemoryV3Database.createRegistry(), runtimeScope = {}, stageObserver = null } = {}) {
  const rawDatabases = [];
  const eventSource = new FakeEventSource();
  const globalObject = passiveGlobal();
  const timers = fakeTimers();
  const context = { chatId: 's08-chat', chat: [] };
  return {
    options: {
      ownerId: 's08-owner',
      runtimeScope,
      databaseFactory: () => { const db = new MemoryV3Database({ registry }); rawDatabases.push(db); return db; },
      previewControl: previewControl(),
      startupEvidence: { requested: true, cleanReloadProven: true, exclusionProof: { previewExcluded: true }, gateFReport: { status: 'pass' } },
      getContext: () => context,
      Generate: async () => {},
      eventSource,
      sillyTavernEventTypes: EVENT_TYPES,
      sourceIdentityResolver: async () => ({ characterCardSourceId: 'card', storySourceId: 'story', routeSourceId: 'branch' }),
      messageIdentityResolver: async () => null,
      globalObject,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      heartbeatIntervalMs: 5_000,
      stageObserver,
    },
    registry,
    rawDatabases,
    eventSource,
    globalObject,
    timers,
  };
}

async function leaseRecord(registry) {
  const probe = new MemoryV3Database({ registry });
  await probe.open();
  const value = await probe.transaction(['metadata'], 'readonly', tx => tx.store('metadata').get(V3_RUNTIME_LEASE_KEY));
  probe.close();
  return value;
}

const REQUIRED_ORDER = [
  'production-runtime-owner',
  'raw-database',
  'schema-ready',
  'production-health',
  'lease-acquired',
  'authoring-gate-closed',
  'heartbeat-started',
  'normal-fenced-database',
  'identity-kernel',
  'context-adapter',
  'mapped-scope-resolver',
  'identity-binding-resolver',
  'canonical-event-engine',
  'knowledge-audience-services',
  'phone-state-services',
  'contacts-service',
  'messages-service',
  'calls-service',
  'social-insungram-services',
  'live-service',
  'notification-service',
  'phone-world-utility-service',
  'calendar-app-service',
  'commerce-app-service',
  'beta-settings',
  'smart-contact-discovery',
  'call-coordinator',
  'handoff-coordinator',
  'phone-context-injector',
  'call-continuation-driver',
  'call-story-integration',
  'voice-profile-service',
  'voice-audio-history-service',
  'voice-runtime-configured',
  'voice-puzzle-adapter',
  'voice-presenter',
  'call-bot-reply',
  'runtime-integration',
  'playable-bootstrap',
  'listener-owner',
  'generation-interceptor-owner',
  'phone-shell-view-models',
  'phone-controller',
  's08-ready-without-mount',
];

test('S08 constructs one exact fenced production graph in blueprint order and stops before mount/launcher', async () => {
  const h = baseOptions();
  const root = await createTmrwV3ProductionRuntime(h.options);
  assert.equal(root.role, 'owner');
  assert.deepEqual(root.status.constructionOrder, REQUIRED_ORDER);
  assert.equal(root.status.gateState, 'closed');
  assert.equal(root.authoringAvailable, false);
  assert.equal(root.phoneMountAvailable, false);
  assert.equal(root.launcherAvailable, false);
  assert.equal(root.status.phoneMounted, false);
  assert.equal(root.status.launcherMounted, false);
  assert.equal(root.voiceCapability.runtimeAvailable, false);
  assert.equal(root.imageCapability.providerId, 'pixabay');
  assert.equal(root.imageCapability.configured, false);
  assert.equal(root.imageCapability.available, false);
  assert.equal(root.services.socialAi.enabled, false);
  assert.equal(root.services.liveAi.enabled, false);
  assert.ok(root.composition.contextAdapter instanceof ProductionSillyTavernContextAdapter);
  assert.ok(root.composition.identityResolver instanceof ProductionIdentityBindingResolver);
  assert.equal(h.eventSource.count(EVENT_TYPES.MESSAGE_SENT), 1);
  assert.equal(h.eventSource.count(EVENT_TYPES.CHAT_CHANGED), 1);
  assert.equal(root.composition.generationOwner.status.delegateActive, true);
  assert.equal(root.composition.listenerOwner.status.registered, true);
  assert.equal(root.finalHealth.ready, false);
  assert.ok(root.finalHealth.blockers.includes('shellMountHealthy'));
  await root.dispose();
});

test('raw DB stays private and every normal canonical consumer shares the one normal fenced boundary', async () => {
  const h = baseOptions();
  const root = await createTmrwV3ProductionRuntime(h.options);
  const raw = h.rawDatabases[0];
  assert.notEqual(root.composition.normalDatabase, raw);
  assert.equal('rawDatabase' in root, false);
  assert.equal('rawDatabase' in root.composition, false);
  assert.equal(root.composition.normalDatabase.capability, 'normal');
  await assert.rejects(
    () => root.composition.normalDatabase.transaction(['metadata'], 'readwrite', tx => tx.store('metadata').put({ key: 'forbidden-normal-write' })),
    /Authoring capability normal is not permitted/,
  );
  assert.equal(root.status.gateState, 'closed');
  await root.dispose();
});

test('duplicate activation on the same runtime scope returns the same singleton graph', async () => {
  const runtimeScope = {};
  const h = baseOptions({ runtimeScope });
  let factoryCalls = 0;
  const factory = h.options.databaseFactory;
  h.options.databaseFactory = () => { factoryCalls += 1; return factory(); };
  const [first, second] = await Promise.all([
    createTmrwV3ProductionRuntime(h.options),
    createTmrwV3ProductionRuntime(h.options),
  ]);
  assert.equal(first, second);
  assert.equal(factoryCalls, 1);
  assert.equal(first.services.calls, second.services.calls);
  assert.equal(first.composition.eventEngine, second.composition.eventEngine);
  await first.dispose();
});

test('standby/non-owner never constructs the authoring service graph and never disturbs the foreign lease', async () => {
  const registry = MemoryV3Database.createRegistry();
  const foreignDb = new MemoryV3Database({ registry }); await foreignDb.open();
  const foreign = new V3RuntimeGuard({ database: foreignDb, ownerId: 'foreign-owner', leaseIdFactory: () => 'foreign-lease' });
  assert.equal((await foreign.acquire()).acquired, true);

  const h = baseOptions({ registry });
  h.options.ownerId = 'standby-owner';
  const standby = await createTmrwV3ProductionRuntime(h.options);
  assert.equal(standby.role, 'standby');
  assert.equal(standby.authoringAvailable, false);
  assert.equal('services' in standby, false);
  assert.equal(h.eventSource.count(EVENT_TYPES.MESSAGE_SENT), 0);
  assert.equal(h.timers.timers.size, 0);
  await standby.dispose();
  const record = await foreignDb.transaction(['metadata'], 'readonly', tx => tx.store('metadata').get(V3_RUNTIME_LEASE_KEY));
  assert.equal(record.ownerId, 'foreign-owner');
  assert.equal(record.leaseId, 'foreign-lease');
  await foreign.release(); foreignDb.close();
});

test('failure injected at lease-acquired releases that exact generation before closing the DB', async () => {
  const h = baseOptions({ stageObserver: stage => { if (stage === 'lease-acquired') throw new Error('inject-lease-stage'); } });
  let failure;
  try { await createTmrwV3ProductionRuntime(h.options); } catch (error) { failure = error; }
  assert.ok(failure);
  assert.match(failure.message, /inject-lease-stage/);
  assert.deepEqual(failure.productionActivationStatus.disposalOrder, ['lease-release', 'raw-database']);
  assert.equal(h.rawDatabases[0].isOpen, false);
  assert.equal(await leaseRecord(h.registry), undefined);
});

test('representative late construction failure unwinds hooks, heartbeat, lease and DB in strict reverse order', async () => {
  const h = baseOptions({ stageObserver: stage => { if (stage === 'generation-interceptor-owner') throw new Error('inject-generation-stage'); } });
  let failure;
  try { await createTmrwV3ProductionRuntime(h.options); } catch (error) { failure = error; }
  assert.ok(failure);
  assert.match(failure.message, /inject-generation-stage/);
  assert.deepEqual(failure.productionActivationStatus.disposalOrder, [
    'generation-interceptor-owner',
    'listener-owner',
    'voice-presenter',
    'heartbeat-stop',
    'lease-release',
    'raw-database',
  ]);
  assert.equal(h.rawDatabases[0].isOpen, false);
  assert.equal(h.timers.timers.size, 0);
  assert.equal(h.eventSource.count(EVENT_TYPES.MESSAGE_SENT), 0);
  assert.equal(h.eventSource.count(EVENT_TYPES.CHAT_CHANGED), 0);
  assert.equal(h.globalObject[V3_GENERATION_INTERCEPTOR_KEY][PASSIVE_SHIM_MARKER], V3_PRODUCTION_RUNTIME_ID);
  assert.equal(await leaseRecord(h.registry), undefined);
});

test('successful S08 disposal is idempotent and preserves gate-close before reverse resource teardown', async () => {
  const h = baseOptions();
  const root = await createTmrwV3ProductionRuntime(h.options);
  const first = await root.dispose('test-dispose');
  const second = await root.dispose('test-dispose-again');
  assert.equal(first.disposed, true);
  assert.equal(second.disposed, true);
  assert.deepEqual(first.disposalOrder, [
    'phone-controller',
    'generation-interceptor-owner',
    'listener-owner',
    'voice-presenter',
    'heartbeat-stop',
    'lease-release',
    'raw-database',
  ]);
  assert.deepEqual(second.disposalOrder, first.disposalOrder);
  assert.equal(root.status.gateState, 'closed');
  assert.equal(root.status.databaseOpen, false);
  assert.equal(root.status.ownsLease, false);
  assert.equal(root.status.heartbeatRunning, false);
  assert.equal(root.status.listenerRegistered, false);
  assert.equal(root.status.interceptorDelegateActive, false);
  assert.equal(h.eventSource.count(EVENT_TYPES.MESSAGE_SENT), 0);
  assert.equal(h.eventSource.count(EVENT_TYPES.CHAT_CHANGED), 0);
  assert.equal(h.timers.timers.size, 0);
  assert.equal(await leaseRecord(h.registry), undefined);
});

test('S08 production root contains no mount/launcher/installed-deployment or Voice provider runtime path', async () => {
  const h = baseOptions();
  const root = await createTmrwV3ProductionRuntime(h.options);
  assert.equal(root.phoneMountAvailable, false);
  assert.equal(root.launcherAvailable, false);
  assert.equal(root.voiceCapability.runtimeAvailable, false);
  assert.equal(root.voiceCapability.textCallsReady, true);
  assert.equal('mountManager' in root.composition, false);
  assert.equal('launcherOwner' in root.composition, false);
  assert.equal('voiceRuntime' in root.composition, false);
  assert.equal('voiceProvider' in root.composition, false);
  await root.dispose();
});
