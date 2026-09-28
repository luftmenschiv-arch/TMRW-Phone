import test from 'node:test';
import assert from 'node:assert/strict';
import { CallBotReplyCoordinator } from '../../application/call-bot-reply-coordinator.mjs';
import { CallVoicePresenter } from '../../application/call-voice-presenter.mjs';
import { TMRWLocalVoiceAdapter } from '../../platform/voice/tmrw-local-voice-adapter.mjs';
import { CallVoicePlaybackController } from '../../ui/calls/call-voice-playback.mjs';
import { BetaSettingsService, GLOBAL_VOICE_SETTINGS_KEY } from '../../ui/settings-beta.mjs';
import { renderApprovedCallSurface } from '../../ui/calls/approved-call-surface.mjs';
import { TmrwPhoneShell } from '../../ui/shell.mjs';
import { CALL_EVENT_TYPES } from '../../domain/calls/call-event-types.mjs';
import { setupPhase9 } from '../phase9/call-fixtures.mjs';
import { FakeDocument } from '../phase7/fake-dom.mjs';

const scope = Object.freeze({ storyId: 'story:voice-v2', branchId: 'branch:voice-v2' });
const botBinding = Object.freeze({ actorId: 'actor:bot', instanceId: 'character-instance:bot', accountId: 'account:bot', deviceId: 'device:bot' });
const userTranscript = Object.freeze({ transcriptEntryId: 'transcript:user:1', callSessionId: 'call:voice-v2', speakerAccountId: 'account:user', text: 'อรุณสวัสดิ์' });
const userCommit = Object.freeze({ event: Object.freeze({ id: 'event:user:1', eventType: CALL_EVENT_TYPES.TRANSCRIPT_ADDED }), transcript: userTranscript });

function callServiceHarness() {
  const writes = [];
  return {
    writes,
    service: {
      getSession: async () => ({ callSessionId: 'call:voice-v2', state: 'active', participantAccountIds: ['account:user', 'account:bot'] }),
      listTranscript: async () => [userTranscript],
      addTranscript: async input => {
        writes.push(input);
        return Object.freeze({
          event: Object.freeze({ id: 'event:bot:1', eventType: CALL_EVENT_TYPES.TRANSCRIPT_ADDED }),
          transcript: Object.freeze({ transcriptEntryId: 'transcript:bot:1', callSessionId: input.callSessionId, speakerAccountId: input.speakerAccountId, actualAuthorActorId: input.actualAuthorActorId, actualAuthorInstanceId: input.actualAuthorInstanceId, text: input.text }),
        });
      },
    },
  };
}

function coordinatorHarness(generateQuietPrompt, { callService = null, stopGeneration = null, savedName = null } = {}) {
  const calls = callServiceHarness();
  const prompts = [];
  const bindingInputs = [];
  const coordinator = new CallBotReplyCoordinator({
    callService: callService || calls.service,
    voiceProfileService: { resolve: async () => ({ actorId: botBinding.actorId, instanceId: botBinding.instanceId, profileName: null, language: 'auto', defaultDelivery: 'natural', traits: {}, providerNeutral: true }) },
    settingsService: { get: async () => ({ voiceLanguagePreference: 'ja', botSavedNames: savedName ? { [botBinding.instanceId]: savedName } : {} }) },
    bindingResolver: async input => { bindingInputs.push(input); return { actorBinding: botBinding }; },
    getContext: () => ({
      groupId: null,
      characterId: 7,
      name1: 'เฮคเตอร์',
      name2: 'Kaelan Vance',
      generateQuietPrompt: options => { prompts.push(options); return generateQuietPrompt(options); },
      stopGeneration,
    }),
  });
  return { coordinator, prompts, bindingInputs, writes: calls.writes };
}

