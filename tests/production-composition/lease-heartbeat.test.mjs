import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryKeyValueStorage, V3BetaFeatureFlag } from '../../beta/feature-flag.mjs';
import { V3RuntimeGuard } from '../../beta/runtime-guard.mjs';
import { V3BetaLifecycle } from '../../platform/sillytavern/lifecycle.mjs';
import { LeaseHeartbeat } from '../../production/lease-heartbeat.mjs';
import { ProductionAuthoringGate } from '../../production/authoring-gate.mjs';
import { MemoryV3Database } from '../../storage/memory-v3-database.mjs';
import { V3_RUNTIME_LEASE_KEY } from '../../storage/schema.mjs';
import { FakeEventTarget } from '../phase1/test-helpers.mjs';

function mutableClock(start = 1_000) {
  let value = start;
  return {
    now: () => value,
    advance(delta) { value += delta; },
  };
}

function idFactory(...ids) {
  let index = 0;
  return () => ids[index++] ?? `lease-generated-${index}`;
}

function normalPrerequisites() {
  return {
    productionHealthValid: true,
    previewExcluded: true,
    identityResolved: true,
    compositionServicesReady: true,
    uniqueListenersReady: true,
    uniqueGenerationInterceptorReady: true,
    callIntegrationReady: true,
    shellMountHealthy: true,
    heartbeatQualified: true,
  };
}

async function openMemory(registry = MemoryV3Database.createRegistry()) {
  const database = new MemoryV3Database({ registry });
  await database.open();
  return database;
}

async function readLease(database) {
  return database.transaction(['metadata'], 'readonly', tx => tx.store('metadata').get(V3_RUNTIME_LEASE_KEY));
}

class FakeScheduler {
  #nextId = 1;
  #callbacks = new Map();
  created = 0;
  cleared = 0;

  setInterval = callback => {
    const id = this.#nextId++;
    this.#callbacks.set(id, callback);
    this.created += 1;
    return id;
  };

