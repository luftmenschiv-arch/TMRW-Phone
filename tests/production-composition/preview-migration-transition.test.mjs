import test from 'node:test';
import assert from 'node:assert/strict';

import { createTmrwV3ProductionRuntime } from '../../production/composition-root.mjs';
import { V3_GENERATION_INTERCEPTOR_KEY, V3_PRODUCTION_RUNTIME_ID } from '../../production/constants.mjs';
import { MemoryV3Database } from '../../storage/memory-v3-database.mjs';
import { V3_RUNTIME_LEASE_KEY } from '../../storage/schema.mjs';
import { preview37Project } from '../phase12/preview37-fixtures.mjs';
import { previewDigest } from '../../migration/preview37/digest.mjs';

const PASSIVE_SHIM_MARKER = Symbol.for('tmrw.v3.production.passive-generation-interceptor');
const EVENT_TYPES = Object.freeze({ CHAT_CHANGED: 'chat-changed', MESSAGE_SENT: 'sent', MESSAGE_RECEIVED: 'received', MESSAGE_SWIPED: 'swiped', MESSAGE_EDITED: 'edited', MESSAGE_DELETED: 'deleted', IMPERSONATE_READY: 'impersonate' });

class FakeEventSource {
  listeners = new Map();
  on(type, handler) { const rows = this.listeners.get(type) || []; rows.push(handler); this.listeners.set(type, rows); }
  removeListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(row => row !== handler)); }
  count(type) { return (this.listeners.get(type) || []).length; }
}

class RecordingDatabase {
  constructor(inner) { this.inner = inner; this.transactions = []; }
  get databaseName() { return this.inner.databaseName; }
  get schemaVersion() { return this.inner.schemaVersion; }
  get isOpen() { return this.inner.isOpen; }
  get diagnostics() { return this.inner.diagnostics; }
  open() { return this.inner.open().then(() => this); }
  close() { return this.inner.close(); }
  transaction(storeNames, mode, work) {
    this.transactions.push({ storeNames: [...storeNames], mode });
    return this.inner.transaction(storeNames, mode, work);
  }
}

function optionsFor({ source = preview37Project({ castSize: 2, suffix: 's08-transition', includeGroup: false, includeCall: true }), commitOptions = {}, stageObserver = null, registry = MemoryV3Database.createRegistry() } = {}) {
  const rawDatabases = [];
  const timers = new Map(); let nextTimer = 1;
  const eventSource = new FakeEventSource();
  const globalObject = { document: { visibilityState: 'visible' } };
  const shim = async () => {}; Object.defineProperty(shim, PASSIVE_SHIM_MARKER, { value: V3_PRODUCTION_RUNTIME_ID }); globalObject[V3_GENERATION_INTERCEPTOR_KEY] = shim;
  const snapshot = structuredClone(source);
  const options = {
    ownerId: 's08-transition-owner', runtimeScope: {},
    databaseFactory: () => { const db = new RecordingDatabase(new MemoryV3Database({ registry })); rawDatabases.push(db); return db; },
    previewControl: { findPreview37: () => ({ name: 'third-party/TMRW-Phone-Preview', enabled: false }), isPreview37Disabled: () => true, verifyPreview37Excluded: () => ({ excluded: true }) },
    startupEvidence: { requested: true, cleanReloadProven: true, exclusionProof: {}, gateFReport: { status: 'pass' } },
    getContext: () => ({ chatId: 's08-transition', chat: [] }), Generate: async () => {}, eventSource, sillyTavernEventTypes: EVENT_TYPES,
    sourceIdentityResolver: async () => ({ characterCardSourceId: 'unused', storySourceId: 'unused', routeSourceId: 'unused' }), messageIdentityResolver: async () => null,
    globalObject,
    setIntervalFn: fn => { const id = nextTimer++; timers.set(id, fn); return id; }, clearIntervalFn: id => timers.delete(id), heartbeatIntervalMs: 5_000,
    migration: { previewQuiesced: true, previewReadSource: async () => ({ available: true, sourceVersion: snapshot.schemaVersion, sourceLocation: 's08-transition-fixture', record: structuredClone(snapshot) }), commitOptions },
    stageObserver,
  };
  return { options, registry, rawDatabases, timers, eventSource, globalObject };
}

async function readStore(registry, storeName) {
  const db = new MemoryV3Database({ registry }); await db.open();
  const rows = await db.transaction([storeName], 'readonly', tx => tx.store(storeName).getAll());
  db.close(); return rows;
}

async function updateCompletedBatchEvidence(registry, batchId, updates) {
  const db = new MemoryV3Database({ registry }); await db.open();
  await db.transaction(['previewMigrationBatches'], 'readwrite', async tx => {
    const store = tx.store('previewMigrationBatches');
    const batch = await store.get(batchId);
    assert.ok(batch?.status === 'completed');
    await store.put({ ...batch, ...updates });
  });
  db.close();
}

