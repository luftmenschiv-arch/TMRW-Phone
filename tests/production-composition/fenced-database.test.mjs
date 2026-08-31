import assert from 'node:assert/strict';
import test from 'node:test';
import { V3RuntimeGuard } from '../../beta/runtime-guard.mjs';
import { ProductionAuthoringGate } from '../../production/authoring-gate.mjs';
import { createFencedV3Database } from '../../production/fenced-database.mjs';
import { MemoryV3Database } from '../../storage/memory-v3-database.mjs';
import { V3_RUNTIME_LEASE_KEY } from '../../storage/schema.mjs';
import { setupPhase15, postFrom } from '../phase15/social-fixtures.mjs';
import { createDm, sendFrom } from '../phase8/messaging-fixtures.mjs';
import { startCall } from '../phase9/call-fixtures.mjs';
import { eventInput } from '../phase3/event-fixtures.mjs';

function mutableClock(start = 1_000) {
  let value = start;
  return {
    now: () => value,
    set(next) { value = next; },
    advance(delta) { value += delta; },
  };
}

function idFactory(...ids) {
  let index = 0;
  return () => ids[index++] ?? `lease-${index}`;
}

function normalPrerequisites(overrides = {}) {
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
    ...overrides,
  };
}

async function openMemory(registry = MemoryV3Database.createRegistry()) {
  const database = new MemoryV3Database({ registry });
  await database.open();
  return database;
}

async function readRecord(database, store, key) {
  return database.transaction([store], 'readonly', tx => tx.store(store).get(key));
}

class SpyDatabase {
  constructor(database) {
    this.database = database;
    this.calls = [];
  }
  get databaseName() { return this.database.databaseName; }
  get schemaVersion() { return this.database.schemaVersion; }
  get isOpen() { return this.database.isOpen; }
  get diagnostics() { return this.database.diagnostics; }
  async open() { await this.database.open(); return this; }
  close() { return this.database.close(); }
  transaction(storeNames, mode, work) {
    this.calls.push({ storeNames: [...storeNames], mode });
    return this.database.transaction(storeNames, mode, work);
  }
}

class SerializedDatabase extends SpyDatabase {
  #tail = Promise.resolve();
  transaction(storeNames, mode, work) {
    if (mode !== 'readwrite') return super.transaction(storeNames, mode, work);
    this.calls.push({ storeNames: [...storeNames], mode });
    const previous = this.#tail;
    let release;
    this.#tail = new Promise(resolve => { release = resolve; });
    return (async () => {
      await previous;
      try {
        return await this.database.transaction(storeNames, mode, work);
      } finally {
        release();
      }
    })();
  }
}

async function leasedContext({ database = null, clock = mutableClock(), ownerId = 'window-a', leaseId = 'lease-a', leaseDurationMs = 100 } = {}) {
  const raw = database || await openMemory();
  const guard = new V3RuntimeGuard({ database: raw, ownerId, clock: clock.now, leaseDurationMs, leaseIdFactory: idFactory(leaseId, `${leaseId}-next`) });
  const acquired = await guard.acquire();
  assert.equal(acquired.acquired, true);
  const gate = new ProductionAuthoringGate({ runtimeGuard: guard });
  const fence = gate.createFence();
  return { raw, guard, gate, fence, clock };
}

test('Authoring Gate stays fail-closed until every normal prerequisite and immediate lease validation pass', async () => {
  const context = await leasedContext();
  const missing = await context.gate.open(normalPrerequisites({ shellMountHealthy: false }));
  assert.equal(missing.opened, false);
  assert.equal(context.gate.state, 'closed');

  const opened = await context.gate.open(normalPrerequisites());
  assert.equal(opened.opened, true);
  assert.equal(context.gate.state, 'open');

  assert.equal(context.gate.close('test-close').state, 'closed');
  assert.equal(context.gate.close('test-close-again').state, 'closed');
  context.raw.close();
});

test('Authoring Gate cannot open from cached ownership after the shared lease disappears', async () => {
  const context = await leasedContext();
  await context.raw.transaction(['metadata'], 'readwrite', tx => tx.store('metadata').delete(V3_RUNTIME_LEASE_KEY));
  assert.equal(context.guard.ownsLease, true);
  const opened = await context.gate.open(normalPrerequisites());
  assert.equal(opened.opened, false);
  assert.equal(context.gate.state, 'closed');
  assert.match(context.gate.status.reason, /lease-/);
  context.raw.close();
});

