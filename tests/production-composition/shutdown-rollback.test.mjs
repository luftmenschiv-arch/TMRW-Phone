import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { ProductionShutdownController } from '../../production/shutdown-controller.mjs';
import { ProductionMountManager } from '../../production/mount-manager.mjs';
import { ProductionLauncherOwner } from '../../production/launcher-owner.mjs';
import { createTmrwV3ProductionRuntime } from '../../production/composition-root.mjs';
import { ProductionRuntimeArbiter, PRODUCTION_RUNTIME_STATE } from '../../production/runtime-arbiter.mjs';
import { SillyTavernExtensionControl } from '../../production/sillytavern-extension-control.mjs';
import { V3BetaFeatureFlag, MemoryKeyValueStorage } from '../../beta/feature-flag.mjs';
import { V3RuntimeGuard } from '../../beta/runtime-guard.mjs';
import { V3_GENERATION_INTERCEPTOR_KEY, V3_LAUNCHER_ID, V3_PRODUCTION_RUNTIME_ID, V3_ROOT_ID } from '../../production/constants.mjs';
import { MemoryV3Database } from '../../storage/memory-v3-database.mjs';
import { V3_RUNTIME_LEASE_KEY } from '../../storage/schema.mjs';
import { V3IdentityKernel } from '../../domain/identity/identity-kernel.mjs';
import { setupPhase17 } from '../phase17/notification-fixtures.mjs';
import { identitySeed } from '../phase2/identity-fixtures.mjs';
import { FakeDocument, FakeNode } from '../phase7/fake-dom.mjs';

const PASSIVE_SHIM_MARKER = Symbol.for('tmrw.v3.production.passive-generation-interceptor');
const NORMAL_READY = Object.freeze({
  productionHealthValid: true,
  previewExcluded: true,
  identityResolved: true,
  compositionServicesReady: true,
  uniqueListenersReady: true,
  uniqueGenerationInterceptorReady: true,
  callIntegrationReady: true,
  shellMountHealthy: true,
  heartbeatQualified: true,
});
const EXPECTED_SHUTDOWN_ORDER = Object.freeze([
  '1-close-authoring-gate',
  '2-block-launcher-phone-actions',
  '3-wait-canonical-quiescence',
  '4-deactivate-generation-interceptor',
  '5-unregister-runtime-listeners',
  '6-stop-background-canonical-jobs',
  '7-stop-heartbeat-resume',
  '8-dispose-phone-shell',
  '9-close-phone-controller-state',
  '10-remove-v3-root-launcher',
  '11-12-release-lease-close-db',
  '13-clear-composition-references',
]);

class FakeEventSource {
  listeners = new Map();
  on(type, handler) { const rows = this.listeners.get(type) || []; rows.push(handler); this.listeners.set(type, rows); }
  removeListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(row => row !== handler)); }
  count(type) { return (this.listeners.get(type) || []).length; }
}

const EVENT_TYPES = Object.freeze({
  CHAT_CHANGED: 'chat-changed', MESSAGE_SENT: 'sent', MESSAGE_RECEIVED: 'received', MESSAGE_SWIPED: 'swiped',
  MESSAGE_EDITED: 'edited', MESSAGE_DELETED: 'deleted', IMPERSONATE_READY: 'impersonate',
});

class MutableArbiter {
  constructor(state = PRODUCTION_RUNTIME_STATE.V3_STARTING) { this.state = state; }
  inspect() { return Object.freeze({ state: this.state, requested: true, requestedIntentOnly: true, authoringAuthority: false }); }
}

function fakeTimers() {
  let next = 1;
  const timers = new Map();
  return { timers, setIntervalFn(fn) { const id = next++; timers.set(id, fn); return id; }, clearIntervalFn(id) { timers.delete(id); } };
}

function previewControl() {
  return {
    findPreview37: () => ({ name: 'third-party/TMRW-Phone-Preview', enabled: false }),
    isPreview37Disabled: () => true,
    verifyPreview37Excluded: proof => Object.freeze({ excluded: proof?.previewExcluded !== false }),
  };
}

function passiveGlobal(document) {
  const globalObject = { document };
  const shim = async () => {};
  Object.defineProperty(shim, PASSIVE_SHIM_MARKER, { value: V3_PRODUCTION_RUNTIME_ID });
  globalObject[V3_GENERATION_INTERCEPTOR_KEY] = shim;
  return globalObject;
}

function nodeId(node) { return node?.id || node?.attributes?.get?.('id') || null; }
function allNodes(root) { const rows=[]; const walk=node=>{ if(!node)return; rows.push(node); for(const child of node.children||[]) walk(child); }; walk(root); return rows; }
function countId(root, id) { return allNodes(root).filter(node => nodeId(node) === id).length; }