async function withExactDuplicatePlanItem(plan) {
  const duplicate = plan.items.find(item => item.sourceType === 'call') || plan.items[0];
  assert.ok(duplicate);
  const items = Object.freeze([...plan.items, duplicate]);
  const counts = Object.freeze({ ...plan.counts, [duplicate.state]: Number(plan.counts?.[duplicate.state] || 0) + 1 });
  const classificationCounts = duplicate.classification
    ? Object.freeze({ ...plan.classificationCounts, [duplicate.classification]: Number(plan.classificationCounts?.[duplicate.classification] || 0) + 1 })
    : plan.classificationCounts;
  const planBasis = {
    sourceFingerprint: plan.sourceFingerprint,
    items: items.map(item => ({
      sourceRecordId: item.sourceRecordId,
      sourceFingerprint: item.sourceFingerprint,
      sourceType: item.sourceType,
      state: item.state,
      reasonCode: item.reasonCode || null,
      classification: item.classification || null,
    })),
  };
  return Object.freeze({ ...plan, items, counts, classificationCounts, planFingerprint: await previewDigest(planBasis) });
}

async function withChangedCanonicalPlanFingerprint(plan) {
  const items = plan.items.map(item => item.sourceType === 'identity-scope'
    ? Object.freeze({ ...item, sourceFingerprint: `${item.sourceFingerprint}:changed-canonical` })
    : item);
  const planBasis = {
    sourceFingerprint: plan.sourceFingerprint,
    items: items.map(item => ({
      sourceRecordId: item.sourceRecordId,
      sourceFingerprint: item.sourceFingerprint,
      sourceType: item.sourceType,
      state: item.state,
      reasonCode: item.reasonCode || null,
      classification: item.classification || null,
    })),
  };
  return Object.freeze({ ...plan, items: Object.freeze(items), planFingerprint: await previewDigest(planBasis) });
}

async function lease(registry) {
  const db = new MemoryV3Database({ registry }); await db.open();
  const row = await db.transaction(['metadata'], 'readonly', tx => tx.store('metadata').get(V3_RUNTIME_LEASE_KEY));
  db.close(); return row;
}

test('Preview migration commit runs through the bounded transition fence before normal graph construction', async () => {
  const h = optionsFor();
  const root = await createTmrwV3ProductionRuntime(h.options);
  assert.equal(root.migration.attempted, true);
  assert.equal(root.migration.committed, true);
  assert.equal(root.status.gateState, 'closed');
  const order = root.status.constructionOrder;
  assert.ok(order.indexOf('transition-fenced-database') < order.indexOf('migration-transition-open'));
  assert.ok(order.indexOf('migration-transition-open') < order.indexOf('normal-fenced-database'));
  assert.equal('transitionDatabase' in root, false);
  assert.equal('transitionDatabase' in root.composition, false);
  const batches = await readStore(h.registry, 'previewMigrationBatches');
  assert.equal(batches.length, 1);
  assert.equal(batches[0].status, 'completed');
  assert.ok((await readStore(h.registry, 'events')).length > 0);
  await root.dispose();
});

test('completed Patch3-era plan reuses exact canonical migration semantics despite legacy physical manifest-row dedup', async () => {
  const registry = MemoryV3Database.createRegistry();
  const source = preview37Project({ castSize: 2, suffix: 's08-completed-reuse', includeGroup: false, includeCall: true });
  const first = optionsFor({ source, registry });
  const initial = await createTmrwV3ProductionRuntime(first.options);
  const originalPlan = initial.migration.plan;
  const completedOriginal = (await readStore(registry, 'previewMigrationBatches')).find(row => row.id === originalPlan.batchId);
  assert.equal(completedOriginal?.status, 'completed');
  await initial.dispose();

  const legacyPlan = await withExactDuplicatePlanItem(originalPlan);
  await updateCompletedBatchEvidence(registry, originalPlan.batchId, {
    planFingerprint: legacyPlan.planFingerprint,
    counts: legacyPlan.counts,
    classificationCounts: legacyPlan.classificationCounts,
  });
  const physicalBeforeReplay = (await readStore(registry, 'previewMigrationItems')).filter(row => row.batchId === legacyPlan.batchId).length;
  assert.ok(physicalBeforeReplay < legacyPlan.items.length);
  const completedBefore = (await readStore(registry, 'previewMigrationBatches')).find(row => row.id === legacyPlan.batchId);

  const replay = optionsFor({ source, registry });
  replay.options.migration.plan = legacyPlan;
  const resumed = await createTmrwV3ProductionRuntime(replay.options);
  assert.equal(resumed.migration.result.replayed, true);
  assert.equal(resumed.migration.result.productionExactCompletedPlanReuse, true);
  const completedAfter = (await readStore(registry, 'previewMigrationBatches')).find(row => row.id === legacyPlan.batchId);
  assert.equal(completedAfter.planFingerprint, completedBefore.planFingerprint);
  assert.equal(completedAfter.updatedAt, completedBefore.updatedAt);
  assert.equal((await readStore(registry, 'previewMigrationItems')).filter(row => row.batchId === legacyPlan.batchId).length, physicalBeforeReplay);
  await resumed.dispose();
});