test('outbound reply stays uncommitted until bilingual Thai/Japanese segments are prepared for Voice', async () => {
  const response = JSON.stringify({ segments: [
    { subtitle_th: 'อรุณสวัสดิ์ครับ', spoken_text: 'おはようございます。' },
    { subtitle_th: 'เมื่อคืนหลับสบายไหมครับ', spoken_text: '昨夜はよく眠れましたか？' },
  ] });
  const h = coordinatorHarness(async () => response);
  const prepared = await h.coordinator.prepareReplyToCommittedUserTranscript({ scope, playerInstanceId: 'character-instance:user', commit: userCommit });
  assert.equal(prepared.status, 'prepared');
  assert.equal(h.bindingInputs[0].canonicalAccountId, botBinding.accountId);
  assert.equal(h.bindingInputs[0].requireActiveCallCounterpart, true);
  assert.equal(h.prompts[0].responseLength, 4096, 'reasoning-capable providers must have enough output budget to close the bilingual JSON object');
  assert.equal(prepared.language, 'ja');
  assert.equal(prepared.deliveryMode, 'complete-response');
  assert.equal(prepared.incremental, false);
  assert.equal(prepared.incrementalReason, 'sillytavern-generation-api-has-no-safe-stream');
  assert.deepEqual(prepared.segments.map(row => [row.subtitleThai, row.spokenText]), [
    ['อรุณสวัสดิ์ครับ', 'おはようございます。'],
    ['เมื่อคืนหลับสบายไหมครับ', '昨夜はよく眠れましたか？'],
  ]);
  assert.equal(h.writes.length, 0, 'the bot reply must remain hidden until real audio is ready');
  assert.match(h.prompts[0].quietPrompt, /strict JSON/i);
  assert.match(h.prompts[0].quietPrompt, /natural Japanese/);
  assert.match(h.prompts[0].quietPrompt, /Never answer as a different character/);
  assert.doesNotMatch(h.prompts[0].quietPrompt, /เฮคเตอร์/);
  assert.equal(h.prompts[0].jsonSchema.name, 'tmrw_phone_call_reply');
  assert.equal(h.prompts[0].jsonSchema.strict, true);
  assert.equal(h.prompts[0].jsonSchema.returnInvalid, true);
  assert.equal(h.prompts[0].jsonSchema.value.properties.segments.maxItems, 3);
  assert.deepEqual(h.prompts[0].jsonSchema.value.properties.segments.items.required, ['subtitle_th', 'spoken_text']);

  const committed = await h.coordinator.commitPreparedReply({ scope, prepared });
  assert.equal(committed.committed, true);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].text, 'อรุณสวัสดิ์ครับ เมื่อคืนหลับสบายไหมครับ');
  await h.coordinator.commitPreparedReply({ scope, prepared });
  assert.equal(h.writes.length, 1, 'commit must be idempotent');
});

test('call prompt uses the contact name the bot saved, not the SillyTavern persona name', async () => {
  const h = coordinatorHarness(async () => JSON.stringify({ segments: [{ subtitle_th: 'ได้สิ', spoken_text: 'もちろん。' }] }), { savedName: 'เจ้าตัวปัญหา' });
  const prepared = await h.coordinator.prepareReplyToCommittedUserTranscript({ scope, playerInstanceId: 'character-instance:user', commit: userCommit });
  assert.equal(prepared.status, 'prepared');
  assert.match(h.prompts[0].quietPrompt, /saved the caller as เจ้าตัวปัญหา/);
  assert.doesNotMatch(h.prompts[0].quietPrompt, /เฮคเตอร์/);
});

test('retrying the same committed call turn invokes SillyTavern generation again after a failure', async () => {
  let attempts = 0;
  const h = coordinatorHarness(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('No message generated');
    return JSON.stringify({ segments: [{ subtitle_th: 'ได้ยินแล้ว', spoken_text: 'I hear you.' }] });
  });
  const input = { scope, playerInstanceId: 'character-instance:user', commit: userCommit };
  const first = await h.coordinator.prepareReplyToCommittedUserTranscript(input);
  const second = await h.coordinator.prepareReplyToCommittedUserTranscript(input);
  const third = await h.coordinator.prepareReplyToCommittedUserTranscript(input);
  assert.equal(first.reason, 'generation-failed');
  assert.equal(second.reason, 'generation-failed');
  assert.equal(first.modelAttempted, true);
  assert.equal(second.modelAttempted, true);
  assert.equal(third.status, 'prepared');
  assert.equal(attempts, 3);
  assert.equal(h.prompts.length, 3);
  assert.equal(h.writes.length, 0, 'retry must not duplicate the canonical user transcript');
});

test('invalid one-language model output fails closed instead of being spoken or exposed as a fake Thai subtitle', async () => {
  const h = coordinatorHarness(async () => 'Good morning.');
  const result = await h.coordinator.prepareReplyToCommittedUserTranscript({ scope, playerInstanceId: 'character-instance:user', commit: userCommit });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'invalid-structured-model-response');
  assert.equal(h.writes.length, 0);
});

