import {
  V3_GENERATION_INTERCEPTOR_KEY,
  V3_PRODUCTION_RUNTIME_ID,
} from './constants.mjs';
import { createProductionPackagePreflightSession } from './passive-preflight.mjs';
import { createProductionActiveStartupSession } from './active-startup.mjs';
import { createProductionUserControl } from './user-control.mjs';

const PASSIVE_SHIM_MARKER = Symbol.for('tmrw.v3.production.passive-generation-interceptor');

function createDocumentOwnerId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return `tmrw-v3-window:${globalThis.crypto.randomUUID()}`;
  throw new Error('Secure per-document production ownerId generation is unavailable');
}

const DOCUMENT_OWNER_ID = createDocumentOwnerId();

let activated = false;
let enabled = false;
let shimConflict = false;
let preflightSession = null;
let preflightSessionPromise = null;
let activeStartupSession = null;
let activeStartupSessionPromise = null;
let userControl = null;

async function passiveGenerationInterceptor() {
  // The static SillyTavern manifest may visit this shim while Preview remains
  // selected. It must never mutate chat/context or abort generation.
}

Object.defineProperty(passiveGenerationInterceptor, PASSIVE_SHIM_MARKER, {
  value: V3_PRODUCTION_RUNTIME_ID,
  enumerable: false,
});

function ensurePassiveGenerationShim() {
  const current = globalThis[V3_GENERATION_INTERCEPTOR_KEY];
  if (current === undefined || current === null) {
    globalThis[V3_GENERATION_INTERCEPTOR_KEY] = passiveGenerationInterceptor;
    shimConflict = false;
    return true;
  }
  if (current === passiveGenerationInterceptor || current?.[PASSIVE_SHIM_MARKER] === V3_PRODUCTION_RUNTIME_ID) {
    shimConflict = false;
    return true;
  }
  // Never clobber an unknown global owner. S07 owns the active delegate only
  // after production startup authority exists; this entry remains passive.
  shimConflict = true;
  return false;
}

function snapshot() {
  const preflight = preflightSession?.status || null;
  const active = activeStartupSession?.status || null;
  const authoring = active?.authoringAuthority === true;
  return Object.freeze({
    runtimeId: V3_PRODUCTION_RUNTIME_ID,
    ownerId: DOCUMENT_OWNER_ID,
    phase: authoring ? 's13-active-production-runtime' : 's12-prereq-remediated-passive-package',
    passive: !authoring,
    activated,
    enabled,
    generationShimInstalled: globalThis[V3_GENERATION_INTERCEPTOR_KEY]?.[PASSIVE_SHIM_MARKER] === V3_PRODUCTION_RUNTIME_ID || active?.interceptorDelegateActive === true,
    generationShimConflict: shimConflict,
    preflightConfigured: Boolean(preflightSession),
    preflightDatabaseOpen: preflight?.ephemeralPreflightDatabaseOpen === true,
    preflightMigrationCapability: preflight?.migrationDatabaseCapability || null,
    activeStartupConfigured: Boolean(activeStartupSession),
    runtimeState: active?.runtimeState || preflight?.runtime?.state || null,
    databaseOpen: active?.databaseOpen === true,
    leaseAcquired: active?.ownsLease === true,
    leaseId: active?.leaseId || null,
    authoringGateOpen: active?.authoringGateState === 'open',
    phoneRootMounted: active?.phoneRootMounted === true,
    launcherMounted: active?.launcherMounted === true,
    listenerRegistered: active?.listenerRegistered === true,
    interceptorDelegateActive: active?.interceptorDelegateActive === true,
    storyId: active?.storyId || null,
    branchId: active?.branchId || null,
    previewStateChanged: false,
    canonicalWrites: Number(preflight?.canonicalWrites || 0) + Number(active?.canonicalWritesDuringMigration || 0),
    voiceRuntimeAvailable: active?.voiceRuntimeAvailable ?? false,
    voiceProviderModelCalls: active?.voiceProviderModelCalls ?? 0,
  });
}

function ensureProductionUserControl() {
  if (userControl) return userControl;
  userControl = createProductionUserControl({
    entryApi: {
      getProductionEntryStatus,
      configureProductionPreflight,
      runProductionPreflight,
      requestProductionTakeover,
      checkProductionPostReloadSelection,
      disposeProductionPreflight,
      configureProductionActiveStartup,
      startProductionActiveRuntime,
      returnProductionToPreview37,
    },
  });
  return userControl;
}

