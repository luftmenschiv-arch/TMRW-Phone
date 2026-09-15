import { requireEventScope } from '../domain/events/event-validator.mjs';
import { CALL_EVENT_TYPES } from '../domain/calls/call-event-types.mjs';
import { normalizeVoiceRenderRequest, VOICE_RENDER_STATUS } from '../domain/voice/voice-adapter-contract.mjs';
import { VOICE_LANGUAGE } from '../domain/voice/voice-profile.mjs';

const PUZZLE_PROFILE = 'puzzle';

function committedTranscript(commit) {
  if (!commit || commit.event?.eventType !== CALL_EVENT_TYPES.TRANSCRIPT_ADDED) return null;
  return commit.transcript || commit.event?.payload?.transcript || null;
}

function profileIsPuzzle(profile) {
  return String(profile?.profileName || '').trim().toLowerCase() === PUZZLE_PROFILE;
}

function resolveLanguage(profile, settings) {
  if ([VOICE_LANGUAGE.ENGLISH, VOICE_LANGUAGE.JAPANESE].includes(profile?.language)) return profile.language;
  if ([VOICE_LANGUAGE.ENGLISH, VOICE_LANGUAGE.JAPANESE].includes(settings?.voiceLanguagePreference)) return settings.voiceLanguagePreference;
  return null;
}

export class CallVoicePresenter {
  #profiles;
  #settings;
  #adapter;
  #playback;
  #processed = new Set();
  #activeByCall = new Map();
  #lastResult = null;

  constructor({ voiceProfileService, settingsService, adapter, playbackController }) {
    if (!voiceProfileService?.resolve) throw new TypeError('CallVoicePresenter requires VoiceProfileService');
    if (!settingsService?.get) throw new TypeError('CallVoicePresenter requires settings');
    if (!adapter?.render) throw new TypeError('CallVoicePresenter requires a Voice adapter');
    if (!playbackController?.play || !playbackController?.cancelCall) throw new TypeError('CallVoicePresenter requires playback controller');
    this.#profiles = voiceProfileService;
    this.#settings = settingsService;
    this.#adapter = adapter;
    this.#playback = playbackController;
  }

  get status() {
    return Object.freeze({ processedCount: this.#processed.size, activeCalls: Object.freeze([...this.#activeByCall.keys()]), playback: this.#playback.status, lastResult: this.#lastResult });
  }

  async presentCommittedBotTranscript({ scope: inputScope, playerActorId, playerInstanceId, commit }) {
    const scope = requireEventScope(inputScope);
    const transcript = committedTranscript(commit);
    if (!transcript) return this.#record({ status: 'text-only', reason: 'not-committed-transcript' });
    if (transcript.actualAuthorActorId === playerActorId) return this.#record({ status: 'text-only', reason: 'player-transcript' });
    const key = String(transcript.transcriptEntryId || commit.event?.id || '').trim();
    if (!key) return this.#record({ status: 'text-only', reason: 'missing-transcript-id' });
    if (this.#processed.has(key)) return this.#record({ status: 'duplicate', reason: 'already-presented', transcriptEntryId: key });
    this.#processed.add(key);

    const settings = await this.#settings.get({ scope, playerInstanceId });
    if (!settings.voiceCallsEnabled || !settings.botCallsWithVoice) return this.#record({ status: 'text-only', reason: 'voice-disabled', transcriptEntryId: key });
    const profile = await this.#profiles.resolve({ scope, actorId: transcript.actualAuthorActorId, instanceId: transcript.actualAuthorInstanceId });
    if (!profileIsPuzzle(profile)) return this.#record({ status: 'text-only', reason: 'puzzle-profile-required', transcriptEntryId: key });
    const language = resolveLanguage(profile, settings);
    if (!language) return this.#record({ status: 'text-only', reason: 'language-unresolved', transcriptEntryId: key });

    this.cancelCall(transcript.callSessionId, 'replaced');
    const controller = new AbortController();
    this.#activeByCall.set(transcript.callSessionId, controller);
    const request = normalizeVoiceRenderRequest({
      actorId: transcript.actualAuthorActorId,
      instanceId: transcript.actualAuthorInstanceId,
      callSessionId: transcript.callSessionId,
      canonicalText: transcript.text,
      language,
      resolvedProfile: profile,
      delivery: { preset: profile.defaultDelivery || 'natural' },
    });

    let renderResult = null;
    try {
      renderResult = await this.#adapter.render(request, { signal: controller.signal });
      if (controller.signal.aborted || renderResult?.status === VOICE_RENDER_STATUS.CANCELLED) return this.#record({ status: 'text-only', reason: 'voice-cancelled', transcriptEntryId: key, language });
      if (renderResult?.status !== VOICE_RENDER_STATUS.READY || !renderResult.audioArtifactRef) return this.#record({ status: 'text-only', reason: renderResult?.errorCode || renderResult?.status || 'voice-render-failed', transcriptEntryId: key, language });
      const playback = await this.#playback.play({ callSessionId: transcript.callSessionId, transcriptEntryId: key, audioArtifactRef: renderResult.audioArtifactRef });
      if (playback.status === 'completed') return this.#record({ status: 'played', reason: 'completed', transcriptEntryId: key, language, durationMs: renderResult.durationMs });
      if (playback.status === 'duplicate') return this.#record({ status: 'duplicate', reason: 'playback-duplicate', transcriptEntryId: key, language });
      return this.#record({ status: 'text-only', reason: `playback-${playback.status}`, transcriptEntryId: key, language });
    } catch (error) {
      return this.#record({ status: 'text-only', reason: controller.signal.aborted ? 'voice-cancelled' : 'voice-presenter-error', transcriptEntryId: key, language, error: String(error?.message || error) });
    } finally {
      if (this.#activeByCall.get(transcript.callSessionId) === controller) this.#activeByCall.delete(transcript.callSessionId);
      if (renderResult?.audioArtifactRef) {
        try { this.#adapter.release?.(renderResult); } catch {}
      }
    }
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
