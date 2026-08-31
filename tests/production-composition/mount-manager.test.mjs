import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { ProductionMountManager } from '../../production/mount-manager.mjs';
import { ProductionLauncherOwner } from '../../production/launcher-owner.mjs';
import { createTmrwV3ProductionRuntime } from '../../production/composition-root.mjs';
import { PRODUCTION_RUNTIME_STATE } from '../../production/runtime-arbiter.mjs';
import { V3_GENERATION_INTERCEPTOR_KEY, V3_LAUNCHER_ID, V3_PRODUCTION_RUNTIME_ID, V3_ROOT_ID } from '../../production/constants.mjs';
import { MemoryV3Database } from '../../storage/memory-v3-database.mjs';
import { V3IdentityKernel } from '../../domain/identity/identity-kernel.mjs';
import { setupPhase17 } from '../phase17/notification-fixtures.mjs';
import { identitySeed } from '../phase2/identity-fixtures.mjs';
import { FakeDocument, FakeNode } from '../phase7/fake-dom.mjs';

const PASSIVE_SHIM_MARKER = Symbol.for('tmrw.v3.production.passive-generation-interceptor');

class FakeEventSource {
  listeners = new Map();
  on(type, handler) { const rows = this.listeners.get(type) || []; rows.push(handler); this.listeners.set(type, rows); }
  removeListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(row => row !== handler)); }
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

