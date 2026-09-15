import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPhase17 } from '../phase17/notification-fixtures.mjs';
import { startCall, transitionCall, addCallText } from '../phase9/call-fixtures.mjs';
import { CALL_ACTION, CALL_STATE } from '../../domain/calls/call-state-machine.mjs';
import { VoiceProfileService } from '../../application/voice-profile-service.mjs';
import { CallBotReplyCoordinator } from '../../application/call-bot-reply-coordinator.mjs';
import { CallVoicePresenter } from '../../application/call-voice-presenter.mjs';
import { CallVoicePlaybackController } from '../../ui/calls/call-voice-playback.mjs';
import { PuzzleLocalRuntimeVoiceAdapter } from '../../platform/voice/puzzle-local-runtime-adapter.mjs';
import { CallCoordinator } from '../../application/call-coordinator.mjs';
import { CallStoryIntegrationCoordinator } from '../../application/call-story-integration.mjs';

const profile = language => ({ profileName: 'Puzzle', language, defaultDelivery: 'natural', traits: {}, lockedByUser: true });

async function acceptedCall(c, key) {
  const call = await startCall(c, { key });
  await transitionCall(c, call.session.callSessionId, CALL_ACTION.ACCEPT, { actor: c.alice, key: `${key}-accept` });
  return c.calls.getSession({ scope: c.scope, callSessionId: call.session.callSessionId });
}

async function enableVoice(c, language = 'auto') {
  await c.settings.setVoiceCalls({ scope: c.scope, playerInstanceId: c.user.instanceId, enabled: true });
  await c.settings.setBotCallsWithVoice({ scope: c.scope, playerInstanceId: c.user.instanceId, enabled: true });
  await c.settings.setVoiceLanguagePreference({ scope: c.scope, playerInstanceId: c.user.instanceId, language });
}

function quietCoordinator(c, voices, reply, calls) {
  const chat = [{ is_user: true, mes: 'Existing visible Main RP remains untouched.' }];
  const context = {
    groupId: null,
    characterId: 0,
    name2: 'Alice',
    chat,
    generateQuietPrompt: async options => { calls.push(options); return reply; },
  };
  const coordinator = new CallBotReplyCoordinator({
    callService: c.calls,
    voiceProfileService: voices,
    settingsService: c.settings,
    bindingResolver: async () => ({ actorBinding: { actorId: c.alice.actorId, instanceId: c.alice.instanceId, accountId: c.alice.accountId, deviceId: c.alice.deviceId }, mentionBindings: {}, explicitPhoneActions: [] }),
    getContext: () => context,
  });
  return { coordinator, chat };
}

