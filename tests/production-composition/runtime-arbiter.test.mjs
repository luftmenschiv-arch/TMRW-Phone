import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { V3BetaFeatureFlag, MemoryKeyValueStorage } from '../../beta/feature-flag.mjs';
import { SillyTavernExtensionControl } from '../../production/sillytavern-extension-control.mjs';
import { ProductionCompositionHealth } from '../../production/production-health.mjs';
import { ProductionRuntimeArbiter, PRODUCTION_RUNTIME_STATE } from '../../production/runtime-arbiter.mjs';

const PREVIEW_NAME = 'third-party/TMRW-Phone-Preview';

function officialPreviewApi({ enabled = true, installed = true, failDisable = null, failEnable = false, order = null } = {}) {
  const extensionSettings = { disabledExtensions: enabled ? [] : [PREVIEW_NAME] };
  const calls = [];
  const isDisabled = () => extensionSettings.disabledExtensions.includes(PREVIEW_NAME);
  const api = {
    extensionSettings,
    calls,
    findExtension(query) {
      calls.push(['find', query]);
      return installed ? { name: PREVIEW_NAME, enabled: !isDisabled() } : null;
    },
    async disableExtension(name, reload) {
      calls.push(['disable', name, reload]);
      order?.push('disable');
      if (failDisable === 'before') throw new Error('disable failed before persistence');
      if (!extensionSettings.disabledExtensions.includes(name)) extensionSettings.disabledExtensions.push(name);
      if (failDisable === 'after') throw new Error('disable failed after persistence');
    },
    async enableExtension(name, reload) {
      calls.push(['enable', name, reload]);
      order?.push('enable');
      if (failEnable) throw new Error('enable failed');
      extensionSettings.disabledExtensions = extensionSettings.disabledExtensions.filter(value => value !== name);
    },
  };
  return api;
}

function createControl(options = {}) {
  const api = officialPreviewApi(options);
  return {
    api,
    control: new SillyTavernExtensionControl({
      findExtension: api.findExtension,
      disableExtension: api.disableExtension,
      enableExtension: api.enableExtension,
      extensionSettings: api.extensionSettings,
    }),
  };
}

function featureFlag() {
  return new V3BetaFeatureFlag({ storage: new MemoryKeyValueStorage(), now: () => '2026-08-29T00:00:00.000Z' });
}

function validOnboarding(overrides = {}) {
  return {
    optInRequired: true,
    defaultRuntime: 'preview37',
    migrationPlan: { fatal: false, batchId: 'dry-run-only' },
    gateF: 'pass',
    authoringEnabled: false,
    autoMigrationRan: false,
    ...overrides,
  };
}

function createArbiter({ controlOptions = {}, onboarding = null, quiesceV3 = null } = {}) {
  const { api, control } = createControl(controlOptions);
  const flag = featureFlag();
  const health = new ProductionCompositionHealth({ previewControl: control });
  const arbiter = new ProductionRuntimeArbiter({ featureFlag: flag, extensionControl: control, productionHealth: health, onboarding, quiesceV3 });
  return { api, control, flag, health, arbiter };
}

test('official Preview control resolves Preview 37 and delegates disable/enable with mandatory reload', async () => {
  const { api, control } = createControl();
  assert.deepEqual(control.findPreview37(), { name: PREVIEW_NAME, enabled: true });
  assert.equal(control.isPreview37Disabled(), false);
  const disabled = await control.disablePreview37AndReload();
  assert.equal(disabled.reloadRequested, true);
  assert.deepEqual(api.calls.find(call => call[0] === 'disable'), ['disable', PREVIEW_NAME, true]);
  assert.equal(control.isPreview37Disabled(), true);
  assert.equal(control.verifyPreview37Excluded({ launcherAbsent: true, rootAbsent: true, runtimeGlobalAbsent: true }).excluded, true);
  const enabled = await control.enablePreview37AndReload();
  assert.equal(enabled.reloadRequested, true);
  assert.deepEqual(api.calls.find(call => call[0] === 'enable'), ['enable', PREVIEW_NAME, true]);
  assert.equal(control.isPreview37Disabled(), false);
});

test('Preview exclusion fails closed unless persisted disable plus launcher/root/global absence are all proven', async () => {
  const { control } = createControl({ enabled: false });
  for (const proof of [
    {},
    { launcherAbsent: true },
    { launcherAbsent: true, rootAbsent: true },
    { launcherAbsent: true, rootAbsent: true, runtimeGlobalAbsent: false },
  ]) assert.equal(control.verifyPreview37Excluded(proof).excluded, false);
  assert.equal(control.verifyPreview37Excluded({ launcherAbsent: true, rootAbsent: true, runtimeGlobalAbsent: true }).excluded, true);
});