class MutableArbiter {
  constructor(state = PRODUCTION_RUNTIME_STATE.V3_STARTING) { this.state = state; }
  inspect() { return Object.freeze({ state: this.state, requested: true, requestedIntentOnly: true, authoringAuthority: false }); }
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

function nodeId(node) {
  return node?.id || node?.attributes?.get?.('id') || null;
}

function allNodes(root) {
  const rows = [];
  const walk = node => { if (!node) return; rows.push(node); for (const child of node.children || []) walk(child); };
  walk(root);
  return rows;
}

function nodesById(root, id) {
  return allNodes(root).filter(node => nodeId(node) === id);
}

async function writes(registry) {
  const db = new MemoryV3Database({ registry });
  await db.open();
  const count = db.diagnostics.writeCommits;
  db.close();
  return count;
}

function productionSeed({ castSize, manifestId, storySourceId, routeSourceId }) {
  return Object.freeze({
    ...identitySeed({ castSize, manifestId, cardSourceId: 's09-card', storySourceId, routeSourceId }),
    sourceAuthority: 'sillytavern',
  });
}

async function prepareCanonicalRegistry({ castSize = 2 } = {}) {
  const registry = MemoryV3Database.createRegistry();
  const bootstrap = await setupPhase17({ registry, castSize: 1, manifestId: `s09-bootstrap-${castSize}` });
  const kernel = new V3IdentityKernel({ database: bootstrap.database, now: () => '2026-08-29T00:00:00.000Z' });

  const main = await kernel.seedIdentityGraph(productionSeed({ castSize, manifestId: `s09-main-${castSize}`, storySourceId: 's09-story-a', routeSourceId: 's09-branch-a' }));
  await bootstrap.phones.initializeScope({ storyId: main.storyId, branchId: main.branchId });

  const branch = await kernel.seedIdentityGraph(productionSeed({ castSize, manifestId: `s09-branch-${castSize}`, storySourceId: 's09-story-a', routeSourceId: 's09-branch-b' }));
  await bootstrap.phones.initializeScope({ storyId: branch.storyId, branchId: branch.branchId });

  const story = await kernel.seedIdentityGraph(productionSeed({ castSize, manifestId: `s09-story-${castSize}`, storySourceId: 's09-story-b', routeSourceId: 's09-branch-c' }));
  await bootstrap.phones.initializeScope({ storyId: story.storyId, branchId: story.branchId });

  bootstrap.database.close();
  return { registry, main, branch, story };
}

async function createHarness({ castSize = 2, state = PRODUCTION_RUNTIME_STATE.V3_STARTING, shellFactory = undefined } = {}) {
  const seeded = await prepareCanonicalRegistry({ castSize });
  const document = new FakeDocument();
  document.body = new FakeNode('body');
  document.visibilityState = 'visible';
  const context = { chatId: 's09-chat', chat: [], characterCardSourceId: 's09-card', storySourceId: 's09-story-a', routeSourceId: 's09-branch-a' };
  const eventSource = new FakeEventSource();
  const timers = fakeTimers();
  const globalObject = passiveGlobal(document);
  const rawDatabases = [];
  const runtimeScope = {};
  const runtime = await createTmrwV3ProductionRuntime({
    ownerId: `s09-owner-${castSize}-${Math.random()}`,
    runtimeScope,
    databaseFactory: () => { const db = new MemoryV3Database({ registry: seeded.registry }); rawDatabases.push(db); return db; },
    previewControl: previewControl(),
    startupEvidence: { requested: true, cleanReloadProven: true, exclusionProof: { previewExcluded: true }, gateFReport: { status: 'pass' } },
    getContext: () => context,
    Generate: async () => {},
    eventSource,
    sillyTavernEventTypes: EVENT_TYPES,
    sourceIdentityResolver: async current => ({ characterCardSourceId: current.characterCardSourceId, storySourceId: current.storySourceId, routeSourceId: current.routeSourceId }),
    messageIdentityResolver: async () => null,
    globalObject,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
    heartbeatIntervalMs: 5_000,
  });
  const arbiter = new MutableArbiter(state);
  const mountManager = new ProductionMountManager({ productionRuntime: runtime, runtimeArbiter: arbiter, document, hostParent: document.body, ...(shellFactory ? { shellFactory } : {}) });
  const launcher = new ProductionLauncherOwner({ productionRuntime: runtime, runtimeArbiter: arbiter, mountManager, document, hostParent: document.body });
  return { ...seeded, document, context, eventSource, timers, rawDatabases, runtimeScope, runtime, arbiter, mountManager, launcher };
}

async function cleanup(h) {
  try { h.launcher?.dispose(); } catch {}
  try { await h.mountManager?.unmount(); } catch {}
  try { await h.runtime?.dispose(); } catch {}
}

test('real S08 graph mounts one frozen TmrwPhoneShell root and one launcher without opening authoring', async () => {
  const h = await createHarness({ castSize: 2 });
  try {
    const before = await writes(h.registry);
    const mounted = await h.mountManager.mount();
    assert.equal(mounted.healthy, true);
    assert.equal(nodesById(h.document.body, V3_ROOT_ID).length, 1);
    assert.equal(h.runtime.status.gateState, 'closed');
    assert.equal(h.launcher.mount(), true);
    assert.equal(nodesById(h.document.body, V3_LAUNCHER_ID).length, 1);
    assert.equal(h.mountManager.status.visible, false);
    assert.equal(h.launcher.open(), true);
    assert.equal(h.mountManager.status.visible, true);
    assert.equal(h.runtime.status.gateState, 'closed');
    assert.equal(await writes(h.registry), before);
  } finally { await cleanup(h); }
});

test('repeated mount activation is duplicate-safe and a second mount owner cannot create another root', async () => {
  const h = await createHarness();
  try {
    await h.mountManager.mount();
    await h.mountManager.mount();
    assert.equal(h.mountManager.status.mountCount, 1);
    const second = new ProductionMountManager({ productionRuntime: h.runtime, runtimeArbiter: h.arbiter, document: h.document, hostParent: h.document.body });
    await assert.rejects(() => second.mount(), /another owner|already exists/);
    assert.equal(nodesById(h.document.body, V3_ROOT_ID).length, 1);
  } finally { await cleanup(h); }
});

test('launcher ownership is exactly one, repeated exposure is duplicate-safe, and teardown is idempotent', async () => {
  const h = await createHarness();
  try {
    await h.mountManager.mount();
    const second = new ProductionLauncherOwner({ productionRuntime: h.runtime, runtimeArbiter: h.arbiter, mountManager: h.mountManager, document: h.document, hostParent: h.document.body });
    assert.equal(h.launcher.mount(), true);
    assert.equal(h.launcher.mount(), false);
    assert.equal(second.mount(), false);
    assert.equal(nodesById(h.document.body, V3_LAUNCHER_ID).length, 1);
    assert.equal(h.launcher.dispose(), true);
    assert.equal(h.launcher.dispose(), false);
    assert.equal(nodesById(h.document.body, V3_LAUNCHER_ID).length, 0);
  } finally { await cleanup(h); }
});

test('My Phone and Their Phones remain dynamic for cast sizes 1, 2, and 12 through the real production shell', async () => {
  for (const castSize of [1, 2, 12]) {
    const h = await createHarness({ castSize });
    try {
      await h.mountManager.mount();
      const shell = nodesById(h.document.body, V3_ROOT_ID)[0].children[0];
      const switcher = shell.children[1];
      const identity = await h.runtime.resolveCurrentIdentity();
      const roster = await h.runtime.services.viewModels.deviceRoster(identity.scope);
      assert.equal(switcher.children.length, castSize + 1);
      assert.equal(roster.filter(row => row.kind === 'my-phone').length, 1);
      assert.equal(roster.filter(row => row.kind === 'their-phone').length, castSize);
      const myButtons = switcher.children.filter(node => node.dataset.kind === 'my-phone');
      const theirButtons = switcher.children.filter(node => node.dataset.kind === 'their-phone');
      assert.equal(myButtons.length, 1);
      assert.equal(myButtons[0].attributes.get('aria-pressed'), 'true');
      assert.equal(theirButtons.length, castSize);
      assert.equal(theirButtons.every(node => node.attributes.get('aria-pressed') === 'false'), true);
      assert.equal(h.runtime.voiceCapability.runtimeAvailable, false);
    } finally { await cleanup(h); }
  }
});

test('same Story new Branch disposes the old shell/root and mounts one exact replacement with no stale scope UI', async () => {
  const h = await createHarness();
  try {
    await h.mountManager.mount();
    h.launcher.mount();
    const oldHost = nodesById(h.document.body, V3_ROOT_ID)[0];
    const oldBranch = h.mountManager.status.branchId;
    h.context.routeSourceId = 's09-branch-b';
    await h.mountManager.transitionScope();
    const nextHost = nodesById(h.document.body, V3_ROOT_ID)[0];
    assert.notEqual(nextHost, oldHost);
    assert.equal(oldHost.parentNode, null);
    assert.equal(h.mountManager.status.storyId, h.main.storyId);
    assert.notEqual(h.mountManager.status.branchId, oldBranch);
    assert.equal(h.mountManager.status.branchId, h.branch.branchId);
    assert.equal(nodesById(h.document.body, V3_ROOT_ID).length, 1);
    assert.equal(nodesById(h.document.body, V3_LAUNCHER_ID).length, 1);
    assert.equal(h.runtime.status.gateState, 'closed');
    assert.equal(h.mountManager.status.requiresAuthoringRevalidation, true);
  } finally { await cleanup(h); }
});

test('same card new Story replaces the old production shell without carrying old Story ownership', async () => {
  const h = await createHarness();
  try {
    await h.mountManager.mount();
    const oldHost = nodesById(h.document.body, V3_ROOT_ID)[0];
    h.context.storySourceId = 's09-story-b';
    h.context.routeSourceId = 's09-branch-c';
    await h.mountManager.transitionScope();
    assert.equal(oldHost.parentNode, null);
    assert.equal(h.mountManager.status.storyId, h.story.storyId);
    assert.equal(h.mountManager.status.branchId, h.story.branchId);
    assert.equal(nodesById(h.document.body, V3_ROOT_ID).length, 1);
  } finally { await cleanup(h); }
});

test('repeated Story/Branch switching never accumulates roots, launchers, listeners, or composition graphs', async () => {
  const h = await createHarness();
  try {
    const sameRuntime = h.runtime;
    await h.mountManager.mount();
    h.launcher.mount();
    for (const [storySourceId, routeSourceId] of [['s09-story-a','s09-branch-b'], ['s09-story-b','s09-branch-c'], ['s09-story-a','s09-branch-a']]) {
      h.context.storySourceId = storySourceId;
      h.context.routeSourceId = routeSourceId;
      await h.mountManager.transitionScope();
      h.launcher.reconcile();
      assert.equal(nodesById(h.document.body, V3_ROOT_ID).length, 1);
      assert.equal(nodesById(h.document.body, V3_LAUNCHER_ID).length, 1);
      assert.equal(h.runtime, sameRuntime);
    }
    assert.equal(h.mountManager.status.mountCount, 4);
    assert.equal(h.mountManager.status.transitionCount, 3);
    assert.equal(h.runtime.composition.listenerOwner.status.registered, true);
    assert.equal(h.runtime.composition.generationOwner.status.delegateActive, true);
  } finally { await cleanup(h); }
});

test('unresolved production scope fails closed, disposes old UI, and launcher reconciles away', async () => {
  const h = await createHarness();
  try {
    await h.mountManager.mount();
    h.launcher.mount();
    const oldHost = nodesById(h.document.body, V3_ROOT_ID)[0];
    h.context.storySourceId = 'missing-story';
    await assert.rejects(() => h.mountManager.transitionScope(), /missing Story mapping|unresolved/i);
    assert.equal(oldHost.parentNode, null);
    assert.equal(h.mountManager.status.mounted, false);
    assert.equal(h.mountManager.status.healthy, false);
    h.launcher.reconcile();
    assert.equal(nodesById(h.document.body, V3_ROOT_ID).length, 0);
    assert.equal(nodesById(h.document.body, V3_LAUNCHER_ID).length, 0);
    assert.equal(h.runtime.status.gateState, 'closed');
  } finally { await cleanup(h); }
});

test('partial shell mount failure removes the host, releases ownership, and leaves the Authoring Gate closed', async () => {
  let documentRef;
  const failingFactory = () => {
    let root = null;
    return {
      get root() { return root; },
      async mount(host) { root = documentRef.createElement('section'); host.append(root); throw new Error('injected-shell-mount-failure'); },
      dispose() { root?.remove(); root = null; },
    };
  };
  const h = await createHarness({ shellFactory: failingFactory });
  documentRef = h.document;
  try {
    await assert.rejects(() => h.mountManager.mount(), /injected-shell-mount-failure/);
    assert.equal(nodesById(h.document.body, V3_ROOT_ID).length, 0);
    assert.equal(h.runtime.status.gateState, 'closed');
    const clean = new ProductionMountManager({ productionRuntime: h.runtime, runtimeArbiter: h.arbiter, document: h.document, hostParent: h.document.body });
    await clean.mount();
    assert.equal(nodesById(h.document.body, V3_ROOT_ID).length, 1);
    await clean.unmount();
  } finally { await cleanup(h); }
});

test('standby/non-owner composition cannot construct a production Phone mount surface', async () => {
  const h = await createHarness();
  let standby;
  try {
    const timers = fakeTimers();
    const document = new FakeDocument(); document.body = new FakeNode('body'); document.visibilityState = 'visible';
    const globalObject = passiveGlobal(document);
    standby = await createTmrwV3ProductionRuntime({
      ownerId: 's09-standby-owner', runtimeScope: {}, databaseFactory: () => new MemoryV3Database({ registry: h.registry }), previewControl: previewControl(),
      startupEvidence: { requested: true, cleanReloadProven: true, exclusionProof: { previewExcluded: true }, gateFReport: { status: 'pass' } },
      getContext: () => h.context, Generate: async () => {}, eventSource: new FakeEventSource(), sillyTavernEventTypes: EVENT_TYPES,
      sourceIdentityResolver: async current => ({ characterCardSourceId: current.characterCardSourceId, storySourceId: current.storySourceId, routeSourceId: current.routeSourceId }),
      messageIdentityResolver: async () => null, globalObject, setIntervalFn: timers.setIntervalFn, clearIntervalFn: timers.clearIntervalFn,
    });
    assert.equal(standby.role, 'standby');
    assert.throws(() => new ProductionMountManager({ productionRuntime: standby, runtimeArbiter: new MutableArbiter(), document, hostParent: document.body }), /owner composition root/);
    assert.equal(nodesById(document.body, V3_ROOT_ID).length, 0);
  } finally { try { await standby?.dispose(); } catch {} await cleanup(h); }
});

test('Preview/default or blocked arbiter state cannot mount or expose a production launcher', async () => {
  const h = await createHarness({ state: PRODUCTION_RUNTIME_STATE.PREVIEW_DEFAULT });
  try {
    await assert.rejects(() => h.mountManager.mount(), /PREVIEW_DEFAULT/);
    assert.equal(h.launcher.mount(), false);
    assert.equal(nodesById(h.document.body, V3_ROOT_ID).length, 0);
    assert.equal(nodesById(h.document.body, V3_LAUNCHER_ID).length, 0);
    h.arbiter.state = PRODUCTION_RUNTIME_STATE.V3_BLOCKED_READONLY;
    await assert.rejects(() => h.mountManager.mount(), /V3_BLOCKED_READONLY/);
  } finally { await cleanup(h); }
});

test('S09 reuses the S08 graph, performs no passive canonical write, exposes Text Calls, and keeps Voice unavailable', async () => {
  const h = await createHarness();
  try {
    const before = await writes(h.registry);
    await h.mountManager.mount();
    const after = await writes(h.registry);
    assert.equal(after, before);
    const shell = nodesById(h.document.body, V3_ROOT_ID)[0].children[0];
    const nav = shell.children[2];
    assert.ok(nav.children.some(node => node.dataset.route === 'calls'));
    assert.equal(h.runtime.voiceCapability.runtimeAvailable, false);
    assert.equal(h.runtime.services.viewModels.voiceCapability.runtimeAvailable, false);
    assert.equal(h.runtime.composition.normalDatabase.capability, 'normal');
    assert.equal('rawDatabase' in h.runtime, false);
    assert.equal('rawDatabase' in h.runtime.composition, false);
  } finally { await cleanup(h); }
});

test('launcher reconciliation removes stale UI after mount teardown and cleanup remains idempotent', async () => {
  const h = await createHarness();
  try {
    await h.mountManager.mount();
    h.launcher.mount();
    await h.mountManager.unmount();
    assert.equal(h.launcher.reconcile(), false);
    assert.equal(nodesById(h.document.body, V3_ROOT_ID).length, 0);
    assert.equal(nodesById(h.document.body, V3_LAUNCHER_ID).length, 0);
    await h.mountManager.unmount();
    h.launcher.dispose();
    h.launcher.dispose();
    assert.equal(h.runtime.status.gateState, 'closed');
  } finally { await cleanup(h); }
});

test('S09 source boundary contains no second graph, raw DB, Voice provider, or Preview mutation', async () => {
  const mountSource = await fs.readFile(new URL('../../production/mount-manager.mjs', import.meta.url), 'utf8');
  const launcherSource = await fs.readFile(new URL('../../production/launcher-owner.mjs', import.meta.url), 'utf8');
  const source = `${mountSource}\n${launcherSource}`;
  assert.doesNotMatch(source, /new\s+V3Database|CanonicalEventEngine|V3IdentityKernel|VoiceProvider|provider\/model|disablePreview37|enablePreview37/);
  assert.match(mountSource, /TmrwPhoneShell/);
  assert.match(mountSource, /resolveCurrentIdentity/);
  assert.match(launcherSource, /ProductionMountManager/);
});
