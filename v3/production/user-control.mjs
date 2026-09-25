import { V3BetaFeatureFlag } from '../beta/feature-flag.mjs';
import { PRODUCTION_RUNTIME_STATE } from './runtime-arbiter.mjs';

export const PRODUCTION_USER_CONTROL_ID = 'tmrw-v3-production-control';
export const PRODUCTION_USER_STATUS_ID = 'tmrw-v3-production-status';
export const PRODUCTION_USER_RETRY_BUTTON_ID = 'tmrw-v3-production-retry';
export const PRODUCTION_USER_DIAGNOSTIC_ID = 'tmrw-v3-production-diagnostic';

const DIAGNOSTIC_SESSION_KEY = 'tmrw-v3-production-last-diagnostic-v1';
const PREVIEW_ROOT_ID = 'tmrw-phone-root';
const PREVIEW_LAUNCHER_ID = 'tmrw-phone-launcher';
const PREVIEW_DATABASE_NAME = 'tmrw-phone-project-storage-v1';
const PREVIEW_DATABASE_STORE = 'project-db';
const PREVIEW_DATABASE_KEY = 'main';
const ACCEPTED_GATE_F_REPORT = Object.freeze({ status: 'pass', source: 'phase21-accepted-gate-f' });

function genericUnavailableMessage() {
  return 'TMRW Phone unavailable';
}

function normalizeError(error) {
  return String(error?.message || error || 'unknown Production activation failure');
}

function sanitizeDiagnosticStage(stage) {
  const value = String(stage || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9:_-]+/g, '_').slice(0, 72);
  return value || 'UNKNOWN';
}

