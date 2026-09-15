import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { setupPhase17 } from '../phase17/notification-fixtures.mjs';
import { mainRpSource, binding, explicitCall } from '../phase10/handoff-fixtures.mjs';
import { startCall, transitionCall, addCallText } from '../phase9/call-fixtures.mjs';
import { CALL_ACTION, CALL_STATE } from '../../domain/calls/call-state-machine.mjs';
import { CallStoryIntegrationCoordinator, CALL_CONTINUATION_ROUTE, CALL_INTENT_STATUS, detectCurrentCallIntent, decideCallContinuation } from '../../application/call-story-integration.mjs';
import { createSillyTavernV3RuntimeIntegration } from '../../platform/sillytavern/runtime-integration.mjs';
import { SillyTavernCallContinuationDriver } from '../../platform/sillytavern/call-continuation-driver.mjs';
import { TmrwPhoneShell } from '../../ui/shell.mjs';
import { openPreviewRoute } from '../phase23/true-preview-test-nav.mjs';

const source = recordId => ({ authority: 'phase18-closure-test', kind: 'test', recordId, version: '1' });
const settle = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(predicate) { for (let index = 0; index < 80; index += 1) { if (await predicate()) return; await settle(); } throw new Error('Closure async work did not settle'); }
function find(node, predicate) { if (predicate(node)) return node; for (const child of node.children || []) { const hit = find(child, predicate); if (hit) return hit; } return null; }
function findAll(node, predicate, output = []) { if (predicate(node)) output.push(node); for (const child of node.children || []) findAll(child, predicate, output); return output; }

function integration(c) {
  return new CallStoryIntegrationCoordinator({
    handoffCoordinator: c.handoff,
    callService: c.calls,
    callCoordinator: c.viewModels.callCoordinator,
    knowledgeService: c.knowledge,
    phoneContextBuilder: c.phoneContext,
    settingsService: c.settings,
  });
}

function callSource(c, text, { id = 'role-call', mentions = { Arin: c.alice }, actor = c.user, role = 'user', origin = 'main-rp', mode = 'normal' } = {}) {
  return mainRpSource(c, { id, ordinal: 0, role, text, actor, mentions, origin, mode });
}