test('closed gate denies writes while readonly queries remain duck-compatible and lease-control operations stay raw', async () => {
  const context = await leasedContext();
  const fenced = createFencedV3Database({ database: context.raw, runtimeGuard: context.guard, authoringFence: context.fence, capability: 'normal' });
  assert.equal(fenced.databaseName, context.raw.databaseName);
  assert.equal(fenced.schemaVersion, context.raw.schemaVersion);
  assert.equal(fenced.isOpen, true);
  assert.equal(typeof fenced.diagnostics, 'object');
  assert.equal('rawDatabase' in fenced, false);

  const lease = await fenced.transaction(['metadata'], 'readonly', tx => tx.store('metadata').get(V3_RUNTIME_LEASE_KEY));
  assert.equal(lease.leaseId, context.guard.leaseId);
  await assert.rejects(
    fenced.transaction(['migrations'], 'readwrite', tx => tx.store('migrations').put({ id: 'blocked-write' })),
    /not permitted/,
  );

  const renewed = await context.guard.renew();
  assert.equal(renewed.renewed, true);
  context.raw.close();
});

test('normal and transition capabilities are distinct and transition cannot authorize normal writes', async () => {
  const context = await leasedContext();
  const normal = createFencedV3Database({ database: context.raw, runtimeGuard: context.guard, authoringFence: context.fence, capability: 'normal' });
  const transition = createFencedV3Database({ database: context.raw, runtimeGuard: context.guard, authoringFence: context.fence, capability: 'transition' });

  const transitionOpen = await context.gate.enterTransition({ previewQuiesced: true });
  assert.equal(transitionOpen.opened, true);
  await transition.transaction(['migrations'], 'readwrite', tx => tx.store('migrations').put({ id: 'transition-write', status: 'applied' }));
  assert.equal((await readRecord(context.raw, 'migrations', 'transition-write')).status, 'applied');
  await assert.rejects(
    normal.transaction(['migrations'], 'readwrite', tx => tx.store('migrations').put({ id: 'normal-leak' })),
    /not permitted/,
  );
  assert.equal(await readRecord(context.raw, 'migrations', 'normal-leak'), undefined);

  context.gate.close('transition-complete');
  assert.equal((await context.gate.open(normalPrerequisites())).opened, true);
  await normal.transaction(['migrations'], 'readwrite', tx => tx.store('migrations').put({ id: 'normal-write', status: 'applied' }));
  await assert.rejects(
    transition.transaction(['migrations'], 'readwrite', tx => tx.store('migrations').put({ id: 'transition-leak' })),
    /not permitted/,
  );
  assert.equal(await readRecord(context.raw, 'migrations', 'transition-leak'), undefined);
  const unsafeDirectSwitch = await context.gate.enterTransition({ previewQuiesced: true });
  assert.equal(unsafeDirectSwitch.opened, false);
  assert.equal(context.gate.state, 'closed');
  context.raw.close();
});

test('every fenced readwrite transaction includes metadata and validates the lease before mutation work starts', async () => {
  const raw = await openMemory();
  const spy = new SpyDatabase(raw);
  const context = await leasedContext({ database: raw });
  assert.equal((await context.gate.open(normalPrerequisites())).opened, true);
  const fenced = createFencedV3Database({ database: spy, runtimeGuard: context.guard, authoringFence: context.fence, capability: 'normal' });
  let workStarted = false;
  await fenced.transaction(['migrations'], 'readwrite', async tx => {
    workStarted = true;
    await tx.store('migrations').put({ id: 'fenced-write', status: 'applied' });
  });
  assert.equal(workStarted, true);
  const call = spy.calls.at(-1);
  assert.equal(call.mode, 'readwrite');
  assert.deepEqual(new Set(call.storeNames), new Set(['migrations', 'metadata']));
  assert.equal((await readRecord(raw, 'migrations', 'fenced-write')).status, 'applied');
  raw.close();
});

