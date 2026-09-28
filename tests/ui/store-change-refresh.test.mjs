import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPhase9 } from '../phase9/call-fixtures.mjs';
import { TmrwPhoneShell, shouldRefreshPhoneRoute } from '../../v3/ui/shell.mjs';

const source = recordId => ({ authority: 'store-change-refresh-test', kind: 'test', recordId, version: '1' });
const threadInput = (context, key) => ({
  scope: context.scope,
  kind: 'dm',
  participantAccountIds: [context.user.accountId, context.alice.accountId],
  source: source(key),
  idempotencyKey: key,
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const find = (node, predicate) => {
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const result = find(child, predicate);
    if (result) return result;
  }
  return null;
};

test('canonical commit notification fires after commit, not on replay or failed write', async () => {
  const context = await setupPhase9({ castSize: 2, manifestId: 'store-change-commit' });
  const changes = [];
  context.engine.subscribeCommits(() => { throw new Error('observer failure cannot undo commit'); });
  const unsubscribe = context.engine.subscribeCommits(change => changes.push(change));
  const input = threadInput(context, 'first-thread');
  const first = await context.messages.createThread(input);
  assert.equal(first.replayed, false);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].operation, 'append');
  assert.equal(changes[0].eventTypes[0], 'messaging.thread-created.v1');
  assert.deepEqual(changes[0].scope, context.scope);
  assert.ok(await context.engine.getEvent(context.scope, changes[0].eventId));

  const replay = await context.messages.createThread(input);
  assert.equal(replay.replayed, true);
  assert.equal(changes.length, 1);
  await assert.rejects(context.messages.createThread({
    ...threadInput(context, 'invalid-thread'),
    participantAccountIds: [context.user.accountId, 'missing-account'],
  }));
  assert.equal(changes.length, 1);
  unsubscribe();
  await context.messages.createThread(threadInput(context, 'second-thread'));
  assert.equal(changes.length, 1);
});

test('route refresh mapping limits unrelated app redraws', () => {
  const message = { operation: 'append', eventTypes: ['messaging.message-sent.v1'] };
  const post = { operation: 'append', eventTypes: ['social.post-created.v1'] };
  assert.equal(shouldRefreshPhoneRoute('messages', message), true);
  assert.equal(shouldRefreshPhoneRoute('feed', message), false);
  assert.equal(shouldRefreshPhoneRoute('feed', post), true);
  assert.equal(shouldRefreshPhoneRoute('settings', post), false);
  assert.equal(shouldRefreshPhoneRoute('notifications', post), true);
  assert.equal(shouldRefreshPhoneRoute('notes', { operation: 'rebuild', eventTypes: [] }), true);
});

test('revision, retraction, and restoration each publish one committed change', async () => {
  const context = await setupPhase9({ castSize: 2, manifestId: 'store-change-revisions' });
  const changes = [];
  context.engine.subscribeCommits(change => changes.push(change));
  const created = await context.messages.createThread(threadInput(context, 'revision-thread'));
  const revised = await context.engine.revise({
    scope: context.scope, eventId: created.event.id, expectedRevision: created.event.revision,
    payload: created.event.payload, producer: 'store-change-test', idempotencyKey: 'revise-thread',
  });
  const retracted = await context.engine.retract({
    scope: context.scope, eventId: created.event.id, expectedRevision: revised.event.revision,
    producer: 'store-change-test', idempotencyKey: 'retract-thread', reason: 'test',
  });
  await context.engine.restore({
    scope: context.scope, eventId: created.event.id, expectedRevision: retracted.event.revision,
    producer: 'store-change-test', idempotencyKey: 'restore-thread', reason: 'test',
  });
  assert.deepEqual(changes.map(change => change.operation), ['append', 'revise', 'retract', 'restore']);
  assert.ok(changes.every(change => change.eventTypes.includes('messaging.thread-created.v1')));
});

test('mounted shell coalesces commits and ignores hidden phone', async () => {
  const context = await setupPhase9({ castSize: 2, manifestId: 'store-change-shell' });
  let notify = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('test voice manager offline'); };
  const shell = new TmrwPhoneShell({
    document: context.document,
    viewModels: context.viewModels,
    controller: context.controller,
    eventEngine: { subscribeCommits(callback) { notify = callback; return () => { notify = null; }; } },
    messageService: context.messages,
    callService: context.calls,
    scope: context.scope,
    playerActorId: context.user.actorId,
    playerInstanceId: context.user.instanceId,
    selectedDeviceId: context.user.deviceId,
  });
  globalThis.fetch = originalFetch;
  await shell.mount(context.target);
  await wait(80);
  const baseline = shell.metrics.appRegionUpdates;
  const change = { scope: context.scope, operation: 'append', eventTypes: ['messaging.thread-created.v1'] };
  notify({ ...change, scope: { ...context.scope, branchId: 'another-branch' } });
  await wait(60);
  assert.equal(shell.metrics.appRegionUpdates, baseline);
  notify(change);
  notify(change);
  await wait(120);
  assert.equal(shell.metrics.appRegionUpdates, baseline + 1);
  context.target.hidden = true;
  notify(change);
  await wait(120);
  assert.equal(shell.metrics.appRegionUpdates, baseline + 1);
  shell.dispose();
  assert.equal(notify, null);
});

test('store refresh retains the live message composer and typed draft', async () => {
  const context = await setupPhase9({ castSize: 2, manifestId: 'store-change-typing' });
  await context.messages.createThread(threadInput(context, 'typing-thread'));
  let notify = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('test voice manager offline'); };
  const shell = new TmrwPhoneShell({
    document: context.document,
    viewModels: context.viewModels,
    controller: context.controller,
    eventEngine: { subscribeCommits(callback) { notify = callback; return () => { notify = null; }; } },
    messageService: context.messages,
    callService: context.calls,
    scope: context.scope,
    playerActorId: context.user.actorId,
    playerInstanceId: context.user.instanceId,
    selectedDeviceId: context.user.deviceId,
  });
  globalThis.fetch = originalFetch;
  await shell.mount(context.target);
  find(shell.root, node => node.dataset?.action === 'unlock').click();
  await wait(80);
  find(shell.root, node => node.dataset?.app === 'insungram').click();
  await wait(80);
  find(shell.root, node => node.dataset?.threadId && node.tagName === 'button').click();
  await wait(80);
  const input = find(shell.root, node => node.tagName === 'textarea' && node.attributes?.get('aria-label') === 'ข้อความ');
  assert.ok(input);
  input.value = 'กำลังพิมพ์';
  for (const listener of input.listeners.get('input') || []) listener();
  notify({ scope: context.scope, operation: 'append', eventTypes: ['messaging.message-sent.v1'] });
  await wait(120);
  assert.strictEqual(find(shell.root, node => node.tagName === 'textarea' && node.attributes?.get('aria-label') === 'ข้อความ'), input);
  assert.equal(input.value, 'กำลังพิมพ์');
  shell.dispose();
});