for (const [label, response] of [
  ['roleplay prose around JSON', 'He smiles. {"segments":[{"subtitle_th":"สวัสดี","spoken_text":"Hello."}]}'],
  ['action markers inside speech', JSON.stringify({ segments: [{ subtitle_th: 'สวัสดี', spoken_text: '*smiles* Hello.' }] })],
  ['four segments that would otherwise be silently truncated', JSON.stringify({ segments: Array.from({ length: 4 }, () => ({ subtitle_th: 'สวัสดี', spoken_text: 'Hello.' })) })],
]) {
  test(`${label} fails closed without an incomplete or narrated call reply`, async () => {
    const h = coordinatorHarness(async () => response);
    const result = await h.coordinator.prepareReplyToCommittedUserTranscript({ scope, playerInstanceId: 'character-instance:user', commit: userCommit });
    assert.equal(result.reason, 'invalid-structured-model-response');
    assert.equal(h.writes.length, 0);
  });
}

test('generation cancellation exits without a late transcript commit', async () => {
  const stopped = [];
  const h = coordinatorHarness(() => new Promise(() => {}), { stopGeneration: reason => stopped.push(reason) });
  const controller = new AbortController();
  const pending = h.coordinator.prepareReplyToCommittedUserTranscript({ scope, playerInstanceId: 'character-instance:user', commit: { ...userCommit, event: { ...userCommit.event, id: 'event:user:cancel' }, transcript: { ...userTranscript, transcriptEntryId: 'transcript:user:cancel' } }, signal: controller.signal });
  controller.abort('hangup');
  const result = await pending;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.reason, 'generation-cancelled');
  assert.deepEqual(stopped, [], 'replacing a turn must not stop the next SillyTavern generation globally');
  assert.equal(h.writes.length, 0);
});

test('the reply deadline covers canonical preparation before LLM generation and cancels SillyTavern deterministically', async () => {
  const stopped = [];
  const h = coordinatorHarness(
    async () => { throw new Error('LLM must not be reached'); },
    {
      callService: {
        getSession: () => new Promise(() => {}),
        listTranscript: async () => [userTranscript],
        addTranscript: async () => { throw new Error('must not commit'); },
      },
      stopGeneration: reason => stopped.push(reason),
    },
  );
  const result = await h.coordinator.prepareReplyToCommittedUserTranscript({
    scope,
    playerInstanceId: 'character-instance:user',
    commit: { ...userCommit, event: { ...userCommit.event, id: 'event:user:timeout' }, transcript: { ...userTranscript, transcriptEntryId: 'transcript:user:timeout' } },
    timeoutMs: 100,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'generation-timeout');
  assert.deepEqual(stopped, ['generation-timeout']);
  assert.equal(h.prompts.length, 0);
});

test('TMRW Local Voice multi-segment turn sends selected-language speech plus paired Thai subtitles and fetches each audio chunk', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/health')) return { ok: true, status: 200, json: async () => ({ ok: true, ready: true, voice: 'TMRW Local Voice' }) };
    if (url.endsWith('/turn/start')) return { ok: true, status: 200, json: async () => ({ ok: true, turn_id: 'turn:segments' }) };
    if (url.endsWith('/turn/push')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    if (url.includes('/turn/audio?')) return { ok: true, status: 200, headers: { get: name => name.toLowerCase() === 'content-type' ? 'audio/wav' : name.toLowerCase() === 'x-tmrw-duration' ? '0.5' : null }, blob: async () => ({ size: 128 }) };
    throw new Error(`unexpected URL ${url}`);
  };
  let objectUrl = 0;
  const adapter = new TMRWLocalVoiceAdapter({ fetchImpl, createObjectURL: () => `blob:segment:${++objectUrl}`, revokeObjectURL: () => {}, healthTimeoutMs: 500, requestTimeoutMs: 500, audioTimeoutMs: 1000 });
  const profile = Object.freeze({ profileName: 'male-polite-dangerous', language: 'ja', defaultDelivery: 'natural', traits: {}, providerNeutral: true });
  const sequence = await adapter.openSequence([
    { actorId: botBinding.actorId, instanceId: botBinding.instanceId, callSessionId: 'call:voice-v2', canonicalText: 'おはようございます。', subtitleText: 'อรุณสวัสดิ์ครับ', language: 'ja', resolvedProfile: profile },
    { actorId: botBinding.actorId, instanceId: botBinding.instanceId, callSessionId: 'call:voice-v2', canonicalText: 'よく眠れましたか？', subtitleText: 'หลับสบายไหมครับ', language: 'ja', resolvedProfile: profile },
  ]);
  const [first, second] = await Promise.all([sequence.renderAt(0), sequence.renderAt(1)]);
  assert.equal(first.status, 'ready');
  assert.equal(second.status, 'ready');
  const start = JSON.parse(requests.find(row => row.url.endsWith('/turn/start')).options.body);
  const pushes = requests.filter(row => row.url.endsWith('/turn/push')).map(row => JSON.parse(row.options.body));
  assert.deepEqual(start, { expected_chunks: 2, language: 'japanese', calibration: false, profile_id: 'male-polite-dangerous' });
  assert.deepEqual(pushes.map(row => [row.index, row.text, row.subtitle]), [
    [0, 'おはようございます。', 'อรุณสวัสดิ์ครับ'],
    [1, 'よく眠れましたか？', 'หลับสบายไหมครับ'],
  ]);
  assert.equal(requests.filter(row => row.url.includes('/turn/audio?')).length, 2);
});