class ImmediateAudio {
  #listeners = new Map();
  paused = false;
  currentTime = 0;
  addEventListener(type, fn) { this.#listeners.set(type, fn); }
  removeEventListener(type, fn) { if (this.#listeners.get(type) === fn) this.#listeners.delete(type); }
  play() { queueMicrotask(() => this.#listeners.get('ended')?.()); return Promise.resolve(); }
  pause() { this.paused = true; }
}

class HoldingAudio extends ImmediateAudio {
  play() { return Promise.resolve(); }
}

function readyAdapter(calls, { status = 'ready' } = {}) {
  return {
    async render(request, { signal } = {}) {
      calls.push({ request, signal });
      if (status === 'unavailable') return { status: 'unavailable', audioArtifactRef: null, errorCode: 'runtime-unavailable' };
      if (status === 'failed') return { status: 'failed', audioArtifactRef: null, errorCode: 'synthesis-failed' };
      return { status: 'ready', audioArtifactRef: `blob:voice-${calls.length}`, durationMs: 700, derivedOnly: true, mutatesCanonicalText: false };
    },
    release() { return true; },
    dispose() {},
  };
}

test('canonical USER commit produces one quiet BOT commit, then EN Puzzle Voice plays exactly once while canon/Main RP remain intact', async () => {
  const c = await setupPhase17({ manifestId: 'voice-v1-en' });
  const voices = new VoiceProfileService({ database: c.database });
  await voices.setActorBase({ actorId: c.alice.actorId, profile: profile('en') });
  await enableVoice(c, 'en');
  const session = await acceptedCall(c, 'voice-v1-en');
  const quietCalls = [];
  const { coordinator, chat } = quietCoordinator(c, voices, 'I am here. Tell me what happened.', quietCalls);
  const userCommit = await addCallText(c, session.callSessionId, { speaker: c.user, text: 'Can you hear me?', key: 'voice-v1-en-user' });
  assert.equal(userCommit.event.eventType, 'calls.transcript-added.v1');
  const [botCommit, retry] = await Promise.all([
    coordinator.replyToCommittedUserTranscript({ scope: c.scope, playerInstanceId: c.user.instanceId, commit: userCommit }),
    coordinator.replyToCommittedUserTranscript({ scope: c.scope, playerInstanceId: c.user.instanceId, commit: userCommit }),
  ]);
  const lateRetry = await coordinator.replyToCommittedUserTranscript({ scope: c.scope, playerInstanceId: c.user.instanceId, commit: userCommit });
  assert.equal(botCommit.committed, true);
  assert.equal(retry.event.id, botCommit.event.id);
  assert.equal(lateRetry.event.id, botCommit.event.id);
  assert.equal(quietCalls.length, 1);
  assert.match(quietCalls[0].quietPrompt, /CANONICAL CALL TRANSCRIPT/);
  assert.match(quietCalls[0].quietPrompt, /Reply in English/);
  assert.deepEqual(chat, [{ is_user: true, mes: 'Existing visible Main RP remains untouched.' }]);

  const transcriptBeforeVoice = await c.calls.listTranscript({ scope: c.scope, viewerAccountId: c.user.accountId, callSessionId: session.callSessionId });
  assert.equal(transcriptBeforeVoice.length, 2);
  assert.equal(transcriptBeforeVoice[1].text, 'I am here. Tell me what happened.');

  const adapterCalls = [];
  const presenter = new CallVoicePresenter({ voiceProfileService: voices, settingsService: c.settings, adapter: readyAdapter(adapterCalls), playbackController: new CallVoicePlaybackController({ audioFactory: () => new ImmediateAudio() }) });
  const played = await presenter.presentCommittedBotTranscript({ scope: c.scope, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, commit: botCommit });
  const duplicate = await presenter.presentCommittedBotTranscript({ scope: c.scope, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, commit: botCommit });
  assert.equal(played.status, 'played');
  assert.equal(played.language, 'en');
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(adapterCalls.length, 1);
  assert.equal(adapterCalls[0].request.canonicalText, 'I am here. Tell me what happened.');
  assert.equal(adapterCalls[0].request.resolvedProfile.profileName, 'Puzzle');
  const transcriptAfterVoice = await c.calls.listTranscript({ scope: c.scope, viewerAccountId: c.user.accountId, callSessionId: session.callSessionId });
  assert.deepEqual(transcriptAfterVoice.map(row => row.text), transcriptBeforeVoice.map(row => row.text));
  assert.equal((await c.calls.getSession({ scope: c.scope, callSessionId: session.callSessionId })).state, CALL_STATE.ACTIVE);
});

test('JP profile produces canonical Japanese bot text and Voice request uses ja', async () => {
  const c = await setupPhase17({ manifestId: 'voice-v1-ja' });
  const voices = new VoiceProfileService({ database: c.database });
  await voices.setActorBase({ actorId: c.alice.actorId, profile: profile('ja') });
  await enableVoice(c, 'auto');
  const session = await acceptedCall(c, 'voice-v1-ja');
  const quietCalls = [];
  const { coordinator } = quietCoordinator(c, voices, 'うん、ちゃんと聞こえてるよ。', quietCalls);
  const userCommit = await addCallText(c, session.callSessionId, { speaker: c.user, text: '聞こえる？', key: 'voice-v1-ja-user' });
  const botCommit = await coordinator.replyToCommittedUserTranscript({ scope: c.scope, playerInstanceId: c.user.instanceId, commit: userCommit });
  assert.equal(botCommit.language, 'ja');
  assert.match(quietCalls[0].quietPrompt, /Reply in Japanese/);
  const adapterCalls = [];
  const presenter = new CallVoicePresenter({ voiceProfileService: voices, settingsService: c.settings, adapter: readyAdapter(adapterCalls), playbackController: new CallVoicePlaybackController({ audioFactory: () => new ImmediateAudio() }) });
  const result = await presenter.presentCommittedBotTranscript({ scope: c.scope, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, commit: botCommit });
  assert.equal(result.status, 'played');
  assert.equal(result.language, 'ja');
  assert.equal(adapterCalls[0].request.language, 'ja');
  const transcript = await c.calls.listTranscript({ scope: c.scope, viewerAccountId: c.user.accountId, callSessionId: session.callSessionId });
  assert.equal(transcript.at(-1).text, 'うん、ちゃんと聞こえてるよ。');
});

test('unresolved language, runtime unavailable and synthesis failure all stay text-only without mutating transcript/history', async () => {
  for (const mode of ['unresolved', 'unavailable', 'failed']) {
    const c = await setupPhase17({ manifestId: `voice-v1-fallback-${mode}` });
    const voices = new VoiceProfileService({ database: c.database });
    await voices.setActorBase({ actorId: c.alice.actorId, profile: profile(mode === 'unresolved' ? 'auto' : 'en') });
    await enableVoice(c, mode === 'unresolved' ? 'auto' : 'en');
    const session = await acceptedCall(c, `voice-v1-${mode}`);
    const botCommit = await c.calls.addTranscript({ scope: c.scope, callSessionId: session.callSessionId, speakerAccountId: c.alice.accountId, actualAuthorActorId: c.alice.actorId, actualAuthorInstanceId: c.alice.instanceId, deviceId: c.alice.deviceId, text: `CANON-${mode}`, source: { authority: 'voice-v1-test', kind: 'fixture', recordId: `bot-${mode}`, version: '1' }, producer: 'voice-v1-test', idempotencyKey: `bot-${mode}` });
    const adapterCalls = [];
    const adapter = readyAdapter(adapterCalls, { status: mode === 'unresolved' ? 'ready' : mode });
    const presenter = new CallVoicePresenter({ voiceProfileService: voices, settingsService: c.settings, adapter, playbackController: new CallVoicePlaybackController({ audioFactory: () => new ImmediateAudio() }) });
    const result = await presenter.presentCommittedBotTranscript({ scope: c.scope, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, commit: botCommit });
    assert.equal(result.status, 'text-only');
    if (mode === 'unresolved') assert.equal(adapterCalls.length, 0); else assert.equal(adapterCalls.length, 1);
    const transcript = await c.calls.listTranscript({ scope: c.scope, viewerAccountId: c.user.accountId, callSessionId: session.callSessionId });
    assert.equal(transcript.at(-1).text, `CANON-${mode}`);
    const history = await c.calls.listCalls({ scope: c.scope, viewerAccountId: c.user.accountId });
    assert.ok(history.some(row => row.callSessionId === session.callSessionId));
  }
});

test('END_CALL commits canonical closure first and cancels pending Voice without orphan playback', async () => {
  const c = await setupPhase17({ manifestId: 'voice-v1-end-cleanup' });
  const voices = new VoiceProfileService({ database: c.database });
  await voices.setActorBase({ actorId: c.alice.actorId, profile: profile('en') });
  await enableVoice(c, 'en');
  const session = await acceptedCall(c, 'voice-v1-end-cleanup');
  const botCommit = await c.calls.addTranscript({ scope: c.scope, callSessionId: session.callSessionId, speakerAccountId: c.alice.accountId, actualAuthorActorId: c.alice.actorId, actualAuthorInstanceId: c.alice.instanceId, deviceId: c.alice.deviceId, text: 'I will still be in the transcript.', source: { authority: 'voice-v1-test', kind: 'fixture', recordId: 'end-bot', version: '1' }, producer: 'voice-v1-test', idempotencyKey: 'end-bot' });
  const adapterCalls = [];
  const presenter = new CallVoicePresenter({ voiceProfileService: voices, settingsService: c.settings, adapter: readyAdapter(adapterCalls), playbackController: new CallVoicePlaybackController({ audioFactory: () => new HoldingAudio() }) });
  const presentation = presenter.presentCommittedBotTranscript({ scope: c.scope, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, commit: botCommit });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(presenter.status.playback.active, true);

  const callCoordinator = new CallCoordinator({ database: c.database, callService: c.calls, phoneStateService: c.phones });
  const bridge = new CallStoryIntegrationCoordinator({ handoffCoordinator: c.handoff, callService: c.calls, callCoordinator, knowledgeService: c.knowledge, phoneContextBuilder: c.phoneContext, settingsService: c.settings });
  const ended = await bridge.endCall({ scope: c.scope, deviceId: c.user.deviceId, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, callSessionId: session.callSessionId, measuredDurationMs: 0, consequences: [], latestVisibleRole: 'user', continuationDriver: null, releaseEphemeral: () => presenter.cancelCall(session.callSessionId), source: { authority: 'voice-v1-test', kind: 'fixture', recordId: 'end-call', version: '1' }, idempotencyKey: 'end-call' });
  assert.equal(ended.callCanonCommitted, true);
  assert.equal((await c.calls.getSession({ scope: c.scope, callSessionId: session.callSessionId })).state, CALL_STATE.ENDED);
  const presentationResult = await presentation;
  assert.equal(presentationResult.status, 'text-only');
  assert.match(presentationResult.reason, /playback-cancelled|voice-cancelled/);
  assert.equal(presenter.status.playback.active, false);
  const transcript = await c.calls.listTranscript({ scope: c.scope, viewerAccountId: c.user.accountId, callSessionId: session.callSessionId });
  assert.equal(transcript.at(-1).text, 'I will still be in the transcript.');
});

test('approved Puzzle HTTP adapter uses health/start/push/audio with exact EN/JP runtime language contract', async () => {
  for (const [language, runtimeLanguage] of [['en', 'English'], ['ja', 'japanese']]) {
    const requests = [];
    const fetchImpl = async (url, options = {}) => {
      requests.push({ url, options });
      if (url.endsWith('/health')) return { ok: true, status: 200, json: async () => ({ ok: true, ready: true, voice: 'Puzzle' }) };
      if (url.endsWith('/turn/start')) return { ok: true, status: 200, json: async () => ({ ok: true, turn_id: 'turn-1' }) };
      if (url.endsWith('/turn/push')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
      if (url.includes('/turn/audio?')) return { ok: true, status: 200, headers: { get: name => name.toLowerCase() === 'content-type' ? 'audio/wav' : name.toLowerCase() === 'x-tmrw-duration' ? '0.75' : null }, blob: async () => ({ size: 128 }) };
      throw new Error(`unexpected URL ${url}`);
    };
    const adapter = new PuzzleLocalRuntimeVoiceAdapter({ fetchImpl, createObjectURL: () => `blob:${language}`, revokeObjectURL: () => {}, healthTimeoutMs: 500, requestTimeoutMs: 500, audioTimeoutMs: 500 });
    const resolvedProfile = { actorId: 'actor:a', instanceId: 'character-instance:a', profileName: 'Puzzle', language, defaultDelivery: 'natural', traits: {}, baseLockedByUser: true, overrideEnabled: false, overrideLockedByUser: false, baseProfileId: 'voice-actor-profile:actor:a', overrideId: null, providerNeutral: true, phase: 19 };
    const result = await adapter.render({ actorId: 'actor:a', instanceId: 'character-instance:a', callSessionId: 'call:1', canonicalText: 'CANONICAL', language, resolvedProfile, delivery: {} });
    assert.equal(result.status, 'ready');
    assert.equal(result.audioArtifactRef, `blob:${language}`);
    const startBody = JSON.parse(requests.find(row => row.url.endsWith('/turn/start')).options.body);
    const pushBody = JSON.parse(requests.find(row => row.url.endsWith('/turn/push')).options.body);
    assert.equal(startBody.expected_chunks, 1);
    assert.equal(startBody.language, runtimeLanguage);
    assert.equal(pushBody.text, 'CANONICAL');
    assert.equal(pushBody.subtitle, 'CANONICAL');
    assert.ok(requests.some(row => row.url.includes('/turn/audio?wait=1')));
  }
});
