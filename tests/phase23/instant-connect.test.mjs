import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPhase9 } from '../phase9/call-fixtures.mjs';
import { TmrwPhoneShell } from '../../ui/shell.mjs';
import { EXPERIENCE_PRESET, PHONE_NUMBER_DISCOVERY, resolveExperiencePreset } from '../../ui/experience-presets.mjs';
import { DEFAULT_VOICE_RUNTIME_BASE_URL } from '../../ui/settings-beta.mjs';
import { PuzzleLocalRuntimeVoiceAdapter } from '../../platform/voice/puzzle-local-runtime-adapter.mjs';
import { CallVoicePresenter } from '../../application/call-voice-presenter.mjs';
import { VoiceProfileService } from '../../application/voice-profile-service.mjs';
import { CallBotReplyCoordinator } from '../../application/call-bot-reply-coordinator.mjs';
import { PHONE_ACCESS_MODE, resolvePlayerAccess } from '../../domain/phone/player-access-policy.mjs';

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
  assert.equal(resolveExperiencePreset(EXPERIENCE_PRESET.SIMPLE).phoneAccessMode, PHONE_ACCESS_MODE.FREE_ACCESS);
  assert.equal(resolveExperiencePreset(EXPERIENCE_PRESET.STORY).phoneNumberDiscovery, PHONE_NUMBER_DISCOVERY.SMART);
  assert.equal(resolvePlayerAccess({ settings: { preset: EXPERIENCE_PRESET.SIMPLE, phoneAccessMode: PHONE_ACCESS_MODE.FREE_ACCESS }, canonicalAllowed: false }).granted, true);
});

test('a persisted legacy Simple preference reads as the current Instant contract', async () => {
  const context = await setupPhase9({ castSize: 1, manifestId: 'p23-instant-legacy-simple' });
  const saved = await context.settings.setPreset({ scope: context.scope, playerInstanceId: context.user.instanceId, preset: EXPERIENCE_PRESET.SIMPLE });
  await context.database.transaction(['phoneUiPreferences'], 'readwrite', transaction => transaction.store('phoneUiPreferences').put({ ...saved, phoneNumberDiscovery: PHONE_NUMBER_DISCOVERY.OFF }));
  const normalized = await context.settings.get({ scope: context.scope, playerInstanceId: context.user.instanceId });
  assert.equal(normalized.preset, EXPERIENCE_PRESET.SIMPLE);
  assert.equal(normalized.phoneNumberDiscovery, PHONE_NUMBER_DISCOVERY.ON);
  assert.equal(normalized.phoneAccessMode, PHONE_ACCESS_MODE.FREE_ACCESS);
});

test('Local Voice Runtime endpoint is explicit, validated, and preserved across Experience changes', async () => {
  const context = await setupPhase9({ castSize: 1, manifestId: 'p23-instant-runtime-url' });
  assert.equal((await context.settings.get({ scope: context.scope, playerInstanceId: context.user.instanceId })).voiceRuntimeBaseUrl, DEFAULT_VOICE_RUNTIME_BASE_URL);
  await context.settings.setVoiceRuntimeBaseUrl({ scope: context.scope, playerInstanceId: context.user.instanceId, baseUrl: 'http://192.168.1.20:18769/' });
  await context.settings.setPreset({ scope: context.scope, playerInstanceId: context.user.instanceId, preset: EXPERIENCE_PRESET.SIMPLE });
  assert.equal((await context.settings.get({ scope: context.scope, playerInstanceId: context.user.instanceId })).voiceRuntimeBaseUrl, 'http://192.168.1.20:18769');
  await assert.rejects(() => context.settings.setVoiceRuntimeBaseUrl({ scope: context.scope, playerInstanceId: context.user.instanceId, baseUrl: 'http://192.168.1.20:18769/private/path' }), /origin only/);
});

test('Puzzle adapter uses the saved per-call runtime origin', async () => {
  const urls = [];
  const adapter = new PuzzleLocalRuntimeVoiceAdapter({ fetchImpl: async url => { urls.push(url); return { ok: true, status: 200, json: async () => ({ ok: true, ready: true, voice: 'Puzzle' }) }; } });
  const health = await adapter.health({ baseUrl: 'http://192.168.1.20:18769' });
  assert.equal(health.ready, true);
  assert.equal(health.endpoint, 'http://192.168.1.20:18769');
  assert.deepEqual(urls, ['http://192.168.1.20:18769/health']);
});

