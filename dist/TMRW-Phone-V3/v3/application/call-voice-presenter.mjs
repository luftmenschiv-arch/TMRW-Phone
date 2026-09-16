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
  return Object.freeze({ ...(profile || {}), profileName: 'Puzzle', language: profile?.language || VOICE_LANGUAGE.AUTO, defaultDelivery: profile?.defaultDelivery || 'natural', traits: Object.freeze({ ...(profile?.traits || {}) }), providerNeutral: true });
}

function resolveLanguage(profile, settings, prepared) {
  if ([VOICE_LANGUAGE.ENGLISH, VOICE_LANGUAGE.JAPANESE].includes(settings?.voiceLanguagePreference)) return settings.voiceLanguagePreference;
  if ([VOICE_LANGUAGE.ENGLISH, VOICE_LANGUAGE.JAPANESE].includes(prepared?.language)) return prepared.language;
  if ([VOICE_LANGUAGE.ENGLISH, VOICE_LANGUAGE.JAPANESE].includes(profile?.language)) return profile.language;
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
  #processed = new Set();
  #activeByCall = new Map();
  #lastResult = null;

  constructor({ voiceProfileService, settingsService, adapter, playbackController, timingDiagnostics = null }) {
    if (!voiceProfileService?.resolve) throw new TypeError('CallVoicePresenter requires VoiceProfileService');
    if (!settingsService?.get) throw new TypeError('CallVoicePresenter requires settings');
    if (!adapter?.render) throw new TypeError('CallVoicePresenter requires a Voice adapter');
    if (!playbackController?.play || !playbackController?.cancelCall) throw new TypeError('CallVoicePresenter requires playback controller');
    this.#profiles = voiceProfileService;
    this.#settings = settingsService;
    this.#adapter = adapter;
    this.#playback = playbackController;
    this.#timing = timingDiagnostics;
  }

  get status() {
    return Object.freeze({ processedCount: this.#processed.size, activeCalls: Object.freeze([...this.#activeByCall.keys()]), playback: this.#playback.status, lastResult: this.#lastResult });
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

    this.cancelCall(callSessionId, 'replaced');
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

  cancelCall(callSessionId, reason = 'end-call') {
    const id = String(callSessionId || '').trim();
    if (!id) return false;
    const controller = this.#activeByCall.get(id);
    if (controller) {
      try { controller.abort(reason); } catch { controller.abort(); }
      this.#activeByCall.delete(id);
    }
    let playback = false;
    try { playback = this.#playback.cancelCall(id); } catch {}
    return Boolean(controller || playback);
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
