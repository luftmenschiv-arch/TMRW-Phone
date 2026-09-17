import { requireEventScope } from '../domain/events/event-validator.mjs';
import { CALL_EVENT_TYPES } from '../domain/calls/call-event-types.mjs';
import { normalizeVoiceRenderRequest, VOICE_RENDER_STATUS } from '../domain/voice/voice-adapter-contract.mjs';
import { VOICE_LANGUAGE } from '../domain/voice/voice-profile.mjs';

function committedTranscript(commit) {
  if (!commit || commit.event?.eventType !== CALL_EVENT_TYPES.TRANSCRIPT_ADDED) return null;
  return commit.transcript || commit.event?.payload?.transcript || null;
}
function profileIsConfigured(profile) {
  return Boolean(String(profile?.profileName || '').trim());
}

function effectiveProfile(profile) {
  if (profileIsConfigured(profile)) return profile;
  return Object.freeze({ ...(profile || {}), profileName: 'male-polite-dangerous', language: profile?.language || VOICE_LANGUAGE.AUTO, defaultDelivery: profile?.defaultDelivery || 'natural', traits: Object.freeze({ ...(profile?.traits || {}) }), providerNeutral: true });
}

function resolveLanguage(profile, settings, prepared) {
  if ([VOICE_LANGUAGE.ENGLISH, VOICE_LANGUAGE.JAPANESE].includes(settings?.voiceLanguagePreference)) return settings.voiceLanguagePreference;
  if ([VOICE_LANGUAGE.ENGLISH, VOICE_LANGUAGE.JAPANESE].includes(prepared?.language)) return prepared.language;
  return VOICE_LANGUAGE.ENGLISH;
}

function preparedSegments(prepared) {
  const source = Array.isArray(prepared?.segments) ? prepared.segments : [];
  return source.map((segment, index) => Object.freeze({
    index,
    subtitleThai: String(segment?.subtitleThai || segment?.subtitle_th || '').trim(),
    spokenText: String(segment?.spokenText || segment?.spoken_text || '').trim(),
  })).filter(segment => segment.subtitleThai && segment.spokenText);
}

export class CallVoicePresenter {
  #profiles;
  #settings;
  #adapter;
  #playback;
  #timing;
  #audioHistory;
  #processed = new Set();
  #activeByCall = new Map();
  #warmByCall = new Map();
  #lastResult = null;
  #archivePlaybackSequence = 0;

  constructor({ voiceProfileService, settingsService, adapter, playbackController, timingDiagnostics = null, voiceAudioHistoryService = null }) {
    if (!voiceProfileService?.resolve) throw new TypeError('CallVoicePresenter requires VoiceProfileService');
    if (!settingsService?.get) throw new TypeError('CallVoicePresenter requires settings');
    if (!adapter?.render) throw new TypeError('CallVoicePresenter requires a Voice adapter');
    if (!playbackController?.play || !playbackController?.cancelCall) throw new TypeError('CallVoicePresenter requires playback controller');
    this.#profiles = voiceProfileService;
    this.#settings = settingsService;
    this.#adapter = adapter;
    this.#playback = playbackController;
    this.#timing = timingDiagnostics;
    this.#audioHistory = voiceAudioHistoryService;
  }