test('TOCTOU takeover between a successful precheck and transaction start is rejected before canonical mutation', async () => {
  const raw = await openMemory();
  const clock = mutableClock(10_000);
  const a = await leasedContext({ database: raw, clock, ownerId: 'window-a', leaseId: 'lease-a', leaseDurationMs: 10 });
  assert.equal((await a.gate.open(normalPrerequisites())).opened, true);
  const fencedA = createFencedV3Database({ database: raw, runtimeGuard: a.guard, authoringFence: a.fence, capability: 'normal' });
  assert.equal((await a.guard.validateLease()).valid, true);

  clock.set(10_011);
  const guardB = new V3RuntimeGuard({ database: raw, ownerId: 'window-b', clock: clock.now, leaseDurationMs: 10, leaseIdFactory: idFactory('lease-b') });
  assert.equal((await guardB.acquire()).acquired, true);

  let workStarted = false;
  await assert.rejects(
    fencedA.transaction(['migrations'], 'readwrite', async tx => {
      workStarted = true;
      await tx.store('migrations').put({ id: 'stale-a-write' });
    }),
    /owner-mismatch|generation-mismatch|lease generation/i,
  );
  assert.equal(workStarted, false);
  assert.equal(a.gate.state, 'closed');
  assert.equal(await readRecord(raw, 'migrations', 'stale-a-write'), undefined);
  raw.close();
});

test('an expired generation without takeover is rejected and closes the gate before mutation', async () => {
  const clock = mutableClock(20_000);
  const context = await leasedContext({ clock, leaseDurationMs: 10 });
  assert.equal((await context.gate.open(normalPrerequisites())).opened, true);
  const fenced = createFencedV3Database({ database: context.raw, runtimeGuard: context.guard, authoringFence: context.fence, capability: 'normal' });
  clock.set(20_010);
  await assert.rejects(
    fenced.transaction(['migrations'], 'readwrite', tx => tx.store('migrations').put({ id: 'expired-write' })),
    /lease expired/i,
  );
  assert.equal(context.gate.state, 'closed');
  assert.equal(await readRecord(context.raw, 'migrations', 'expired-write'), undefined);
  context.raw.close();
});

test('same owner with a different live lease generation is rejected inside the fenced transaction', async () => {
  const context = await leasedContext();
  assert.equal((await context.gate.open(normalPrerequisites())).opened, true);
  const fenced = createFencedV3Database({ database: context.raw, runtimeGuard: context.guard, authoringFence: context.fence, capability: 'normal' });
  const current = await readRecord(context.raw, 'metadata', V3_RUNTIME_LEASE_KEY);
  await context.raw.transaction(['metadata'], 'readwrite', tx => tx.store('metadata').put({ ...current, leaseId: 'different-live-generation' }));
  await assert.rejects(
    fenced.transaction(['migrations'], 'readwrite', tx => tx.store('migrations').put({ id: 'wrong-generation-write' })),
    /generation-mismatch/i,
  );
  assert.equal(context.gate.state, 'closed');
  assert.equal(await readRecord(context.raw, 'migrations', 'wrong-generation-write'), undefined);
  context.raw.close();
});

test('an unusable lease clock fails closed inside the same-transaction fence', async () => {
  const clock = mutableClock(25_000);
  const context = await leasedContext({ clock });
  assert.equal((await context.gate.open(normalPrerequisites())).opened, true);
  const fenced = createFencedV3Database({ database: context.raw, runtimeGuard: context.guard, authoringFence: context.fence, capability: 'normal' });
  clock.set(Number.NaN);
  await assert.rejects(
    fenced.transaction(['migrations'], 'readwrite', tx => tx.store('migrations').put({ id: 'invalid-clock-write' })),
    /finite epoch millisecond/i,
  );
  assert.equal(context.gate.state, 'closed');
  assert.equal(await readRecord(context.raw, 'migrations', 'invalid-clock-write'), undefined);
  context.raw.close();
});