class FakeEventSource {
  #listeners = new Map();
  on(type, handler) { if (!this.#listeners.has(type)) this.#listeners.set(type, []); this.#listeners.get(type).push(handler); }
  removeListener(type, handler) { const rows = this.#listeners.get(type) || []; this.#listeners.set(type, rows.filter(row => row !== handler)); }
  async emit(type, ...args) { for (const handler of [...(this.#listeners.get(type) || [])]) await handler(...args); }
}
const EVENT_TYPES = Object.freeze({ MESSAGE_SENT: 'sent', MESSAGE_RECEIVED: 'received', MESSAGE_SWIPED: 'swiped', MESSAGE_EDITED: 'edited', MESSAGE_DELETED: 'deleted', IMPERSONATE_READY: 'impersonate' });

function runtimeFor(c, chat, storyIntegration) {
  const eventSource = new FakeEventSource();
  const context = { chatId: 'phase18-closure-runtime', chat };
  const runtime = createSillyTavernV3RuntimeIntegration({
    eventSource,
    eventTypes: EVENT_TYPES,
    getContext: () => context,
    scopeResolver: async () => c.scope,
    bindingResolver: async ({ message, role }) => ({
      actorBinding: message?.is_user || role === 'assistant-target' ? binding(message?.is_user ? c.user : c.alice) : binding(c.alice),
      mentionBindings: String(message?.mes || '').includes('Arin') ? { Arin: [binding(c.alice)] } : {},
      explicitPhoneActions: message?.extra?.tmrwPhoneActions || [],
    }),
    handoffCoordinator: c.handoff,
    phoneContextBuilder: c.phoneContext,
    callStoryIntegration: storyIntegration,
    authoringEnabled: () => true,
  });
  return { runtime, eventSource, context };
}

test('current Thai and English Call actions resolve one exact target while preserving stable identity', async () => {
  const c = await setupPhase17({ manifestId: 'closure-intent-ready' });
  for (const text of ['ฉันโทรหา Arin', '*ฉันหยิบโทรศัพท์ขึ้นมาโทรหา Arin*', 'I call Arin']) {
    const result = detectCurrentCallIntent(callSource(c, text));
    assert.equal(result.status, CALL_INTENT_STATUS.READY);
    assert.equal(result.caller.accountId, c.user.accountId);
    assert.equal(result.called.accountId, c.alice.accountId);
  }
});

test('past, hypothetical, planned, negated, reported and quoted Call text never becomes a current Call action', async () => {
  const c = await setupPhase17({ manifestId: 'closure-intent-blocked' });
  const blocked = [
    'เมื่อวานฉันโทรหา Arin',
    'ถ้าฉันโทรหา Arin จะเป็นยังไง',
    'ฉันคิดว่าจะโทรหา Arin',
    'ฉันไม่โทรหา Arin หรอก',
    'เขาบอกว่าเขาเคยโทรหา Arin',
    'ตัวอย่าง: ฉันโทรหา Arin',
    '"ฉันโทรหา Arin"',
  ];
  for (const text of blocked) assert.notEqual(detectCurrentCallIntent(callSource(c, text)).status, CALL_INTENT_STATUS.READY, text);
});

test('ambiguous or unresolved Call targets fail closed', async () => {
  const c = await setupPhase17({ manifestId: 'closure-intent-ambiguous' });
  assert.equal(detectCurrentCallIntent(callSource(c, 'ฉันโทรหา Arin', { mentions: { Arin: [c.alice, c.bob] } })).status, CALL_INTENT_STATUS.AMBIGUOUS);
  assert.equal(detectCurrentCallIntent(callSource(c, 'ฉันโทรหา Someone', { mentions: {} })).status, CALL_INTENT_STATUS.AMBIGUOUS);
});

test('role-trigger interception commits one canonical Call, aborts normal generation and preserves the USER turn', async () => {
  const c = await setupPhase17({ manifestId: 'closure-role-intercept' }); const bridge = integration(c); const callbacks = [];
  const input = callSource(c, '*ฉันหยิบโทรศัพท์ขึ้นมาโทรหา Arin*', { id: 'role-intercept' });
  const first = await bridge.interceptRoleTriggeredCall({ scope: c.scope, source: input, abortGeneration: immediate => callbacks.push(['abort', immediate]), discardPartialAssistant: details => callbacks.push(['discard', details.sourceMessageId]) });
  const replay = await bridge.interceptRoleTriggeredCall({ scope: c.scope, source: input, abortGeneration: immediate => callbacks.push(['abort-replay', immediate]) });
  assert.equal(first.intercepted, true); assert.equal(first.userMessagePreserved, true); assert.equal(first.assistantResponseReplacedByCall, true); assert.equal(first.session.callSessionId, replay.session.callSessionId);
  assert.deepEqual(callbacks[0], ['abort', true]); assert.deepEqual(callbacks[1], ['discard', 'role-intercept']);
  assert.equal((await c.calls.listCalls({ scope: c.scope, viewerAccountId: c.user.accountId })).length, 1);
  assert.equal((await c.engine.listEvents(c.scope)).filter(event => event.eventType === 'calls.session-initiated.v1').length, 1);
});

test('SillyTavern generation interceptor aborts/discards a late partial assistant and repeated interception cannot duplicate the Call', async () => {
  const c = await setupPhase17({ manifestId: 'closure-runtime-intercept' }); const bridge = integration(c); const chat = [{ is_user: true, mes: '*ฉันโทรหา Arin*', extra: {} }]; const { runtime, eventSource } = runtimeFor(c, chat, bridge); runtime.register();
  await eventSource.emit(EVENT_TYPES.MESSAGE_SENT, 0);
  chat.push({ is_user: false, mes: 'PARTIAL-CONFLICTING-RP', extra: { is_hidden: true } });
  const aborts = []; await runtime.generateInterceptor([], 8192, immediate => aborts.push(immediate), 'normal');
  assert.deepEqual(aborts, [true]); assert.equal(chat.length, 1); assert.equal(chat[0].is_user, true); assert.doesNotMatch(JSON.stringify(chat), /PARTIAL-CONFLICTING-RP/);
  assert.equal((await c.engine.listEvents(c.scope)).filter(event => event.eventType === 'calls.session-initiated.v1').length, 1);
  await runtime.generateInterceptor([], 8192, immediate => aborts.push(immediate), 'normal');
  assert.equal((await c.engine.listEvents(c.scope)).filter(event => event.eventType === 'calls.session-initiated.v1').length, 1);
  assert.equal(runtime.metrics.activeCallGenerationBlocks >= 1, true); runtime.unregister();
});

test('active or ringing Call excludes unrelated Main RP generation without injecting a conflicting prompt', async () => {
  const c = await setupPhase17({ manifestId: 'closure-generation-lock' }); const bridge = integration(c); const call = await startCall(c, { key: 'lock' });
  const discarded = []; const aborted = [];
  const result = await bridge.guardMainRpGeneration({ scope: c.scope, accountId: c.user.accountId, abortGeneration: immediate => aborted.push(immediate), discardPartialAssistant: details => discarded.push(details.callSessionId) });
  assert.equal(result.blocked, true); assert.equal(result.callSessionId, call.session.callSessionId); assert.deepEqual(aborted, [true]); assert.deepEqual(discarded, [call.session.callSessionId]);
});

test('Call continuation routing is USER→Generate, BOT→Continue, and OFF→none', () => {
  assert.equal(decideCallContinuation({ enabled: true, latestVisibleRole: 'user' }), CALL_CONTINUATION_ROUTE.GENERATE);
  assert.equal(decideCallContinuation({ enabled: true, latestVisibleRole: 'assistant' }), CALL_CONTINUATION_ROUTE.CONTINUE);
  assert.equal(decideCallContinuation({ enabled: false, latestVisibleRole: 'user' }), CALL_CONTINUATION_ROUTE.NONE);
  assert.equal(decideCallContinuation({ enabled: false, oneShot: true, latestVisibleRole: 'assistant' }), CALL_CONTINUATION_ROUTE.CONTINUE);
});

test('Phone-triggered Call after latest USER commits canon then requests normal Generate when Auto Continue is ON', async () => {
  const c = await setupPhase17({ manifestId: 'closure-auto-user' }); const bridge = integration(c); await c.settings.setContinueStoryAfterCalls({ scope: c.scope, playerInstanceId: c.user.instanceId, enabled: true });
  const call = await startCall(c, { key: 'auto-user' }); await transitionCall(c, call.session.callSessionId, CALL_ACTION.ACCEPT, { actor: c.alice, key: 'auto-user-accept' }); const routes = [];
  const result = await bridge.endCall({ scope: c.scope, deviceId: c.user.deviceId, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, callSessionId: call.session.callSessionId, latestVisibleRole: 'user', continuationDriver: { generateStory: async () => routes.push('normal'), continueStory: async () => routes.push('continue') }, source: source('auto-user-end'), idempotencyKey: 'auto-user-end' });
  await result.continuationPromise; assert.equal(result.continuationRoute, CALL_CONTINUATION_ROUTE.GENERATE); assert.deepEqual(routes, ['normal']); assert.equal((await c.calls.getSession({ scope: c.scope, callSessionId: call.session.callSessionId })).state, CALL_STATE.ENDED);
});

test('Phone-triggered Call after latest BOT commits canon then requests Continue without inserting a fake USER role', async () => {
  const c = await setupPhase17({ manifestId: 'closure-auto-bot' }); const bridge = integration(c); await c.settings.setContinueStoryAfterCalls({ scope: c.scope, playerInstanceId: c.user.instanceId, enabled: true });
  const call = await startCall(c, { key: 'auto-bot' }); await transitionCall(c, call.session.callSessionId, CALL_ACTION.ACCEPT, { actor: c.alice, key: 'auto-bot-accept' }); const chat = [{ is_user: false, mes: 'Arin returns to his room.' }]; const generated = [];
  const driver = new SillyTavernCallContinuationDriver({ Generate: async type => generated.push(type), getContext: () => ({ chat }) }); assert.equal(driver.latestVisibleRole(), 'assistant');
  const result = await bridge.endCall({ scope: c.scope, deviceId: c.user.deviceId, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, callSessionId: call.session.callSessionId, latestVisibleRole: driver.latestVisibleRole(), continuationDriver: driver, source: source('auto-bot-end'), idempotencyKey: 'auto-bot-end' }); await result.continuationPromise;
  assert.deepEqual(generated, ['continue']); assert.equal(chat.length, 1); assert.equal(chat[0].is_user, false);
});

test('Auto Continue OFF changes only continuation: END_CALL, history and Knowledge still commit', async () => {
  const c = await setupPhase17({ manifestId: 'closure-auto-off' }); const bridge = integration(c); const call = await startCall(c, { key: 'auto-off' }); await transitionCall(c, call.session.callSessionId, CALL_ACTION.ACCEPT, { actor: c.alice, key: 'auto-off-accept' }); let generated = 0;
  const result = await bridge.endCall({ scope: c.scope, deviceId: c.user.deviceId, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, callSessionId: call.session.callSessionId, consequences: [{ kind: 'promise', text: 'Arin promised to meet at the station.' }], latestVisibleRole: 'user', continuationDriver: { generateStory: async () => { generated += 1; }, continueStory: async () => { generated += 1; } }, source: source('auto-off-end'), idempotencyKey: 'auto-off-end' });
  assert.equal(result.callCanonCommitted, true); assert.equal(result.continuationRoute, CALL_CONTINUATION_ROUTE.NONE); assert.equal(result.continuationScheduled, false); assert.equal(generated, 0); assert.equal((await c.calls.getSession({ scope: c.scope, callSessionId: call.session.callSessionId })).state, CALL_STATE.ENDED);
  assert.match((await c.knowledge.compileSafePromptContext({ scope: c.scope, actorId: c.alice.actorId, instanceId: c.alice.instanceId })).text, /promised to meet/);
});

test('END_CALL ordering exposes canon and durable consequence before optional continuation and cleanup does not hold the Ended UI', async () => {
  const c = await setupPhase17({ manifestId: 'closure-end-order' }); const bridge = integration(c); await c.settings.setContinueStoryAfterCalls({ scope: c.scope, playerInstanceId: c.user.instanceId, enabled: true }); const call = await startCall(c, { key: 'end-order' }); await transitionCall(c, call.session.callSessionId, CALL_ACTION.ACCEPT, { actor: c.alice, key: 'end-order-accept' }); const order = [];
  const driver = { generateStory: async () => { const ended = await c.calls.getSession({ scope: c.scope, callSessionId: call.session.callSessionId }); const knowledge = await c.knowledge.compileSafePromptContext({ scope: c.scope, actorId: c.user.actorId, instanceId: c.user.instanceId }); assert.equal(ended.state, CALL_STATE.ENDED); assert.match(knowledge.text, /mutual feelings were revealed/i); order.push('continuation'); } };
  const result = await bridge.endCall({ scope: c.scope, deviceId: c.user.deviceId, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, callSessionId: call.session.callSessionId, consequences: [{ kind: 'relationship', text: 'Mutual feelings were revealed.' }], latestVisibleRole: 'user', continuationDriver: driver, releaseEphemeral: async ({ continuationScheduled }) => { assert.equal(continuationScheduled, true); order.push('cleanup'); }, source: source('end-order'), idempotencyKey: 'end-order' });
  assert.equal(result.transcriptFinalizedByTerminalState, true); await result.continuationPromise; assert.equal(order.includes('cleanup'), true); assert.equal(order.includes('continuation'), true);
});

test('durable Call facts/promises/plans/secrets survive beyond bounded raw transcript handoff', async () => {
  const c = await setupPhase17({ manifestId: 'closure-durable' }); const bridge = integration(c); const call = await startCall(c, { key: 'durable' }); await transitionCall(c, call.session.callSessionId, CALL_ACTION.ACCEPT, { actor: c.alice, key: 'durable-accept' });
  for (let index = 0; index < 40; index += 1) await addCallText(c, call.session.callSessionId, { text: `throwaway transcript ${index}`, key: `durable-text-${index}` });
  await bridge.endCall({ scope: c.scope, deviceId: c.user.deviceId, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, callSessionId: call.session.callSessionId, consequences: [{ kind: 'fact', text: 'Arin lives above the old bookstore.' }, { kind: 'promise', text: 'Arin promised to bring the blue key.' }, { kind: 'plan', text: 'They will meet at the station at dawn.' }, { kind: 'secret', text: 'Only the participants learned the archive password clue.' }], latestVisibleRole: 'user', source: source('durable-end'), idempotencyKey: 'durable-end' });
  const handoff = await bridge.buildBoundedRpHandoff({ scope: c.scope, actorId: c.user.actorId, instanceId: c.user.instanceId, limit: 12, maxCharacters: 4000 });
  assert.match(handoff.text, /old bookstore|blue key|station at dawn|archive password clue/);
});

test('Call-derived durable consequences remain participant/Story/Branch scoped', async () => {
  const c = await setupPhase17({ manifestId: 'closure-privacy' }); const bridge = integration(c); const call = await startCall(c, { key: 'privacy' }); await transitionCall(c, call.session.callSessionId, CALL_ACTION.ACCEPT, { actor: c.alice, key: 'privacy-accept' });
  await bridge.endCall({ scope: c.scope, deviceId: c.user.deviceId, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, callSessionId: call.session.callSessionId, consequences: [{ kind: 'secret', text: 'PRIVATE-CALL-SECRET-CLOSURE' }], latestVisibleRole: 'user', source: source('privacy-end'), idempotencyKey: 'privacy-end' });
  assert.match((await c.knowledge.compileSafePromptContext({ scope: c.scope, actorId: c.alice.actorId, instanceId: c.alice.instanceId })).text, /PRIVATE-CALL-SECRET-CLOSURE/);
  assert.doesNotMatch((await c.knowledge.compileSafePromptContext({ scope: c.scope, actorId: c.bob.actorId, instanceId: c.bob.instanceId })).text, /PRIVATE-CALL-SECRET-CLOSURE/);
  const child = await c.kernel.forkBranch({ manifestId: 'closure-privacy-child', parentScope: c.scope, sourceRouteId: 'closure-child', label: 'Closure child' }); const childScope = { storyId: c.scope.storyId, branchId: child.branchId };
  assert.doesNotMatch((await c.knowledge.compileSafePromptContext({ scope: childScope, actorId: child.actorIds[0], instanceId: child.instanceIds[0] })).text, /PRIVATE-CALL-SECRET-CLOSURE/);
});

test('Director Undo of END_CALL retracts Call consequences caused by the end while unrelated canon survives', async () => {
  const c = await setupPhase17({ manifestId: 'closure-undo' }); const bridge = integration(c); const unrelated = await c.engine.append({ scope: c.scope, eventType: 'core.occurrence.v1', payload: { keep: true }, source: source('keep'), producer: 'closure-test', idempotencyKey: 'keep' }); const call = await startCall(c, { key: 'undo' }); await transitionCall(c, call.session.callSessionId, CALL_ACTION.ACCEPT, { actor: c.alice, key: 'undo-accept' });
  const ended = await bridge.endCall({ scope: c.scope, deviceId: c.user.deviceId, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, callSessionId: call.session.callSessionId, consequences: [{ kind: 'decision', text: 'UNDO-CALL-DECISION' }], latestVisibleRole: 'user', source: source('undo-end'), idempotencyKey: 'undo-end' });
  const preview = await c.undo.preview({ scope: c.scope, targetEventId: ended.event.id }); await c.undo.undo({ scope: c.scope, preview, reason: 'closure undo', idempotencyKey: 'closure-undo-end' });
  assert.equal((await c.calls.getSession({ scope: c.scope, callSessionId: call.session.callSessionId })).state, CALL_STATE.ACTIVE);
  assert.doesNotMatch((await c.knowledge.compileSafePromptContext({ scope: c.scope, actorId: c.user.actorId, instanceId: c.user.instanceId })).text, /UNDO-CALL-DECISION/);
  assert.equal((await c.engine.getEvent(c.scope, unrelated.event.id)).status, 'active');
});

test('assistant/bot explicit Call decision commits after its visible RP source and then generation guard blocks concurrent RP', async () => {
  const c = await setupPhase17({ manifestId: 'closure-bot-call' }); const bridge = integration(c); const rp = mainRpSource(c, { id: 'bot-call-source', ordinal: 8, role: 'assistant', actor: c.alice, text: 'Arin puts the book down and decides to call.', actions: [explicitCall(c.alice, c.user, { actionKey: 'bot-call' })] });
  const result = await c.handoff.processSource({ scope: c.scope, source: rp }); const committed = result.proposals.find(row => row.committed && row.event?.eventType === 'calls.session-initiated.v1'); assert.ok(committed); assert.equal(committed.session.calledAccountId, c.user.accountId);
  const guard = await bridge.guardMainRpGeneration({ scope: c.scope, accountId: c.user.accountId }); assert.equal(guard.blocked, true); assert.equal(guard.callSessionId, committed.session.callSessionId);
});

test('Continue story after calls setting is independent, defaults OFF, and survives preset changes', async () => {
  const c = await setupPhase17({ manifestId: 'closure-setting' }); let row = await c.settings.get({ scope: c.scope, playerInstanceId: c.user.instanceId }); assert.equal(row.continueStoryAfterCalls, false);
  row = await c.settings.setContinueStoryAfterCalls({ scope: c.scope, playerInstanceId: c.user.instanceId, enabled: true }); assert.equal(row.continueStoryAfterCalls, true);
  row = await c.settings.setPreset({ scope: c.scope, playerInstanceId: c.user.instanceId, preset: 'simple' }); assert.equal(row.continueStoryAfterCalls, true);
});

test('approved Call surface preserves incoming/outgoing/connected/ended canonical actions while speaker/mute remain explicitly deferred', async () => {
  const c = await setupPhase17({ manifestId: 'closure-ui-reference' }); const bridge = integration(c); const shell = new TmrwPhoneShell({ document: c.document, viewModels: c.viewModels, controller: c.controller, messageService: c.messages, callService: c.calls, callCoordinator: c.viewModels.callCoordinator, callStoryIntegration: bridge, socialService: c.social, notificationService: c.notifications, scope: c.scope, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, selectedDeviceId: c.user.deviceId }); const call = await startCall(c, { caller: c.alice, called: c.user, key: 'ui-ref' }); await shell.mount(c.target); await openPreviewRoute(shell, 'calls');
  let surface = find(shell.root, node => node.dataset?.presentationAuthority === 'v3/design/call-ui-authority' && node.dataset?.callState === 'ringing' && String(node.className || '').includes('tmrw-call-authority-incoming')); assert.ok(surface); assert.ok(find(surface, node => node.dataset?.callAction === 'accept')); assert.ok(find(surface, node => node.dataset?.callAction === 'decline'));
  find(surface, node => node.dataset?.callAction === 'accept').click(); await waitFor(async () => (await c.calls.getSession({ scope: c.scope, callSessionId: call.session.callSessionId })).state === CALL_STATE.ACTIVE); surface = find(shell.root, node => node.dataset?.presentationAuthority === 'v3/design/call-ui-authority' && node.dataset?.callState === 'active'); assert.ok(surface); const disabledVoice = findAll(surface, node => ['speaker', 'mute'].includes(node.dataset?.callAction)); assert.equal(disabledVoice.length, 2); assert.equal(disabledVoice.every(node => node.disabled), true);
  find(surface, node => node.dataset?.callAction === 'end').click(); await waitFor(async () => (await c.calls.getSession({ scope: c.scope, callSessionId: call.session.callSessionId })).state === CALL_STATE.ENDED); surface = find(shell.root, node => node.dataset?.presentationAuthority === 'v3/design/call-ui-authority' && node.dataset?.callState === 'ended'); assert.ok(surface); assert.equal(find(surface, node => node.dataset?.callAction === 'end'), null); const close = find(surface, node => node.dataset?.callAction === 'close-ended'); assert.ok(close); close.click(); await settle(); assert.equal(find(shell.root, node => node.dataset?.presentationAuthority === 'v3/design/call-ui-authority' && node.dataset?.callState === 'ended'), null); assert.ok(find(shell.root, node => node.dataset?.callSessionId === call.session.callSessionId));
});

test('settings UI preserves transparent Auto Continue cost alongside separately configured optional Voice', async () => {
  const c = await setupPhase17({ manifestId: 'closure-settings-ui' }); const shell = new TmrwPhoneShell({ document: c.document, viewModels: c.viewModels, controller: c.controller, messageService: c.messages, callService: c.calls, scope: c.scope, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, selectedDeviceId: c.user.deviceId }); await shell.mount(c.target); await openPreviewRoute(shell, 'settings'); const row = find(shell.root, node => node.tagName === 'button' && Boolean(find(node, child => child.tagName === 'strong' && child.textContent === 'Continue story after calls'))); assert.ok(row); assert.ok(find(row, node => node.tagName === 'small' && node.textContent === 'หลังสายจบ')); assert.ok(find(row, node => node.tagName === 'b' && node.textContent === 'ปิด')); row.click(); await settle(); assert.equal((await c.settings.get({ scope: c.scope, playerInstanceId: c.user.instanceId })).continueStoryAfterCalls, true);
});

test('Call Closure stays free of artificial latency/model internals/hidden canon while optional Voice V1 remains downstream of canonical handlers', async () => {
  const files = ['../../application/call-story-integration.mjs', '../../platform/sillytavern/runtime-integration.mjs', '../../platform/sillytavern/call-continuation-driver.mjs', '../../ui/calls/approved-call-surface.mjs'];
  const forbiddenCallRuntime = /setTimeout|setInterval|requestAnimationFrame|Date\.now|Opening Audio|voice warm|model loader|GPT-SoVITS|Irodori|\bRVC\b|VITS/;
  for (const relative of files) { const text = await fs.readFile(new URL(relative, import.meta.url), 'utf8'); assert.doesNotMatch(text, forbiddenCallRuntime); assert.doesNotMatch(text, /HIDDEN TMRW CALL EVENT|fake user|ghost message/i); }
  const shellText = await fs.readFile(new URL('../../ui/shell.mjs', import.meta.url), 'utf8');
  const callRender = shellText.match(/if\(route==='calls'\) \{[\s\S]*?if\(route==='gallery'\)/)?.[0] || '';
  const callHandlers = shellText.match(/async #startOutgoing\([\s\S]*?async #runGuideMutation/)?.[0] || '';
  const callContinuation = shellText.match(/async #continueAfterEnded\([\s\S]*?async #openNotification/)?.[0] || '';
  assert.ok(callRender && callHandlers && callContinuation, 'Phase18 Call-specific shell source slices must remain discoverable');
  for (const callSlice of [callRender, callHandlers, callContinuation]) { assert.doesNotMatch(callSlice, forbiddenCallRuntime); assert.doesNotMatch(callSlice, /HIDDEN TMRW CALL EVENT|fake user|ghost message/i); }
  const css = await fs.readFile(new URL('../../ui/call-authority.css', import.meta.url), 'utf8'); assert.match(css, /#fbfbfc/); assert.match(css, /#f3f3f5/); assert.match(css, /tmrw-call-authority-surface/); assert.match(css, /min-height:44px/); assert.match(css, /max-width:430px/);
});

test('SillyTavern continuation driver maps directly to installed Generate contract and never mutates chat', async () => {
  const chat = [{ is_user: true, mes: 'User turn' }, { is_user: false, mes: 'Bot turn' }]; const calls = []; const driver = new SillyTavernCallContinuationDriver({ Generate: async type => calls.push(type), getContext: () => ({ chat }) }); const before = structuredClone(chat); assert.equal(driver.latestVisibleRole(), 'assistant'); await driver.continueStory(); await driver.generateStory(); assert.deepEqual(calls, ['continue', 'normal']); assert.deepEqual(chat, before);
});

test('quiet and impersonate generation modes never trigger a role Call from visible Call-like text', async () => {
  const c = await setupPhase17({ manifestId: 'closure-quiet-impersonate' }); const bridge = integration(c); const chat = [{ is_user: true, mes: 'ฉันโทรหา Arin', extra: {} }]; const { runtime } = runtimeFor(c, chat, bridge); const aborts = [];
  await runtime.generateInterceptor([], 8192, value => aborts.push(value), 'quiet'); await runtime.generateInterceptor([], 8192, value => aborts.push(value), 'impersonate');
  assert.equal((await c.calls.listCalls({ scope: c.scope, viewerAccountId: c.user.accountId })).length, 0); assert.deepEqual(aborts, []);
});

test('assistant regenerate/swipe events cannot duplicate an existing role-triggered Call', async () => {
  const c = await setupPhase17({ manifestId: 'closure-regenerate-swipe' }); const bridge = integration(c); const chat = [{ is_user: true, mes: 'ฉันโทรหา Arin', extra: {} }]; const { runtime, eventSource } = runtimeFor(c, chat, bridge); runtime.register(); await eventSource.emit(EVENT_TYPES.MESSAGE_SENT, 0); const original = (await c.calls.listCalls({ scope: c.scope, viewerAccountId: c.user.accountId }))[0];
  chat.push({ is_user: false, mes: 'Assistant regenerated narrative with no Call action.', swipe_id: 1, extra: {} }); await eventSource.emit(EVENT_TYPES.MESSAGE_RECEIVED, 1, 'regenerate'); await eventSource.emit(EVENT_TYPES.MESSAGE_SWIPED, 1);
  const calls = await c.calls.listCalls({ scope: c.scope, viewerAccountId: c.user.accountId }); assert.equal(calls.length, 1); assert.equal(calls[0].callSessionId, original.callSessionId); runtime.unregister();
});

test('Closure reload creates no second Call universe: a fresh integration reads and guards the same canonical Session', async () => {
  const c = await setupPhase17({ manifestId: 'closure-reload' }); const firstBridge = integration(c); const created = await firstBridge.interceptRoleTriggeredCall({ scope: c.scope, source: callSource(c, 'ฉันโทรหา Arin', { id: 'reload-call' }) }); assert.ok(created.session?.callSessionId);
  const reloadedBridge = integration(c); const guard = await reloadedBridge.guardMainRpGeneration({ scope: c.scope, accountId: c.user.accountId }); assert.equal(guard.blocked, true); assert.equal(guard.callSessionId, created.session.callSessionId); assert.equal((await c.calls.listCalls({ scope: c.scope, viewerAccountId: c.user.accountId })).length, 1);
});

test('repeated one-shot Continue after an ended Call never recreates or mutates canonical Call truth', async () => {
  const c = await setupPhase17({ manifestId: 'closure-repeated-continue' }); const bridge = integration(c); const call = await startCall(c, { key: 'repeat-continue' }); await transitionCall(c, call.session.callSessionId, CALL_ACTION.ACCEPT, { actor: c.alice, key: 'repeat-continue-accept' }); await bridge.endCall({ scope: c.scope, deviceId: c.user.deviceId, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, callSessionId: call.session.callSessionId, latestVisibleRole: 'assistant', source: source('repeat-continue-end'), idempotencyKey: 'repeat-continue-end' }); const generated = []; const driver = { continueStory: async () => generated.push('continue'), generateStory: async () => generated.push('normal') };
  const a = bridge.continueAfterEnded({ scope: c.scope, callSessionId: call.session.callSessionId, latestVisibleRole: 'assistant', continuationDriver: driver }); const b = bridge.continueAfterEnded({ scope: c.scope, callSessionId: call.session.callSessionId, latestVisibleRole: 'assistant', continuationDriver: driver }); await Promise.all([a.promise, b.promise]); assert.deepEqual(generated, ['continue', 'continue']); assert.equal((await c.calls.listCalls({ scope: c.scope, viewerAccountId: c.user.accountId })).length, 1); assert.equal((await c.engine.listEvents(c.scope)).filter(event => event.eventType === 'calls.session-initiated.v1').length, 1); assert.equal((await c.calls.getSession({ scope: c.scope, callSessionId: call.session.callSessionId })).state, CALL_STATE.ENDED);
});

test('role-trigger source edit/delete and repeated Continue cannot recreate a logical Call effect', async () => {
  const c = await setupPhase17({ manifestId: 'closure-idempotency' }); const bridge = integration(c); const chat = [{ is_user: true, mes: 'ฉันโทรหา Arin', extra: {} }]; const { runtime, eventSource } = runtimeFor(c, chat, bridge); runtime.register(); await eventSource.emit(EVENT_TYPES.MESSAGE_SENT, 0); await eventSource.emit(EVENT_TYPES.MESSAGE_SENT, 0); assert.equal((await c.engine.listEvents(c.scope)).filter(e => e.eventType === 'calls.session-initiated.v1' && e.status === 'active').length, 1);
  chat[0] = { is_user: true, mes: 'ฉันนั่งอยู่เงียบ ๆ', swipe_id: 1, extra: {} }; await eventSource.emit(EVENT_TYPES.MESSAGE_EDITED, 0); assert.equal((await c.calls.listCalls({ scope: c.scope, viewerAccountId: c.user.accountId })).length, 0);
  await eventSource.emit(EVENT_TYPES.MESSAGE_DELETED, 0); assert.equal((await c.calls.listCalls({ scope: c.scope, viewerAccountId: c.user.accountId })).length, 0); runtime.unregister();
});
