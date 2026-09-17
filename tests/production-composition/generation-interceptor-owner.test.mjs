import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { ProductionListenerOwner } from '../../production/listener-owner.mjs';
import { GenerationInterceptorOwner } from '../../production/generation-interceptor-owner.mjs';
import { V3_GENERATION_INTERCEPTOR_KEY, V3_PRODUCTION_RUNTIME_ID } from '../../production/constants.mjs';
import { createSillyTavernV3RuntimeIntegration } from '../../platform/sillytavern/runtime-integration.mjs';
import { CallStoryIntegrationCoordinator } from '../../application/call-story-integration.mjs';
import { setupPhase17 } from '../phase17/notification-fixtures.mjs';
import { binding } from '../phase10/handoff-fixtures.mjs';

const PASSIVE_SHIM_MARKER = Symbol.for('tmrw.v3.production.passive-generation-interceptor');

class FakeGate {
  constructor(state = 'closed') { this.state = state; this.reasons = []; }
  allows(capability) { return capability === 'normal' && this.state === 'open'; }
  close(reason = 'closed') { this.state = 'closed'; this.reasons.push(reason); return { state: this.state, reason }; }
  openForTest() { this.state = 'open'; }
}

class FakeEventSource {
  listeners = new Map();
  on(type, handler) { const rows = this.listeners.get(type) || []; rows.push(handler); this.listeners.set(type, rows); }
  removeListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(row => row !== handler)); }
  count(type) { return (this.listeners.get(type) || []).length; }
  async emit(type, ...args) { for (const handler of [...(this.listeners.get(type) || [])]) await handler(...args); }
}

