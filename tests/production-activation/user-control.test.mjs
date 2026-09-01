import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { MemoryKeyValueStorage, V3BetaFeatureFlag } from '../../beta/feature-flag.mjs';
import { PRODUCTION_RUNTIME_STATE } from '../../production/runtime-arbiter.mjs';
import { canonicalJson } from '../../domain/events/idempotency.mjs';
import {
  PRODUCTION_USER_CONTROL_ID,
  PRODUCTION_USER_DIAGNOSTIC_ID,
  PRODUCTION_USER_RETRY_BUTTON_ID,
  PRODUCTION_USER_STATUS_ID,
  createProductionUserControl,
  resolveCurrentPreview37SourceIdentity,
} from '../../production/user-control.mjs';

class FakeElement {
  constructor(tagName, document) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.parentNode = null;
    this.id = '';
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.type = '';
    this.isConnected = false;
    this.listeners = new Map();
  }
  append(...children) {
    for (const child of children) {
      child.parentNode = this;
      child.#setConnected(this.isConnected);
      this.children.push(child);
    }
  }
  #setConnected(value) {
    this.isConnected = Boolean(value);
    for (const child of this.children) child.#setConnected(this.isConnected);
  }
  connect() { this.#setConnected(true); }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  querySelector(selector) { return findMatches(this, selector)[0] || null; }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
    this.#setConnected(false);
  }
}

function findMatches(root, selector) {
  const id = selector.startsWith('#') ? selector.slice(1) : null;
  const matches = [];
  const visit = node => {
    if (id && node.id === id) matches.push(node);
    for (const child of node.children || []) visit(child);
  };
  visit(root);
  return matches;
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement('body', this);
    this.body.connect();
    this.settings = new FakeElement('div', this);
    this.settings.id = 'extensions_settings2';
    this.body.append(this.settings);
  }
  createElement(tagName) { return new FakeElement(tagName, this); }
  querySelector(selector) { return findMatches(this.body, selector)[0] || null; }
  querySelectorAll(selector) { return findMatches(this.body, selector); }
}

function previewRecord() {
  return {
    schemaVersion: 2,
    cards: {
      'character:alice.png': {
        cardKey: 'character:alice.png',
        stories: {
          'story:chat-a': {
            storyId: 'story:chat-a',
            branches: {
              'branch:main': { branchId: 'branch:main', phones: {}, shared: {} },
            },
          },
        },
      },
    },
  };
}

function context() {
  return { characterId: 0, characters: [{ avatar: 'alice.png', name: 'Alice' }], chatId: 'chat-a', chatMetadata: {}, chat: [], name1: 'Player' };
}

function previewRecordWithMembership(value) {
  const record = previewRecord();
  record.cards['character:alice.png'].stories['story:chat-a'].branches['branch:main'].shared = {
    conversations: [
      { id: 'first', participantIds: ['user', 'alice'] },
      { id: 'legacy', memberIds: value },
    ],
  };
  return record;
}