function productionSeed({ castSize = 2, manifestId = 's10-main', storySourceId = 's10-story', routeSourceId = 's10-branch' } = {}) {
  return Object.freeze({ ...identitySeed({ castSize, manifestId, cardSourceId: 's10-card', storySourceId, routeSourceId }), sourceAuthority: 'sillytavern' });
}

async function prepareRegistry({ castSize = 2 } = {}) {
  const registry = MemoryV3Database.createRegistry();
  const bootstrap = await setupPhase17({ registry, castSize: 1, manifestId: `s10-bootstrap-${castSize}` });
  const kernel = new V3IdentityKernel({ database: bootstrap.database, now: () => '2026-08-29T00:00:00.000Z' });
  const seeded = await kernel.seedIdentityGraph(productionSeed({ castSize, manifestId: `s10-main-${castSize}` }));
  await bootstrap.phones.initializeScope({ storyId: seeded.storyId, branchId: seeded.branchId });
  bootstrap.database.close();
  return { registry, seeded };
}

async function leaseRecord(registry) {
  const db = new MemoryV3Database({ registry }); await db.open();
  const value = await db.transaction(['metadata'], 'readonly', tx => tx.store('metadata').get(V3_RUNTIME_LEASE_KEY));
  db.close(); return value;
}

async function writeCommits(registry) {
  const db = new MemoryV3Database({ registry }); await db.open(); const count = db.diagnostics.writeCommits; db.close(); return count;
}

async function createHarness({ castSize = 2, shellFactory = undefined, clockRef = { now: 1_000 }, leaseDurationMs = 30_000, stageObserver = null } = {}) {
  const { registry, seeded } = await prepareRegistry({ castSize });
  const document = new FakeDocument(); document.body = new FakeNode('body'); document.visibilityState = 'visible';
  const context = { chatId: 's10-chat', chat: [], characterCardSourceId: 's10-card', storySourceId: 's10-story', routeSourceId: 's10-branch' };
  const eventSource = new FakeEventSource(); const timers = fakeTimers(); const globalObject = passiveGlobal(document); const rawDatabases = [];
  const runtimeScope = {};
  const runtime = await createTmrwV3ProductionRuntime({
    ownerId: `s10-owner-${Math.random()}`, runtimeScope,
    databaseFactory: () => { const db = new MemoryV3Database({ registry }); rawDatabases.push(db); return db; },
    previewControl: previewControl(),
    startupEvidence: { requested: true, cleanReloadProven: true, exclusionProof: { previewExcluded: true }, gateFReport: { status: 'pass' } },
    getContext: () => context, Generate: async () => {}, eventSource, sillyTavernEventTypes: EVENT_TYPES,
    sourceIdentityResolver: async current => ({ characterCardSourceId: current.characterCardSourceId, storySourceId: current.storySourceId, routeSourceId: current.routeSourceId }),
    messageIdentityResolver: async () => null, globalObject, setIntervalFn: timers.setIntervalFn, clearIntervalFn: timers.clearIntervalFn,
    heartbeatIntervalMs: 5_000, clock: () => clockRef.now, leaseDurationMs, stageObserver,
  });
  const arbiter = new MutableArbiter();
  const mountManager = new ProductionMountManager({ productionRuntime: runtime, runtimeArbiter: arbiter, document, hostParent: document.body, ...(shellFactory ? { shellFactory } : {}) });
  const launcher = new ProductionLauncherOwner({ productionRuntime: runtime, runtimeArbiter: arbiter, mountManager, document, hostParent: document.body });
  return { registry, seeded, document, context, eventSource, timers, globalObject, rawDatabases, runtimeScope, runtime, arbiter, mountManager, launcher, clockRef };
}

async function mountedHarness(options = {}) {
  const h = await createHarness(options);
  await h.mountManager.mount();
  assert.equal(h.launcher.mount(), true);
  return h;
}

async function cleanup(h) {
  try { h.launcher?.dispose(); } catch {}
  try { await h.mountManager?.unmount(); } catch {}
  try { await h.runtime?.dispose(); } catch {}
}

async function openAuthoring(h) {
  const opened = await h.runtime.composition.authoringGate.open(NORMAL_READY);
  assert.equal(opened.opened, true);
  assert.equal(h.runtime.composition.authoringGate.state, 'open');
}