  clearInterval = id => {
    if (this.#callbacks.delete(id)) this.cleared += 1;
  };

  async fire() {
    const callback = [...this.#callbacks.values()][0];
    if (!callback) return undefined;
    return callback();
  }

  get activeCount() {
    return this.#callbacks.size;
  }
}

async function flushAsync() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function ownerHeartbeat({ registry = MemoryV3Database.createRegistry(), ownerId = 'owner-a', clock = mutableClock(), leaseIds = ['lease-a'], eventTarget = null, visibilityState = () => 'visible' } = {}) {
  const database = await openMemory(registry);
  const guard = new V3RuntimeGuard({ database, ownerId, clock: clock.now, leaseDurationMs: 100, leaseIdFactory: idFactory(...leaseIds) });
  const acquired = await guard.acquire();
  assert.equal(acquired.acquired, true);
  const gate = new ProductionAuthoringGate({ runtimeGuard: guard });
  const scheduler = new FakeScheduler();
  const heartbeat = new LeaseHeartbeat({
    runtimeGuard: guard,
    authoringGate: gate,
    intervalMs: 10,
    setIntervalFn: scheduler.setInterval,
    clearIntervalFn: scheduler.clearInterval,
    eventTarget,
    visibilityState,
  });
  return { registry, database, guard, gate, scheduler, heartbeat, clock };
}

test('lifecycle exposes the acquired runtime guard only to the owner while preserving standby semantics', async () => {
  const registry = MemoryV3Database.createRegistry();
  const values = new Map();
  const seen = [];
  const create = (ownerId, label) => new V3BetaLifecycle({
    featureFlag: new V3BetaFeatureFlag({ storage: new MemoryKeyValueStorage(values) }),
    databaseFactory: () => new MemoryV3Database({ registry }),
    ownerId,
    activation: ({ role, runtimeGuard }) => {
      seen.push({ label, role, runtimeGuard });
      return { authoringEnabled: false };
    },
  });

  const owner = create('owner-window', 'owner');
  const standby = create('standby-window', 'standby');
  assert.equal((await owner.enable()).state, 'enabled-owner');
  assert.equal((await standby.enable()).state, 'enabled-standby');
  assert.equal(seen[0].role, 'enabled-owner');
  assert.ok(seen[0].runtimeGuard instanceof V3RuntimeGuard);
  assert.equal(owner.status.runtimeLeaseId, seen[0].runtimeGuard.leaseId);
  assert.equal(seen[1].role, 'enabled-standby');
  assert.equal(seen[1].runtimeGuard, null);
  assert.equal(standby.status.runtimeLeaseId, null);
  await standby.disable();
  await owner.disable();
});

test('heartbeat start is idempotent, validates before scheduling, and renews the same lease generation', async () => {
  const context = await ownerHeartbeat();
  const initialLease = await readLease(context.database);
  const first = await context.heartbeat.start();
  const second = await context.heartbeat.start();
  assert.equal(first.running, true);
  assert.equal(second.running, true);
  assert.equal(context.scheduler.created, 1);
  assert.equal(context.heartbeat.status.validationCount, 1);

  const opened = await context.gate.open(normalPrerequisites());
  assert.equal(opened.opened, true);
  const leaseId = context.guard.leaseId;
  context.clock.advance(20);
  const tick = await context.scheduler.fire();
  assert.equal(tick.renewed, true);
  assert.equal(context.guard.leaseId, leaseId);
  assert.equal(context.heartbeat.status.renewalCount, 1);
  assert.equal(context.gate.state, 'open');
  const renewed = await readLease(context.database);
  assert.equal(renewed.leaseId, initialLease.leaseId);
  assert.equal(renewed.acquiredAt, initialLease.acquiredAt);
  assert.ok(renewed.renewedAt > initialLease.renewedAt);
  assert.ok(renewed.expiresAt > initialLease.expiresAt);
  await context.heartbeat.stop();
  context.database.close();
});

test('visible/focus/pageshow resume signals validate immediately while hidden visibility does not', async () => {
  const events = new FakeEventTarget();
  let visibility = 'hidden';
  const context = await ownerHeartbeat({ eventTarget: events, visibilityState: () => visibility });
  await context.heartbeat.start();
  await context.gate.open(normalPrerequisites());
  const baseline = context.heartbeat.status.validationCount;
  assert.equal(events.count('visibilitychange'), 1);
  assert.equal(events.count('focus'), 1);
  assert.equal(events.count('pageshow'), 1);

  events.dispatch('visibilitychange', {});
  await flushAsync();
  assert.equal(context.heartbeat.status.validationCount, baseline);

  visibility = 'visible';
  events.dispatch('visibilitychange', {});
  await flushAsync();
  assert.equal(context.heartbeat.status.validationCount, baseline + 1);
  events.dispatch('focus', {});
  await flushAsync();
  events.dispatch('pageshow', {});
  await flushAsync();
  assert.equal(context.heartbeat.status.validationCount, baseline + 3);
  assert.equal(context.gate.state, 'open');
  await context.heartbeat.stop();
  context.database.close();
});

test('suspended stale owner fails resume validation after takeover and cannot regain or release the newer generation', async () => {
  const registry = MemoryV3Database.createRegistry();
  const clock = mutableClock(5_000);
  const context = await ownerHeartbeat({ registry, ownerId: 'owner-a', clock, leaseIds: ['lease-a', 'lease-a2'] });
  await context.heartbeat.start();
  await context.gate.open(normalPrerequisites());
  const oldLeaseId = context.guard.leaseId;

  clock.advance(101);
  const databaseB = await openMemory(registry);
  const guardB = new V3RuntimeGuard({ database: databaseB, ownerId: 'owner-b', clock: clock.now, leaseDurationMs: 100, leaseIdFactory: idFactory('lease-b') });
  assert.equal((await guardB.acquire()).acquired, true);
  assert.notEqual(guardB.leaseId, oldLeaseId);

  const resumed = await context.heartbeat.validateOnResume('pageshow');
  assert.equal(resumed.valid, false);
  assert.equal(context.gate.state, 'closed');
  assert.equal(context.heartbeat.status.running, false);
  assert.equal(context.guard.ownsLease, false);
  const beforeRelease = await readLease(databaseB);
  assert.equal(await context.guard.release(), false);
  const afterRelease = await readLease(databaseB);
  assert.deepEqual(afterRelease, beforeRelease);
  databaseB.close();
  context.database.close();
});

test('renewal/database failure closes an already-open authoring gate before any retry path', async () => {
  const context = await ownerHeartbeat();
  await context.heartbeat.start();
  await context.gate.open(normalPrerequisites());
  assert.equal(context.gate.state, 'open');
  context.database.close();
  const result = await context.scheduler.fire();
  assert.equal(result.renewed, false);
  assert.equal(context.gate.state, 'closed');
  assert.equal(context.heartbeat.status.running, false);
  assert.match(context.heartbeat.status.lastFailure, /renew-unavailable/);
  assert.throws(() => context.gate.createFence().assertCapability('normal'), /not permitted/i);
});

test('expired lease is never renewed; explicit reacquisition rotates leaseId and does not reopen authoring automatically', async () => {
  const context = await ownerHeartbeat({ leaseIds: ['lease-a', 'lease-a2'] });
  await context.heartbeat.start();
  await context.gate.open(normalPrerequisites());
  const firstLeaseId = context.guard.leaseId;
  context.clock.advance(101);
  const tick = await context.scheduler.fire();
  assert.equal(tick.renewed, false);
  assert.equal(context.gate.state, 'closed');
  assert.equal(context.heartbeat.status.running, false);
  const reacquired = await context.guard.acquire();
  assert.equal(reacquired.acquired, true);
  assert.notEqual(context.guard.leaseId, firstLeaseId);
  assert.equal(context.gate.state, 'closed');
  const restarted = await context.heartbeat.start();
  assert.equal(restarted.running, true);
  assert.equal(context.gate.state, 'closed');
  await context.heartbeat.stop();
  context.database.close();
});

test('slow renewal is serialized so background-throttled duplicate ticks cannot overlap', async () => {
  let resolveRenew;
  let renewCalls = 0;
  const guard = {
    ownerId: 'slow-owner',
    leaseId: 'slow-lease',
    async validateLease() { return { valid: true, reason: 'valid' }; },
    renew() {
      renewCalls += 1;
      return new Promise(resolve => { resolveRenew = resolve; });
    },
  };
  const gate = new ProductionAuthoringGate({ runtimeGuard: guard });
  const scheduler = new FakeScheduler();
  const heartbeat = new LeaseHeartbeat({ runtimeGuard: guard, authoringGate: gate, intervalMs: 10, setIntervalFn: scheduler.setInterval, clearIntervalFn: scheduler.clearInterval });
  await heartbeat.start();
  await gate.open(normalPrerequisites());
  const first = scheduler.fire();
  const second = scheduler.fire();
  await flushAsync();
  assert.equal(renewCalls, 1);
  resolveRenew({ renewed: true, reason: 'renewed' });
  await Promise.all([first, second]);
  assert.equal(heartbeat.status.renewalCount, 1);
  assert.equal(gate.state, 'open');
  await heartbeat.stop();
});

test('heartbeat cleanup is idempotent and removes its timer and resume listeners exactly once', async () => {
  const events = new FakeEventTarget();
  const context = await ownerHeartbeat({ eventTarget: events });
  await context.heartbeat.start();
  assert.equal(context.scheduler.activeCount, 1);
  await context.heartbeat.stop();
  await context.heartbeat.stop();
  assert.equal(context.scheduler.activeCount, 0);
  assert.equal(context.scheduler.cleared, 1);
  assert.equal(events.count('visibilitychange'), 0);
  assert.equal(events.count('focus'), 0);
  assert.equal(events.count('pageshow'), 0);
  assert.equal(context.heartbeat.status.running, false);
  context.database.close();
});

test('lifecycle disposes the registered heartbeat resource before matching lease release and DB close', async () => {
  const registry = MemoryV3Database.createRegistry();
  const values = new Map();
  const scheduler = new FakeScheduler();
  const order = [];
  let heartbeat;
  const lifecycle = new V3BetaLifecycle({
    featureFlag: new V3BetaFeatureFlag({ storage: new MemoryKeyValueStorage(values) }),
    databaseFactory: () => new MemoryV3Database({ registry }),
    ownerId: 'lifecycle-owner',
    activation: async ({ runtimeGuard, resources }) => {
      assert.ok(runtimeGuard);
      const gate = new ProductionAuthoringGate({ runtimeGuard });
      heartbeat = new LeaseHeartbeat({ runtimeGuard, authoringGate: gate, intervalMs: 10, setIntervalFn: scheduler.setInterval, clearIntervalFn: scheduler.clearInterval });
      await heartbeat.start();
      resources.add('timers', 'lease-heartbeat', async () => {
        order.push('heartbeat-stop');
        await heartbeat.stop();
      });
      const originalRelease = runtimeGuard.release.bind(runtimeGuard);
      runtimeGuard.release = async () => {
        order.push('lease-release');
        return originalRelease();
      };
      return { authoringEnabled: false };
    },
  });

  assert.equal((await lifecycle.enable()).state, 'enabled-owner');
  assert.equal(heartbeat.status.running, true);
  const disabled = await lifecycle.disable();
  assert.equal(disabled.state, 'disabled');
  assert.ok(order.indexOf('heartbeat-stop') >= 0);
  assert.ok(order.indexOf('lease-release') > order.indexOf('heartbeat-stop'));
  assert.equal(disabled.databaseOpen, false);
  assert.deepEqual(disabled.resources, { listeners: 0, timers: 0, jobs: 0, adapters: 0, other: 0 });
});

test('partial activation unwind disposes resources before release and leaves lifecycle failed/closed', async () => {
  const registry = MemoryV3Database.createRegistry();
  const values = new Map();
  const order = [];
  const lifecycle = new V3BetaLifecycle({
    featureFlag: new V3BetaFeatureFlag({ storage: new MemoryKeyValueStorage(values) }),
    databaseFactory: () => new MemoryV3Database({ registry }),
    ownerId: 'partial-owner',
    activation: async ({ runtimeGuard, resources }) => {
      assert.ok(runtimeGuard);
      const originalRelease = runtimeGuard.release.bind(runtimeGuard);
      runtimeGuard.release = async () => {
        order.push('lease-release');
        return originalRelease();
      };
      resources.add('timers', 'partial-heartbeat', async () => { order.push('heartbeat-stop'); });
      throw new Error('synthetic activation failure');
    },
  });

  const result = await lifecycle.enable();
  assert.equal(result.state, 'failed');
  assert.equal(result.authoringEnabled, false);
  assert.equal(result.databaseOpen, false);
  assert.deepEqual(result.resources, { listeners: 0, timers: 0, jobs: 0, adapters: 0, other: 0 });
  assert.deepEqual(order, ['heartbeat-stop', 'lease-release']);
  await lifecycle.disable();
  assert.equal(lifecycle.status.state, 'disabled');
});
