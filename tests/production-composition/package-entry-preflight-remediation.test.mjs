import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { MemoryKeyValueStorage } from '../../beta/feature-flag.mjs';
import { V3_BETA_SETTINGS_KEY } from '../../storage/schema.mjs';
import { PRODUCTION_RUNTIME_STATE } from '../../production/runtime-arbiter.mjs';
import { preview37Project } from '../phase12/preview37-fixtures.mjs';

const PREVIEW_NAME = 'third-party/TMRW-Phone-Preview';
const v3Root = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, value => value.slice(1)));
const entryUrl = pathToFileURL(path.join(v3Root, 'production', 'entry.mjs')).href;

function officialPreviewApi({ enabled = true } = {}) {
  const extensionSettings = { disabledExtensions: enabled ? [] : [PREVIEW_NAME] };
  const calls = [];
  const isDisabled = () => extensionSettings.disabledExtensions.includes(PREVIEW_NAME);
  return {
    extensionSettings,
    calls,
    findExtension(query) {
      calls.push(['find', query]);
      return { name: PREVIEW_NAME, enabled: !isDisabled() };
    },
    async disableExtension(name, reload) {
      calls.push(['disable', name, reload]);
      if (!extensionSettings.disabledExtensions.includes(name)) extensionSettings.disabledExtensions.push(name);
    },
    async enableExtension(name, reload) {
      calls.push(['enable', name, reload]);
      extensionSettings.disabledExtensions = extensionSettings.disabledExtensions.filter(value => value !== name);
    },
  };
}

function previewReadSource(record = preview37Project({ castSize: 2, suffix: 's12-remediation', includeGroup: true, includeCall: true })) {
  return async () => ({
    available: true,
    sourceVersion: record.schemaVersion,
    sourceLocation: 's12-remediation-fixture',
    record: structuredClone(record),
  });
}

async function withShimRestored(work) {
  const previous = globalThis.tmrwV3GenerateInterceptor;
  try {
    delete globalThis.tmrwV3GenerateInterceptor;
    return await work();
  } finally {
    if (previous === undefined) delete globalThis.tmrwV3GenerateInterceptor;
    else globalThis.tmrwV3GenerateInterceptor = previous;
  }
}

async function loadEntry(label) {
  return import(`${entryUrl}?s12-prereq=${label}-${Date.now()}-${Math.random()}`);
}

