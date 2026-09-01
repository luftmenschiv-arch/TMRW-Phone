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

function officialPreviewApi({ restoreFails = false } = {}) {
  const name = 'third-party/TMRW-Phone-Preview';
  const extensionSettings = { disabledExtensions: [name] };
  let enabled = false;
  let enableCalls = 0;
  let disableCalls = 0;
  return {
    extensionSettings,
    findExtension() { return { name, enabled }; },
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

async function harness({ suffix = `case-${Math.random().toString(36).slice(2)}`, restoreFails = false, appendFailureId = null, previewReadSource = null, previewSource = null, stageObserver = null, sourceIdentityResolver = undefined, runtimeFactory = undefined, preseedProductionScope = true, registry = MemoryV3Database.createRegistry() } = {}) {
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
  const api = officialPreviewApi({ restoreFails });
  const featureFlagStorage = new MemoryKeyValueStorage();
  new V3BetaFeatureFlag({ storage: featureFlagStorage, now: () => '2026-08-29T00:00:00.000Z' }).requestEnable();
  const readSource = previewReadSource || (async () => ({ available: true, sourceVersion: source.schemaVersion, sourceLocation: `s13-${suffix}`, record: structuredClone(source) }));
  const options = {
    ownerId: `s13-owner-${suffix}`,
    officialExtensionApi: api,
    previewReadSource: readSource,
    featureFlagStorage,
    getContext: () => ({ name1: 'Player', chatId: `chat-${suffix}`, chat: [] }),
    Generate: async () => {},
    eventSource,
    sillyTavernEventTypes: EVENT_TYPES,
    document,
    globalObject,
    eventTarget: null,
    databaseFactory: () => { const db = new MemoryV3Database({ registry }); rawDatabases.push(db); return db; },
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
    heartbeatIntervalMs: 10_000,
    now: () => '2026-08-29T00:00:00.000Z',
    stageObserver,
  };
  if (sourceIdentityResolver !== undefined) options.sourceIdentityResolver = sourceIdentityResolver;
  if (runtimeFactory !== undefined) options.runtimeFactory = runtimeFactory;
  const session = new ProductionActiveStartupSession(options);
  return { session, api, featureFlagStorage, registry, rawDatabases, document, body, timers, source, options, eventSource };
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

test('S15 active startup routes CHAT_CHANGED once through mount-manager scope replacement and leaves authoring closed for revalidation', async () => {
  const suffix = 's15-scope';
  let currentSource = Object.freeze({ characterCardSourceId: `card-${suffix}`, storySourceId: `story-${suffix}`, routeSourceId: `branch-${suffix}` });
  const h = await harness({ suffix, preseedProductionScope: false, sourceIdentityResolver: async () => currentSource });
  const started = await h.session.start({ exclusionProof, gateFReport });
  assert.equal(started.runtimeState, 'V3_AUTHORING');
  const oldRoot = nodesById(h.body, V3_ROOT_ID)[0];
  const initialStoryId = h.session.mountManager.status.storyId;
  const next = await h.session.runtime.composition.identityKernel.seedIdentityGraph({
    ...identitySeed({ manifestId: 's15-scope-next', cardSourceId: `card-${suffix}-next`, storySourceId: `story-${suffix}-next`, routeSourceId: `branch-${suffix}-next`, castSize: 2 }),
    sourceAuthority: 'sillytavern',
  });
  await h.session.runtime.services.phones.initializeScope({ storyId: next.storyId, branchId: next.branchId });
  currentSource = Object.freeze({ characterCardSourceId: `card-${suffix}-next`, storySourceId: `story-${suffix}-next`, routeSourceId: `branch-${suffix}-next` });
  await h.eventSource.emit(EVENT_TYPES.CHAT_CHANGED, 's15-next-chat');
  const nextRoot = nodesById(h.body, V3_ROOT_ID)[0];
  assert.notEqual(nextRoot, oldRoot);
  assert.equal(oldRoot.parentNode, null);
  assert.notEqual(h.session.mountManager.status.storyId, initialStoryId);
  const transitionDiagnostics = JSON.stringify({ listener: h.session.runtime.composition.listenerOwner.status, mount: h.session.mountManager.status, currentSource, next });
  assert.equal(h.session.mountManager.status.storyId, next.storyId, transitionDiagnostics);
  assert.equal(h.session.mountManager.status.branchId, next.branchId, transitionDiagnostics);
  assert.equal(h.session.mountManager.status.transitionCount, 1);
  assert.equal(h.session.mountManager.status.requiresAuthoringRevalidation, true);
  assert.equal(h.session.runtime.status.gateState, 'closed');
  assert.equal(nodesById(h.body, V3_ROOT_ID).length, 1);
  assert.equal(nodesById(h.body, V3_LAUNCHER_ID).length, 1);
  assert.equal(h.session.runtime.composition.listenerOwner.status.registered, true);
  await h.session.returnToPreview37();
});