test('normal shutdown follows the authoritative order and leaves no v3 authority/UI resource alive', async () => {
  const h = await mountedHarness();
  const controller = new ProductionShutdownController({ productionRuntime: h.runtime, mountManager: h.mountManager, launcherOwner: h.launcher });
  await openAuthoring(h);
  const before = await writeCommits(h.registry);
  const status = await controller.shutdown({ reason: 'manual-disable' });
  assert.deepEqual(status.order, EXPECTED_SHUTDOWN_ORDER);
  assert.equal(status.quiesced, true);
  assert.equal(status.gateState, 'closed');
  assert.equal(status.listenerRegistered, false);
  assert.equal(status.interceptorDelegateActive, false);
  assert.equal(status.heartbeatRunning, false);
  assert.equal(status.phoneMounted, false);
  assert.equal(status.launcherMounted, false);
  assert.equal(status.databaseOpen, false);
  assert.equal(status.ownsLease, false);
  assert.equal(countId(h.document.body, V3_ROOT_ID), 0);
  assert.equal(countId(h.document.body, V3_LAUNCHER_ID), 0);
  assert.equal(await leaseRecord(h.registry), undefined);
  assert.equal(await writeCommits(h.registry), before + 1); // exact lease release only; no canonical truth rollback
});

test('shutdown is idempotent and repeated calls do not double-release or recreate resources', async () => {
  const h = await mountedHarness();
  const controller = new ProductionShutdownController({ productionRuntime: h.runtime, mountManager: h.mountManager, launcherOwner: h.launcher });
  const first = await controller.shutdown();
  const writesAfterFirst = await writeCommits(h.registry);
  const second = await controller.shutdown();
  assert.deepEqual(second.order, first.order);
  assert.equal(second.quiesced, true);
  assert.equal(await writeCommits(h.registry), writesAfterFirst);
  assert.equal(countId(h.document.body, V3_ROOT_ID), 0);
  assert.equal(countId(h.document.body, V3_LAUNCHER_ID), 0);
});

