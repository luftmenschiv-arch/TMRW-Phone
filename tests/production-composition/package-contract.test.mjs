import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  AUTHORING_CAPABILITY,
  PREVIEW37_EXTENSION_QUERY,
  V3_EXTENSION_DIRECTORY_NAME,
  V3_GENERATION_INTERCEPTOR_KEY,
  V3_LAUNCHER_ID,
  V3_PRODUCTION_RUNTIME_ID,
  V3_ROOT_ID,
} from '../../production/constants.mjs';
import { buildProductionPackage } from '../../dev/production-package/build-production-package.mjs';
import { verifyProductionPackage } from '../../dev/production-package/verify-production-package.mjs';

const v3Root = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, value => value.slice(1)));
const distRoot = path.join(v3Root, 'dist', V3_EXTENSION_DIRECTORY_NAME);
const entryUrl = pathToFileURL(path.join(v3Root, 'production', 'entry.mjs')).href;

async function withShimRestored(work) {
  const previous = globalThis[V3_GENERATION_INTERCEPTOR_KEY];
  try {
    return await work();
  } finally {
    if (previous === undefined) delete globalThis[V3_GENERATION_INTERCEPTOR_KEY];
    else globalThis[V3_GENERATION_INTERCEPTOR_KEY] = previous;
  }
}

test('production package constants use the frozen non-colliding v3 identities and capabilities', () => {
  assert.equal(V3_PRODUCTION_RUNTIME_ID, 'tmrw-phone-v3');
  assert.equal(PREVIEW37_EXTENSION_QUERY, 'TMRW-Phone-Preview');
  assert.equal(V3_EXTENSION_DIRECTORY_NAME, 'TMRW-Phone-V3');
  assert.equal(V3_LAUNCHER_ID, 'tmrw-v3-phone-launcher');
  assert.equal(V3_ROOT_ID, 'tmrw-v3-phone-root');
  assert.equal(V3_GENERATION_INTERCEPTOR_KEY, 'tmrwV3GenerateInterceptor');
  assert.deepEqual(AUTHORING_CAPABILITY, { NORMAL: 'normal', TRANSITION: 'transition' });
  for (const value of [V3_PRODUCTION_RUNTIME_ID, V3_EXTENSION_DIRECTORY_NAME, V3_LAUNCHER_ID, V3_ROOT_ID]) {
    assert.doesNotMatch(value, /^tmrw-phone$/i);
  }
});