test('retired Preview package counts as excluded only when no legacy runtime footprint is present', () => {
  const { control } = createControl({ installed: false });
  const clean = control.verifyPreview37Excluded({ launcherAbsent: true, rootAbsent: true, runtimeGlobalAbsent: true });
  assert.equal(clean.excluded, true);
  assert.equal(clean.previewInstalled, false);
  assert.equal(clean.previewAbsent, true);
  assert.equal(clean.previewPersistedDisabled, false);
  assert.equal(clean.checks.previewRuntimeExcluded, true);
  assert.equal(control.verifyPreview37Excluded({ launcherAbsent: false, rootAbsent: true, runtimeGlobalAbsent: true }).excluded, false);
});

test('retired Preview package can enter V3_STARTING with retained intent and clean exclusion proof', async () => {
  const { arbiter, flag } = createArbiter({ controlOptions: { installed: false } });
  flag.requestEnable();
  const selected = await arbiter.startSelectedRuntime({ exclusionProof: { launcherAbsent: true, rootAbsent: true, runtimeGlobalAbsent: true } });
  assert.equal(selected.state, PRODUCTION_RUNTIME_STATE.V3_STARTING);
  assert.equal(selected.activationRequired, true);
  assert.equal(selected.preview, null);
  assert.equal(selected.exclusion.previewAbsent, true);
});

test('extension control never mutates disabledExtensions directly when the official disable API fails before persistence', async () => {
  const { api, control } = createControl({ failDisable: 'before' });
  await assert.rejects(() => control.disablePreview37AndReload(), /disable failed/);
  assert.deepEqual(api.extensionSettings.disabledExtensions, []);
});

test('Preview is the default and requested intent is not authoring authority', () => {
  const { arbiter, flag } = createArbiter();
  assert.equal(flag.read().requested, false);
  assert.deepEqual(arbiter.inspect(), {
    state: PRODUCTION_RUNTIME_STATE.PREVIEW_DEFAULT,
    requested: false,
    requestedIntentOnly: true,
    authoringAuthority: false,
    preview: { name: PREVIEW_NAME, enabled: true, disabled: false },
    lastError: null,
  });
});

test('unconfirmed or blocked preflight leaves Preview default and never persists v3 request', async () => {
  const { arbiter, flag, api } = createArbiter();
  const unconfirmed = await arbiter.requestV3({ confirmed: false, onboarding: validOnboarding() });
  assert.equal(unconfirmed.state, PRODUCTION_RUNTIME_STATE.PREVIEW_DEFAULT);
  assert.equal(flag.read().requested, false);
  assert.equal(api.calls.some(call => call[0] === 'disable'), false);

  const blocked = await arbiter.requestV3({ confirmed: true, onboarding: validOnboarding({ gateF: 'blocked' }) });
  assert.equal(blocked.state, PRODUCTION_RUNTIME_STATE.PREVIEW_DEFAULT);
  assert.equal(flag.read().requested, false);
  assert.equal(api.calls.some(call => call[0] === 'disable'), false);
});

test('confirmed healthy request persists intent only then disables Preview through official API and requires reload', async () => {
  const { arbiter, flag, api } = createArbiter();
  const result = await arbiter.requestV3({ confirmed: true, onboarding: validOnboarding() });
  assert.equal(result.state, PRODUCTION_RUNTIME_STATE.RELOAD_REQUIRED_FOR_V3);
  assert.equal(result.authoringAuthority, false);
  assert.equal(flag.read().requested, true);
  assert.deepEqual(api.calls.find(call => call[0] === 'disable'), ['disable', PREVIEW_NAME, true]);
});

test('post-reload selection blocks read-only when any Preview exclusion proof is missing', async () => {
  const { arbiter } = createArbiter();
  await arbiter.requestV3({ confirmed: true, onboarding: validOnboarding() });
  const result = await arbiter.startSelectedRuntime({ exclusionProof: { launcherAbsent: true, rootAbsent: true, runtimeGlobalAbsent: false } });
  assert.equal(result.state, PRODUCTION_RUNTIME_STATE.V3_BLOCKED_READONLY);
  assert.equal(result.activationRequired, false);
  assert.equal(result.authoringAuthority, false);
});