function harness({ failStart = false, exerciseIdentityPin = false, failPreflightError = null, previewRecordFactory = previewRecord } = {}) {
  const document = new FakeDocument();
  const storage = new MemoryKeyValueStorage();
  const sessionStorage = new MemoryKeyValueStorage();
  const flag = new V3BetaFeatureFlag({ storage, now: () => '2026-08-30T00:00:00.000Z' });
  const calls = [];
  let active = false;
  let previewEnabled = true;
  const configuredActiveOptions = [];
  let identityDuringStart = null;
  let previewReadCalls = 0;
  let contextCalls = 0;
  const host = {
    officialExtensionApi: {
      findExtension: () => ({ name: 'third-party/TMRW-Phone-Preview', enabled: previewEnabled }),
      disableExtension: async () => { previewEnabled = false; },
      enableExtension: async () => { previewEnabled = true; },
      extensionSettings: { disabledExtensions: [] },
    },
    getContext: () => { contextCalls += 1; return context(); },
    Generate: async () => {},
    eventSource: { on() {}, removeListener() {} },
    sillyTavernEventTypes: { CHAT_CHANGED: 'chat_changed' },
  };
  const entryApi = {
    getProductionEntryStatus() {
      return {
        passive: !active,
        databaseOpen: active,
        leaseAcquired: active,
        authoringGateOpen: active,
        launcherMounted: active,
        phoneRootMounted: active,
        voiceRuntimeAvailable: false,
        voiceProviderModelCalls: 0,
      };
    },
    async configureProductionPreflight(options) { calls.push('configure-preflight'); return { options }; },
    async runProductionPreflight() {
      calls.push('run-preflight');
      if (failPreflightError) throw failPreflightError;
      return { onboarding: { migrationPlan: { fatal: false } } };
    },
    async requestProductionTakeover() {
      calls.push('request-takeover');
      flag.requestEnable();
      previewEnabled = false;
      return { runtime: { state: PRODUCTION_RUNTIME_STATE.RELOAD_REQUIRED_FOR_V3 } };
    },
    async checkProductionPostReloadSelection() {
      calls.push('check-post-reload');
      return { state: PRODUCTION_RUNTIME_STATE.V3_STARTING, activationRequired: true };
    },
    async disposeProductionPreflight() { calls.push('dispose-preflight'); return true; },
    async configureProductionActiveStartup(options) { calls.push('configure-active'); configuredActiveOptions.push(options); return { options }; },
    async startProductionActiveRuntime() {
      calls.push('start-active');
      if (exerciseIdentityPin) {
        const resolver = configuredActiveOptions.at(-1)?.sourceIdentityResolver;
        const first = await resolver(context());
        const second = await resolver({ ...context(), chatId: 'drifted-during-startup' });
        identityDuringStart = { first, second };
      }
      if (failStart) {
        active = false;
        throw new Error('injected authority failure');
      }
      active = true;
      return { authoringAuthority: true, launcherMounted: true, authoringGateState: 'open', voiceRuntimeAvailable: false };
    },
    async returnProductionToPreview37() {
      calls.push('return-preview');
      active = false;
      previewEnabled = true;
      flag.requestDisable();
      return { restored: true };
    },
  };
  const control = createProductionUserControl({
    entryApi,
    hostApiLoader: async () => host,
    document,
    globalObject: { sessionStorage },
    featureFlagStorage: storage,
    previewReadSourceFactory: () => async () => {
      previewReadCalls += 1;
      return { available: true, sourceVersion: 2, sourceLocation: 'fixture', record: previewRecordFactory() };
    },
  });
  return {
    control, document, storage, sessionStorage, flag, calls, entryApi, configuredActiveOptions,
    get identityDuringStart() { return identityDuringStart; },
    get previewReadCalls() { return previewReadCalls; },
    get contextCalls() { return contextCalls; },
    get active() { return active; },
    get previewEnabled() { return previewEnabled; },
    set previewEnabled(value) { previewEnabled = value; },
  };
}

