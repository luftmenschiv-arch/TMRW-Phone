import test from 'node:test';
import assert from 'node:assert/strict';

import { createTmrwV3ProductionRuntime } from '../../production/composition-root.mjs';
import { V3_GENERATION_INTERCEPTOR_KEY, V3_PRODUCTION_RUNTIME_ID } from '../../production/constants.mjs';
import { MemoryV3Database } from '../../storage/memory-v3-database.mjs';
import { V3_RUNTIME_LEASE_KEY } from '../../storage/schema.mjs';
import { preview37Project } from '../phase12/preview37-fixtures.mjs';

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

function optionsFor({ source = preview37Project({ castSize: 2, suffix: 's08-transition', includeGroup: false, includeCall: true }), commitOptions = {}, stageObserver = null } = {}) {
  const registry = MemoryV3Database.createRegistry();
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