  get status() {
    return Object.freeze({ processedCount: this.#processed.size, activeCalls: Object.freeze([...this.#activeByCall.keys()]), warmingCalls: Object.freeze([...this.#warmByCall.keys()]), playback: this.#playback.status, lastResult: this.#lastResult });
  }

  async warmCall({ scope: inputScope, playerInstanceId, callSessionId }) {
    const scope = requireEventScope(inputScope);
    const callId = String(callSessionId || '').trim();
    if (!callId || typeof this.#adapter.warm !== 'function') return Object.freeze({ ready: false, reason: 'runtime-warmup-unavailable' });
    const settings = await this.#settings.get({ scope, playerInstanceId });
    if (!settings.voiceCallsEnabled || !settings.botCallsWithVoice) return Object.freeze({ ready: false, reason: 'voice-disabled' });
    const language = resolveLanguage(null, settings, null);
    const prior = this.#warmByCall.get(callId);
    if (prior) { try { prior.abort('warmup-replaced'); } catch { prior.abort(); } }
    const controller = new AbortController();
    this.#warmByCall.set(callId, controller);
    try { return await this.#adapter.warm({ callSessionId: callId, language, signal: controller.signal, baseUrl: settings.voiceRuntimeBaseUrl || null }); }
    catch (error) { return Object.freeze({ ready: false, reason: controller.signal.aborted ? 'warmup-cancelled' : (error?.code || 'warmup-failed') }); }
    finally { if (this.#warmByCall.get(callId) === controller) this.#warmByCall.delete(callId); }
  }

  async presentPreparedBotReply({ scope: inputScope, playerInstanceId, prepared, commit = null, committed = null, startIndex = 0, onUpdate = null }) {
    const scope = requireEventScope(inputScope);
    const callSessionId = String(prepared?.callSessionId || committed?.transcript?.callSessionId || '').trim();
    const timingTurnId = String(prepared?.preparedId || committed?.transcript?.transcriptEntryId || '').trim();
    const complete = result => { if (timingTurnId) this.#timing?.finish?.(timingTurnId, result?.status || result?.reason || 'finished', { outcome: result?.reason || result?.status }); return this.#record(result); };
    const segments = preparedSegments(prepared);
    const firstIndex = Math.max(0, Number(startIndex) || 0);
    if (!callSessionId || !segments.length || firstIndex >= segments.length) return this.#record({ status: 'failed', reason: 'invalid-prepared-voice-reply', failedIndex: firstIndex });
    const settings = await this.#settings.get({ scope, playerInstanceId });
    if (!settings.voiceCallsEnabled || !settings.botCallsWithVoice) return this.#record({ status: 'failed', reason: 'voice-disabled', failedIndex: firstIndex });
    const rawProfile = prepared?.resolvedProfile || await this.#profiles.resolve({ scope, actorId: prepared.botBinding.actorId, instanceId: prepared.botBinding.instanceId });
    const profile = effectiveProfile(rawProfile);
    const language = resolveLanguage(profile, settings, prepared);
    if (timingTurnId) {
      this.#timing?.begin?.(timingTurnId, { callSessionId });
      this.#timing?.mark?.(timingTurnId, 'voice-pipeline-start', { language, segmentCount: segments.length });
    }
    const requests = segments.slice(firstIndex).map(segment => normalizeVoiceRenderRequest({
      actorId: prepared.botBinding.actorId,
      instanceId: prepared.botBinding.instanceId,
      callSessionId,
      canonicalText: segment.spokenText,
      subtitleText: segment.subtitleThai,
      language,
      resolvedProfile: profile,
      delivery: { preset: settings.voiceDefaultDelivery || profile.defaultDelivery || 'natural' },
    }));

    this.cancelCall(callSessionId, 'replaced', { invalidateRuntime: false });
    const controller = new AbortController();
    this.#activeByCall.set(callSessionId, controller);
    let sequence = null;
    try {
      onUpdate?.(Object.freeze({ phase: 'synthesizing', segmentIndex: firstIndex, segmentCount: segments.length }));
      if (typeof this.#adapter.openSequence === 'function') {
        try { sequence = await this.#adapter.openSequence(requests, { signal: controller.signal, baseUrl: settings.voiceRuntimeBaseUrl || null, onTiming: event => this.#timing?.mark?.(timingTurnId, event.phase, { ...event, segmentIndex: Number.isSafeInteger(event.segmentIndex) ? firstIndex + event.segmentIndex : undefined, language }) }); }
        catch (error) {
          if (controller.signal.aborted) return complete({ status: 'cancelled', reason: 'voice-cancelled', failedIndex: firstIndex, committed });
          sequence = null;
        }
      }

      let nextAudio = sequence ? sequence.renderAt(0) : this.#adapter.render(requests[0], { signal: controller.signal, baseUrl: settings.voiceRuntimeBaseUrl || null });
      let currentCommit = committed;
      let totalDurationMs = 0;
      for (let offset = 0; offset < requests.length; offset += 1) {
        const absoluteIndex = firstIndex + offset;
        const segment = segments[absoluteIndex];
        let renderResult = await nextAudio;
        if (controller.signal.aborted || renderResult?.status === VOICE_RENDER_STATUS.CANCELLED) return complete({ status: 'cancelled', reason: 'voice-cancelled', failedIndex: absoluteIndex, committed: currentCommit });
        if (renderResult?.status !== VOICE_RENDER_STATUS.READY || !renderResult.audioArtifactRef) {
          onUpdate?.(Object.freeze({ phase: 'retrying-voice', segmentIndex: absoluteIndex, segmentCount: segments.length }));
          const canResumeRuntimeTurn = renderResult?.errorCode === 'runtime-timeout' && typeof sequence?.retryAt === 'function';
          renderResult = canResumeRuntimeTurn
            ? await sequence.retryAt(offset)
            : await this.#adapter.render(requests[offset], { signal: controller.signal, baseUrl: settings.voiceRuntimeBaseUrl || null, onTiming: event => this.#timing?.mark?.(timingTurnId, event.phase, { ...event, segmentIndex: Number.isSafeInteger(event.segmentIndex) ? firstIndex + event.segmentIndex : undefined, language }) });
        }
        if (controller.signal.aborted || renderResult?.status === VOICE_RENDER_STATUS.CANCELLED) return complete({ status: 'cancelled', reason: 'voice-cancelled', failedIndex: absoluteIndex, committed: currentCommit });
        if (renderResult?.status !== VOICE_RENDER_STATUS.READY || !renderResult.audioArtifactRef) return complete({ status: 'failed', reason: renderResult?.errorCode || renderResult?.status || 'voice-render-failed', failedIndex: absoluteIndex, committed: currentCommit, language });

        if (offset + 1 < requests.length) nextAudio = sequence ? sequence.renderAt(offset + 1) : this.#adapter.render(requests[offset + 1], { signal: controller.signal, baseUrl: settings.voiceRuntimeBaseUrl || null });
        if (!currentCommit) {
          if (typeof commit !== 'function') return complete({ status: 'failed', reason: 'voice-commit-required', failedIndex: absoluteIndex });
          currentCommit = await commit();
          if (!currentCommit?.committed) return complete({ status: 'failed', reason: currentCommit?.reason || 'voice-commit-failed', failedIndex: absoluteIndex });
        }

        onUpdate?.(Object.freeze({ phase: 'speaking', segmentIndex: absoluteIndex, segmentCount: segments.length, subtitleThai: segment.subtitleThai }));
        const transcriptEntryId = String(currentCommit.transcript?.transcriptEntryId || prepared.preparedId || callSessionId);
        if (renderResult.audioBlob && this.#audioHistory?.registerDerivedArtifact) {
          const artifactId = `${transcriptEntryId}:audio:${absoluteIndex}`;
          try {
            await this.#audioHistory.registerDerivedArtifact({ scope, artifact: {
              id: artifactId,
              callSessionId,
              transcriptEntryId,
              actorId: prepared.botBinding.actorId,
              instanceId: prepared.botBinding.instanceId,
              language,
              artifactRef: artifactId,
              audioBlob: renderResult.audioBlob,
              mimeType: renderResult.mimeType || renderResult.audioBlob.type || 'audio/wav',
              byteLength: Number(renderResult.audioBlob.size || 0),
              segmentIndex: absoluteIndex,
              subtitleThai: segment.subtitleThai,
              spokenText: segment.spokenText,
              filename: `tmrw-call-${callSessionId.replace(/[^a-z0-9_-]+/gi, '-')}-${String(absoluteIndex + 1).padStart(2, '0')}.wav`,
              durationMs: Number(renderResult.durationMs || 0),
              retention: 'temporary',
              sourceKind: 'tmrw-local-voice',
            } });
          } catch (error) { this.#timing?.mark?.(timingTurnId, 'audio-history-failed', { segmentIndex: absoluteIndex, outcome: error?.code || 'storage-failed' }); }
        }
        this.#timing?.mark?.(timingTurnId, 'playback-start', { segmentIndex: absoluteIndex, segmentCount: segments.length, durationMs: renderResult.durationMs, language });
        const playback = await this.#playback.play({ callSessionId, transcriptEntryId: `${transcriptEntryId}:segment:${absoluteIndex}`, audioArtifactRef: renderResult.audioArtifactRef });
        this.#timing?.mark?.(timingTurnId, 'playback-end', { segmentIndex: absoluteIndex, segmentCount: segments.length, outcome: playback.status, language });
        try { this.#adapter.release?.(renderResult); } catch {}
        if (playback.status !== 'completed' && playback.status !== 'duplicate') return complete({ status: controller.signal.aborted ? 'cancelled' : 'failed', reason: `playback-${playback.status}`, failedIndex: absoluteIndex, committed: currentCommit, language });
        if (Number.isFinite(renderResult.durationMs)) totalDurationMs += renderResult.durationMs;
        if (offset + 1 < requests.length) onUpdate?.(Object.freeze({ phase: 'synthesizing', segmentIndex: absoluteIndex + 1, segmentCount: segments.length }));
      }
      onUpdate?.(Object.freeze({ phase: 'completed', segmentIndex: segments.length - 1, segmentCount: segments.length }));
      return complete({ status: 'played', reason: 'completed', language, committed: currentCommit, segmentCount: segments.length, durationMs: totalDurationMs });
    } catch (error) {
      return complete({ status: controller.signal.aborted ? 'cancelled' : 'failed', reason: controller.signal.aborted ? 'voice-cancelled' : (error?.code || 'voice-presenter-error'), failedIndex: firstIndex, committed, language, error: String(error?.message || error) });
    } finally {
      if (this.#activeByCall.get(callSessionId) === controller) this.#activeByCall.delete(callSessionId);
    }
  }

  async presentCommittedBotTranscript({ scope: inputScope, playerActorId, playerInstanceId, commit }) {
    const scope = requireEventScope(inputScope);
    const transcript = committedTranscript(commit);
    if (!transcript) return this.#record({ status: 'text-only', reason: 'not-committed-transcript' });
    if (transcript.actualAuthorActorId === playerActorId) return this.#record({ status: 'text-only', reason: 'player-transcript' });
    const key = String(transcript.transcriptEntryId || commit.event?.id || '').trim();
    if (!key) return this.#record({ status: 'text-only', reason: 'missing-transcript-id' });
    if (this.#processed.has(key)) return this.#record({ status: 'duplicate', reason: 'already-presented', transcriptEntryId: key });
    const prepared = commit.prepared || Object.freeze({
      status: 'prepared',
      preparedId: key,
      callSessionId: transcript.callSessionId,
      language: commit.language || null,
      resolvedProfile: commit.resolvedProfile || null,
      botBinding: Object.freeze({ actorId: transcript.actualAuthorActorId, instanceId: transcript.actualAuthorInstanceId }),
      segments: commit.voiceSegments || Object.freeze([Object.freeze({ index: 0, subtitleThai: transcript.text, spokenText: transcript.text })]),
    });
    const result = await this.presentPreparedBotReply({ scope, playerInstanceId, prepared, committed: commit });
    if (result.status === 'played') {
      this.#processed.add(key);
      return Object.freeze({ ...result, transcriptEntryId: key });
    }
    if (result.status === 'cancelled') return this.#record({ status: 'text-only', reason: 'voice-cancelled', transcriptEntryId: key, language: result.language });
    return this.#record({ status: 'text-only', reason: result.reason, transcriptEntryId: key, language: result.language, failedIndex: result.failedIndex });
  }

  async playArchivedArtifacts({ callSessionId, artifacts = [] }) {
    const id = String(callSessionId || '').trim();
    const rows = artifacts.filter(row => row?.recoverable && row?.audioBlob).slice().sort((left, right) => Number(left.turnIndex || 0) - Number(right.turnIndex || 0) || Number(left.segmentIndex || 0) - Number(right.segmentIndex || 0));
    if (!id || !rows.length || typeof this.#adapter.materializeStoredBlob !== 'function') return Object.freeze({ status: 'unavailable', played: 0 });
    this.#playback.cancelActive?.('replaced');
    const sequence = ++this.#archivePlaybackSequence;
    if (typeof this.#adapter.materializeStoredBlobs === 'function') {
      const merged = await this.#adapter.materializeStoredBlobs(rows.map(row => row.audioBlob), { durationMs: rows.reduce((sum, row) => sum + Number(row.durationMs || 0), 0) });
      if (sequence !== this.#archivePlaybackSequence || merged.status !== VOICE_RENDER_STATUS.READY) return Object.freeze({ status: merged.status || 'failed', played: 0 });
      const result = await this.#playback.play({ callSessionId: id, transcriptEntryId: `archive:${id}:${sequence}`, audioArtifactRef: merged.audioArtifactRef });
      try { this.#adapter.release?.(merged); } catch {}
      return Object.freeze({ status: result.status, played: result.status === 'completed' ? rows.length : 0 });
    }
    let played = 0;
    for (const row of rows) {
      if (sequence !== this.#archivePlaybackSequence) return Object.freeze({ status: 'cancelled', played });
      const renderResult = this.#adapter.materializeStoredBlob(row.audioBlob, { durationMs: row.durationMs, mimeType: row.mimeType });
      if (renderResult.status !== VOICE_RENDER_STATUS.READY) return Object.freeze({ status: 'failed', played });
      const playbackId = `archive:${row.id}:${sequence}`;
      const result = await this.#playback.play({ callSessionId: id, transcriptEntryId: playbackId, audioArtifactRef: renderResult.audioArtifactRef });
      try { this.#adapter.release?.(renderResult); } catch {}
      if (result.status !== 'completed' && result.status !== 'duplicate') return Object.freeze({ status: result.status, played });
      played += 1;
    }
    return Object.freeze({ status: 'completed', played });
  }

  async combineArchivedArtifacts(artifacts = []) {
    const rows = artifacts.filter(row => row?.recoverable && row?.audioBlob).slice().sort((left, right) => Number(left.turnIndex || 0) - Number(right.turnIndex || 0) || Number(left.segmentIndex || 0) - Number(right.segmentIndex || 0));
    if (!rows.length || typeof this.#adapter.combineStoredBlobs !== 'function') return null;
    try { return await this.#adapter.combineStoredBlobs(rows.map(row => row.audioBlob)); } catch { return null; }
  }

  stopArchivedPlayback(callSessionId) {
    this.#archivePlaybackSequence += 1;
    return this.#playback.cancelCall(String(callSessionId || '').trim());
  }

  pauseArchivedPlayback() { return this.#playback.pauseActive?.() || false; }
  resumeArchivedPlayback() { return this.#playback.resumeActive?.() || false; }

  cancelCall(callSessionId, reason = 'end-call', { invalidateRuntime = true } = {}) {
    const id = String(callSessionId || '').trim();
    if (!id) return false;
    const controller = this.#activeByCall.get(id);
    if (controller) {
      try { controller.abort(reason); } catch { controller.abort(); }
      this.#activeByCall.delete(id);
    }
    const warmController = this.#warmByCall.get(id);
    if (warmController) {
      try { warmController.abort(reason); } catch { warmController.abort(); }
      this.#warmByCall.delete(id);
    }
    if (invalidateRuntime) { try { this.#adapter.invalidateCall?.(id); } catch {} }
    let playback = false;
    try { playback = this.#playback.cancelCall(id); } catch {}
    return Boolean(controller || warmController || playback);
  }

  dispose() {
    for (const id of [...this.#activeByCall.keys()]) this.cancelCall(id, 'dispose');
    try { this.#playback.dispose?.(); } catch {}
    try { this.#adapter.dispose?.(); } catch {}
  }

  #record(result) {
    this.#lastResult = Object.freeze({ ...result });
    return this.#lastResult;
  }
}