test('admitted fenced transaction holds the serialized metadata write boundary ahead of takeover, and the next transaction re-fences', async () => {
  const rawMemory = await openMemory();
  const serialized = new SerializedDatabase(rawMemory);
  const clock = mutableClock(30_000);
  const a = await leasedContext({ database: serialized, clock, ownerId: 'window-a', leaseId: 'lease-a', leaseDurationMs: 10 });
  assert.equal((await a.gate.open(normalPrerequisites())).opened, true);
  const fencedA = createFencedV3Database({ database: serialized, runtimeGuard: a.guard, authoringFence: a.fence, capability: 'normal' });

  let releaseWork;
  const hold = new Promise(resolve => { releaseWork = resolve; });
  let admittedResolve;
  const admitted = new Promise(resolve => { admittedResolve = resolve; });
  const firstWrite = fencedA.transaction(['migrations'], 'readwrite', async tx => {
    admittedResolve();
    await hold;
    await tx.store('migrations').put({ id: 'admitted-a', status: 'applied' });
  });
  await admitted;

  clock.set(30_011);
  const guardB = new V3RuntimeGuard({ database: serialized, ownerId: 'window-b', clock: clock.now, leaseDurationMs: 10, leaseIdFactory: idFactory('lease-b') });
  let takeoverSettled = false;
  const takeover = guardB.acquire().then(result => { takeoverSettled = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(takeoverSettled, false);

  releaseWork();
  await firstWrite;
  assert.equal((await takeover).acquired, true);
  assert.equal((await readRecord(serialized, 'migrations', 'admitted-a')).status, 'applied');

  await assert.rejects(
    fencedA.transaction(['migrations'], 'readwrite', tx => tx.store('migrations').put({ id: 'second-a' })),
    /owner-mismatch|generation-mismatch|lease generation/i,
  );
  assert.equal(await readRecord(serialized, 'migrations', 'second-a'), undefined);
  rawMemory.close();
});

test('missing/malformed/database-unavailable lease authority fails closed before canonical write', async () => {
  const missing = await leasedContext();
  assert.equal((await missing.gate.open(normalPrerequisites())).opened, true);
  const missingFenced = createFencedV3Database({ database: missing.raw, runtimeGuard: missing.guard, authoringFence: missing.fence, capability: 'normal' });
  await missing.raw.transaction(['metadata'], 'readwrite', tx => tx.store('metadata').delete(V3_RUNTIME_LEASE_KEY));
  await assert.rejects(missingFenced.transaction(['migrations'], 'readwrite', tx => tx.store('migrations').put({ id: 'missing' })), /missing-lease/);
  assert.equal(missing.gate.state, 'closed');
  missing.raw.close();

  const unavailable = await leasedContext();
  assert.equal((await unavailable.gate.open(normalPrerequisites())).opened, true);
  const unavailableFenced = createFencedV3Database({ database: unavailable.raw, runtimeGuard: unavailable.guard, authoringFence: unavailable.fence, capability: 'normal' });
  unavailable.raw.close();
  await assert.rejects(unavailableFenced.transaction(['migrations'], 'readwrite', tx => tx.store('migrations').put({ id: 'closed-db' })), /not open/i);
  assert.equal(unavailable.gate.state, 'closed');
});

test('Event engine plus representative Message, Call, and Social writes remain compatible through only the fenced facade', async () => {
  const raw = await openMemory();
  const spy = new SpyDatabase(raw);
  const context = await leasedContext({ database: raw, ownerId: 'representative-owner', leaseId: 'representative-lease', leaseDurationMs: 100_000 });
  assert.equal((await context.gate.open(normalPrerequisites())).opened, true);
  const fenced = createFencedV3Database({ database: spy, runtimeGuard: context.guard, authoringFence: context.fence, capability: 'normal' });

  const app = await setupPhase15({ database: fenced, manifestId: 's02-fenced-services' });
  const directEvent = await app.engine.append(eventInput(app, { key: 's02-direct-event', value: 'fenced-event' }));
  assert.equal(directEvent.replayed, false);

  const dm = await createDm(app, app.user, app.alice, 's02-dm');
  const message = await sendFrom(app, { threadId: dm.thread.threadId, sender: app.user, text: 's02 fenced message', key: 's02-message' });
  assert.ok(message.message.id);

  const call = await startCall(app, { caller: app.user, called: app.alice, key: 's02-call' });
  assert.ok(call.session.callSessionId);

  const post = await postFrom(app, app.user, { key: 's02-social', text: 's02 fenced social' });
  assert.ok(post.post.id);

  const writeCalls = spy.calls.filter(row => row.mode === 'readwrite');
  assert.ok(writeCalls.length > 0);
  assert.equal(writeCalls.every(row => row.storeNames.includes('metadata')), true);
  assert.equal('database' in fenced, false);
  raw.close();
});