test('active-call warmup caches readiness by endpoint and language until invalidated', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/health')) return { ok: true, status: 200, json: async () => ({ ok: true, ready: true, voice: 'TMRW Local Voice' }) };
    if (url.endsWith('/turn/start')) return { ok: true, status: 200, json: async () => ({ ok: true, turn_id: `turn:${requests.length}` }) };
    if (url.endsWith('/turn/push')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    if (url.includes('/turn/audio?')) return { ok: true, status: 200, headers: { get: name => name.toLowerCase() === 'content-type' ? 'audio/wav' : null }, blob: async () => ({ size: 128 }) };
    throw new Error(`unexpected URL ${url}`);
  };
  const adapter = new TMRWLocalVoiceAdapter({ fetchImpl, createObjectURL: () => 'blob:warm-cache', revokeObjectURL: () => {} });
  const profile = Object.freeze({ profileName: 'male-polite-dangerous', language: 'en', defaultDelivery: 'natural', traits: {}, providerNeutral: true });
  const input = language => ({ actorId: botBinding.actorId, instanceId: botBinding.instanceId, callSessionId: 'call:warm', canonicalText: language === 'ja' ? 'はい。' : 'Yes.', subtitleText: 'ครับ', language, resolvedProfile: profile });

  const warmed = await adapter.warm({ callSessionId: 'call:warm', language: 'en' });
  assert.equal(warmed.ready, true);
  await adapter.openSequence([input('en')]);
  assert.equal(requests.filter(row => row.url.endsWith('/health')).length, 1, 'first reply reuses call-start readiness');

  await adapter.warm({ callSessionId: 'call:warm', language: 'ja' });
  assert.equal(requests.filter(row => row.url.endsWith('/health')).length, 2, 'hot language switch gets fresh readiness');
  await adapter.openSequence([input('ja')]);
  assert.equal(requests.filter(row => row.url.endsWith('/health')).length, 2, 'reply reuses switched-language readiness');

  adapter.invalidateCall('call:warm');
  await adapter.openSequence([input('ja')]);
  assert.equal(requests.filter(row => row.url.endsWith('/health')).length, 3, 'hangup/runtime invalidation forces a fresh check');
});