test('remediated package entry remains strictly passive on ordinary module load', async () => withShimRestored(async () => {
  let indexedDbOpens = 0;
  const previousIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = { open() { indexedDbOpens += 1; throw new Error('default load must never open production IndexedDB'); } };
  try {
    const entry = await loadEntry('passive-default');
    const status = entry.getProductionEntryStatus();
    assert.equal(status.phase, 's12-prereq-remediated-passive-package');
    assert.equal(status.passive, true);
    assert.equal(status.preflightConfigured, false);
    assert.equal(status.databaseOpen, false);
    assert.equal(status.leaseAcquired, false);
    assert.equal(status.authoringGateOpen, false);
    assert.equal(status.phoneRootMounted, false);
    assert.equal(status.launcherMounted, false);
    assert.equal(status.canonicalWrites, 0);
    assert.equal(status.voiceRuntimeAvailable, false);
    assert.equal(status.voiceProviderModelCalls, 0);
    assert.equal(indexedDbOpens, 0);

    const shim = globalThis.tmrwV3GenerateInterceptor;
    assert.equal(typeof shim, 'function');
    const chat = [{ mes: 'unchanged' }];
    const before = structuredClone(chat);
    let abortCalls = 0;
    assert.equal(await shim(chat, 4096, () => { abortCalls += 1; }, 'normal'), undefined);
    assert.deepEqual(chat, before);
    assert.equal(abortCalls, 0);
    assert.equal(shim?.[Symbol.for('tmrw.v3.production.generation-interceptor-owner')], undefined);

    const disabled = entry.onDisable();
    assert.equal(disabled.passive, true);
    assert.equal(disabled.preflightConfigured, false);
  } finally {
    if (previousIndexedDb === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previousIndexedDb;
  }
}));

test('explicit package preflight reuses onboarding, Production Health, Runtime Arbiter and official Preview control with zero writes', async () => withShimRestored(async () => {
  const entry = await loadEntry('preflight');
  const api = officialPreviewApi();
  const storage = new MemoryKeyValueStorage();
  const session = await entry.configureProductionPreflight({
    officialExtensionApi: api,
    previewReadSource: previewReadSource(),
    featureFlagStorage: storage,
    now: () => '2026-08-29T03:15:00.000Z',
  });

  assert.equal(session.status.productionDatabaseOpen, false);
  assert.equal(session.status.ephemeralPreflightDatabaseOpen, true);
  assert.equal(session.status.migrationDatabaseCapability, 'transition');
  assert.equal(session.status.leaseAcquired, false);
  assert.equal(session.status.authoringGateOpen, false);
  assert.equal(session.status.transitionGateOpen, false);
  assert.equal(session.status.authoringAuthority, false);

  const result = await entry.runProductionPreflight();
  assert.equal(result.onboarding.optInRequired, true);
  assert.equal(result.onboarding.defaultRuntime, 'preview37');
  assert.equal(result.onboarding.autoMigrationRan, false);
  assert.equal(result.onboarding.authoringEnabled, false);
  assert.ok(result.onboarding.migrationPlan && typeof result.onboarding.migrationPlan === 'object');
  assert.equal(result.onboarding.migrationPlan.fatal, false);
  assert.equal(result.onboarding.gateF, 'unverified');
  assert.equal(result.health.stage, 'preflight');
  assert.equal(result.health.ready, false);
  assert.ok(result.health.blockers.includes('gateFPassed'));
  assert.equal(result.runtime.state, PRODUCTION_RUNTIME_STATE.PREVIEW_DEFAULT);
  assert.equal(result.runtime.requested, false);
  assert.equal(result.runtime.authoringAuthority, false);
  assert.equal(result.migrationMetrics.operation, 'dry-run');
  assert.equal(result.migrationMetrics.previewWrites, 0);
  assert.equal(result.migrationMetrics.canonicalWrites, 0);
  assert.equal(storage.snapshot()[V3_BETA_SETTINGS_KEY], undefined);
  assert.equal(api.calls.some(call => call[0] === 'disable' || call[0] === 'enable'), false);
  assert.ok(api.calls.some(call => call[0] === 'find'));

  const status = entry.getProductionEntryStatus();
  assert.equal(status.databaseOpen, false);
  assert.equal(status.leaseAcquired, false);
  assert.equal(status.authoringGateOpen, false);
  assert.equal(status.phoneRootMounted, false);
  assert.equal(status.launcherMounted, false);
  assert.equal(status.canonicalWrites, 0);
  assert.equal(status.voiceRuntimeAvailable, false);
  assert.equal(status.voiceProviderModelCalls, 0);

  assert.equal(await entry.disposeProductionPreflight(), true);
  assert.equal(await entry.disposeProductionPreflight(), false);
  assert.equal(entry.getProductionEntryStatus().preflightConfigured, false);
}));

test('repeated preflight configuration is singleton/idempotent and disable disposes it exactly once', async () => withShimRestored(async () => {
  const entry = await loadEntry('duplicate');
  const api = officialPreviewApi();
  const options = { officialExtensionApi: api, previewReadSource: previewReadSource(), featureFlagStorage: new MemoryKeyValueStorage() };
  const first = await entry.configureProductionPreflight(options);
  const second = await entry.configureProductionPreflight(options);
  assert.equal(second, first);
  assert.equal(entry.getProductionEntryStatus().preflightConfigured, true);
  const disabled = await entry.onDisable();
  assert.equal(disabled.passive, true);
  assert.equal(disabled.preflightConfigured, false);
  const repeated = entry.onDisable();
  assert.equal(repeated.preflightConfigured, false);
}));

test('pre-seeded requested intent remains non-authoring and incomplete Preview exclusion is blocked read-only', async () => withShimRestored(async () => {
  const entry = await loadEntry('blocked-exclusion');
  const storage = new MemoryKeyValueStorage();
  storage.setItem(V3_BETA_SETTINGS_KEY, JSON.stringify({ requested: true, authoringEnabled: true }));
  await entry.configureProductionPreflight({
    officialExtensionApi: officialPreviewApi(),
    previewReadSource: previewReadSource(),
    featureFlagStorage: storage,
  });
  const selected = await entry.checkProductionPostReloadSelection({
    exclusionProof: { launcherAbsent: true, rootAbsent: true, runtimeGlobalAbsent: false },
  });
  assert.equal(selected.state, PRODUCTION_RUNTIME_STATE.V3_BLOCKED_READONLY);
  assert.equal(selected.activationRequired, false);
  assert.equal(selected.authoringAuthority, false);
  assert.equal(entry.getProductionEntryStatus().authoringGateOpen, false);
  assert.equal(entry.getProductionEntryStatus().databaseOpen, false);
  await entry.disposeProductionPreflight();
}));

test('preflight surface exposes no normal-authoring, raw DB, composition-root, listener, mount or launcher handle', async () => withShimRestored(async () => {
  const entry = await loadEntry('surface');
  const session = await entry.configureProductionPreflight({
    officialExtensionApi: officialPreviewApi(),
    previewReadSource: previewReadSource(),
    featureFlagStorage: new MemoryKeyValueStorage(),
  });
  assert.deepEqual(Object.keys(session), []);
  assert.equal(typeof session.openAuthoring, 'undefined');
  assert.equal(typeof session.acquireLease, 'undefined');
  assert.equal(typeof session.mount, 'undefined');
  assert.equal(typeof session.launcher, 'undefined');
  assert.equal(typeof session.database, 'undefined');
  assert.equal(typeof session.rawDatabase, 'undefined');
  assert.equal(typeof session.listenerOwner, 'undefined');
  assert.equal(typeof session.generationInterceptorOwner, 'undefined');
  assert.equal(session.status.migrationDatabaseCapability, 'transition');
  assert.equal(session.status.authoringGateOpen, false);
  assert.equal(session.status.transitionGateOpen, false);
  await entry.disposeProductionPreflight();
}));