test('complete post-reload exclusion can reach only V3_STARTING handoff, never authoring', async () => {
  const { arbiter } = createArbiter();
  await arbiter.requestV3({ confirmed: true, onboarding: validOnboarding() });
  const result = await arbiter.startSelectedRuntime({ exclusionProof: { launcherAbsent: true, rootAbsent: true, runtimeGlobalAbsent: true } });
  assert.equal(result.state, PRODUCTION_RUNTIME_STATE.V3_STARTING);
  assert.equal(result.activationRequired, true);
  assert.equal(result.authoringAuthority, false);
  assert.notEqual(result.state, PRODUCTION_RUNTIME_STATE.V3_AUTHORING);
});

test('missing startup intent never auto-enables Preview as an alternate runtime', async () => {
  const { arbiter, flag, api } = createArbiter({ controlOptions: { enabled: false } });
  assert.equal(flag.read().requested, false);
  const result = await arbiter.startSelectedRuntime({ exclusionProof: { launcherAbsent: true, rootAbsent: true, runtimeGlobalAbsent: true } });
  assert.equal(result.state, PRODUCTION_RUNTIME_STATE.V3_BLOCKED_READONLY);
  assert.equal(result.activationRequired, false);
  assert.equal(api.calls.some(call => call[0] === 'enable'), false);
});

test('internal rollback after Preview disable still uses the official enable API and clears request intent', async () => {
  const { arbiter, flag, api } = createArbiter();
  await arbiter.requestV3({ confirmed: true, onboarding: validOnboarding() });
  const result = await arbiter.returnToPreview37();
  assert.equal(result.state, PRODUCTION_RUNTIME_STATE.RELOAD_REQUIRED_FOR_PREVIEW);
  assert.equal(flag.read().requested, false);
  assert.deepEqual(api.calls.find(call => call[0] === 'enable'), ['enable', PREVIEW_NAME, true]);
  assert.equal(result.authoringAuthority, false);
});

test('disable failure before persistence stays FAILED_SAFE with TMRW Phone retry intent preserved', async () => {
  const { arbiter, flag, api } = createArbiter({ controlOptions: { failDisable: 'before' } });
  const result = await arbiter.requestV3({ confirmed: true, onboarding: validOnboarding() });
  assert.equal(result.state, PRODUCTION_RUNTIME_STATE.FAILED_SAFE);
  assert.equal(result.failedSafe, true);
  assert.equal(flag.read().requested, true);
  assert.equal(result.preview.enabled, true);
  assert.equal(api.calls.some(call => call[0] === 'enable'), false);
});

test('disable failure after persisted disable never auto-restores Preview and preserves retry intent', async () => {
  const { arbiter, flag, api } = createArbiter({ controlOptions: { failDisable: 'after' } });
  const result = await arbiter.requestV3({ confirmed: true, onboarding: validOnboarding() });
  assert.equal(result.state, PRODUCTION_RUNTIME_STATE.FAILED_SAFE);
  assert.equal(flag.read().requested, true);
  assert.equal(api.calls.some(call => call[0] === 'enable'), false);
  assert.equal(result.authoringAuthority, false);
});

test('startup fail-safe does not call the Preview enable path even when that path would fail', async () => {
  const { arbiter, flag, api } = createArbiter({ controlOptions: { failDisable: 'after', failEnable: true } });
  const result = await arbiter.requestV3({ confirmed: true, onboarding: validOnboarding() });
  assert.equal(result.state, PRODUCTION_RUNTIME_STATE.FAILED_SAFE);
  assert.equal(flag.read().requested, true);
  assert.equal(result.authoringAuthority, false);
  assert.equal(api.calls.some(call => call[0] === 'enable'), false);
});

test('internal development Preview recovery fails safe when the retired package is absent without becoming a shipping fallback', async () => {
  const { arbiter, flag, api } = createArbiter({ controlOptions: { installed: false } });
  flag.requestEnable();
  const result = await arbiter.returnToPreview37();
  assert.equal(result.state, PRODUCTION_RUNTIME_STATE.FAILED_SAFE);
  assert.equal(result.recoveryRequired, 'internal-development-preview-recovery');
  assert.match(result.lastError, /internal legacy Preview development recovery/i);
  assert.equal(flag.read().requested, false);
  assert.equal(api.calls.some(call => call[0] === 'enable'), false);
});

test('return-to-Preview quiesces v3 before official Preview enable', async () => {
  const order = [];
  const { arbiter } = createArbiter({ controlOptions: { enabled: false, order }, quiesceV3: async () => order.push('quiesce') });
  const result = await arbiter.returnToPreview37();
  assert.equal(result.state, PRODUCTION_RUNTIME_STATE.RELOAD_REQUIRED_FOR_PREVIEW);
  assert.deepEqual(order, ['quiesce', 'enable']);
});