test('source package entry installs only a stable passive interceptor shim and lifecycle hooks start no runtime authority', async () => withShimRestored(async () => {
  delete globalThis[V3_GENERATION_INTERCEPTOR_KEY];
  let indexedDbOpens = 0;
  const previousIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = { open() { indexedDbOpens += 1; throw new Error('S04 must never open IndexedDB'); } };
  try {
    const module = await import(`${entryUrl}?passive=${Date.now()}-${Math.random()}`);
    const shim = globalThis[V3_GENERATION_INTERCEPTOR_KEY];
    assert.equal(typeof shim, 'function');
    const chat = [{ mes: 'unchanged' }];
    const before = structuredClone(chat);
    let aborted = false;
    assert.equal(await shim(chat, 4096, () => { aborted = true; }, 'normal'), undefined);
    assert.deepEqual(chat, before);
    assert.equal(aborted, false);

    const activated = module.onActivate();
    const enabled = module.onEnable();
    const disabled = module.onDisable();
    for (const status of [activated, enabled, disabled, module.getProductionEntryStatus()]) {
      assert.equal(status.passive, true);
      assert.equal(status.databaseOpen, false);
      assert.equal(status.leaseAcquired, false);
      assert.equal(status.authoringGateOpen, false);
      assert.equal(status.phoneRootMounted, false);
      assert.equal(status.launcherMounted, false);
      assert.equal(status.previewStateChanged, false);
      assert.equal(status.canonicalWrites, 0);
    }
    assert.equal(indexedDbOpens, 0);
  } finally {
    if (previousIndexedDb === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previousIndexedDb;
  }
}));

test('passive entry never clobbers an unknown generation-interceptor global owner', async () => withShimRestored(async () => {
  const foreign = async () => 'foreign';
  globalThis[V3_GENERATION_INTERCEPTOR_KEY] = foreign;
  const module = await import(`${entryUrl}?conflict=${Date.now()}-${Math.random()}`);
  assert.equal(globalThis[V3_GENERATION_INTERCEPTOR_KEY], foreign);
  const status = module.getProductionEntryStatus();
  assert.equal(status.generationShimInstalled, false);
  assert.equal(status.generationShimConflict, true);
  assert.equal(status.passive, true);
}));

test('production package builder includes the passive/preflight surface plus the accepted S13 active-startup ownership closure', async () => {
  const result = await buildProductionPackage();
  assert.equal(result.outputRoot, distRoot);
  const requiredRuntime = [
    'v3/production/constants.mjs',
    'v3/production/entry.mjs',
    'v3/production/passive-preflight.mjs',
    'v3/production/runtime-arbiter.mjs',
    'v3/production/production-health.mjs',
    'v3/production/sillytavern-extension-control.mjs',
    'v3/production/authoring-gate.mjs',
    'v3/production/fenced-database.mjs',
    'v3/production/active-startup.mjs',
    'v3/production/composition-root.mjs',
    'v3/production/production-activation.mjs',
    'v3/production/listener-owner.mjs',
    'v3/production/generation-interceptor-owner.mjs',
    'v3/production/mount-manager.mjs',
    'v3/production/launcher-owner.mjs',
    'v3/production/shutdown-controller.mjs',
    'v3/production/lease-heartbeat.mjs',
    'v3/storage/v3-database.mjs',
    'v3/beta/feature-flag.mjs',
    'v3/beta/health-check.mjs',
    'v3/beta/onboarding.mjs',
    'v3/beta/runtime-guard.mjs',
    'v3/migration/preview37/raw-reader.mjs',
    'v3/migration/preview37/coordinator.mjs',
    'v3/ui/styles.css',
  ];
  for (const required of ['manifest.json', 'index.js', 'style.css', ...requiredRuntime]) {
    assert.equal(await fs.stat(path.join(distRoot, ...required.split('/'))).then(stat => stat.isFile(), () => false), true, required);
  }
  assert.equal(result.runtimeFiles.some(file => file.startsWith('v3/tests/')), false);
  assert.equal(result.runtimeFiles.some(file => file.startsWith('v3/dev/')), false);
  assert.equal(result.runtimeFiles.some(file => file.includes('browser-production-install')), false);
});

test('package verifier proves manifest hooks, import closure, passive import, and protected-path exclusion', async () => {
  await buildProductionPackage();
  const report = await verifyProductionPackage();
  assert.equal(report.passiveImport, true);
  assert.equal(report.protectedPaths, false);
  assert.equal(report.previewFilesCopied, false);
  assert.equal(report.manifest.displayName, 'TMRW—Phone v3 Beta');
  assert.equal(report.manifest.loadingOrder, 60);
  assert.equal(report.manifest.generateInterceptor, V3_GENERATION_INTERCEPTOR_KEY);
  assert.ok(report.files >= 6);
  assert.ok(report.importEdges >= 3);
});

test('package manifest owns only the passive S04 lifecycle/global shim hooks', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(v3Root, 'production', 'package', 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.hooks, { activate: 'onActivate', enable: 'onEnable', disable: 'onDisable' });
  assert.equal(manifest.generate_interceptor, V3_GENERATION_INTERCEPTOR_KEY);
  assert.equal(manifest.loading_order, 60);
  assert.equal(manifest.auto_update, false);
  assert.equal(manifest.js, 'index.js');
  assert.equal(manifest.css, 'style.css');
});

test('v3 package metadata exposes only S04 production-composition build/test commands without disturbing legacy verifier commands', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(v3Root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:production-composition'], 'node --test tests/production-composition/*.test.mjs');
  assert.equal(pkg.scripts['verify:production-composition'], 'node --test tests/production-composition/*.test.mjs');
  assert.equal(pkg.scripts['build:production-package'], 'node dev/production-package/build-production-package.mjs');
  assert.equal(pkg.scripts['verify:production-package'], 'node dev/production-package/verify-production-package.mjs');
  assert.equal(pkg.scripts['verify:phase19'], 'node dev/run-phase19.mjs');
  assert.equal(pkg.scripts.verify, 'node dev/run-phase19.mjs');
});
