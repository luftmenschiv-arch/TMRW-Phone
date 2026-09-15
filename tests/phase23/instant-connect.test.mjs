import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPhase9 } from '../phase9/call-fixtures.mjs';
import { TmrwPhoneShell } from '../../ui/shell.mjs';
import { EXPERIENCE_PRESET, PHONE_NUMBER_DISCOVERY, resolveExperiencePreset } from '../../ui/experience-presets.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(predicate, label = 'Instant Connect UI') {
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
function allText(node, output = []) {
  if (node?.textContent) output.push(String(node.textContent));
  for (const child of node?.children || []) allText(child, output);
  return output.join(' ');
}
function shellFor(context) {
  return new TmrwPhoneShell({
    document: context.document,
    viewModels: context.viewModels,
    controller: context.controller,
    messageService: context.messages,
    callService: context.calls,
    callCoordinator: context.viewModels.callCoordinator,
    scope: context.scope,
    playerActorId: context.user.actorId,
    playerInstanceId: context.user.instanceId,
    activeCharacterDisplayName: 'Kaelan Vance',
    selectedDeviceId: context.user.deviceId,
  });
}
async function open(shell, route) {
  const unlock = find(shell.root, node => node.dataset?.action === 'unlock');
  if (unlock) { unlock.click(); await waitFor(() => Boolean(find(shell.root, node => node.dataset?.app)), 'Phone unlock'); }
  let button = find(shell.root, node => node.dataset?.app === route);
  if (!button && route === 'messages') {
    const social = find(shell.root, node => node.dataset?.app === 'insungram');
    assert.ok(social, 'missing Insungram route');
    social.click();
    await waitFor(() => shell.root.dataset?.route === 'insungram', 'Insungram route');
    button = find(shell.root, node => node.attributes?.get?.('aria-label') === 'ข้อความ');
  }
  assert.ok(button, `missing ${route} route`);
  button.click();
  await waitFor(() => shell.root.dataset?.route === route, `${route} route`);
  return shell.root.children[1].children[0].children[0];
}

test('Simple is explicit Instant while Story remains evidence-gated', () => {
  assert.equal(resolveExperiencePreset(EXPERIENCE_PRESET.SIMPLE).phoneNumberDiscovery, PHONE_NUMBER_DISCOVERY.ON);
  assert.equal(resolveExperiencePreset(EXPERIENCE_PRESET.STORY).phoneNumberDiscovery, PHONE_NUMBER_DISCOVERY.SMART);
});

test('a persisted legacy Simple preference reads as the current Instant contract', async () => {
  const context = await setupPhase9({ castSize: 1, manifestId: 'p23-instant-legacy-simple' });
  const saved = await context.settings.setPreset({ scope: context.scope, playerInstanceId: context.user.instanceId, preset: EXPERIENCE_PRESET.SIMPLE });
  await context.database.transaction(['phoneUiPreferences'], 'readwrite', transaction => transaction.store('phoneUiPreferences').put({ ...saved, phoneNumberDiscovery: PHONE_NUMBER_DISCOVERY.OFF }));
  const normalized = await context.settings.get({ scope: context.scope, playerInstanceId: context.user.instanceId });
  assert.equal(normalized.preset, EXPERIENCE_PRESET.SIMPLE);
  assert.equal(normalized.phoneNumberDiscovery, PHONE_NUMBER_DISCOVERY.ON);
});

test('Instant exposes canonical cast Accounts without fabricating Contacts or phone numbers', async () => {
  const context = await setupPhase9({ castSize: 1, manifestId: 'p23-instant-view-model' });
  await context.settings.setPreset({ scope: context.scope, playerInstanceId: context.user.instanceId, preset: EXPERIENCE_PRESET.SIMPLE });
  const view = await context.viewModels.selected({
    scope: context.scope,
    deviceId: context.user.deviceId,
    playerActorId: context.user.actorId,
    playerInstanceId: context.user.instanceId,
    route: 'calls',
    controller: context.controller,
    activeCharacterDisplayName: 'Kaelan Vance',
  });
  assert.equal(view.instantEligible, true);
  assert.equal(view.communicationTargets.length, 1);
  assert.equal(view.communicationTargets[0].accountId, context.alice.accountId);
  assert.equal(view.communicationTargets[0].label, 'Kaelan Vance');
  assert.equal(view.communicationTargets[0].numberRequired, false);
  assert.deepEqual(view.callUi.dialTargets.map(row => row.accountId), [context.alice.accountId]);
  assert.deepEqual(await context.contacts.listContacts({ scope: context.scope, ownerAccountId: context.user.accountId }), []);
});