class FakeRuntimeIntegration {
  registerCalls = 0;
  unregisterCalls = 0;
  generationCalls = 0;
  registered = false;
  generate = async () => {};
  register() { this.registerCalls += 1; if (this.registered) return false; this.registered = true; return true; }
  unregister() { this.unregisterCalls += 1; if (!this.registered) return false; this.registered = false; return true; }
  async generateInterceptor(chat, contextSize, abort, type) { this.generationCalls += 1; return this.generate(chat, contextSize, abort, type); }
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

function passiveGlobal() {
  const globalObject = {};
  const shim = async () => {};
  Object.defineProperty(shim, PASSIVE_SHIM_MARKER, { value: V3_PRODUCTION_RUNTIME_ID });
  globalObject[V3_GENERATION_INTERCEPTOR_KEY] = shim;
  return globalObject;
}

function callIntegration(c) {
  return new CallStoryIntegrationCoordinator({
    handoffCoordinator: c.handoff,
    callService: c.calls,
    callCoordinator: c.viewModels.callCoordinator,
    knowledgeService: c.knowledge,
    phoneContextBuilder: c.phoneContext,
    settingsService: c.settings,
  });
}

function realRuntime(c, gate, chat) {
  const eventSource = new FakeEventSource();
  const context = { chatId: 's07-role-call', chat };
  const runtime = createSillyTavernV3RuntimeIntegration({
    eventSource,
    eventTypes: EVENT_TYPES,
    getContext: () => context,
    scopeResolver: async () => c.scope,
    bindingResolver: async ({ message, role }) => {
      const actor = role === 'assistant-target' ? c.alice : (message?.is_user ? c.user : c.alice);
      return {
        actorBinding: binding(actor),
        mentionBindings: String(message?.mes || '').includes('Arin') ? { Arin: [binding(c.alice)] } : {},
        explicitPhoneActions: message?.extra?.tmrwPhoneActions || [],
      };
    },
    handoffCoordinator: c.handoff,
    phoneContextBuilder: c.phoneContext,
    callStoryIntegration: callIntegration(c),
    authoringEnabled: () => gate.allows('normal'),
  });
  return { runtime, eventSource, context };
}

test('standby runtime cannot claim production listener ownership', () => {
  const runtime = new FakeRuntimeIntegration();
  const eventSource = new FakeEventSource();
  const gate = new FakeGate();
  const owner = new ProductionListenerOwner({ runtimeIntegration: runtime, eventSource, eventTypes: EVENT_TYPES, authoringGate: gate, runtimeGuard: { ownsLease: false }, onScopeChange: async () => {} });
  assert.equal(owner.register(), false);
  assert.equal(runtime.registerCalls, 0);
  assert.equal(eventSource.count(EVENT_TYPES.CHAT_CHANGED), 0);
  assert.equal(owner.status.registered, false);
});

test('listener owner registers exactly once; duplicate owner and repeated registration are rejected', () => {
  const runtime = new FakeRuntimeIntegration();
  const eventSource = new FakeEventSource();
  const gate = new FakeGate();
  const guard = { ownsLease: true };
  const first = new ProductionListenerOwner({ runtimeIntegration: runtime, eventSource, eventTypes: EVENT_TYPES, authoringGate: gate, runtimeGuard: guard, onScopeChange: async () => {} });
  const second = new ProductionListenerOwner({ runtimeIntegration: new FakeRuntimeIntegration(), eventSource, eventTypes: EVENT_TYPES, authoringGate: gate, runtimeGuard: guard, onScopeChange: async () => {} });
  assert.equal(first.register(), true);
  assert.equal(first.register(), false);
  assert.equal(second.register(), false);
  assert.equal(runtime.registerCalls, 1);
  assert.equal(eventSource.count(EVENT_TYPES.CHAT_CHANGED), 1);
  assert.equal(first.unregister(), true);
});

test('gate-closed listener ownership is passive and Story/Branch scope callback runs once only after gate opens', async () => {
  const runtime = new FakeRuntimeIntegration();
  const eventSource = new FakeEventSource();
  const gate = new FakeGate();
  let scopeChanges = 0;
  const owner = new ProductionListenerOwner({ runtimeIntegration: runtime, eventSource, eventTypes: EVENT_TYPES, authoringGate: gate, runtimeGuard: { ownsLease: true }, onScopeChange: async () => { scopeChanges += 1; } });
  assert.equal(owner.register(), true);
  await eventSource.emit(EVENT_TYPES.CHAT_CHANGED, 'story-a');
  assert.equal(scopeChanges, 0);
  gate.openForTest();
  await eventSource.emit(EVENT_TYPES.CHAT_CHANGED, 'story-b');
  assert.equal(scopeChanges, 1);
  owner.unregister();
});

test('listener critical scope-transition error closes authoring and never duplicates the callback', async () => {
  const runtime = new FakeRuntimeIntegration();
  const eventSource = new FakeEventSource();
  const gate = new FakeGate('open');
  let calls = 0;
  const owner = new ProductionListenerOwner({ runtimeIntegration: runtime, eventSource, eventTypes: EVENT_TYPES, authoringGate: gate, runtimeGuard: { ownsLease: true }, onScopeChange: async () => { calls += 1; throw new Error('scope-resolution-failed'); } });
  owner.register();
  await eventSource.emit(EVENT_TYPES.CHAT_CHANGED, 'bad-scope');
  assert.equal(calls, 1);
  assert.equal(gate.state, 'closed');
  assert.equal(gate.reasons.at(-1), 'listener-critical-error');
  assert.match(owner.status.lastError, /scope-resolution-failed/);
  owner.unregister();
});

test('a later CHAT_CHANGED retries a failed scope transition even while authoring remains closed', async () => {
  const runtime = new FakeRuntimeIntegration();
  const eventSource = new FakeEventSource();
  const gate = new FakeGate('open');
  const routed = [];
  let fail = true;
  const owner = new ProductionListenerOwner({
    runtimeIntegration: runtime,
    eventSource,
    eventTypes: EVENT_TYPES,
    authoringGate: gate,
    runtimeGuard: { ownsLease: true },
    onScopeChange: async scope => {
      routed.push(scope);
      if (fail) { fail = false; throw new Error('first-remount-failed'); }
    },
  });
  owner.register();
  await eventSource.emit(EVENT_TYPES.CHAT_CHANGED, 'kaelan');
  assert.equal(gate.state, 'closed');
  await eventSource.emit(EVENT_TYPES.CHAT_CHANGED, 'jaren');
  assert.deepEqual(routed, ['kaelan', 'jaren']);
  assert.equal(owner.status.lastError, null);
  owner.unregister();
});

test('listener cleanup is idempotent, releases exact ownership, and leaves no stale scope listener', () => {
  const eventSource = new FakeEventSource();
  const gate = new FakeGate();
  const guard = { ownsLease: true };
  const runtimeA = new FakeRuntimeIntegration();
  const first = new ProductionListenerOwner({ runtimeIntegration: runtimeA, eventSource, eventTypes: EVENT_TYPES, authoringGate: gate, runtimeGuard: guard, onScopeChange: async () => {} });
  assert.equal(first.register(), true);
  assert.equal(first.unregister(), true);
  assert.equal(first.unregister(), false);
  assert.equal(runtimeA.unregisterCalls, 1);
  assert.equal(eventSource.count(EVENT_TYPES.CHAT_CHANGED), 0);
  const second = new ProductionListenerOwner({ runtimeIntegration: new FakeRuntimeIntegration(), eventSource, eventTypes: EVENT_TYPES, authoringGate: gate, runtimeGuard: guard, onScopeChange: async () => {} });
  assert.equal(second.register(), true);
  assert.equal(second.unregister(), true);
});

test('generation owner adopts only the known passive S04 shim and rejects unknown global ownership', () => {
  const gate = new FakeGate();
  const guard = { ownsLease: true };
  const globalObject = passiveGlobal();
  const owner = new GenerationInterceptorOwner({ authoringGate: gate, runtimeGuard: guard, globalObject });
  assert.equal(owner.installShim(), true);
  assert.equal(owner.installShim(), false);
  assert.equal(owner.status.installed, true);

  const unknownGlobal = { [V3_GENERATION_INTERCEPTOR_KEY]: async () => {} };
  const conflict = new GenerationInterceptorOwner({ authoringGate: gate, runtimeGuard: guard, globalObject: unknownGlobal });
  assert.equal(conflict.installShim(), false);
  assert.equal(conflict.status.conflict, true);
  owner.dispose();
});

test('standby runtime cannot activate a generation delegate even if requested intent exists elsewhere', () => {
  const globalObject = passiveGlobal();
  const gate = new FakeGate();
  const runtime = new FakeRuntimeIntegration();
  const owner = new GenerationInterceptorOwner({ authoringGate: gate, runtimeGuard: { ownsLease: false }, globalObject });
  assert.equal(owner.installShim(), true);
  assert.equal(owner.activateDelegate(runtime), false);
  assert.equal(owner.status.delegateActive, false);
  owner.dispose();
});

test('repeated delegate activation is duplicate-safe and gate-closed invocation remains passive', async () => {
  const globalObject = passiveGlobal();
  const gate = new FakeGate();
  const runtime = new FakeRuntimeIntegration();
  const owner = new GenerationInterceptorOwner({ authoringGate: gate, runtimeGuard: { ownsLease: true }, globalObject });
  owner.installShim();
  assert.equal(owner.activateDelegate(runtime), true);
  assert.equal(owner.activateDelegate(runtime), false);
  await globalObject[V3_GENERATION_INTERCEPTOR_KEY]([], 4096, () => { throw new Error('must-not-abort'); }, 'normal');
  assert.equal(runtime.generationCalls, 0);
  assert.equal(owner.status.abortCalls, 0);
  owner.dispose();
});

test('gate-open generation invokes exactly one active delegate once', async () => {
  const globalObject = passiveGlobal();
  const gate = new FakeGate('open');
  const runtime = new FakeRuntimeIntegration();
  const owner = new GenerationInterceptorOwner({ authoringGate: gate, runtimeGuard: { ownsLease: true }, globalObject });
  owner.installShim();
  owner.activateDelegate(runtime);
  await globalObject[V3_GENERATION_INTERCEPTOR_KEY]([], 4096, () => {}, 'normal');
  assert.equal(runtime.generationCalls, 1);
  assert.equal(owner.status.invocations, 1);
  owner.dispose();
});

test('loss of runtime ownership closes the gate before delegate behavior can run', async () => {
  const globalObject = passiveGlobal();
  const gate = new FakeGate('open');
  const guard = { ownsLease: true };
  const runtime = new FakeRuntimeIntegration();
  const owner = new GenerationInterceptorOwner({ authoringGate: gate, runtimeGuard: guard, globalObject });
  owner.installShim(); owner.activateDelegate(runtime);
  guard.ownsLease = false;
  await globalObject[V3_GENERATION_INTERCEPTOR_KEY]([], 4096, () => {}, 'normal');
  assert.equal(runtime.generationCalls, 0);
  assert.equal(gate.state, 'closed');
  assert.equal(gate.reasons.at(-1), 'generation-interceptor-runtime-owner-lost');
  owner.dispose();
});

test('critical generation error fails closed and external abort fires exactly once even if delegate already aborted', async () => {
  const globalObject = passiveGlobal();
  const gate = new FakeGate('open');
  const runtime = new FakeRuntimeIntegration();
  runtime.generate = async (chat, contextSize, abort) => { abort(true); throw new Error('critical-call-error'); };
  const owner = new GenerationInterceptorOwner({ authoringGate: gate, runtimeGuard: { ownsLease: true }, globalObject });
  owner.installShim(); owner.activateDelegate(runtime);
  let aborts = 0;
  await globalObject[V3_GENERATION_INTERCEPTOR_KEY]([], 4096, () => { aborts += 1; }, 'normal');
  assert.equal(aborts, 1);
  assert.equal(owner.status.abortCalls, 1);
  assert.equal(gate.state, 'closed');
  assert.equal(gate.reasons.at(-1), 'generation-interceptor-critical-error');
  assert.match(owner.status.lastError, /critical-call-error/);
  owner.dispose();
});

test('generation cleanup is idempotent, removes active delegate, and permits a fresh owner to adopt only a passive shim', () => {
  const globalObject = passiveGlobal();
  const gate = new FakeGate();
  const guard = { ownsLease: true };
  const first = new GenerationInterceptorOwner({ authoringGate: gate, runtimeGuard: guard, globalObject });
  first.installShim(); first.activateDelegate(new FakeRuntimeIntegration());
  assert.equal(first.dispose(), true);
  assert.equal(first.dispose(), false);
  assert.equal(first.status.delegateActive, false);
  assert.equal(globalObject[V3_GENERATION_INTERCEPTOR_KEY][PASSIVE_SHIM_MARKER], V3_PRODUCTION_RUNTIME_ID);
  const second = new GenerationInterceptorOwner({ authoringGate: gate, runtimeGuard: guard, globalObject });
  assert.equal(second.installShim(), true);
  assert.equal(second.dispose(), true);
});

test('real frozen role-triggered Call interception through the generation owner aborts exactly once and creates one Call', async () => {
  const c = await setupPhase17({ manifestId: 's07-real-role-call' });
  const gate = new FakeGate('open');
  const globalObject = passiveGlobal();
  const chat = [{ is_user: true, mes: 'I call Arin', extra: {} }];
  const { runtime } = realRuntime(c, gate, chat);
  const owner = new GenerationInterceptorOwner({ authoringGate: gate, runtimeGuard: { ownsLease: true }, globalObject });
  owner.installShim();
  assert.equal(owner.activateDelegate(runtime), true);
  assert.equal(owner.activateDelegate(runtime), false);
  let aborts = 0;
  await globalObject[V3_GENERATION_INTERCEPTOR_KEY]([], 4096, () => { aborts += 1; }, 'normal');
  const calls = await c.calls.listCalls({ scope: c.scope, viewerAccountId: c.user.accountId, limit: 10 });
  assert.equal(aborts, 1);
  assert.equal(runtime.metrics.abortCalls, 1);
  assert.equal(runtime.metrics.roleCallsIntercepted, 1);
  assert.equal(calls.length, 1);
  owner.dispose();
  c.database.close();
});

test('real frozen runtime remains zero-write while generation delegate exists but Authoring Gate is closed', async () => {
  const c = await setupPhase17({ manifestId: 's07-passive-real-runtime' });
  const gate = new FakeGate('closed');
  const globalObject = passiveGlobal();
  const chat = [{ is_user: true, mes: 'I call Arin', extra: {} }];
  const { runtime } = realRuntime(c, gate, chat);
  const owner = new GenerationInterceptorOwner({ authoringGate: gate, runtimeGuard: { ownsLease: true }, globalObject });
  owner.installShim(); owner.activateDelegate(runtime);
  const before = c.database.diagnostics.writeCommits;
  let aborts = 0;
  await globalObject[V3_GENERATION_INTERCEPTOR_KEY]([], 4096, () => { aborts += 1; }, 'normal');
  assert.equal(c.database.diagnostics.writeCommits, before);
  assert.equal(aborts, 0);
  assert.equal(runtime.metrics.roleCallsIntercepted, 0);
  owner.dispose();
  c.database.close();
});

test('second generation-owner instance cannot claim the same live global owner', () => {
  const globalObject = passiveGlobal();
  const gate = new FakeGate();
  const guard = { ownsLease: true };
  const first = new GenerationInterceptorOwner({ authoringGate: gate, runtimeGuard: guard, globalObject });
  const second = new GenerationInterceptorOwner({ authoringGate: gate, runtimeGuard: guard, globalObject });
  assert.equal(first.installShim(), true);
  assert.equal(second.installShim(), false);
  assert.equal(second.status.conflict, true);
  assert.equal(first.dispose(), true);
});

test('real frozen listener callbacks stay zero-write while Authoring Gate is closed', async () => {
  const c = await setupPhase17({ manifestId: 's07-passive-real-listener' });
  const gate = new FakeGate('closed');
  const chat = [{ is_user: true, mes: 'I call Arin', extra: {} }];
  const { runtime, eventSource } = realRuntime(c, gate, chat);
  const owner = new ProductionListenerOwner({
    runtimeIntegration: runtime,
    eventSource,
    eventTypes: EVENT_TYPES,
    authoringGate: gate,
    runtimeGuard: { ownsLease: true },
    onScopeChange: async () => { throw new Error('closed gate must not route scope'); },
  });
  const before = c.database.diagnostics.writeCommits;
  assert.equal(owner.register(), true);
  await eventSource.emit(EVENT_TYPES.MESSAGE_SENT, 0);
  await eventSource.emit(EVENT_TYPES.CHAT_CHANGED, 'new-chat');
  assert.equal(c.database.diagnostics.writeCommits, before);
  assert.equal(runtime.metrics.processed, 0);
  assert.ok(runtime.metrics.skipped >= 1);
  assert.equal(owner.unregister(), true);
  c.database.close();
});

test('listener registration failure closes the gate and releases ownership for a later clean owner', () => {
  const eventSource = new FakeEventSource();
  const gate = new FakeGate('open');
  const guard = { ownsLease: true };
  const broken = new FakeRuntimeIntegration();
  broken.register = () => { throw new Error('register-broke'); };
  const failed = new ProductionListenerOwner({ runtimeIntegration: broken, eventSource, eventTypes: EVENT_TYPES, authoringGate: gate, runtimeGuard: guard, onScopeChange: async () => {} });
  assert.equal(failed.register(), false);
  assert.equal(gate.state, 'closed');
  assert.equal(gate.reasons.at(-1), 'listener-registration-error');
  assert.match(failed.status.lastError, /register-broke/);
  const clean = new ProductionListenerOwner({ runtimeIntegration: new FakeRuntimeIntegration(), eventSource, eventTypes: EVENT_TYPES, authoringGate: gate, runtimeGuard: guard, onScopeChange: async () => {} });
  assert.equal(clean.register(), true);
  assert.equal(clean.unregister(), true);
});

test('S07 source owns only global-hook registration and delegates identity/Call semantics to frozen existing integration', async () => {
  const [listenerSource, generationSource] = await Promise.all([
    fs.readFile(new URL('../../production/listener-owner.mjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../production/generation-interceptor-owner.mjs', import.meta.url), 'utf8'),
  ]);
  const source = `${listenerSource}\n${generationSource}`;
  assert.doesNotMatch(source, /V3IdentityKernel|resolveMappedSillyTavernScope|fuzzy|mount\(|launcher|composition-root/i);
  assert.doesNotMatch(source, /requestEnable|V3BetaFeatureFlag|requested\s*=/i);
  assert.match(listenerSource, /runtimeIntegration\.register\(\)/);
  assert.match(listenerSource, /runtimeIntegration\.unregister\(\)/);
  assert.match(generationSource, /delegate\.generateInterceptor/);
});