test('genuine canonical completed-plan fingerprint change still fails closed through the strict migration invariant', async () => {
  const registry = MemoryV3Database.createRegistry();
  const source = preview37Project({ castSize: 2, suffix: 's08-completed-negative', includeGroup: false, includeCall: true });
  const first = optionsFor({ source, registry });
  const initial = await createTmrwV3ProductionRuntime(first.options);
  const originalPlan = initial.migration.plan;
  const completedBefore = (await readStore(registry, 'previewMigrationBatches')).find(row => row.id === originalPlan.batchId);
  await initial.dispose();

  const changedPlan = await withChangedCanonicalPlanFingerprint(originalPlan);
  assert.notEqual(changedPlan.planFingerprint, completedBefore.planFingerprint);
  const retry = optionsFor({ source, registry });
  retry.options.migration.plan = changedPlan;
  await assert.rejects(() => createTmrwV3ProductionRuntime(retry.options), /Completed Preview migration/);
  const completedAfter = (await readStore(registry, 'previewMigrationBatches')).find(row => row.id === originalPlan.batchId);
  assert.equal(completedAfter.status, 'completed');
  assert.equal(completedAfter.planFingerprint, completedBefore.planFingerprint);
  assert.equal(completedAfter.updatedAt, completedBefore.updatedAt);
});

test('transition capability never opens normal authoring and cannot leak after migration completion', async () => {
  const h = optionsFor();
  const root = await createTmrwV3ProductionRuntime(h.options);
  assert.equal(root.composition.normalDatabase.capability, 'normal');
  assert.equal(root.composition.authoringGate.allows('transition'), false);
  assert.equal(root.composition.authoringGate.allows('normal'), false);
  await assert.rejects(() => root.services.messages.createThread({}), /Authoring capability normal is not permitted|scope/i);
  assert.equal(root.status.gateState, 'closed');
  await root.dispose();
});

test('Preview quiescence is mandatory before transition authority exists', async () => {
  const h = optionsFor();
  h.options.migration.previewQuiesced = false;
  let failure;
  try { await createTmrwV3ProductionRuntime(h.options); } catch (error) { failure = error; }
  assert.ok(failure);
  assert.match(failure.message, /Preview must be quiesced/);
  assert.equal(h.rawDatabases[0].isOpen, false);
  assert.equal(h.timers.size, 0);
  assert.equal(await lease(h.registry), undefined);
  assert.equal(h.eventSource.count(EVENT_TYPES.MESSAGE_SENT), 0);
});

test('transition migration failure closes authority and reverse-unwinds heartbeat, lease and DB before any normal graph/hooks exist', async () => {
  const h = optionsFor({ commitOptions: { failAfterItems: 1 } });
  let failure;
  try { await createTmrwV3ProductionRuntime(h.options); } catch (error) { failure = error; }
  assert.ok(failure);
  assert.match(failure.message, /Injected Preview migration failure/);
  assert.equal(failure.productionActivationStatus.constructionOrder.includes('normal-fenced-database'), false);
  assert.deepEqual(failure.productionActivationStatus.disposalOrder, ['heartbeat-stop', 'lease-release', 'raw-database']);
  assert.equal(h.rawDatabases[0].isOpen, false);
  assert.equal(h.timers.size, 0);
  assert.equal(await lease(h.registry), undefined);
  assert.equal(h.eventSource.count(EVENT_TYPES.MESSAGE_SENT), 0);
  const batches = await readStore(h.registry, 'previewMigrationBatches');
  assert.equal(batches.length, 1);
  assert.equal(batches[0].status, 'failed');
});

test('migration uses the same lease generation and fenced transactions include metadata through the transition DB', async () => {
  const h = optionsFor({ source: preview37Project({ castSize: 1, suffix: 's08-fence', includeGroup: false, includeCall: false }) });
  const root = await createTmrwV3ProductionRuntime(h.options);
  assert.equal(root.migration.committed, true);
  const storedLease = await lease(h.registry);
  assert.equal(storedLease.ownerId, root.ownerId);
  assert.equal(storedLease.leaseId, root.composition.runtimeGuard.leaseId);
  assert.ok(h.rawDatabases[0].transactions.some(row => row.mode === 'readwrite' && row.storeNames.length > 1 && row.storeNames.includes('metadata')));
  assert.equal(root.status.gateState, 'closed');
  assert.equal(root.composition.authoringGate.allows('transition'), false);
  await root.dispose();
});