test('Story and Off do not bypass number evidence, and Their Phone never gains player Instant actions', async () => {
  const context = await setupPhase9({ castSize: 2, manifestId: 'p23-instant-boundaries' });
  const selected = deviceId => context.viewModels.selected({ scope: context.scope, deviceId, playerActorId: context.user.actorId, playerInstanceId: context.user.instanceId, route: 'messages', controller: context.controller, activeCharacterDisplayName: 'Kaelan Vance' });
  assert.deepEqual((await selected(context.user.deviceId)).communicationTargets, []);
  await context.settings.setPhoneNumberDiscovery({ scope: context.scope, playerInstanceId: context.user.instanceId, value: PHONE_NUMBER_DISCOVERY.OFF });
  assert.deepEqual((await selected(context.user.deviceId)).communicationTargets, []);
  await context.settings.setPhoneNumberDiscovery({ scope: context.scope, playerInstanceId: context.user.instanceId, value: PHONE_NUMBER_DISCOVERY.ON });
  assert.deepEqual((await selected(context.alice.deviceId)).communicationTargets, []);
});

test('Instant Messages creates one canonical DM on demand and leaves Contacts untouched', async () => {
  const context = await setupPhase9({ castSize: 1, manifestId: 'p23-instant-message' });
  await context.settings.setPreset({ scope: context.scope, playerInstanceId: context.user.instanceId, preset: EXPERIENCE_PRESET.SIMPLE });
  const shell = shellFor(context);
  await shell.mount(context.target);
  const panel = await open(shell, 'messages');
  assert.match(allText(panel), /เริ่มคุยได้ทันที/);
  const target = find(panel, node => node.dataset?.instantTargetAccountId === context.alice.accountId);
  assert.ok(target);
  target.click();
  target.click();
  await waitFor(async () => (await context.messages.listThreads({ scope: context.scope, viewerAccountId: context.user.accountId })).length === 1, 'Instant DM creation');
  const threads = await context.messages.listThreads({ scope: context.scope, viewerAccountId: context.user.accountId });
  assert.deepEqual(threads[0].participantAccountIds.slice().sort(), [context.user.accountId, context.alice.accountId].sort());
  assert.deepEqual(await context.contacts.listContacts({ scope: context.scope, ownerAccountId: context.user.accountId }), []);
  await waitFor(() => /Kaelan Vance/.test(allText(shell.root)), 'Instant DM presentation');
});

test('Instant Calls starts one canonical Call and keeps the approved active Call surface', async () => {
  const context = await setupPhase9({ castSize: 1, manifestId: 'p23-instant-call' });
  await context.settings.setPreset({ scope: context.scope, playerInstanceId: context.user.instanceId, preset: EXPERIENCE_PRESET.SIMPLE });
  const shell = shellFor(context);
  await shell.mount(context.target);
  const panel = await open(shell, 'calls');
  const target = find(panel, node => node.dataset?.callTargetAccountId === context.alice.accountId);
  assert.ok(target);
  target.click();
  target.click();
  await waitFor(async () => (await context.calls.listCalls({ scope: context.scope, viewerAccountId: context.user.accountId })).length === 1, 'Instant Call creation');
  const calls = await context.calls.listCalls({ scope: context.scope, viewerAccountId: context.user.accountId });
  assert.equal(calls[0].state, 'ringing');
  await waitFor(() => Boolean(find(shell.root, node => node.dataset?.callAction === 'cancel')), 'approved Call surface');
  assert.deepEqual(await context.contacts.listContacts({ scope: context.scope, ownerAccountId: context.user.accountId }), []);
});