test('gate closes and new fenced writes are denied while shutdown waits for an admitted canonical transaction boundary', async () => {
  const h = await mountedHarness();
  const controller = new ProductionShutdownController({ productionRuntime: h.runtime, mountManager: h.mountManager, launcherOwner: h.launcher });
  await openAuthoring(h);
  let enteredResolve; const entered = new Promise(resolve => { enteredResolve = resolve; });
  let releaseResolve; const release = new Promise(resolve => { releaseResolve = resolve; });
  const tx = h.runtime.composition.normalDatabase.transaction(['metadata'], 'readwrite', async txView => {
    enteredResolve(); await release; return txView.store('metadata').get(V3_RUNTIME_LEASE_KEY);
  });
  await entered;
  assert.equal(h.runtime.composition.normalDatabase.activeReadwriteTransactions, 1);
  const shuttingDown = controller.shutdown({ reason: 'quiescence-test' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.runtime.composition.authoringGate.state, 'closed');
  assert.equal(h.launcher.status.blocked, true);
  assert.equal(h.mountManager.status.blocked, true);
  assert.equal(controller.status.runtimeDisposed, false);
  await assert.rejects(() => h.runtime.composition.normalDatabase.transaction(['metadata'], 'readwrite', async () => {}), /Authoring capability normal is not permitted/);
  releaseResolve(); await tx;
  const status = await shuttingDown;
  assert.equal(status.quiesced, true);
  assert.equal(h.runtime.composition.normalDatabase.activeReadwriteTransactions, 0);
});

test('partial Phone startup failure remains fail-closed and later S10 cleanup removes all acquired runtime resources', async () => {
  const badShell = () => ({ root: null, async mount() { throw new Error('injected-shell-mount-failure'); }, dispose() {} });
  const h = await createHarness({ shellFactory: badShell });
  await assert.rejects(() => h.mountManager.mount(), /injected-shell-mount-failure/);
  assert.equal(h.runtime.composition.authoringGate.state, 'closed');
  assert.equal(countId(h.document.body, V3_ROOT_ID), 0);
  const controller = new ProductionShutdownController({ productionRuntime: h.runtime, mountManager: h.mountManager, launcherOwner: h.launcher });
  const status = await controller.shutdown({ reason: 'partial-mount-failure' });
  assert.equal(status.quiesced, true);
  assert.equal(h.eventSource.count(EVENT_TYPES.CHAT_CHANGED), 0);
});

test('partial composition startup failures at heartbeat and generation-owner boundaries reverse-unwind lease/DB/hooks', async () => {
  for (const failureStage of ['heartbeat-started', 'generation-interceptor-owner']) {
    const { registry } = await prepareRegistry();
    const document = new FakeDocument(); document.body = new FakeNode('body'); document.visibilityState = 'visible';
    const eventSource = new FakeEventSource(); const timers = fakeTimers(); const rawDatabases = [];
    await assert.rejects(() => createTmrwV3ProductionRuntime({
      ownerId: `s10-fail-${failureStage}`, runtimeScope: {}, databaseFactory: () => { const db = new MemoryV3Database({ registry }); rawDatabases.push(db); return db; },
      previewControl: previewControl(), startupEvidence: { requested: true, cleanReloadProven: true, exclusionProof: { previewExcluded: true }, gateFReport: { status: 'pass' } },
      getContext: () => ({ chatId: 'x', chat: [], characterCardSourceId: 's10-card', storySourceId: 's10-story', routeSourceId: 's10-branch' }), Generate: async () => {},
      eventSource, sillyTavernEventTypes: EVENT_TYPES, sourceIdentityResolver: async () => ({ characterCardSourceId: 's10-card', storySourceId: 's10-story', routeSourceId: 's10-branch' }), messageIdentityResolver: async () => null,
      globalObject: passiveGlobal(document), setIntervalFn: timers.setIntervalFn, clearIntervalFn: timers.clearIntervalFn, clock: () => 1_000,
      stageObserver: stage => { if (stage === failureStage) throw new Error(`injected-${failureStage}`); },
    }), new RegExp(`injected-${failureStage}`));
    assert.equal(await leaseRecord(registry), undefined);
    assert.equal(rawDatabases.at(-1)?.isOpen, false);
    assert.equal(eventSource.count(EVENT_TYPES.CHAT_CHANGED), 0);
    assert.equal(timers.timers.size, 0);
  }
});

test('heartbeat/resume lease loss closes authoring immediately and stale shutdown cannot release a newer generation', async () => {
  const clockRef = { now: 1_000 };
  const h = await mountedHarness({ clockRef, leaseDurationMs: 100 });
  await openAuthoring(h);
  const oldLease = await leaseRecord(h.registry);
  clockRef.now = 2_000;
  const foreignDb = new MemoryV3Database({ registry: h.registry }); await foreignDb.open();
  const foreign = new V3RuntimeGuard({ database: foreignDb, ownerId: 's10-new-owner', clock: () => clockRef.now, leaseDurationMs: 100 });
  const acquired = await foreign.acquire(); assert.equal(acquired.acquired, true); assert.notEqual(acquired.leaseId, oldLease.leaseId);
  const resumed = await h.runtime.composition.heartbeat.validateOnResume('s10-takeover');
  assert.equal(resumed.valid, false);
  assert.equal(h.runtime.composition.authoringGate.state, 'closed');
  assert.equal(h.runtime.composition.heartbeat.status.running, false);
  const controller = new ProductionShutdownController({ productionRuntime: h.runtime, mountManager: h.mountManager, launcherOwner: h.launcher });
  const status = await controller.handleAuthorityLoss('heartbeat-lease-lost');
  assert.equal(status.quiesced, true);
  const surviving = await leaseRecord(h.registry);
  assert.equal(surviving.ownerId, 's10-new-owner');
  assert.equal(surviving.leaseId, acquired.leaseId);
  await foreign.release(); foreignDb.close();
});

function officialPreviewHarness({ failEnable = false, runtime }) {
  const name = 'third-party/TMRW-Phone-Preview';
  const state = { name, enabled: false };
  const settings = { disabledExtensions: [name] };
  const events = [];
  const extensionControl = new SillyTavernExtensionControl({
    findExtension: () => ({ ...state }),
    disableExtension: async () => { throw new Error('disable must not be called during return-to-Preview'); },
    enableExtension: async (extensionName, reload) => {
      events.push(`official-enable:${extensionName}:${reload}`);
      assert.equal(runtime.status.disposed, true);
      if (failEnable) throw new Error('injected-preview-restore-failure');
      state.enabled = true;
      settings.disabledExtensions = settings.disabledExtensions.filter(row => row !== extensionName);
    },
    extensionSettings: settings,
  });
  const featureFlag = new V3BetaFeatureFlag({ storage: new MemoryKeyValueStorage(), now: () => '2026-08-29T00:00:00.000Z' });
  featureFlag.requestEnable();
  const arbiter = new ProductionRuntimeArbiter({
    featureFlag,
    extensionControl,
    productionHealth: { preflight: async () => ({ ready: true, blockers: [] }) },
    quiesceV3: async () => { events.push('arbiter-quiesce'); },
  });
  return { arbiter, extensionControl, featureFlag, state, settings, events };
}

test('return to Preview enables Preview only after v3 gate/hooks/UI/heartbeat/lease/DB are fully quiesced', async () => {
  const h = await mountedHarness();
  await openAuthoring(h);
  const official = officialPreviewHarness({ runtime: h.runtime });
  const controller = new ProductionShutdownController({ productionRuntime: h.runtime, mountManager: h.mountManager, launcherOwner: h.launcher, runtimeArbiter: official.arbiter });
  const result = await controller.returnToPreview37();
  assert.equal(result.restored, true);
  assert.equal(result.shutdown.quiesced, true);
  assert.equal(official.state.enabled, true);
  assert.deepEqual(official.settings.disabledExtensions, []);
  assert.match(result.arbiter.state, /RELOAD_REQUIRED_FOR_PREVIEW|PREVIEW_DEFAULT/);
  assert.equal(official.featureFlag.read().requested, false);
  assert.equal(official.events.at(-1).startsWith('official-enable:'), true);
  assert.equal(countId(h.document.body, V3_ROOT_ID), 0);
  assert.equal(countId(h.document.body, V3_LAUNCHER_ID), 0);
});

test('official Preview restoration failure stays FAILED_SAFE and never reopens v3 authoring', async () => {
  const h = await mountedHarness();
  await openAuthoring(h);
  const official = officialPreviewHarness({ runtime: h.runtime, failEnable: true });
  const controller = new ProductionShutdownController({ productionRuntime: h.runtime, mountManager: h.mountManager, launcherOwner: h.launcher, runtimeArbiter: official.arbiter });
  const result = await controller.returnToPreview37();
  assert.equal(result.restored, false);
  assert.equal(result.failedSafe, true);
  assert.equal(result.arbiter.state, PRODUCTION_RUNTIME_STATE.FAILED_SAFE);
  assert.equal(h.runtime.composition.authoringGate.state, 'closed');
  assert.equal(h.runtime.status.disposed, true);
  assert.equal(official.featureFlag.read().requested, false);
});

test('shell disposal errors are contained fail-safe; root/launcher/lease/DB are still removed', async () => {
  let disposeCalls = 0;
  const throwingShell = options => {
    const hostShell = { root: null, async mount(target) { const root=options.document.createElement('section'); target.append(root); this.root=root; return root; }, dispose() { disposeCalls += 1; throw new Error('injected-shell-dispose-failure'); } };
    return hostShell;
  };
  const h = await mountedHarness({ shellFactory: throwingShell });
  const controller = new ProductionShutdownController({ productionRuntime: h.runtime, mountManager: h.mountManager, launcherOwner: h.launcher });
  const status = await controller.shutdown();
  assert.equal(disposeCalls >= 1, true);
  assert.equal(status.quiesced, true);
  assert.equal(status.errors.some(row => row.includes('injected-shell-dispose-failure')), true);
  assert.equal(countId(h.document.body, V3_ROOT_ID), 0);
  assert.equal(countId(h.document.body, V3_LAUNCHER_ID), 0);
  assert.equal(await leaseRecord(h.registry), undefined);
});

test('shutdown performs no canonical application writes, preserves Text Call architecture, and never invokes Voice runtime/provider/model paths', async () => {
  const h = await mountedHarness();
  const before = await writeCommits(h.registry);
  assert.equal(h.runtime.voiceCapability.runtimeAvailable, false);
  assert.ok(h.runtime.services.calls);
  assert.ok(h.runtime.services.callCoordinator);
  assert.ok(h.runtime.services.callStoryIntegration);
  const controller = new ProductionShutdownController({ productionRuntime: h.runtime, mountManager: h.mountManager, launcherOwner: h.launcher });
  await controller.shutdown();
  const after = await writeCommits(h.registry);
  assert.equal(after, before + 1); // lease release only
  assert.equal(h.runtime.voiceCapability.runtimeAvailable, false);
});

test('S10 source is shutdown-only: no raw DB escape, direct Preview settings mutation, Voice implementation, S11 verifier, or installed deployment', async () => {
  const files = ['../../production/shutdown-controller.mjs', '../../production/fenced-database.mjs', '../../production/mount-manager.mjs', '../../production/launcher-owner.mjs'];
  const text = (await Promise.all(files.map(file => fs.readFile(new URL(file, import.meta.url), 'utf8')))).join('\n');
  assert.doesNotMatch(text, /disabledExtensions\s*=|extension_settings\s*\./);
  assert.doesNotMatch(text, /voice.*provider|model-loader|PC Runtime|Mobile Optimization/i);
  assert.doesNotMatch(text, /new\s+V3Database\s*\(/);
  assert.doesNotMatch(text, /S11|isolated verifier|installed deployment/i);
});