test('TMRW Local Voice sequence can resume the same runtime turn after the first audio wait times out', async () => {
  const requests = [];
  let audioFetches = 0;
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/health')) return { ok: true, status: 200, json: async () => ({ ok: true, ready: true, voice: 'TMRW Local Voice' }) };
    if (url.endsWith('/turn/start')) return { ok: true, status: 200, json: async () => ({ ok: true, turn_id: 'turn:slow-audio' }) };
    if (url.endsWith('/turn/push')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    if (url.includes('/turn/audio?')) {
      audioFetches += 1;
      if (audioFetches === 1) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
      return { ok: true, status: 200, headers: { get: name => name.toLowerCase() === 'content-type' ? 'audio/wav' : name.toLowerCase() === 'x-tmrw-duration' ? '0.5' : null }, blob: async () => ({ size: 128 }) };
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const adapter = new TMRWLocalVoiceAdapter({ fetchImpl, createObjectURL: () => 'blob:resumed-turn', revokeObjectURL: () => {}, healthTimeoutMs: 500, requestTimeoutMs: 500, audioTimeoutMs: 1000 });
  const profile = Object.freeze({ profileName: 'male-polite-dangerous', language: 'en', defaultDelivery: 'natural', traits: {}, providerNeutral: true });
  const sequence = await adapter.openSequence([{ actorId: botBinding.actorId, instanceId: botBinding.instanceId, callSessionId: 'call:slow-audio', canonicalText: 'Good morning.', subtitleText: 'อรุณสวัสดิ์ครับ', language: 'en', resolvedProfile: profile }]);
  const first = await sequence.renderAt(0);
  const resumed = await sequence.retryAt(0);
  assert.equal(first.status, 'failed');
  assert.equal(first.errorCode, 'runtime-timeout');
  assert.equal(resumed.status, 'ready');
  assert.equal(resumed.audioArtifactRef, 'blob:resumed-turn');
  assert.equal(requests.filter(row => row.url.endsWith('/turn/start')).length, 1, 'resume must not start a duplicate synthesis turn');
  assert.equal(requests.filter(row => row.url.endsWith('/turn/push')).length, 1, 'resume must not push the same text again');
  assert.equal(requests.filter(row => row.url.includes('/turn/audio?')).length, 2);
});

test('presenter uses TMRW Local Voice fallback, retries one failed segment automatically, commits only after audio is ready, and streams all segments', async () => {
  const events = [];
  const requestSets = [];
  let fallbackRenders = 0;
  const adapter = {
    async openSequence(requests) {
      requestSets.push(requests);
      return {
        renderAt(index) {
          events.push(`sequence:${index}`);
          if (index === 0) return Promise.resolve({ status: 'failed', errorCode: 'first-attempt-failed' });
          return Promise.resolve({ status: 'ready', audioArtifactRef: `blob:sequence:${index}`, durationMs: 500 });
        },
      };
    },
    async render(request) {
      fallbackRenders += 1;
      events.push(`retry:${request.canonicalText}`);
      return { status: 'ready', audioArtifactRef: 'blob:retry:0', durationMs: 600 };
    },
    release(result) { events.push(`release:${result.audioArtifactRef}`); },
    dispose() {},
  };
  const presenter = new CallVoicePresenter({
    voiceProfileService: { resolve: async () => ({ actorId: botBinding.actorId, instanceId: botBinding.instanceId, profileName: null, language: 'auto', defaultDelivery: 'natural', traits: {}, providerNeutral: true }) },
    settingsService: { get: async () => ({ voiceCallsEnabled: true, botCallsWithVoice: true, voiceLanguagePreference: 'en', voiceDefaultDelivery: 'natural', voiceRuntimeBaseUrl: 'http://127.0.0.1:18769' }) },
    adapter,
    playbackController: {
      status: Object.freeze({ active: false }),
      async play({ transcriptEntryId }) { events.push(`play:${transcriptEntryId}`); return { status: 'completed' }; },
      cancelCall() { return false; },
      dispose() {},
    },
  });
  const prepared = Object.freeze({ status: 'prepared', preparedId: 'event:user:1', callSessionId: 'call:voice-v2', language: 'en', resolvedProfile: null, botBinding, segments: Object.freeze([
    Object.freeze({ index: 0, subtitleThai: 'สวัสดีครับ', spokenText: 'Good morning.' }),
    Object.freeze({ index: 1, subtitleThai: 'หลับสบายไหมครับ', spokenText: 'Did you sleep well?' }),
  ]) });
  let commitCount = 0;
  const result = await presenter.presentPreparedBotReply({
    scope,
    playerInstanceId: 'character-instance:user',
    prepared,
    commit: async () => { events.push('commit'); commitCount += 1; return { committed: true, transcript: { transcriptEntryId: 'transcript:bot:1', callSessionId: 'call:voice-v2' } }; },
    onUpdate: update => events.push(`state:${update.phase}:${update.segmentIndex}`),
  });
  assert.equal(result.status, 'played');
  assert.equal(result.segmentCount, 2);
  assert.equal(fallbackRenders, 1, 'only the failed first segment receives one automatic retry');
  assert.equal(commitCount, 1);
  assert.equal(requestSets[0][0].resolvedProfile.profileName, 'male-polite-dangerous');
  assert.equal(requestSets[0][0].canonicalText, 'Good morning.');
  assert.equal(requestSets[0][0].subtitleText, 'สวัสดีครับ');
  assert.ok(events.indexOf('retry:Good morning.') < events.indexOf('commit'));
  assert.ok(events.indexOf('commit') < events.findIndex(value => value.startsWith('play:')));
  assert.ok(events.indexOf('sequence:1') < events.findIndex(value => value.startsWith('play:')), 'segment 2 begins rendering before segment 1 playback');
  assert.equal(events.filter(value => value.startsWith('play:')).length, 2);
});

test('hangup aborts active runtime warmup and invalidates its call cache', async () => {
  let warmSignal = null;
  const invalidated = [];
  const presenter = new CallVoicePresenter({
    voiceProfileService: { resolve: async () => ({}) },
    settingsService: { get: async () => ({ voiceCallsEnabled: true, botCallsWithVoice: true, voiceLanguagePreference: 'en', voiceRuntimeBaseUrl: 'http://127.0.0.1:18769' }) },
    adapter: {
      render: async () => ({ status: 'failed' }),
      warm: ({ signal }) => new Promise(resolve => { warmSignal = signal; signal.addEventListener('abort', () => resolve({ ready: false, reason: 'cancelled' }), { once: true }); }),
      invalidateCall: id => { invalidated.push(id); return true; },
      dispose() {},
    },
    playbackController: { status: Object.freeze({ active: false }), play: async () => ({ status: 'completed' }), cancelCall: () => false, dispose() {} },
  });
  const warming = presenter.warmCall({ scope, playerInstanceId: 'character-instance:user', callSessionId: 'call:warm-cancel' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(warmSignal?.aborted, false);
  presenter.cancelCall('call:warm-cancel', 'hangup');
  const result = await warming;
  assert.equal(warmSignal.aborted, true);
  assert.equal(result.ready, false);
  assert.deepEqual(invalidated, ['call:warm-cancel']);
});

test('presenter resumes a timed-out runtime turn instead of synthesizing the segment again', async () => {
  const events = [];
  let fallbackRenders = 0;
  const adapter = {
    async openSequence() {
      return {
        renderAt(index) { events.push(`wait:${index}`); return Promise.resolve({ status: 'failed', errorCode: 'runtime-timeout' }); },
        retryAt(index) { events.push(`resume:${index}`); return Promise.resolve({ status: 'ready', audioArtifactRef: `blob:resumed:${index}`, durationMs: 500 }); },
      };
    },
    async render() { fallbackRenders += 1; return { status: 'ready', audioArtifactRef: 'blob:duplicate-turn' }; },
    release() {},
    dispose() {},
  };
  const presenter = new CallVoicePresenter({
    voiceProfileService: { resolve: async () => ({ actorId: botBinding.actorId, instanceId: botBinding.instanceId, profileName: 'male-polite-dangerous', language: 'en', defaultDelivery: 'natural', traits: {}, providerNeutral: true }) },
    settingsService: { get: async () => ({ voiceCallsEnabled: true, botCallsWithVoice: true, voiceLanguagePreference: 'en', voiceDefaultDelivery: 'natural', voiceRuntimeBaseUrl: 'http://127.0.0.1:18769' }) },
    adapter,
    playbackController: { status: Object.freeze({ active: false }), async play() { return { status: 'completed' }; }, cancelCall() { return false; }, dispose() {} },
  });
  const result = await presenter.presentPreparedBotReply({
    scope,
    playerInstanceId: 'character-instance:user',
    prepared: Object.freeze({ status: 'prepared', preparedId: 'event:user:slow', callSessionId: 'call:slow-audio', language: 'en', resolvedProfile: null, botBinding, segments: Object.freeze([Object.freeze({ index: 0, subtitleThai: 'อรุณสวัสดิ์ครับ', spokenText: 'Good morning.' })]) }),
    commit: async () => ({ committed: true, transcript: { transcriptEntryId: 'transcript:bot:slow', callSessionId: 'call:slow-audio' } }),
    onUpdate: update => events.push(`state:${update.phase}`),
  });
  assert.equal(result.status, 'played');
  assert.equal(fallbackRenders, 0, 'a timed-out wait must not start a duplicate synthesis turn');
  assert.deepEqual(events.slice(0, 4), ['state:synthesizing', 'wait:0', 'state:retrying-voice', 'resume:0']);
});

test('a rejected browser playback stays retryable and becomes duplicate-safe only after audio ends', async () => {
  let attempts = 0;
  const controller = new CallVoicePlaybackController({ audioFactory: () => {
    attempts += 1;
    const listeners = new Map();
    return {
      currentTime: 0,
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
      pause() {},
      play() {
        if (attempts === 1) return Promise.reject(new Error('autoplay-blocked'));
        queueMicrotask(() => listeners.get('ended')?.());
        return Promise.resolve();
      },
    };
  } });
  const request = { callSessionId: 'call:playback-retry', transcriptEntryId: 'transcript:playback-retry:segment:0', audioArtifactRef: 'blob:voice' };
  const failed = await controller.play(request);
  const completed = await controller.play(request);
  const duplicate = await controller.play(request);
  assert.equal(failed.status, 'failed');
  assert.equal(completed.status, 'completed');
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(attempts, 2);
  assert.equal(controller.status.playedCount, 1);
});

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
}

test('voice controls persist globally across branch/reload and first runtime detection enables only once', async () => {
  const context = await setupPhase9({ castSize: 1, manifestId: 'voice-v2-global-settings' });
  const storage = new MemoryStorage();
  const settingsA = new BetaSettingsService({ database: context.database, globalStorage: storage });
  await settingsA.activateDetectedVoice({ scope: context.scope, playerInstanceId: context.user.instanceId, language: 'en' });
  await settingsA.setVoiceLanguagePreference({ scope: context.scope, playerInstanceId: context.user.instanceId, language: 'ja' });
  await settingsA.setVoiceCaptions({ scope: context.scope, playerInstanceId: context.user.instanceId, enabled: false });
  await settingsA.setVoiceCalls({ scope: context.scope, playerInstanceId: context.user.instanceId, enabled: false });

  const alternateScope = Object.freeze({ storyId: context.scope.storyId, branchId: `${context.scope.branchId}:alternate` });
  const settingsAfterReload = new BetaSettingsService({ database: context.database, globalStorage: storage });
  const alternate = await settingsAfterReload.get({ scope: alternateScope, playerInstanceId: context.user.instanceId });
  assert.equal(alternate.voiceLanguagePreference, 'ja');
  assert.equal(alternate.voiceCaptionsEnabled, false);
  assert.equal(alternate.voiceCallsEnabled, false);
  assert.equal(alternate.botCallsWithVoice, true);
  assert.equal(JSON.parse(storage.getItem(GLOBAL_VOICE_SETTINGS_KEY)).voiceSetupInitialized, true);

  await settingsAfterReload.activateDetectedVoice({ scope: alternateScope, playerInstanceId: context.user.instanceId, language: 'en' });
  assert.equal((await settingsAfterReload.get({ scope: alternateScope, playerInstanceId: context.user.instanceId })).voiceCallsEnabled, false, 'later detection must preserve an intentional manual disable');
});

function find(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node?.children || []) {
    const hit = find(child, predicate);
    if (hit) return hit;
  }
  return null;
}

function allText(node) {
  return [node?.textContent || '', ...(node?.children || []).map(allText)].join(' ');
}

test('active Call UI locks typing during work, keeps hangup available, and exposes retry/caption states', async () => {
  const document = new FakeDocument();
  let retried = 0;
  const island = Object.freeze({
    kind: 'active', state: 'active', callSessionId: 'call:voice-v2', counterpartLabel: 'Kaelan Vance', counterpartAccountId: 'account:bot', title: 'Call',
    actions: Object.freeze([{ id: 'end', enabled: true }]), transcript: Object.freeze([userTranscript]),
  });
  const failed = renderApprovedCallSurface({ document, island, turnState: { phase: 'failed', locked: true, message: 'สร้างเสียงไม่สำเร็จ', retryLabel: 'ลองตอบใหม่' }, captionsVisible: true, onRetry: () => { retried += 1; } });
  assert.match(allText(failed), /อรุณสวัสดิ์/);
  assert.match(allText(failed), /สร้างเสียงไม่สำเร็จ/);
  assert.equal(find(failed, node => node.attributes?.get?.('aria-label') === 'Call text').disabled, true);
  assert.equal(find(failed, node => node.dataset?.callAction === 'end').disabled, false);
  const retry = find(failed, node => node.dataset?.callAction === 'retry-reply');
  assert.ok(retry);
  retry.click();
  await Promise.resolve();
  assert.equal(retried, 1);

  const thinking = renderApprovedCallSurface({ document, island, turnState: { phase: 'thinking', locked: true }, captionsVisible: true });
  assert.match(allText(thinking), /อรุณสวัสดิ์/);
  assert.equal(find(thinking, node => node.attributes?.get?.('aria-label') === 'กำลังคิด…')?.className, 'tmrw-call-authority-loading-wave');
  const synthesizing = renderApprovedCallSurface({ document, island, turnState: { phase: 'synthesizing', locked: true }, captionsVisible: true });
  assert.equal(find(synthesizing, node => node.attributes?.get?.('aria-label') === 'กำลังเตรียมเสียง…')?.className, 'tmrw-call-authority-loading-wave');

  const speaking = renderApprovedCallSurface({ document, island, turnState: { phase: 'speaking', locked: true, subtitleThai: 'อรุณสวัสดิ์ครับ' }, captionsVisible: false });
  assert.doesNotMatch(allText(speaking), /กำลังพูด/);
  assert.doesNotMatch(allText(speaking), /อรุณสวัสดิ์ครับ/);
});

test('Call UI warns that played audio was not fully saved without locking the call', () => {
  const document = new FakeDocument();
  let dismissed = 0;
  const island = { kind: 'active', state: 'active', callSessionId: 'call:archive-warning', counterpartLabel: 'Kaelan Vance', counterpartAccountId: 'account:bot', title: 'Call', actions: [{ id: 'end', enabled: true }], transcript: [userTranscript] };
  const active = renderApprovedCallSurface({ document, island, archiveWarning: 'เสียงเล่นแล้ว แต่บันทึกไว้ฟังย้อนหลังไม่สำเร็จ', onDismissArchiveWarning: () => { dismissed += 1; } });
  assert.match(allText(find(active, node => node.attributes?.get?.('role') === 'alert')), /บันทึกไว้ฟังย้อนหลังไม่สำเร็จ/);
  assert.equal(find(active, node => node.attributes?.get?.('aria-label') === 'Call text').disabled, false);
  find(active, node => node.attributes?.get?.('aria-label') === 'ปิดคำเตือนการบันทึกเสียง').click();
  assert.equal(dismissed, 1);
  const ended = renderApprovedCallSurface({ document, island: { ...island, kind: 'ended', state: 'ended' }, archiveWarning: 'เสียงเล่นแล้ว แต่บันทึกไว้ฟังย้อนหลังไม่สำเร็จ' });
  assert.match(allText(find(ended, node => node.attributes?.get?.('role') === 'alert')), /บันทึกไว้ฟังย้อนหลังไม่สำเร็จ/);
  assert.match(allText(ended), /ข้อความสนทนาถูกบันทึกไว้แล้ว/);
});

test('same-route Call state refresh keeps the current surface visible while view data hydrates', async () => {
  const context = await setupPhase9({ castSize: 1, manifestId: 'voice-v2-call-refresh' });
  let delayNextCalls = false;
  let releaseHydration = null;
  const viewModels = new Proxy(context.viewModels, {
    get(target, property) {
      if (property === 'selected') return async input => {
        const view = await target.selected(input);
        if (delayNextCalls && input.route === 'calls') {
          delayNextCalls = false;
          await new Promise(resolve => { releaseHydration = resolve; });
        }
        return view;
      };
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const shell = new TmrwPhoneShell({
    document: context.document,
    viewModels,
    controller: context.controller,
    messageService: context.messages,
    callService: context.calls,
    callCoordinator: viewModels.callCoordinator,
    scope: context.scope,
    playerActorId: context.user.actorId,
    playerInstanceId: context.user.instanceId,
    selectedDeviceId: context.user.deviceId,
  });
  await shell.mount(context.target);
  find(shell.root, node => node.dataset?.action === 'unlock').click();
  for (let index = 0; index < 100 && !find(shell.root, node => node.dataset?.app === 'calls'); index += 1) await new Promise(resolve => setImmediate(resolve));
  find(shell.root, node => node.dataset?.app === 'calls').click();
  for (let index = 0; index < 100 && !/ยังไม่มีประวัติสาย/.test(allText(shell.root)); index += 1) await new Promise(resolve => setImmediate(resolve));
  assert.match(allText(shell.root), /ยังไม่มีประวัติสาย/);
  const screen = find(shell.root, node => node.id === 'tmrw-phone-screen');
  const visibleCallSurface = screen.children[0];

  delayNextCalls = true;
  const refreshing = shell.renderActive();
  for (let index = 0; index < 100 && !releaseHydration; index += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof releaseHydration, 'function');
  assert.equal(screen.children[0], visibleCallSurface, 'same-route refresh must not replace the Call surface with a loading screen');
  assert.doesNotMatch(allText(screen), /กำลังโหลด Phone/);
  releaseHydration();
  await refreshing;
});
