import test from 'node:test';
import assert from 'node:assert/strict';
import { CallBotReplyCoordinator } from '../../application/call-bot-reply-coordinator.mjs';
import { CallVoicePresenter } from '../../application/call-voice-presenter.mjs';
import { PuzzleLocalRuntimeVoiceAdapter } from '../../platform/voice/puzzle-local-runtime-adapter.mjs';
import { BetaSettingsService, GLOBAL_VOICE_SETTINGS_KEY } from '../../ui/settings-beta.mjs';
import { renderApprovedCallSurface } from '../../ui/calls/approved-call-surface.mjs';
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

function coordinatorHarness(generateQuietPrompt, { callService = null, stopGeneration = null } = {}) {
  const calls = callServiceHarness();
  const prompts = [];
  const coordinator = new CallBotReplyCoordinator({
    callService: callService || calls.service,
    voiceProfileService: { resolve: async () => ({ actorId: botBinding.actorId, instanceId: botBinding.instanceId, profileName: null, language: 'auto', defaultDelivery: 'natural', traits: {}, providerNeutral: true }) },
    settingsService: { get: async () => ({ voiceLanguagePreference: 'ja' }) },
    bindingResolver: async () => ({ actorBinding: botBinding }),
    getContext: () => ({
      groupId: null,
      characterId: 7,
      name2: 'Kaelan Vance',
      generateQuietPrompt: options => { prompts.push(options); return generateQuietPrompt(options); },
      stopGeneration,
    }),
  });
  return { coordinator, prompts, writes: calls.writes };
}

test('outbound reply stays uncommitted until bilingual Thai/Japanese segments are prepared for Voice', async () => {
  const response = JSON.stringify({ segments: [
    { subtitle_th: 'อรุณสวัสดิ์ครับ', spoken_text: 'おはようございます。' },
    { subtitle_th: 'เมื่อคืนหลับสบายไหมครับ', spoken_text: '昨夜はよく眠れましたか？' },
  ] });
  const h = coordinatorHarness(async () => response);
  const prepared = await h.coordinator.prepareReplyToCommittedUserTranscript({ scope, playerInstanceId: 'character-instance:user', commit: userCommit });
  assert.equal(prepared.status, 'prepared');
  assert.equal(prepared.language, 'ja');
  assert.deepEqual(prepared.segments.map(row => [row.subtitleThai, row.spokenText]), [
    ['อรุณสวัสดิ์ครับ', 'おはようございます。'],
    ['เมื่อคืนหลับสบายไหมครับ', '昨夜はよく眠れましたか？'],
  ]);
  assert.equal(h.writes.length, 0, 'the bot reply must remain hidden until real audio is ready');
  assert.match(h.prompts[0].quietPrompt, /strict JSON/i);
  assert.match(h.prompts[0].quietPrompt, /natural Japanese/);
  assert.match(h.prompts[0].quietPrompt, /Never answer as a different character/);
  assert.equal(h.prompts[0].jsonSchema.properties.segments.maxItems, 3);
  assert.deepEqual(h.prompts[0].jsonSchema.properties.segments.items.required, ['subtitle_th', 'spoken_text']);

  const committed = await h.coordinator.commitPreparedReply({ scope, prepared });
  assert.equal(committed.committed, true);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].text, 'อรุณสวัสดิ์ครับ เมื่อคืนหลับสบายไหมครับ');
  await h.coordinator.commitPreparedReply({ scope, prepared });
  assert.equal(h.writes.length, 1, 'commit must be idempotent');
});

test('invalid one-language model output fails closed instead of being spoken or exposed as a fake Thai subtitle', async () => {
  const h = coordinatorHarness(async () => 'Good morning.');
  const result = await h.coordinator.prepareReplyToCommittedUserTranscript({ scope, playerInstanceId: 'character-instance:user', commit: userCommit });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'invalid-structured-model-response');
  assert.equal(h.writes.length, 0);
});