test('single TMRW Phone control mounts once with no Preview/Production mode switch controls', async () => {
  const h = harness();
  assert.equal(h.control.mount(), true);
  assert.equal(h.control.mount(), true);
  assert.equal(h.document.querySelectorAll(`#${PRODUCTION_USER_CONTROL_ID}`).length, 1);
  assert.equal(h.document.querySelector(`#${PRODUCTION_USER_STATUS_ID}`).textContent, 'TMRW Phone');
  assert.equal(h.document.querySelector(`#${PRODUCTION_USER_DIAGNOSTIC_ID}`).hidden, true);
  assert.equal(h.document.querySelector(`#${PRODUCTION_USER_RETRY_BUTTON_ID}`).hidden, true);
  assert.equal(h.document.querySelector('#tmrw-v3-production-use'), null);
  assert.equal(h.document.querySelector('#tmrw-v3-production-return'), null);
  assert.deepEqual(h.calls, []);
  assert.equal(h.entryApi.getProductionEntryStatus().databaseOpen, false);
  assert.equal(h.entryApi.getProductionEntryStatus().leaseAcquired, false);
  assert.equal(h.entryApi.getProductionEntryStatus().authoringGateOpen, false);
  assert.equal(h.document.querySelector('#tmrw-v3-phone-launcher'), null);
  const source = readFileSync(new URL('../../production/user-control.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Use TMRW Phone V3|Return to Preview 37|Preview is still safe/);
});

test('extension hook automatically starts the single TMRW Phone and reaches only the accepted takeover reload boundary', async () => {
  const h = harness();
  h.control.mount();
  await h.control.handleExtensionHook();
  assert.deepEqual(h.calls, ['configure-preflight', 'run-preflight', 'request-takeover']);
  assert.equal(h.flag.read().requested, true);
  assert.equal(h.previewEnabled, false);
  assert.equal(h.active, false);
  assert.equal(h.document.querySelector(`#${PRODUCTION_USER_RETRY_BUTTON_ID}`).hidden, true);
  assert.equal(h.document.querySelector('#tmrw-v3-phone-launcher'), null);
});

test('post-reload TMRW Phone intent reuses selection/startup contracts exactly once with no alternate-mode control', async () => {
  const h = harness();
  h.flag.requestEnable();
  h.previewEnabled = false;
  h.control.mount();
  await Promise.all([h.control.handleExtensionHook(), h.control.handleExtensionHook()]);
  assert.equal(h.calls.filter(value => value === 'check-post-reload').length, 1);
  assert.equal(h.calls.filter(value => value === 'configure-active').length, 1);
  assert.equal(h.calls.filter(value => value === 'start-active').length, 1);
  assert.equal(h.active, true);
  assert.equal(h.control.status.userStatus, 'TMRW Phone');
  assert.equal(h.document.querySelector(`#${PRODUCTION_USER_RETRY_BUTTON_ID}`).hidden, true);
  assert.equal(h.document.querySelector('#tmrw-v3-production-use'), null);
  assert.equal(h.document.querySelector('#tmrw-v3-production-return'), null);
  assert.equal(h.configuredActiveOptions.length, 1);
  assert.equal(Object.hasOwn(h.configuredActiveOptions[0], 'imageProviderConfig'), false);
  assert.equal(Object.keys(h.configuredActiveOptions[0]).some(key => /api.?key|pixabay|provider.?config/i.test(key)), false);
  assert.equal(h.entryApi.getProductionEntryStatus().voiceRuntimeAvailable, false);
  assert.equal(h.entryApi.getProductionEntryStatus().voiceProviderModelCalls, 0);
});

test('post-reload startup pins the first exact source identity only until startup completes', async () => {
  const h = harness({ exerciseIdentityPin: true });
  h.flag.requestEnable();
  h.previewEnabled = false;
  h.control.mount();
  await h.control.handleExtensionHook();
  assert.deepEqual(h.identityDuringStart?.first, {
    characterCardSourceId: 'character:alice.png',
    storySourceId: 'story:chat-a',
    routeSourceId: 'branch:main',
  });
  assert.deepEqual(h.identityDuringStart?.second, h.identityDuringStart?.first);
  const resolver = h.configuredActiveOptions[0].sourceIdentityResolver;
  await assert.rejects(() => resolver({ ...context(), chatId: 'drifted-after-startup' }), /exact migration scope/);
});

test('authority failure stays closed, preserves TMRW Phone retry intent, and never falls back to Preview', async () => {
  const h = harness({ failStart: true });
  h.flag.requestEnable();
  h.previewEnabled = false;
  h.control.mount();
  await h.control.handleExtensionHook();
  assert.equal(h.active, false);
  assert.equal(h.previewEnabled, false);
  assert.equal(h.flag.read().requested, true);
  assert.equal(h.document.querySelector('#tmrw-v3-phone-launcher'), null);
  assert.equal(h.control.status.userStatus, 'TMRW Phone unavailable');
  assert.equal(h.document.querySelector(`#${PRODUCTION_USER_RETRY_BUTTON_ID}`).hidden, false);
});

test('startup failure keeps technical detail internal while normal-user UX stays concise and retry-only', async () => {
  const h = harness({ failStart: true });
  h.flag.requestEnable();
  h.previewEnabled = false;
  h.control.mount();
  await h.control.handleExtensionHook();
  const diagnostic = h.document.querySelector(`#${PRODUCTION_USER_DIAGNOSTIC_ID}`);
  assert.equal(diagnostic.hidden, true);
  assert.equal(diagnostic.textContent, '');
  assert.equal(h.control.status.diagnosticStage, 'ACTIVE_STARTUP');
  assert.match(h.control.status.diagnosticReason, /injected authority failure/);
  assert.equal(h.document.querySelector(`#${PRODUCTION_USER_RETRY_BUTTON_ID}`).hidden, false);
  assert.equal(h.document.querySelector('#tmrw-v3-production-return'), null);
  const persisted = JSON.stringify(h.sessionStorage.snapshot());
  assert.match(persisted, /ACTIVE_STARTUP/);
  assert.equal(persisted.includes('stack'), false);
  assert.equal(persisted.includes('C:\\\\'), false);
  assert.equal(persisted.includes('http://'), false);
  assert.equal(persisted.includes('https://'), false);
});

test('exact PREFLIGHT canonical rejection metadata is consumed directly with no second Preview/context lookup', async () => {
  const legacyMembers = new Set(['sentinel-member-one', 'sentinel-member-two']);
  const record = previewRecordWithMembership(legacyMembers);
  let failure = null;
  try { canonicalJson(record); } catch (error) { failure = error; }
  assert.ok(failure instanceof TypeError);
  assert.equal(failure.code, 'TMRW_NON_JSON_VALUE');
  assert.equal(failure.message, 'value.cards.character:alice.png.stories.story:chat-a.branches.branch:main.shared.conversations[1].memberIds must be JSON-serializable data');
  assert.deepEqual(failure.tmrwNonJsonDiagnostic, {
    path: 'value.cards.character:alice.png.stories.story:chat-a.branches.branch:main.shared.conversations[1].memberIds',
    tag: '[object Set]', constructor: 'Set', array: false,
    typeof: 'object', iterable: true, plain: false,
  });

  const h = harness({
    failPreflightError: failure,
    previewRecordFactory: () => { throw new Error('direct rejection metadata must not trigger a second Preview read'); },
  });
  h.control.mount();
  await h.control.useProduction();

  const diagnostic = h.document.querySelector(`#${PRODUCTION_USER_DIAGNOSTIC_ID}`);
  assert.equal(h.control.status.diagnosticStage, 'PREFLIGHT');
  assert.deepEqual(h.control.status.legacyMembershipType, {
    tag: '[object Set]', constructor: 'Set', array: false,
    typeof: 'object', iterable: true, plain: false,
  });
  assert.equal(diagnostic.hidden, true);
  assert.equal(diagnostic.textContent, '');
  assert.equal(h.document.querySelector(`#${PRODUCTION_USER_RETRY_BUTTON_ID}`).hidden, false);
  assert.equal(h.previewReadCalls, 0);
  assert.equal(h.contextCalls, 0);
  assert.deepEqual(h.calls, ['configure-preflight', 'run-preflight', 'dispose-preflight']);

  const persisted = JSON.stringify(h.sessionStorage.snapshot());
  assert.match(persisted, /legacyMembershipType/);
  assert.equal(persisted.includes('sentinel-member-one'), false);
  assert.equal(persisted.includes('sentinel-member-two'), false);
  assert.equal(persisted.includes('tmrwNonJsonDiagnostic'), false);
  assert.equal(legacyMembers.size, 2);
  assert.strictEqual(record.cards['character:alice.png'].stories['story:chat-a'].branches['branch:main'].shared.conversations[1].memberIds, legacyMembers);
  assert.equal(h.active, false);
  assert.equal(h.entryApi.getProductionEntryStatus().databaseOpen, false);
  assert.equal(h.entryApi.getProductionEntryStatus().leaseAcquired, false);
  assert.equal(h.entryApi.getProductionEntryStatus().authoringGateOpen, false);
});

test('single-surface CSS hides the obsolete Preview launcher/runtime presentation while retaining Retry control hiding', () => {
  const css = readFileSync(new URL('../../production/package/style.css', import.meta.url), 'utf8');
  assert.equal(css.includes('#tmrw-v3-production-control [hidden]'), true);
  assert.match(css, /#tmrw-phone-launcher\s*\{\s*display: none !important;/);
  assert.match(css, /body:has\(#tmrw-phone-launcher\) #tmrw-phone-root/);
});

test('internal rollback API remains available for development evidence without a normal-user control', async () => {
  const h = harness();
  h.flag.requestEnable();
  h.previewEnabled = false;
  h.control.mount();
  await h.control.handleExtensionHook();
  assert.equal(h.active, true);
  await h.control.returnToPreview();
  assert.equal(h.calls.at(-1), 'return-preview');
  assert.equal(h.active, false);
  assert.equal(h.previewEnabled, true);
  assert.equal(h.flag.read().requested, false);
});

test('Preview source identity matches the exact current Preview card/story/branch convention and fails closed on mismatch', () => {
  assert.deepEqual(resolveCurrentPreview37SourceIdentity({ context: context(), record: previewRecord() }), {
    characterCardSourceId: 'character:alice.png',
    storySourceId: 'story:chat-a',
    routeSourceId: 'branch:main',
  });
  assert.throws(() => resolveCurrentPreview37SourceIdentity({ context: { ...context(), chatId: 'other-chat' }, record: previewRecord() }), /exact migration scope/);
});