test('Production Health preflight reports concrete blockers and never treats onboarding authoringEnabled as authority', async () => {
  const { control } = createControl();
  const health = new ProductionCompositionHealth({ previewControl: control });
  const good = await health.preflight({ onboarding: validOnboarding({ authoringEnabled: true }) });
  assert.equal(good.ready, true);
  assert.equal(good.authoringEnabled, false);

  const cases = [
    ['optInRequired', { optInRequired: false }],
    ['previewIsDefault', { defaultRuntime: 'v3' }],
    ['migrationDryRunOnly', { autoMigrationRan: true }],
    ['migrationPlanPresent', { migrationPlan: null }],
    ['migrationPlanNotFatal', { migrationPlan: { fatal: true } }],
    ['gateFPassed', { gateF: 'blocked' }],
  ];
  for (const [blocker, override] of cases) {
    const report = await health.preflight({ onboarding: validOnboarding(override) });
    assert.equal(report.ready, false, blocker);
    assert.ok(report.blockers.includes(blocker), blocker);
  }
});

test('Production Health startup requires clean reload, exclusion, schema, and Gate F without opening authority', async () => {
  const { control } = createControl({ enabled: false });
  const health = new ProductionCompositionHealth({ previewControl: control });
  const evidence = {
    requested: true,
    cleanReloadProven: true,
    exclusionProof: { launcherAbsent: true, rootAbsent: true, runtimeGlobalAbsent: true },
    schemaReady: true,
    gateFReport: { status: 'pass', authoringEnabled: true },
  };
  const good = await health.startup(evidence);
  assert.equal(good.ready, true);
  assert.equal(good.authoringEnabled, false);
  for (const [field, blocker] of [
    ['requested', 'requestedIntentPresent'],
    ['cleanReloadProven', 'cleanReloadProven'],
    ['schemaReady', 'schemaReady'],
  ]) {
    const report = await health.startup({ ...evidence, [field]: false });
    assert.equal(report.ready, false);
    assert.ok(report.blockers.includes(blocker));
  }
  const noGate = await health.startup({ ...evidence, gateFReport: { status: 'blocked', authoringEnabled: true } });
  assert.equal(noGate.ready, false);
  assert.ok(noGate.blockers.includes('gateFPassed'));
});

test('Production Health authoring readiness is truthful for every live prerequisite and never opens the gate itself', async () => {
  const { control } = createControl({ enabled: false });
  const health = new ProductionCompositionHealth({ previewControl: control });
  const evidence = {
    requested: true,
    cleanReloadProven: true,
    exclusionProof: { launcherAbsent: true, rootAbsent: true, runtimeGlobalAbsent: true },
    schemaReady: true,
    gateFReport: { status: 'pass', authoringEnabled: true },
    leaseValid: true,
    identityResolved: true,
    compositionServicesReady: true,
    uniqueListenersReady: true,
    uniqueGenerationInterceptorReady: true,
    callIntegrationReady: true,
    shellMountHealthy: true,
    heartbeatQualified: true,
  };
  const good = await health.readyToOpenAuthoring(evidence);
  assert.equal(good.ready, true);
  assert.equal(good.authoringEnabled, false);
  const fields = [
    ['leaseValid', 'validLeaseGeneration'],
    ['identityResolved', 'identityResolved'],
    ['compositionServicesReady', 'compositionServicesReady'],
    ['uniqueListenersReady', 'uniqueListenersReady'],
    ['uniqueGenerationInterceptorReady', 'uniqueGenerationInterceptorReady'],
    ['callIntegrationReady', 'callIntegrationReady'],
    ['shellMountHealthy', 'shellMountHealthy'],
    ['heartbeatQualified', 'heartbeatQualified'],
  ];
  for (const [field, blocker] of fields) {
    const report = await health.readyToOpenAuthoring({ ...evidence, [field]: false });
    assert.equal(report.ready, false, blocker);
    assert.ok(report.blockers.includes(blocker), blocker);
  }
});

test('S05 production modules are structurally preflight-only: no DB, Authoring Gate, shell, launcher, or canonical service imports', async () => {
  const files = [
    new URL('../../production/sillytavern-extension-control.mjs', import.meta.url),
    new URL('../../production/runtime-arbiter.mjs', import.meta.url),
    new URL('../../production/production-health.mjs', import.meta.url),
  ];
  const source = (await Promise.all(files.map(file => fs.readFile(file, 'utf8')))).join('\n');
  assert.doesNotMatch(source, /V3Database|ProductionAuthoringGate|TmrwPhoneShell|ProductionMountManager|ProductionLauncherOwner|CanonicalEventEngine|\.transaction\s*\(/);
});