test('generation cancellation exits without a late transcript commit', async () => {
  const stopped = [];
  const h = coordinatorHarness(() => new Promise(() => {}), { stopGeneration: reason => stopped.push(reason) });
  const controller = new AbortController();
  const pending = h.coordinator.prepareReplyToCommittedUserTranscript({ scope, playerInstanceId: 'character-instance:user', commit: { ...userCommit, event: { ...userCommit.event, id: 'event:user:cancel' }, transcript: { ...userTranscript, transcriptEntryId: 'transcript:user:cancel' } }, signal: controller.signal });
  controller.abort('hangup');
  const result = await pending;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.reason, 'generation-cancelled');
  assert.deepEqual(stopped, ['generation-cancelled']);
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

test('Puzzle multi-segment turn sends selected-language speech plus paired Thai subtitles and fetches each audio chunk', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/health')) return { ok: true, status: 200, json: async () => ({ ok: true, ready: true, voice: 'Puzzle' }) };
    if (url.endsWith('/turn/start')) return { ok: true, status: 200, json: async () => ({ ok: true, turn_id: 'turn:segments' }) };
    if (url.endsWith('/turn/push')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    if (url.includes('/turn/audio?')) return { ok: true, status: 200, headers: { get: name => name.toLowerCase() === 'content-type' ? 'audio/wav' : name.toLowerCase() === 'x-tmrw-duration' ? '0.5' : null }, blob: async () => ({ size: 128 }) };
    throw new Error(`unexpected URL ${url}`);
  };
  let objectUrl = 0;
  const adapter = new PuzzleLocalRuntimeVoiceAdapter({ fetchImpl, createObjectURL: () => `blob:segment:${++objectUrl}`, revokeObjectURL: () => {}, healthTimeoutMs: 500, requestTimeoutMs: 500, audioTimeoutMs: 1000 });
  const profile = Object.freeze({ profileName: 'Puzzle', language: 'ja', defaultDelivery: 'natural', traits: {}, providerNeutral: true });
  const sequence = await adapter.openSequence([
    { actorId: botBinding.actorId, instanceId: botBinding.instanceId, callSessionId: 'call:voice-v2', canonicalText: 'おはようございます。', subtitleText: 'อรุณสวัสดิ์ครับ', language: 'ja', resolvedProfile: profile },
    { actorId: botBinding.actorId, instanceId: botBinding.instanceId, callSessionId: 'call:voice-v2', canonicalText: 'よく眠れましたか？', subtitleText: 'หลับสบายไหมครับ', language: 'ja', resolvedProfile: profile },
  ]);
  const [first, second] = await Promise.all([sequence.renderAt(0), sequence.renderAt(1)]);
  assert.equal(first.status, 'ready');
  assert.equal(second.status, 'ready');
  const start = JSON.parse(requests.find(row => row.url.endsWith('/turn/start')).options.body);
  const pushes = requests.filter(row => row.url.endsWith('/turn/push')).map(row => JSON.parse(row.options.body));
  assert.deepEqual(start, { expected_chunks: 2, language: 'japanese', calibration: false });
  assert.deepEqual(pushes.map(row => [row.index, row.text, row.subtitle]), [
    [0, 'おはようございます。', 'อรุณสวัสดิ์ครับ'],
    [1, 'よく眠れましたか？', 'หลับสบายไหมครับ'],
  ]);
  assert.equal(requests.filter(row => row.url.includes('/turn/audio?')).length, 2);
});

test('presenter uses Puzzle fallback, retries one failed segment automatically, commits only after audio is ready, and streams all segments', async () => {
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
  assert.equal(requestSets[0][0].resolvedProfile.profileName, 'Puzzle');
  assert.equal(requestSets[0][0].canonicalText, 'Good morning.');
  assert.equal(requestSets[0][0].subtitleText, 'สวัสดีครับ');
  assert.ok(events.indexOf('retry:Good morning.') < events.indexOf('commit'));
  assert.ok(events.indexOf('commit') < events.findIndex(value => value.startsWith('play:')));
  assert.equal(events.filter(value => value.startsWith('play:')).length, 2);
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
  assert.match(allText(thinking), /กำลังคิด/);

  const speaking = renderApprovedCallSurface({ document, island, turnState: { phase: 'speaking', locked: true, subtitleThai: 'อรุณสวัสดิ์ครับ' }, captionsVisible: false });
  assert.match(allText(speaking), /กำลังพูด/);
  assert.doesNotMatch(allText(speaking), /อรุณสวัสดิ์ครับ/);
});
