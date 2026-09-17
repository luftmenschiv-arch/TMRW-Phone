import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceAudioHistoryService } from '../../application/voice-audio-history-service.mjs';
import { CallVoicePresenter } from '../../application/call-voice-presenter.mjs';
import { TMRWLocalVoiceAdapter } from '../../platform/voice/tmrw-local-voice-adapter.mjs';
import { setupPhase9, startCall, transitionCall, addCallText } from '../phase9/call-fixtures.mjs';

const wav = marker => new Blob([new Uint8Array(64).fill(marker)], { type: 'audio/wav' });
const pcmWav = samples => {
  const buffer = new ArrayBuffer(44 + samples.length); const view = new DataView(buffer); const bytes = new Uint8Array(buffer);
  const write = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + samples.length, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true); write(36, 'data'); view.setUint32(40, samples.length, true); bytes.set(samples, 44); return new Blob([buffer], { type: 'audio/wav' });
};

test('TMRW Local Voice archive combines same-format WAV segments into one playable file', async () => {
  const adapter = new TMRWLocalVoiceAdapter({ fetchImpl: async () => { throw new Error('unused'); }, createObjectURL: () => 'blob:combined', revokeObjectURL: () => {} });
  const merged = await adapter.combineStoredBlobs([pcmWav(Uint8Array.from([1, 2])), pcmWav(Uint8Array.from([3, 4, 5]))]);
  const view = new DataView(await merged.arrayBuffer());
  assert.equal(merged.type, 'audio/wav');
  assert.equal(view.getUint32(40, true), 5);
  assert.deepEqual([...new Uint8Array(await merged.arrayBuffer()).slice(44)], [1, 2, 3, 4, 5]);
});

test('actual call audio bytes, bilingual metadata, Keep, and cleanup remain scoped without deleting transcript', async () => {
  const c = await setupPhase9({ castSize: 1, manifestId: 'p23-audio-persistence' });
  const history = new VoiceAudioHistoryService({ database: c.database });
  const started = await startCall(c, { key: 'audio-persist' });
  await transitionCall(c, started.session.callSessionId, 'accept', { key: 'audio-persist-accept' });
  const bot = await addCallText(c, started.session.callSessionId, { speaker: c.alice, actual: c.alice, device: c.alice, text: 'อรุณสวัสดิ์ครับ', key: 'audio-persist-bot' });
  const blob = wav(7);
  await history.registerDerivedArtifact({ scope: c.scope, artifact: {
    id: `${bot.transcript.transcriptEntryId}:audio:0`, callSessionId: started.session.callSessionId, transcriptEntryId: bot.transcript.transcriptEntryId,
    actorId: c.alice.actorId, instanceId: c.alice.instanceId, language: 'ja', artifactRef: 'stored:audio:0', audioBlob: blob,
    mimeType: 'audio/wav', segmentIndex: 0, subtitleThai: 'อรุณสวัสดิ์ครับ', spokenText: 'おはようございます。', filename: 'kaelan-01.wav', durationMs: 900,
  } });

  let rows = await history.listByCall({ scope: c.scope, callSessionId: started.session.callSessionId });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].recoverable, true);
  assert.equal(rows[0].audioBlob.size, 64);
  assert.equal(rows[0].subtitleThai, 'อรุณสวัสดิ์ครับ');
  assert.equal(rows[0].spokenText, 'おはようございます。');
  assert.equal((await rows[0].audioBlob.arrayBuffer()).byteLength, 64);
  await transitionCall(c, started.session.callSessionId, 'end', { actor: c.user, key: 'audio-persist-end', durationMs: 900 });
  const view = await c.viewModels.selected({ scope: c.scope, deviceId: c.user.deviceId, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, route: 'calls', controller: c.controller, selectedCallSessionId: started.session.callSessionId });
  assert.equal(view.callUi.details.audioArtifacts.length, 1);
  assert.equal(view.callUi.details.audioArtifacts[0].spokenText, 'おはようございます。');
  assert.equal(view.callUi.details.audioStorage.totalBytes, 64);

  await history.setCallKept({ scope: c.scope, callSessionId: started.session.callSessionId, kept: true });
  await history.deleteTemporary({ scope: c.scope });
  rows = await history.listByCall({ scope: c.scope, callSessionId: started.session.callSessionId });
  assert.equal(rows[0].retention, 'kept');
  assert.equal((await c.calls.listTranscript({ scope: c.scope, viewerAccountId: c.user.accountId, callSessionId: started.session.callSessionId })).length, 1);
  const summary = await history.storageSummary({ scope: c.scope });
  assert.equal(summary.keptBytes, 64);
  assert.equal(summary.temporaryBytes, 0);
});

