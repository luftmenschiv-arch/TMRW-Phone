import test from 'node:test';
import assert from 'node:assert/strict';
import { TmrwPhoneShell } from '../../ui/shell.mjs';
import { setupPhase17 } from '../phase17/notification-fixtures.mjs';
import { createDm, sendFrom } from '../phase8/messaging-fixtures.mjs';
import { startCall } from '../phase9/call-fixtures.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(predicate) { for (let index = 0; index < 100; index += 1) { if (await predicate()) return; await settle(); } throw new Error('P23 communication UI did not settle'); }
function find(node, predicate) { if (predicate(node)) return node; for (const child of node.children || []) { const hit = find(child, predicate); if (hit) return hit; } return null; }
function allText(node, out = []) { if (node.textContent) out.push(String(node.textContent)); for (const child of node.children || []) allText(child, out); return out.join(' '); }
function shellFor(c) { return new TmrwPhoneShell({ document: c.document, viewModels: c.viewModels, controller: c.controller, messageService: c.messages, callService: c.calls, callCoordinator: c.viewModels.callCoordinator, socialService: c.social, notificationService: c.notifications, scope: c.scope, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, selectedDeviceId: c.user.deviceId }); }
async function open(shell, route) { const button = find(shell.root, node => node.dataset?.route === route); assert.ok(button, `missing ${route}`); button.click(); await settle(); return shell.root.children[3].children[0]; }

test('P23 Contacts exposes a truthful empty state instead of an empty decorative list', async () => {
  const c = await setupPhase17({ castSize: 1, manifestId: 'p23-contacts-empty' });
  const shell = shellFor(c); await shell.mount(c.target); const panel = await open(shell, 'contacts');
  assert.match(allText(panel), /No contacts saved on this phone yet\.|Contacts are unavailable/);
  assert.ok(find(panel, node => node.dataset?.navAction === 'back'));
});

test('P23 Messages disables empty Send and suppresses a synchronous double-tap to one canonical message', async () => {
  const c = await setupPhase17({ manifestId: 'p23-message-double' });
  const dm = await createDm(c, c.user, c.alice, 'p23-message-double');
  const shell = shellFor(c); await shell.mount(c.target); const panel = await open(shell, 'messages');
  const input = find(panel, node => node.attributes?.get?.('aria-label') === 'Message text');
  const send = find(panel, node => node.tagName === 'button' && node.textContent === 'Send');
  assert.ok(input); assert.ok(send); assert.equal(send.disabled, true);
  input.value = 'ONE-CANONICAL-MESSAGE';
  for (const listener of input.listeners.get('input') || []) listener({ currentTarget: input });
  assert.equal(send.disabled, false);
  send.click(); send.click();
  await waitFor(async () => (await c.messages.listMessages({ scope: c.scope, viewerAccountId: c.user.accountId, threadId: dm.thread.threadId })).length === 1);
  const messages = await c.messages.listMessages({ scope: c.scope, viewerAccountId: c.user.accountId, threadId: dm.thread.threadId });
  assert.equal(messages.length, 1); assert.equal(messages[0].text, 'ONE-CANONICAL-MESSAGE');
});

test('P23 Call accept is one-shot under double tap and text-only disabled Voice controls remain truthful', async () => {
  const c = await setupPhase17({ manifestId: 'p23-call-double' });
  const call = await startCall(c, { caller: c.alice, called: c.user, key: 'p23-double' });
  const shell = shellFor(c); await shell.mount(c.target); const panel = await open(shell, 'calls');
  const accept = find(panel, node => node.dataset?.callAction === 'accept'); assert.ok(accept); accept.click(); accept.click();
  await waitFor(async () => (await c.calls.getSession({ scope: c.scope, callSessionId: call.session.callSessionId })).state === 'active');
  assert.equal((await c.calls.getSession({ scope: c.scope, callSessionId: call.session.callSessionId })).state, 'active');
  const refreshed = shell.root.children[3].children[0];
  const speaker = find(refreshed, node => node.dataset?.callAction === 'speaker'); const mute = find(refreshed, node => node.dataset?.callAction === 'mute');
  assert.equal(speaker.disabled, true); assert.match(String(speaker.title), /Voice controls are unavailable/); assert.equal(mute.disabled, true);
});

test('P23 Notification open navigates by stable source and dismiss is one-shot under double tap', async () => {
  const c = await setupPhase17({ manifestId: 'p23-notification-controls' });
  const dm = await createDm(c, c.alice, c.user, 'p23-notification');
  await sendFrom(c, { threadId: dm.thread.threadId, sender: c.alice, text: 'NOTIFY-ME', key: 'p23-notification' });
  const shell = shellFor(c); await shell.mount(c.target); let panel = await open(shell, 'notifications');
  const openButton = find(panel, node => node.tagName === 'button' && String(node.attributes?.get?.('aria-label') || '').startsWith('Open ')); assert.ok(openButton); openButton.click();
  await waitFor(() => shell.root.children[3].children[0].dataset.route === 'messages');
  panel = shell.root.children[3].children[0]; assert.equal(panel.dataset.route, 'messages');

  const c2 = await setupPhase17({ manifestId: 'p23-notification-dismiss' });
  const dm2 = await createDm(c2, c2.alice, c2.user, 'p23-notification-dismiss');
  await sendFrom(c2, { threadId: dm2.thread.threadId, sender: c2.alice, key: 'p23-notification-dismiss' });
  const shell2 = shellFor(c2); await shell2.mount(c2.target); panel = await open(shell2, 'notifications');
  const dismiss = find(panel, node => node.tagName === 'button' && String(node.attributes?.get?.('aria-label') || '').startsWith('Dismiss ')); assert.ok(dismiss); dismiss.click(); dismiss.click();
  await waitFor(async () => (await c2.notifications.listRecent({ scope: c2.scope, accountId: c2.user.accountId, deviceId: c2.user.deviceId, limit: 25, grouped: false })).items.length === 0);
});
