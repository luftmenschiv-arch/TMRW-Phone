import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPhase9 } from '../phase9/call-fixtures.mjs';
import { PhoneShellViewModels } from '../../ui/view-models.mjs';
import { TmrwPhoneShell } from '../../ui/shell.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(predicate, label) {
  for (let index = 0; index < 120; index += 1) {
    if (await predicate()) return;
    await settle();
  }
  throw new Error(`${label} did not settle`);
}
function find(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node?.children || []) {
    const hit = find(child, predicate);
    if (hit) return hit;
  }
  return null;
}
function findAll(node, predicate, output = []) { if (predicate(node)) output.push(node); for (const child of node?.children || []) findAll(child, predicate, output); return output; }
function text(node, output = []) {
  if (node?.textContent) output.push(String(node.textContent));
  for (const child of node?.children || []) text(child, output);
  return output.join(' ');
}

test('Settings magic action runs bootstrap once and becomes the update action', async () => {
  const c = await setupPhase9({ castSize: 1, manifestId: 'playable-bootstrap-settings-ui' });
  let runs = 0;
  const playableBootstrapService = {
    status: input => c.settings.get(input).then(row => row.playableBootstrap),
    run: async ({ scope, playerInstanceId, onProgress }) => {
      runs += 1;
      onProgress?.({ stage: 'quick-ready', status: 'quick-ready', processedOrdinal: 20, totalMessages: 80 });
      await c.settings.setPlayableBootstrapState({ scope, playerInstanceId, state: { status: 'ready', stage: 'ready', processedOrdinal: 80, totalMessages: 80, castCount: 1, completedAt: '2026-09-17T06:00:00.000Z' } });
    },
  };
  const models = new PhoneShellViewModels({ database: c.database, phoneStateService: c.phones, contactService: c.contacts, settingsService: c.settings, playableBootstrapService, messageService: c.messages, callService: c.calls });
  const shell = new TmrwPhoneShell({ document: c.document, viewModels: models, controller: c.controller, messageService: c.messages, callService: c.calls, callCoordinator: models.callCoordinator, scope: c.scope, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, selectedDeviceId: c.user.deviceId });
  await shell.mount(c.target);
  find(shell.root, node => node.dataset?.action === 'unlock').click();
  await waitFor(() => Boolean(find(shell.root, node => node.dataset?.app === 'settings')), 'unlock');
  find(shell.root, node => node.dataset?.app === 'settings').click();
  await waitFor(() => shell.root.dataset?.route === 'settings', 'settings');
  let action = find(shell.root, node => node.dataset?.action === 'playable-bootstrap');
  assert.ok(action);
  assert.deepEqual(findAll(shell.root, node => Boolean(node.dataset?.providerArea)).map(node => node.dataset.providerArea), ['image', 'voice']);
  assert.match(text(action), /ทำให้มือถือพร้อมเล่น/);
  action.click();
  await waitFor(async () => runs === 1 && (await c.settings.get({ scope: c.scope, playerInstanceId: c.user.instanceId })).playableBootstrap.status === 'ready', 'bootstrap');
  await waitFor(() => /อัปเดตมือถือให้ทันเรื่อง/.test(text(find(shell.root, node => node.dataset?.action === 'playable-bootstrap'))), 'ready label');
  shell.dispose();
});