function scheduleProductionUserControl() {
  Promise.resolve()
    .then(() => ensureProductionUserControl().handleExtensionHook())
    .catch(error => console.error('[TMRW Phone] startup control initialization failed safely:', error));
}

// Passive load still has exactly one evaluation side effect: install/adopt the
// known no-op generation shim. No DB, lease, timer, listener, root, launcher,
// preflight, or authoring graph is created until an explicit control call.
ensurePassiveGenerationShim();

export function onActivate() {
  activated = true;
  ensurePassiveGenerationShim();
  scheduleProductionUserControl();
  return snapshot();
}

export function onEnable() {
  enabled = true;
  ensurePassiveGenerationShim();
  scheduleProductionUserControl();
  return snapshot();
}

export function onDisable() {
  enabled = false;
  userControl?.dispose?.();
  userControl = null;
  if (!preflightSession && !preflightSessionPromise && !activeStartupSession && !activeStartupSessionPromise) return snapshot();
  return (async () => {
    await shutdownProductionActiveRuntime('extension-disabled');
    await disposeProductionPreflight();
    return snapshot();
  })();
}

export function getProductionEntryStatus() {
  return snapshot();
}

export function getProductionUserControlStatus() {
  return userControl?.status || Object.freeze({ mounted: false, busy: false, lastError: null, requested: false, productionActive: false, userStatus: 'TMRW Phone' });
}

export async function configureProductionPreflight(options = {}) {
  if (preflightSession && preflightSession.status.disposed !== true) return preflightSession;
  if (preflightSessionPromise) return preflightSessionPromise;
  preflightSessionPromise = createProductionPackagePreflightSession(options)
    .then(session => {
      preflightSession = session;
      return session;
    })
    .finally(() => {
      preflightSessionPromise = null;
    });
  return preflightSessionPromise;
}

export function getProductionPreflightStatus() {
  if (!preflightSession) return Object.freeze({ configured: false, disposed: false, authoringAuthority: false });
  return preflightSession.inspect();
}

export async function runProductionPreflight() {
  if (!preflightSession) throw new Error('Production preflight must be explicitly configured before inspection');
  return preflightSession.preflight();
}

export async function requestProductionTakeover(options = {}) {
  if (!preflightSession) throw new Error('Production preflight must be explicitly configured before confirmed takeover');
  return preflightSession.requestTakeover(options);
}

export async function checkProductionPostReloadSelection(options = {}) {
  if (!preflightSession) throw new Error('Production preflight must be explicitly configured before runtime selection');
  return preflightSession.checkPostReloadSelection(options);
}

export async function disposeProductionPreflight() {
  if (preflightSessionPromise) await preflightSessionPromise;
  if (!preflightSession) return false;
  const session = preflightSession;
  preflightSession = null;
  return session.dispose();
}

export async function configureProductionActiveStartup(options = {}) {
  if (activeStartupSession && activeStartupSession.status.disposed !== true) return activeStartupSession;
  if (activeStartupSessionPromise) return activeStartupSessionPromise;
  activeStartupSessionPromise = Promise.resolve(createProductionActiveStartupSession({ ...options, ownerId: DOCUMENT_OWNER_ID }))
    .then(session => {
      activeStartupSession = session;
      return session;
    })
    .finally(() => {
      activeStartupSessionPromise = null;
    });
  return activeStartupSessionPromise;
}

export function getProductionActiveRuntimeStatus() {
  if (!activeStartupSession) return Object.freeze({ configured: false, ownerId: DOCUMENT_OWNER_ID, started: false, authoringAuthority: false, voiceRuntimeAvailable: false, voiceProviderModelCalls: 0 });
  return activeStartupSession.status;
}

export async function startProductionActiveRuntime(options = {}) {
  if (!activeStartupSession) throw new Error('Production active startup must be explicitly configured before startup');
  return activeStartupSession.start(options);
}

export async function shutdownProductionActiveRuntime(reason = 'production-entry-shutdown') {
  if (activeStartupSessionPromise) await activeStartupSessionPromise;
  if (!activeStartupSession) return false;
  const session = activeStartupSession;
  activeStartupSession = null;
  await session.shutdown(reason);
  return true;
}

export async function returnProductionToPreview37() {
  if (activeStartupSessionPromise) await activeStartupSessionPromise;
  if (!activeStartupSession) throw new Error('No active production runtime is configured');
  const session = activeStartupSession;
  activeStartupSession = null;
  return session.returnToPreview37();
}