test('temporary retention evicts the oldest unkept call after 20 calls', async () => {
  const c = await setupPhase9({ castSize: 1, manifestId: 'p23-audio-retention' });
  const history = new VoiceAudioHistoryService({ database: c.database });
  const callIds = [];
  for (let index = 0; index < 21; index += 1) {
    const started = await startCall(c, { key: `retention-${index}` });
    callIds.push(started.session.callSessionId);
    await transitionCall(c, started.session.callSessionId, 'accept', { key: `retention-${index}-accept` });
    await history.registerDerivedArtifact({ scope: c.scope, artifact: {
      id: `retention-audio-${index}`, callSessionId: started.session.callSessionId, transcriptEntryId: null, actorId: c.alice.actorId, instanceId: c.alice.instanceId,
      language: 'en', artifactRef: `stored:retention:${index}`, audioBlob: wav(index), mimeType: 'audio/wav', segmentIndex: 0,
      subtitleThai: `ทดสอบ ${index}`, spokenText: `Test ${index}`, filename: `retention-${index}.wav`, durationMs: 100,
    } });
    await transitionCall(c, started.session.callSessionId, 'end', { actor: c.user, key: `retention-${index}-end`, durationMs: 100 });
  }

  assert.equal((await history.listByCall({ scope: c.scope, callSessionId: callIds[0] })).length, 0);
  assert.equal((await history.listByCall({ scope: c.scope, callSessionId: callIds.at(-1) })).length, 1);
  assert.equal((await history.storageSummary({ scope: c.scope })).temporaryCalls, 20);
});

test('archived playback is sequential and uses stored blobs without overlapping', async () => {
  const events = [];
  const presenter = new CallVoicePresenter({
    voiceProfileService: { resolve: async () => ({}) },
    settingsService: { get: async () => ({}) },
    adapter: {
      render: async () => ({ status: 'unavailable' }),
      materializeStoredBlob(blob) { events.push(`materialize:${blob.size}`); return { status: 'ready', audioArtifactRef: `blob:${events.length}` }; },
      release(result) { events.push(`release:${result.audioArtifactRef}`); },
    },
    playbackController: {
      status: {}, cancelActive() { events.push('cancel-active'); },
      async play({ transcriptEntryId }) { events.push(`play:${transcriptEntryId}`); return { status: 'completed' }; },
      cancelCall() { return false; }, dispose() {},
    },
  });
  const result = await presenter.playArchivedArtifacts({ callSessionId: 'call:archive', artifacts: [
    { id: 'b', segmentIndex: 1, recoverable: true, audioBlob: wav(2) },
    { id: 'a', segmentIndex: 0, recoverable: true, audioBlob: wav(1) },
  ] });
  assert.equal(result.status, 'completed');
  assert.equal(result.played, 2);
  assert.match(events[2], /archive:a/);
  assert.match(events[5], /archive:b/);
});

test('production presenter persists runtime bytes after canonical bot transcript commit', async () => {
  const stored = [];
  const blob = wav(9);
  const presenter = new CallVoicePresenter({
    voiceProfileService: { resolve: async () => ({ profileName: 'male-polite-dangerous', language: 'en', defaultDelivery: 'natural', traits: {}, providerNeutral: true }) },
    settingsService: { get: async () => ({ voiceCallsEnabled: true, botCallsWithVoice: true, voiceLanguagePreference: 'en', voiceDefaultDelivery: 'natural' }) },
    adapter: {
      render: async () => ({ status: 'ready', audioArtifactRef: 'blob:runtime', audioBlob: blob, mimeType: 'audio/wav', durationMs: 700 }),
      release() {},
    },
    playbackController: { status: {}, async play() { return { status: 'completed' }; }, cancelCall() { return false; }, dispose() {} },
    voiceAudioHistoryService: { async registerDerivedArtifact(input) { stored.push(input); return input.artifact; } },
  });
  const prepared = Object.freeze({ status: 'prepared', preparedId: 'prepared:persist', callSessionId: 'call:persist', language: 'en', botBinding: { actorId: 'actor:bot', instanceId: 'instance:bot' }, segments: [{ subtitleThai: 'สวัสดีครับ', spokenText: 'Good morning.' }] });
  const result = await presenter.presentPreparedBotReply({
    scope: { storyId: 'story:persist', branchId: 'branch:persist' },
    playerInstanceId: 'instance:user',
    prepared,
    commit: async () => ({ committed: true, transcript: { transcriptEntryId: 'transcript:persist', callSessionId: 'call:persist' } }),
  });
  assert.equal(result.status, 'played');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].artifact.audioBlob, blob);
  assert.equal(stored[0].artifact.subtitleThai, 'สวัสดีครับ');
  assert.equal(stored[0].artifact.spokenText, 'Good morning.');
});