function sanitizeDiagnosticReason(error) {
  let value = normalizeError(error)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>]+/g, '[path]')
    .replace(/\/(?:data\/data|storage\/emulated|home|Users|ai)\/[^\s"'<>]+/g, '[path]')
    .replace(/\b(?:github_pat_|gh[pousr]_|sk-)[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!value) value = 'unknown Production activation failure';
  return value.slice(0, 240);
}

function sanitizeTypeText(value, fallback = '') {
  const text = String(value ?? fallback).replace(/[^A-Za-z0-9_$[\] .:-]+/g, '').trim();
  return (text || fallback).slice(0, 80);
}

function sanitizeLegacyMembershipTypeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  return Object.freeze({
    tag: sanitizeTypeText(metadata.tag, '[object Unknown]'),
    constructor: sanitizeTypeText(metadata.constructor, 'unknown'),
    array: metadata.array === true,
    typeof: sanitizeTypeText(metadata.typeof, 'unknown'),
    iterable: metadata.iterable === true,
    plain: metadata.plain === true,
  });
}

function formatLegacyMembershipType(metadata) {
  const value = sanitizeLegacyMembershipTypeMetadata(metadata);
  if (!value) return '';
  return `tag=${value.tag} constructor=${value.constructor} array=${value.array} typeof=${value.typeof} iterable=${value.iterable} plain=${value.plain}`;
}

function legacyMembershipTypeFromRejectedError(error) {
  if (error?.code !== 'TMRW_NON_JSON_VALUE') return null;
  const diagnostic = error?.tmrwNonJsonDiagnostic;
  if (!diagnostic || typeof diagnostic !== 'object') return null;
  const path = String(diagnostic.path || '');
  const conversationMembership = /\.shared\.conversations\[\d+\]\.(?:participantIds|memberIds)(?:\b|\.|\[|$)/.test(path);
  const messageMembership = /\.shared\.conversations\[\d+\]\.messages\[\d+\].*\.metadata\.memberIds(?:\b|\.|\[|$)/.test(path);
  if (!conversationMembership && !messageMembership) return null;
  return sanitizeLegacyMembershipTypeMetadata(diagnostic);
}

function readDiagnosticSession(storage) {
  try {
    const raw = storage?.getItem?.(DIAGNOSTIC_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return Object.freeze({
      stage: sanitizeDiagnosticStage(parsed.stage),
      reason: sanitizeDiagnosticReason(parsed.reason),
      legacyMembershipType: sanitizeLegacyMembershipTypeMetadata(parsed.legacyMembershipType),
    });
  } catch {
    return null;
  }
}

function writeDiagnosticSession(storage, diagnostic) {
  try {
    if (!diagnostic) storage?.removeItem?.(DIAGNOSTIC_SESSION_KEY);
    else storage?.setItem?.(DIAGNOSTIC_SESSION_KEY, JSON.stringify(diagnostic));
  } catch {}
}

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function exactPreviewScope(context) {
  if (!context || typeof context !== 'object') throw new Error('Current SillyTavern context is unavailable');
  const group = context.groupId ? context.groups?.find(item => String(item.id) === String(context.groupId)) : null;
  const character = !context.groupId ? context.characters?.[context.characterId] : null;
  const cardName = group?.name || character?.name || 'Character card';
  const identity = group ? `group:${context.groupId}` : `character:${character?.avatar || context.characterId || cardName}`;
  const chatIdentity = context.chatId || context.chatMetadata?.chat_id || context.chatMetadata?.chatId || context.chat?.[0]?.send_date || 'current';
  const branchIdentity = context.chatMetadata?.branch_id || context.chatMetadata?.branchId || context.chatMetadata?.main_chat || 'main';
  return Object.freeze({
    characterCardSourceId: identity,
    storySourceId: `story:${chatIdentity}`,
    routeSourceId: `branch:${branchIdentity}`,
  });
}

export async function stablePreviewScope(getContext, globalObject, { attempts = 80, delayMs = 100 } = {}) {
  let previousKey = null;
  let stableCount = 0;
  let latest = null;
  const wait = typeof globalObject?.setTimeout === 'function'
    ? milliseconds => new Promise(resolve => globalObject.setTimeout(resolve, milliseconds))
    : async () => Promise.resolve();
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const context = getContext();
    const hasCard = Boolean(context?.groupId || context?.characters?.[context?.characterId]);
    const hasChat = Boolean(context?.chatId || context?.chatMetadata?.chat_id || context?.chatMetadata?.chatId || context?.chat?.[0]?.send_date);
    if (hasCard && hasChat) {
      latest = exactPreviewScope(context);
      const key = JSON.stringify(latest);
      stableCount = key === previousKey ? stableCount + 1 : 1;
      previousKey = key;
      if (stableCount >= 2) return latest;
    }
    if (attempt < attempts - 1) await wait(delayMs);
  }
  if (!latest) throw new Error('SillyTavern chat identity is not ready; refusing to write phone data into a generic scope');
  return latest;
}

export function resolveCurrentPreview37SourceIdentity({ context, record }) {
  if (!record || typeof record !== 'object') throw new Error('Preview 37 project data is unavailable');
  const source = exactPreviewScope(context);
  const card = record.cards?.[source.characterCardSourceId];
  const story = card?.stories?.[source.storySourceId];
  const branch = story?.branches?.[source.routeSourceId];
  if (!card || !story || !branch) {
    throw new Error('Current Preview Story/Branch is not represented by an exact migration scope');
  }
  return source;
}

export function createPreview37ReadSource({ indexedDB = globalThis.indexedDB } = {}) {
  if (!indexedDB || typeof indexedDB.open !== 'function') throw new TypeError('Preview 37 read source requires IndexedDB');
  return async function preview37ReadSource() {
    if (typeof indexedDB.databases === 'function') {
      try {
        const databases = await indexedDB.databases();
        if (!databases.some(row => row?.name === PREVIEW_DATABASE_NAME)) {
          return Object.freeze({ available: false, reason: 'preview-project-database-missing' });
        }
      } catch {
        // Continue with an abort-on-upgrade open below. No Preview writes are permitted.
      }
    }
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        resolve(Object.freeze(value));
      };
      const request = indexedDB.open(PREVIEW_DATABASE_NAME);
      request.onerror = () => finish({ available: false, reason: 'preview-indexeddb-open-failed' });
      request.onupgradeneeded = () => {
        try { request.transaction?.abort?.(); } catch {}
        try { request.result?.close?.(); } catch {}
        finish({ available: false, reason: 'preview-project-database-missing' });
      };
      request.onsuccess = () => {
        const database = request.result;
        try {
          if (!database.objectStoreNames.contains(PREVIEW_DATABASE_STORE)) {
            database.close();
            finish({ available: false, reason: 'preview-project-store-missing' });
            return;
          }
          const transaction = database.transaction([PREVIEW_DATABASE_STORE], 'readonly');
          const get = transaction.objectStore(PREVIEW_DATABASE_STORE).get(PREVIEW_DATABASE_KEY);
          get.onerror = () => {
            database.close();
            finish({ available: false, reason: 'preview-main-read-failed' });
          };
          get.onsuccess = () => {
            const record = get.result;
            database.close();
            finish(record
              ? { available: true, sourceVersion: record.schemaVersion || 2, sourceLocation: 'preview37-indexeddb-readonly', record }
              : { available: false, reason: 'preview-main-missing' });
          };
        } catch {
          try { database.close(); } catch {}
          finish({ available: false, reason: 'preview-project-read-failed' });
        }
      };
    });
  };
}