test('Puzzle adapter treats a configured user profile name as a label while keeping the qualified Puzzle runtime', async () => {
  const calls = [];
  const adapter = new PuzzleLocalRuntimeVoiceAdapter({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith('/health')) return { ok: true, status: 200, json: async () => ({ ok: true, ready: true, voice: 'Puzzle' }) };
      if (url.endsWith('/turn/start')) return { ok: true, status: 200, json: async () => ({ ok: true, turn_id: 'turn:test' }) };
      if (url.endsWith('/turn/push')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
      return { ok: true, status: 200, headers: { get: name => name === 'Content-Type' ? 'audio/wav' : null }, blob: async () => ({ size: 128 }) };
    },
    createObjectURL: () => 'blob:tmrw-test',
    revokeObjectURL: () => {},
  });
  const result = await adapter.render({
    actorId: 'actor:bot', instanceId: 'instance:bot', callSessionId: 'call:test', canonicalText: 'です。', language: 'ja',
    resolvedProfile: { profileName: 'เคลันเทส', language: 'ja', defaultDelivery: 'natural', providerNeutral: true },
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.capabilityState.voice, 'Puzzle');
  assert.equal(JSON.parse(calls.find(call => call.url.endsWith('/turn/push')).options.body).text, 'です。');
});

test('Call Voice presentation accepts a user-named configured profile without changing canonical text', async () => {
  const calls = [];
  const presenter = new CallVoicePresenter({
    voiceProfileService: { resolve: async () => ({ profileName: 'เคลันเทส', language: 'ja', defaultDelivery: 'natural', providerNeutral: true }) },
    settingsService: { get: async () => ({ voiceCallsEnabled: true, botCallsWithVoice: true, voiceLanguagePreference: 'ja', voiceRuntimeBaseUrl: 'http://192.168.1.20:18769' }) },
    adapter: { render: async (request, options) => { calls.push({ request, options }); return { status: 'unavailable', audioArtifactRef: null, errorCode: 'test-stop' }; }, release() {}, dispose() {} },
    playbackController: { play: async () => ({ status: 'completed' }), cancelCall: () => false, dispose() {} },
  });
  const result = await presenter.presentCommittedBotTranscript({
    scope: { storyId: 'story:test', branchId: 'branch:test' },
    playerActorId: 'actor:player',
    playerInstanceId: 'character-instance:player',
    commit: { event: { eventType: 'calls.transcript-added.v1', id: 'event:test' }, transcript: { transcriptEntryId: 'transcript:test', callSessionId: 'call:test', actualAuthorActorId: 'actor:bot', actualAuthorInstanceId: 'character-instance:bot', text: 'です。' } },
  });
  assert.equal(result.status, 'text-only');
  assert.equal(calls[0].options.baseUrl, 'http://192.168.1.20:18769');
  assert.equal(calls[0].request.canonicalText, 'です。');
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

test('ordinary non-Instant outgoing Calls remain ringing and are never silently auto-answered', async () => {
  const context = await setupPhase9({ castSize: 1, manifestId: 'p23-instant-no-auto-answer' });
  const result = await context.viewModels.callCoordinator.startOutgoing({
    scope: context.scope,
    deviceId: context.user.deviceId,
    playerActorId: context.user.actorId,
    playerInstanceId: context.user.instanceId,
    targetAccountId: context.alice.accountId,
    source: { authority: 'p23-instant-test', kind: 'ordinary-call', recordId: 'ordinary-call', version: '1' },
    idempotencyKey: 'ordinary-call',
  });
  assert.equal(result.session.state, 'ringing');
  assert.equal(result.autoAccepted, false);
});

test('Instant auto-answer recovers the exact already-ringing Character Call without creating a duplicate', async () => {
  const context = await setupPhase9({ castSize: 1, manifestId: 'p23-instant-recover-ringing' });
  const input = {
    scope: context.scope,
    deviceId: context.user.deviceId,
    playerActorId: context.user.actorId,
    playerInstanceId: context.user.instanceId,
    targetAccountId: context.alice.accountId,
    source: { authority: 'p23-instant-test', kind: 'recover-call', recordId: 'recover-call', version: '1' },
    idempotencyKey: 'recover-call',
  };
  const ringing = await context.viewModels.callCoordinator.startOutgoing(input);
  assert.equal(ringing.session.state, 'ringing');
  const recovered = await context.viewModels.callCoordinator.startOutgoing({ ...input, autoAcceptTarget: true });
  assert.equal(recovered.session.state, 'active');
  assert.equal(recovered.autoAccepted, true);
  assert.equal(recovered.reusedOpenSession, true);
  assert.equal((await context.calls.listCalls({ scope: context.scope, viewerAccountId: context.user.accountId })).length, 1);
});

test('an ended Call stays in history without replacing the Instant dial screen on reopen', async () => {
  const context = await setupPhase9({ castSize: 1, manifestId: 'p23-instant-ended-history-only' });
  await context.settings.setPreset({ scope: context.scope, playerInstanceId: context.user.instanceId, preset: EXPERIENCE_PRESET.SIMPLE });
  const call = await context.viewModels.callCoordinator.startOutgoing({
    scope: context.scope,
    deviceId: context.user.deviceId,
    playerActorId: context.user.actorId,
    playerInstanceId: context.user.instanceId,
    targetAccountId: context.alice.accountId,
    autoAcceptTarget: true,
    source: { authority: 'p23-instant-test', kind: 'ended-history', recordId: 'ended-history-call', version: '1' },
    idempotencyKey: 'ended-history-call',
  });
  await context.viewModels.callCoordinator.transition({
    scope: context.scope,
    deviceId: context.user.deviceId,
    playerActorId: context.user.actorId,
    playerInstanceId: context.user.instanceId,
    callSessionId: call.session.callSessionId,
    action: 'end',
    measuredDurationMs: 0,
    source: { authority: 'p23-instant-test', kind: 'ended-history', recordId: 'ended-history-end', version: '1' },
    idempotencyKey: 'ended-history-end',
  });
  const input = { scope: context.scope, deviceId: context.user.deviceId, playerActorId: context.user.actorId, playerInstanceId: context.user.instanceId, route: 'calls', controller: context.controller, activeCharacterDisplayName: 'Kaelan Vance' };
  const reopened = await context.viewModels.selected(input);
  assert.equal(reopened.callUi.island.kind, 'empty');
  assert.deepEqual(reopened.callUi.dialTargets.map(row => row.accountId), [context.alice.accountId]);
  assert.equal(reopened.callUi.history.some(row => row.callSessionId === call.session.callSessionId), true);
  const historyDetail = await context.viewModels.selected({ ...input, selectedCallSessionId: call.session.callSessionId });
  assert.equal(historyDetail.callUi.island.kind, 'ended');
});

test('active text Call gets a canonical bot reply even before a Voice profile is configured', async () => {
  const context = await setupPhase9({ castSize: 1, manifestId: 'p23-instant-text-before-voice' });
  const call = await context.viewModels.callCoordinator.startOutgoing({
    scope: context.scope,
    deviceId: context.user.deviceId,
    playerActorId: context.user.actorId,
    playerInstanceId: context.user.instanceId,
    targetAccountId: context.alice.accountId,
    autoAcceptTarget: true,
    source: { authority: 'p23-instant-test', kind: 'text-before-voice', recordId: 'text-before-voice-call', version: '1' },
    idempotencyKey: 'text-before-voice-call',
  });
  const userCommit = await context.viewModels.callCoordinator.sendText({
    scope: context.scope,
    deviceId: context.user.deviceId,
    playerActorId: context.user.actorId,
    playerInstanceId: context.user.instanceId,
    callSessionId: call.session.callSessionId,
    text: 'Can you hear me?',
    source: { authority: 'p23-instant-test', kind: 'text-before-voice', recordId: 'text-before-voice-user', version: '1' },
    idempotencyKey: 'text-before-voice-user',
  });
  const generationCalls = [];
  const replies = new CallBotReplyCoordinator({
    callService: context.calls,
    voiceProfileService: new VoiceProfileService({ database: context.database }),
    settingsService: context.settings,
    bindingResolver: async () => ({ actorBinding: { actorId: context.alice.actorId, instanceId: context.alice.instanceId, accountId: context.alice.accountId, deviceId: context.alice.deviceId } }),
    getContext: () => ({ groupId: null, characterId: 0, name2: 'Alice', chat: [], generateQuietPrompt: async options => { generationCalls.push(options); return JSON.stringify({ segments: [{ subtitle_th: 'ได้ยินชัดเจนครับ', spoken_text: 'Yes, I can hear you.' }] }); } }),
  });
  const botCommit = await replies.replyToCommittedUserTranscript({ scope: context.scope, playerInstanceId: context.user.instanceId, commit: userCommit });
  assert.equal(botCommit.committed, true);
  assert.equal(generationCalls.length, 1);
  assert.equal((await context.calls.listTranscript({ scope: context.scope, viewerAccountId: context.user.accountId, callSessionId: call.session.callSessionId })).at(-1).text, 'ได้ยินชัดเจนครับ');
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

test('Instant Calls auto-answers the exact current Character, creates one canonical Call, and keeps the approved active Call surface', async () => {
  const context = await setupPhase9({ castSize: 1, manifestId: 'p23-instant-call' });
  await context.settings.setPreset({ scope: context.scope, playerInstanceId: context.user.instanceId, preset: EXPERIENCE_PRESET.SIMPLE });
  const shell = shellFor(context);
  await shell.mount(context.target);
  const panel = await open(shell, 'calls');
  find(panel, node => node.dataset?.callAction === 'open-dialpad').click();
  await waitFor(() => Boolean(find(shell.root, node => node.dataset?.callTargetAccountId === context.alice.accountId)), 'dialpad recommendation');
  const target = find(shell.root, node => node.dataset?.callTargetAccountId === context.alice.accountId);
  assert.ok(target);
  target.click();
  target.click();
  await waitFor(async () => (await context.calls.listCalls({ scope: context.scope, viewerAccountId: context.user.accountId }))[0]?.state === 'active', 'Instant Call auto-answer');
  const calls = await context.calls.listCalls({ scope: context.scope, viewerAccountId: context.user.accountId });
  assert.equal(calls[0].state, 'active');
  await waitFor(() => Boolean(find(shell.root, node => node.dataset?.callAction === 'end')), 'approved active Call surface');
  assert.deepEqual(await context.contacts.listContacts({ scope: context.scope, ownerAccountId: context.user.accountId }), []);
});

test('opening TMRW Phone releases the SillyTavern text focus so the mobile keyboard does not follow it inside', async () => {
  const context = await setupPhase9({ castSize: 1, manifestId: 'p23-open-dismiss-keyboard' });
  let blurred = 0;
  context.document.activeElement = { blur() { blurred += 1; } };
  const shell = shellFor(context);
  await shell.mount(context.target);
  assert.equal(shell.open(), true);
  assert.equal(blurred, 1);
});

test('a rejected Instant Call stays on the contact screen instead of falsely navigating to Call History', async () => {
  const context = await setupPhase9({ castSize: 1, manifestId: 'p23-instant-call-rejected' });
  await context.settings.setPreset({ scope: context.scope, playerInstanceId: context.user.instanceId, preset: EXPERIENCE_PRESET.SIMPLE });
  const shell = new TmrwPhoneShell({
    document: context.document,
    viewModels: context.viewModels,
    controller: context.controller,
    messageService: context.messages,
    callService: context.calls,
    callCoordinator: { startOutgoing: async () => { throw new Error('simulated persistent-id collision'); } },
    scope: context.scope,
    playerActorId: context.user.actorId,
    playerInstanceId: context.user.instanceId,
    activeCharacterDisplayName: 'Kaelan Vance',
    selectedDeviceId: context.user.deviceId,
  });
  await shell.mount(context.target);
  const callsPanel = await open(shell, 'calls');
  const savedNames = find(callsPanel, node => node.tagName === 'button' && node.textContent === 'Saved Names');
  assert.ok(savedNames);
  savedNames.click();
  await waitFor(() => shell.root.dataset?.route === 'contacts', 'Saved Names route');
  const call = find(shell.root, node => String(node.attributes?.get?.('aria-label') || '').startsWith('โทรหา'));
  assert.ok(call);
  call.click();
  await waitFor(() => /เริ่มสายไม่สำเร็จ/.test(allText(shell.root)), 'rejected Call feedback');
  assert.equal(shell.root.dataset.route, 'contacts');
});

test('a fresh shell can start another Call after reload without replaying the ended Call idempotency key', async () => {
  const context = await setupPhase9({ castSize: 1, manifestId: 'p23-instant-call-after-reload' });
  await context.settings.setPreset({ scope: context.scope, playerInstanceId: context.user.instanceId, preset: EXPERIENCE_PRESET.SIMPLE });

  const firstShell = shellFor(context);
  await firstShell.mount(context.target);
  const firstPanel = await open(firstShell, 'calls');
  find(firstPanel, node => node.dataset?.callAction === 'open-dialpad').click();
  await waitFor(() => Boolean(find(firstShell.root, node => node.dataset?.callTargetAccountId === context.alice.accountId)), 'first dialpad recommendation');
  find(firstShell.root, node => node.dataset?.callTargetAccountId === context.alice.accountId).click();
  await waitFor(async () => (await context.calls.listCalls({ scope: context.scope, viewerAccountId: context.user.accountId }))[0]?.state === 'active', 'first active Call');
  find(firstShell.root, node => node.dataset?.callAction === 'end').click();
  await waitFor(async () => (await context.calls.listCalls({ scope: context.scope, viewerAccountId: context.user.accountId }))[0]?.state === 'ended', 'first ended Call');
  firstShell.dispose();

  const reloadedShell = shellFor(context);
  await reloadedShell.mount(context.target);
  const reloadedPanel = await open(reloadedShell, 'calls');
  find(reloadedPanel, node => node.dataset?.callAction === 'open-dialpad').click();
  await waitFor(() => Boolean(find(reloadedShell.root, node => node.dataset?.callTargetAccountId === context.alice.accountId)), 'reloaded dialpad recommendation');
  find(reloadedShell.root, node => node.dataset?.callTargetAccountId === context.alice.accountId).click();
  await waitFor(async () => (await context.calls.listCalls({ scope: context.scope, viewerAccountId: context.user.accountId })).some(call => call.state === 'active'), 'active Call after reload');
  const calls = await context.calls.listCalls({ scope: context.scope, viewerAccountId: context.user.accountId });
  assert.equal(calls.length, 2);
  assert.equal(calls.filter(call => call.state === 'active').length, 1);
  assert.equal(calls.filter(call => call.state === 'ended').length, 1);
});

async function createTestDm(context, other, key) {
  return context.messages.createThread({ scope:context.scope, kind:'dm', participantAccountIds:[context.user.accountId,other.accountId], source:{authority:'p23-message-order',kind:'test',recordId:`thread-${key}`,version:'1'}, idempotencyKey:`thread-${key}` });
}
async function sendTestMessage(context, threadId, sender, text, key) {
  return context.messages.sendMessage({ scope:context.scope, threadId, senderAccountId:sender.accountId, actualAuthorActorId:sender.actorId, actualAuthorInstanceId:sender.instanceId, deviceId:sender.deviceId, text, source:{authority:'p23-message-order',kind:'test',recordId:key,version:'1'}, idempotencyKey:key });
}

test('Messages hides threads whose Character Card actor is no longer active', async () => {
  const context=await setupPhase9({castSize:1,manifestId:'p23-message-active-cast'});await context.settings.setPreset({scope:context.scope,playerInstanceId:context.user.instanceId,preset:EXPERIENCE_PRESET.SIMPLE});const dm=await createTestDm(context,context.alice,'alice-removed');await sendTestMessage(context,dm.thread.threadId,context.alice,'ข้อความจากตัวละครเก่า','alice-old-message');
  await context.overrides.grant({scope:context.scope,deviceId:context.alice.deviceId,action:'inspect',playerActorId:context.user.actorId,playerInstanceId:context.user.instanceId});const theirPhone=await context.viewModels.selected({scope:context.scope,deviceId:context.alice.deviceId,playerActorId:context.user.actorId,playerInstanceId:context.user.instanceId,route:'messages',controller:context.controller});assert.equal(theirPhone.threadRows.length,1,'Their Phone must retain its conversation with the player while the actor is active');
  await context.database.transaction(['characterCardActors'],'readwrite',async transaction=>{const store=transaction.store('characterCardActors');const memberships=await store.getAll();const membership=memberships.find(row=>row.actorId===context.alice.actorId&&row.status==='active');assert.ok(membership);await store.put({...membership,status:'removed',updatedAt:'2026-09-17T13:00:00.000Z'});});
  const view=await context.viewModels.selected({scope:context.scope,deviceId:context.user.deviceId,playerActorId:context.user.actorId,playerInstanceId:context.user.instanceId,route:'messages',controller:context.controller});assert.deepEqual(view.threadRows,[]);assert.deepEqual(view.messages,[]);
});

test('Messages orders conversations by their latest canonical message', async () => {
  const context=await setupPhase9({castSize:2,manifestId:'p23-message-latest-first'});await context.settings.setPreset({scope:context.scope,playerInstanceId:context.user.instanceId,preset:EXPERIENCE_PRESET.SIMPLE});const alice=await createTestDm(context,context.alice,'alice-order');const bob=await createTestDm(context,context.bob,'bob-order');await sendTestMessage(context,alice.thread.threadId,context.alice,'เก่ากว่า','alice-first');await sendTestMessage(context,bob.thread.threadId,context.bob,'ใหม่กว่า','bob-second');
  const selected=()=>context.viewModels.selected({scope:context.scope,deviceId:context.user.deviceId,playerActorId:context.user.actorId,playerInstanceId:context.user.instanceId,route:'messages',controller:context.controller});let view=await selected();assert.equal(view.threadRows[0].threadId,bob.thread.threadId);await sendTestMessage(context,alice.thread.threadId,context.alice,'ล่าสุดจริง','alice-latest');view=await selected();assert.equal(view.threadRows[0].threadId,alice.thread.threadId);assert.equal(view.threadRows[0].preview,'ล่าสุดจริง');
});