export async function loadProductionSillyTavernHostApi() {
  const scriptsRoot = '/scripts/';
  const [extensions, script, events, context] = await Promise.all([
    import(scriptsRoot + 'extensions.js'),
    import('/' + 'script.js'),
    import(scriptsRoot + 'events.js'),
    import(scriptsRoot + 'st-context.js'),
  ]);
  return Object.freeze({
    officialExtensionApi: Object.freeze({
      findExtension: requireFunction(extensions.findExtension, 'findExtension'),
      disableExtension: requireFunction(extensions.disableExtension, 'disableExtension'),
      enableExtension: requireFunction(extensions.enableExtension, 'enableExtension'),
      extensionSettings: extensions.extension_settings,
    }),
    getContext: requireFunction(context.getContext, 'getContext'),
    Generate: requireFunction(script.Generate, 'Generate'),
    eventSource: events.eventSource,
    sillyTavernEventTypes: events.event_types,
  });
}

function createElement(document, tag, { id = '', className = '', text = '' } = {}) {
  const element = document.createElement(tag);
  if (id) element.id = id;
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function exclusionProof(document, globalObject) {
  return Object.freeze({
    launcherAbsent: document.querySelectorAll(`#${PREVIEW_LAUNCHER_ID}`).length === 0,
    rootAbsent: document.querySelectorAll(`#${PREVIEW_ROOT_ID}`).length === 0,
    runtimeGlobalAbsent: typeof globalObject.TMRWPhone === 'undefined',
  });
}

export class ProductionUserControl {
  #entryApi;
  #hostApiLoader;
  #document;
  #globalObject;
  #featureFlagStorage;
  #featureFlag;
  #previewReadSourceFactory;
  #root = null;
  #status = null;
  #diagnostic = null;
  #retryButton = null;
  #busy = false;
  #lastError = null;
  #stage = 'IDLE';
  #legacyMembershipType = null;
  #resumePromise = null;

  constructor({
    entryApi,
    hostApiLoader = loadProductionSillyTavernHostApi,
    document = globalThis.document,
    globalObject = globalThis,
    featureFlagStorage = globalThis.localStorage,
    previewReadSourceFactory = createPreview37ReadSource,
  } = {}) {
    if (!entryApi || typeof entryApi !== 'object') throw new TypeError('ProductionUserControl requires the Production entry API');
    for (const name of ['getProductionEntryStatus', 'configureProductionPreflight', 'runProductionPreflight', 'requestProductionTakeover', 'checkProductionPostReloadSelection', 'disposeProductionPreflight', 'configureProductionActiveStartup', 'startProductionActiveRuntime', 'returnProductionToPreview37']) {
      requireFunction(entryApi[name], `entryApi.${name}`);
    }
    this.#entryApi = entryApi;
    this.#hostApiLoader = requireFunction(hostApiLoader, 'hostApiLoader');
    this.#document = document;
    this.#globalObject = globalObject;
    this.#featureFlagStorage = featureFlagStorage;
    this.#previewReadSourceFactory = requireFunction(previewReadSourceFactory, 'previewReadSourceFactory');
    if (featureFlagStorage?.getItem && featureFlagStorage?.setItem) this.#featureFlag = new V3BetaFeatureFlag({ storage: featureFlagStorage });
    const restoredDiagnostic = readDiagnosticSession(globalObject?.sessionStorage);
    if (restoredDiagnostic) {
      this.#stage = restoredDiagnostic.stage;
      this.#lastError = restoredDiagnostic.reason;
      this.#legacyMembershipType = restoredDiagnostic.legacyMembershipType;
    }
  }

  get status() {
    const entry = this.#entryApi.getProductionEntryStatus();
    return Object.freeze({
      mounted: Boolean(this.#root?.isConnected ?? this.#root),
      busy: this.#busy,
      lastError: this.#lastError,
      diagnosticStage: this.#lastError ? this.#stage : null,
      diagnosticReason: this.#lastError ? sanitizeDiagnosticReason(this.#lastError) : null,
      legacyMembershipType: this.#lastError ? this.#legacyMembershipType : null,
      requested: this.#featureFlag?.read().requested === true,
      productionActive: entry.authoringGateOpen === true && entry.leaseAcquired === true && entry.launcherMounted === true,
      userStatus: this.#status?.textContent || this.#deriveUserStatus(entry),
    });
  }

  mount() {
    const document = this.#document;
    if (!document?.createElement || !document?.querySelector) return false;
    const existing = document.querySelector(`#${PRODUCTION_USER_CONTROL_ID}`);
    if (existing) {
      this.#adopt(existing);
      this.refresh();
      return true;
    }
    const host = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!host?.append) return false;

    const root = createElement(document, 'div', { id: PRODUCTION_USER_CONTROL_ID, className: 'extension_container tmrw-v3-production-control' });
    const title = createElement(document, 'h4', { text: 'TMRW Phone' });
    const statusWrap = createElement(document, 'div', { className: 'tmrw-v3-production-control__status-wrap' });
    const statusLabel = createElement(document, 'span', { className: 'tmrw-v3-production-control__label', text: 'Status:' });
    const status = createElement(document, 'span', { id: PRODUCTION_USER_STATUS_ID, className: 'tmrw-v3-production-control__status' });
    const diagnostic = createElement(document, 'p', { id: PRODUCTION_USER_DIAGNOSTIC_ID, className: 'tmrw-v3-production-control__diagnostic' });
    diagnostic.hidden = true;
    const actions = createElement(document, 'div', { className: 'tmrw-v3-production-control__actions' });
    const retryButton = createElement(document, 'button', { id: PRODUCTION_USER_RETRY_BUTTON_ID, className: 'menu_button', text: 'Retry' });
    retryButton.type = 'button';
    retryButton.hidden = true;
    retryButton.addEventListener('click', () => { void this.retryStartup(); });
    statusWrap.append(statusLabel, status);
    actions.append(retryButton);
    root.append(title, statusWrap, diagnostic, actions);
    host.append(root);
    this.#root = root;
    this.#status = status;
    this.#diagnostic = diagnostic;
    this.#retryButton = retryButton;
    this.refresh();
    return true;
  }

  #adopt(root) {
    this.#root = root;
    this.#status = root.querySelector?.(`#${PRODUCTION_USER_STATUS_ID}`) || null;
    this.#diagnostic = root.querySelector?.(`#${PRODUCTION_USER_DIAGNOSTIC_ID}`) || null;
    this.#retryButton = root.querySelector?.(`#${PRODUCTION_USER_RETRY_BUTTON_ID}`) || null;
  }

  async handleExtensionHook() {
    this.mount();
    this.refresh();
    const entry = this.#entryApi.getProductionEntryStatus();
    if (entry.authoringGateOpen === true && entry.leaseAcquired === true && entry.launcherMounted === true) return this.status;
    if (this.#busy || !this.#document?.querySelector) return this.status;
    let host;
    this.#setStage('HOST_API');
    try { host = await this.#hostApiLoader(); } catch (error) { this.#fail(error); return this.status; }
    const preview = host.officialExtensionApi.findExtension('TMRW-Phone-Preview');
    if (preview?.enabled === true) return this.useProduction({ host });
    if (this.#featureFlag) {
      if (this.#featureFlag.read().requested !== true) this.#featureFlag.requestEnable();
      return this.resumePendingSelection({ host });
    }
    this.#fail(new Error('TMRW Phone startup prerequisites are unavailable'));
    return this.status;
  }

  async useProduction({ host = null } = {}) {
    if (this.#busy) return this.status;
    this.#busy = true;
    this.#clearDiagnostic();
    this.#setStage('HOST_API');
    this.refresh();
    try {
      host = host || await this.#hostApiLoader();
      this.#setStage('PREVIEW_READ_SOURCE');
      const previewReadSource = this.#previewReadSourceFactory({ indexedDB: this.#globalObject.indexedDB });
      this.#setStage('PREFLIGHT_CONFIG');
      await this.#entryApi.configureProductionPreflight({
        officialExtensionApi: host.officialExtensionApi,
        previewReadSource,
        featureFlagStorage: this.#featureFlagStorage,
      });
      this.#setStage('PREFLIGHT');
      const preflight = await this.#entryApi.runProductionPreflight();
      this.#setStage('MIGRATION_PLAN');
      if (preflight?.onboarding?.migrationPlan?.fatal === true) throw new Error('Production preflight migration plan is fatal');
      this.#setStage('TAKEOVER');
      const takeover = await this.#entryApi.requestProductionTakeover({ gateFReport: ACCEPTED_GATE_F_REPORT });
      if (takeover?.runtime?.state !== PRODUCTION_RUNTIME_STATE.RELOAD_REQUIRED_FOR_V3) {
        await this.#entryApi.disposeProductionPreflight();
        throw new Error(`Production takeover did not reach the accepted reload boundary: ${takeover?.runtime?.state || 'unknown'}`);
      }
      return this.status;
    } catch (error) {
      try { await this.#entryApi.disposeProductionPreflight(); } catch {}
      this.#fail(error);
      return this.status;
    } finally {
      this.#busy = false;
      this.refresh();
    }
  }

  async retryStartup() {
    if (this.#busy) return this.status;
    let host;
    this.#setStage('HOST_API');
    try { host = await this.#hostApiLoader(); } catch (error) { this.#fail(error); return this.status; }
    const preview = host.officialExtensionApi.findExtension('TMRW-Phone-Preview');
    if (preview?.enabled === true) return this.useProduction({ host });
    if (this.#featureFlag) {
      if (this.#featureFlag.read().requested !== true) this.#featureFlag.requestEnable();
      return this.resumePendingSelection({ host });
    }
    this.#fail(new Error('TMRW Phone startup prerequisites are unavailable'));
    return this.status;
  }

  async resumePendingSelection({ host = null } = {}) {
    if (this.#resumePromise) return this.#resumePromise;
    this.#resumePromise = this.#resumePendingSelection({ host }).finally(() => { this.#resumePromise = null; });
    return this.#resumePromise;
  }

  async #resumePendingSelection({ host = null } = {}) {
    if (this.#busy) return this.status;
    this.#busy = true;
    this.#setStage('POST_RELOAD_HOST_API');
    this.refresh();
    try {
      const resolvedHost = host || await this.#hostApiLoader();
      this.#setStage('POST_RELOAD_PREVIEW_SOURCE');
      const previewReadSource = this.#previewReadSourceFactory({ indexedDB: this.#globalObject.indexedDB });
      this.#setStage('SILLYTAVERN_SCOPE');
      let startupSourceIdentity = await stablePreviewScope(resolvedHost.getContext, this.#globalObject);
      this.#setStage('ACTIVE_STARTUP');
      let pinStartupSourceIdentity = true;
      const sourceIdentityResolver = async context => {
        if (pinStartupSourceIdentity && startupSourceIdentity) return startupSourceIdentity;
        this.#setStage('SILLYTAVERN_SCOPE');
        const resolved = exactPreviewScope(context);
        if (resolved.storySourceId === 'story:current') throw new Error('SillyTavern chat identity is not ready; refusing generic phone scope');
        if (pinStartupSourceIdentity) startupSourceIdentity = resolved;
        this.#setStage('ACTIVE_STARTUP');
        return resolved;
      };
      const proof = exclusionProof(this.#document, this.#globalObject);

      this.#setStage('POST_RELOAD_PREFLIGHT_CONFIG');
      await this.#entryApi.configureProductionPreflight({
        officialExtensionApi: resolvedHost.officialExtensionApi,
        previewReadSource,
        featureFlagStorage: this.#featureFlagStorage,
      });
      this.#setStage('POST_RELOAD_SELECTION');
      await this.#entryApi.checkProductionPostReloadSelection({ exclusionProof: proof });
      this.#setStage('ACTIVE_CONFIG');
      await this.#entryApi.configureProductionActiveStartup({
        officialExtensionApi: resolvedHost.officialExtensionApi,
        previewReadSource,
        featureFlagStorage: this.#featureFlagStorage,
        getContext: resolvedHost.getContext,
        Generate: resolvedHost.Generate,
        eventSource: resolvedHost.eventSource,
        sillyTavernEventTypes: resolvedHost.sillyTavernEventTypes,
        sourceIdentityResolver,
        stageObserver: stage => { this.#setStage(`ACTIVE_STARTUP:${stage}`); },
        document: this.#document,
        globalObject: this.#globalObject,
        eventTarget: this.#globalObject,
      });
      this.#setStage('ACTIVE_STARTUP');
      const started = await this.#entryApi.startProductionActiveRuntime({ exclusionProof: proof, gateFReport: ACCEPTED_GATE_F_REPORT });
      pinStartupSourceIdentity = false;
      startupSourceIdentity = null;
      if (started?.authoringAuthority !== true || started?.launcherMounted !== true || started?.authoringGateState !== 'open') {
        throw new Error('Production startup did not establish accepted authoring authority');
      }
      this.#clearDiagnostic();
      await this.#entryApi.disposeProductionPreflight();
      this.refresh();
      return this.status;
    } catch (error) {
      try { await this.#entryApi.disposeProductionPreflight(); } catch {}
      this.#fail(error);
      return this.status;
    } finally {
      this.#busy = false;
      this.refresh();
    }
  }

  async returnToPreview() {
    if (this.#busy) return this.status;
    this.#busy = true;
    this.#clearDiagnostic();
    this.#setStage('RETURN_PREVIEW');
    this.refresh();
    try {
      await this.#entryApi.returnProductionToPreview37();
      return this.status;
    } catch (error) {
      this.#fail(error);
      return this.status;
    } finally {
      this.#busy = false;
      this.refresh();
    }
  }

  #setStage(stage) {
    this.#stage = sanitizeDiagnosticStage(stage);
    return this.#stage;
  }

  #clearDiagnostic() {
    this.#lastError = null;
    this.#stage = 'IDLE';
    this.#legacyMembershipType = null;
    writeDiagnosticSession(this.#globalObject?.sessionStorage, null);
  }

  #deriveUserStatus(entry = this.#entryApi.getProductionEntryStatus()) {
    if (this.#busy) return 'Starting TMRW Phone…';
    if (this.#lastError) return genericUnavailableMessage();
    if (entry.authoringGateOpen === true && entry.leaseAcquired === true && entry.launcherMounted === true) return 'TMRW Phone';
    return 'TMRW Phone';
  }

  refresh() {
    const entry = this.#entryApi.getProductionEntryStatus();
    if (this.#status) this.#status.textContent = this.#deriveUserStatus(entry);
    if (this.#diagnostic) {
      this.#diagnostic.textContent = '';
      this.#diagnostic.hidden = true;
    }
    if (this.#retryButton) {
      this.#retryButton.hidden = !this.#lastError;
      this.#retryButton.disabled = this.#busy;
    }
    return this.status;
  }

  #fail(error) {
    this.#lastError = normalizeError(error);
    this.#legacyMembershipType = legacyMembershipTypeFromRejectedError(error) || this.#legacyMembershipType;
    writeDiagnosticSession(this.#globalObject?.sessionStorage, Object.freeze({
      stage: this.#stage,
      reason: sanitizeDiagnosticReason(error),
      legacyMembershipType: this.#legacyMembershipType,
    }));
    console.error('[TMRW Phone] startup failed safely:', error);
    this.refresh();
  }

  dispose() {
    try { this.#root?.remove?.(); } catch {}
    this.#root = null;
    this.#status = null;
    this.#diagnostic = null;
    this.#retryButton = null;
    return true;
  }
}

export function createProductionUserControl(options) {
  return new ProductionUserControl(options);
}
