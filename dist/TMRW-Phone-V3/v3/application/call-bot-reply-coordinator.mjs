import { requireEventScope } from '../domain/events/event-validator.mjs';
import { CALL_EVENT_TYPES } from '../domain/calls/call-event-types.mjs';
import { CALL_STATE } from '../domain/calls/call-state-machine.mjs';
import { VOICE_LANGUAGE } from '../domain/voice/voice-profile.mjs';

const MAX_PROMPT_TRANSCRIPT = 12;
const MAX_PROMPT_CHARACTERS = 6000;
const MAX_REPLY_SEGMENTS = 3;
export const CALL_LLM_DEADLINE_MS = 30000;
export const CALL_LLM_DELIVERY_MODE = Object.freeze({
  COMPLETE_RESPONSE: 'complete-response',
});
export const CALL_LLM_INCREMENTAL_REASON = 'sillytavern-generation-api-has-no-safe-stream';

export function resolveCallLlmDeliveryCapability(context) {
  return Object.freeze({
    mode: CALL_LLM_DELIVERY_MODE.COMPLETE_RESPONSE,
    incremental: false,
    reason: typeof context?.generateQuietPrompt === 'function'
      ? CALL_LLM_INCREMENTAL_REASON
      : 'quiet-generation-unavailable',
  });
}

function committedTranscript(commit) {
  if (!commit || commit.event?.eventType !== CALL_EVENT_TYPES.TRANSCRIPT_ADDED) return null;
  return commit.transcript || commit.event?.payload?.transcript || null;
}
function resolveLanguage(profile, settings) {
  if ([VOICE_LANGUAGE.ENGLISH, VOICE_LANGUAGE.JAPANESE].includes(settings?.voiceLanguagePreference)) return settings.voiceLanguagePreference;
  return VOICE_LANGUAGE.ENGLISH;
}

function spokenLanguageName(language) {
  return language === VOICE_LANGUAGE.JAPANESE ? 'Japanese' : 'English';
}

function promptFor({ transcript, botAccountId, language, targetName, savedName }) {
  const safeSavedName = String(savedName || '').replace(/[\r\n\t]+/gu, ' ').trim().slice(0, 60);
  const rows = transcript.slice(-MAX_PROMPT_TRANSCRIPT).map(row => {
    const label = row.speakerAccountId === botAccountId ? 'YOU' : 'CALLER';
    return `${label}: ${String(row.text || '').trim()}`;
  });
  let history = rows.join('\n');
  if (history.length > MAX_PROMPT_CHARACTERS) history = history.slice(-MAX_PROMPT_CHARACTERS);
  const spokenLanguage = spokenLanguageName(language);
  return [
    `You are ${targetName || 'the selected character'} speaking inside an active private TMRW phone call.`,
    'The caller deliberately selected you. Never answer as a different character.',
    safeSavedName ? `In your own phone you saved the caller as ${safeSavedName}. You chose this contact name based on your relationship. Keep it consistent when you use a name for them.` : 'You have not chosen a saved contact name for the caller. Use a natural form of address if needed.',
    'Return only strict JSON. Do not use markdown or code fences.',
    '{"segments":[{"subtitle_th":"คำบรรยายภาษาไทย","spoken_text":"spoken voice text"}]}',
    `subtitle_th must be natural Thai. spoken_text must be natural ${spokenLanguage}.`,
    'Each pair must carry exactly the same meaning, names, terms of address, and emotion.',
    `Use one to ${MAX_REPLY_SEGMENTS} short, naturally speakable segments. Split only at semantic sentence boundaries.`,
    'Dialogue only. Do not add narration, action markers, speaker labels, quotation marks, metadata, or explanations.',
    'Natural written laughter that the voice can speak is allowed inside spoken dialogue.',
    'Treat the transcript below as the authoritative call conversation and answer its final CALLER turn.',
    '',
    'CANONICAL CALL TRANSCRIPT:',
    history,
    '',
    'STRICT JSON REPLY:',
  ].join('\n');
}

function jsonCandidate(value) {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  return first >= 0 && last > first ? text.slice(first, last + 1) : null;
}

function parseGeneratedReply(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(jsonCandidate(raw));
    const source = Array.isArray(parsed?.segments) ? parsed.segments : [];
    const segments = source.slice(0, MAX_REPLY_SEGMENTS).map((segment, index) => Object.freeze({
      index,
      subtitleThai: String(segment?.subtitle_th || '').trim(),
      spokenText: String(segment?.spoken_text || '').trim(),
    })).filter(segment => segment.subtitleThai && segment.spokenText);
    if (!segments.length || segments.length !== Math.min(source.length, MAX_REPLY_SEGMENTS)) return null;
    return Object.freeze({
      subtitleText: segments.map(segment => segment.subtitleThai).join(' ').trim(),
      segments: Object.freeze(segments),
      structured: true,
    });
  } catch { return null; }
}

function generationFailure(reason, error = null, modelAttempted = false) {
  return Object.freeze({ status: reason === 'generation-cancelled' ? 'cancelled' : 'failed', reason, retryable: reason !== 'generation-cancelled', error: error ? String(error?.message || error) : null, modelAttempted });
}

async function withDeadline(task, { signal = null, timeoutMs = CALL_LLM_DEADLINE_MS, onExpire = null } = {}) {
  if (signal?.aborted) throw Object.assign(new Error('generation-cancelled'), { code: 'generation-cancelled' });
  let timer = null;
  let abortListener = null;
  const expire = code => {
    try { onExpire?.(code); } catch {}
    return Object.assign(new Error(code), { code });
  };
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(expire('generation-timeout')), Math.max(100, Number(timeoutMs) || CALL_LLM_DEADLINE_MS));
    if (signal) {
      abortListener = () => reject(expire('generation-cancelled'));
      signal.addEventListener('abort', abortListener, { once: true });
    }
  });
  const work = Promise.resolve().then(() => typeof task === 'function' ? task() : task);
  try { return await Promise.race([work, deadline]); }
  finally {
    clearTimeout(timer);
    if (signal && abortListener) signal.removeEventListener('abort', abortListener);
  }
}

export class CallBotReplyCoordinator {
  #calls;
  #voiceProfiles;
  #settings;
  #bindingResolver;
  #getContext;
  #timing;
  #inflight = new Map();
  #prepared = new Map();
  #committed = new Map();

  constructor({ callService, voiceProfileService, settingsService, bindingResolver, getContext, timingDiagnostics = null }) {
    if (!callService?.getSession || !callService?.listTranscript || !callService?.addTranscript) throw new TypeError('CallBotReplyCoordinator requires canonical CallService');
    if (!voiceProfileService?.resolve) throw new TypeError('CallBotReplyCoordinator requires VoiceProfileService');
    if (!settingsService?.get) throw new TypeError('CallBotReplyCoordinator requires settings');
    if (typeof bindingResolver !== 'function') throw new TypeError('CallBotReplyCoordinator requires production identity binding resolver');
    if (typeof getContext !== 'function') throw new TypeError('CallBotReplyCoordinator requires SillyTavern getContext');
    this.#calls = callService;
    this.#voiceProfiles = voiceProfileService;
    this.#settings = settingsService;
    this.#bindingResolver = bindingResolver;
    this.#getContext = getContext;
    this.#timing = timingDiagnostics;
  }

  cancelCall(callSessionId) {
    const id = String(callSessionId || '').trim();
    if (!id) return false;
    let removed = false;
    for (const [key, row] of this.#prepared) if (row.callSessionId === id) { this.#prepared.delete(key); removed = true; }
    return removed;
  }

  #stopGeneration(reason) {
    try { this.#getContext()?.stopGeneration?.(reason); } catch {}
  }

  async prepareReplyToCommittedUserTranscript({ scope: inputScope, playerInstanceId, commit, signal = null, timeoutMs = CALL_LLM_DEADLINE_MS }) {
    const scope = requireEventScope(inputScope);
    const userTranscript = committedTranscript(commit);
    if (!userTranscript) return generationFailure('not-committed-transcript');
    const key = String(userTranscript.transcriptEntryId || commit.event?.id || '').trim();
    if (!key) return generationFailure('missing-transcript-id');
    const timingId = String(commit.event?.id || userTranscript.transcriptEntryId).trim();
    this.#timing?.begin?.(timingId, { callSessionId: userTranscript.callSessionId });
    if (this.#prepared.has(key)) return this.#prepared.get(key);
    if (this.#inflight.has(key)) return this.#inflight.get(key);
    const attempt = { modelAttempted: false };
    const promise = withDeadline(
      () => this.#prepare({ scope, playerInstanceId, commit, userTranscript, signal, attempt }),
      // A replaced/hung-up UI turn only owns this coordinator promise. Calling
      // SillyTavern's global stopGeneration for that abort can race with and
      // instantly kill the replacement request. Only a real deadline is
      // allowed to stop the host generator globally.
      { signal, timeoutMs, onExpire: reason => { if (reason === 'generation-timeout') this.#stopGeneration(reason); } },
    ).catch(error => {
      if (error?.code === 'generation-cancelled' || signal?.aborted) return generationFailure('generation-cancelled', error, attempt.modelAttempted);
      if (error?.code === 'generation-timeout') return generationFailure('generation-timeout', error, attempt.modelAttempted);
      return generationFailure('generation-failed', error, attempt.modelAttempted);
    }).then(result => {
      if (result?.status === 'prepared') {
        this.#prepared.set(key, result);
        while (this.#prepared.size > 256) this.#prepared.delete(this.#prepared.keys().next().value);
      } else {
        this.#timing?.finish?.(timingId, result?.reason || result?.status || 'generation-failed');
      }
      return result;
    }).finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, promise);
    return promise;
  }

  async commitPreparedReply({ scope: inputScope, prepared }) {
    const scope = requireEventScope(inputScope);
    if (prepared?.status !== 'prepared' || !prepared.preparedId) return generationFailure('invalid-prepared-reply');
    if (this.#committed.has(prepared.preparedId)) return this.#committed.get(prepared.preparedId);
    const current = await this.#calls.getSession({ scope, callSessionId: prepared.callSessionId });
    if (!current || current.state !== CALL_STATE.ACTIVE) return generationFailure('call-ended-before-bot-commit');
    const source = Object.freeze({ authority: 'tmrw-production-call-bot-v2', kind: 'bilingual-call-reply', recordId: `${prepared.callSessionId}:${prepared.preparedId}`, version: '2' });
    const result = await this.#calls.addTranscript({
      scope,
      callSessionId: prepared.callSessionId,
      speakerAccountId: prepared.botBinding.accountId,
      actualAuthorActorId: prepared.botBinding.actorId,
      actualAuthorInstanceId: prepared.botBinding.instanceId,
      deviceId: prepared.botBinding.deviceId,
      text: prepared.subtitleText,
      sourceMode: 'live',
      causeEventIds: [prepared.causeEventId].filter(Boolean),
      source,
      producer: 'outbound-call-bilingual-v2',
      idempotencyKey: `bilingual-call-reply:${prepared.preparedId}`,
    });
    const committed = Object.freeze({ status: 'committed', committed: true, language: prepared.language, resolvedProfile: prepared.resolvedProfile, botBinding: prepared.botBinding, voiceSegments: prepared.segments, prepared, ...result });
    this.#committed.set(prepared.preparedId, committed);
    while (this.#committed.size > 256) this.#committed.delete(this.#committed.keys().next().value);
    return committed;
  }

  async replyToCommittedUserTranscript(input) {
    const prepared = await this.prepareReplyToCommittedUserTranscript(input);
    if (prepared?.status !== 'prepared') return prepared;
    return this.commitPreparedReply({ scope: input.scope, prepared });
  }

  async #prepare({ scope, playerInstanceId, commit, userTranscript, signal, attempt }) {
    const session = await this.#calls.getSession({ scope, callSessionId: userTranscript.callSessionId });
    if (!session || session.state !== CALL_STATE.ACTIVE) return generationFailure('call-not-active');
    if (!session.participantAccountIds.includes(userTranscript.speakerAccountId)) return generationFailure('speaker-not-participant');

    const context = this.#getContext();
    if (!context || typeof context !== 'object') return generationFailure('sillytavern-context-unavailable');
    if (context.groupId) return generationFailure('v1-direct-character-only');
    if (typeof context.generateQuietPrompt !== 'function') return generationFailure('quiet-generation-unavailable');
    const deliveryCapability = resolveCallLlmDeliveryCapability(context);

    const counterpartAccountIds = session.participantAccountIds.filter(accountId => accountId !== userTranscript.speakerAccountId);
    if (counterpartAccountIds.length !== 1) return generationFailure('call-counterpart-not-exact');
    const counterpartAccountId = counterpartAccountIds[0];
    const resolved = await this.#bindingResolver({ scope, role: 'assistant', context, canonicalAccountId: counterpartAccountId, requireActiveCallCounterpart: true, message: Object.freeze({ is_user: false, name: String(context.name2 || ''), extra: Object.freeze({}) }) });
    const bot = resolved?.actorBinding || null;
    if (!bot || bot.accountId !== counterpartAccountId) return generationFailure('current-character-not-call-counterpart');

    const profile = await this.#voiceProfiles.resolve({ scope, actorId: bot.actorId, instanceId: bot.instanceId });
    const settings = await this.#settings.get({ scope, playerInstanceId });
    const language = resolveLanguage(profile, settings);
    const transcript = await this.#calls.listTranscript({ scope, viewerAccountId: userTranscript.speakerAccountId, callSessionId: session.callSessionId, limit: MAX_PROMPT_TRANSCRIPT });
    const prompt = promptFor({ transcript, botAccountId: bot.accountId, language, targetName: String(context.name2 || '').trim(), savedName: settings.botSavedNames?.[bot.instanceId] });
    const forceChId = Number.isInteger(context.characterId) ? context.characterId : null;
    try {
      this.#timing?.mark?.(String(commit.event?.id || userTranscript.transcriptEntryId), 'llm-start', {
        deliveryMode: deliveryCapability.mode,
        incremental: deliveryCapability.incremental,
        incrementalReason: deliveryCapability.reason,
      });
      attempt.modelAttempted = true;
      const generated = await context.generateQuietPrompt({
        quietPrompt: prompt,
        quietToLoud: false,
        skipWIAN: false,
        quietName: 'TMRW Call',
        responseLength: 4096,
        forceChId,
        removeReasoning: true,
        trimToSentence: false,
        jsonSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['segments'],
          properties: {
            segments: {
              type: 'array', minItems: 1, maxItems: MAX_REPLY_SEGMENTS,
              items: { type: 'object', additionalProperties: false, required: ['subtitle_th', 'spoken_text'], properties: { subtitle_th: { type: 'string' }, spoken_text: { type: 'string' } } },
            },
          },
        },
      });
      this.#timing?.mark?.(String(commit.event?.id || userTranscript.transcriptEntryId), 'llm-complete', { observable: false });
      if (signal?.aborted) return generationFailure('generation-cancelled');
      const reply = parseGeneratedReply(generated);
      this.#timing?.mark?.(String(commit.event?.id || userTranscript.transcriptEntryId), 'structured-validation', { outcome: reply ? 'valid' : 'invalid' });
      if (!reply) return generationFailure('invalid-structured-model-response', null, true);
      return Object.freeze({
        status: 'prepared',
        preparedId: String(commit.event?.id || userTranscript.transcriptEntryId),
        callSessionId: session.callSessionId,
        causeEventId: commit.event?.id || null,
        language,
        resolvedProfile: profile,
        botBinding: Object.freeze({ ...bot }),
        subtitleText: reply.subtitleText,
        segments: reply.segments,
        structured: reply.structured,
        deliveryMode: deliveryCapability.mode,
        modelAttempted: true,
        incremental: deliveryCapability.incremental,
        incrementalReason: deliveryCapability.reason,
      });
    } catch (error) {
      if (error?.code === 'generation-cancelled' || signal?.aborted) return generationFailure('generation-cancelled', error, attempt.modelAttempted);
      if (error?.code === 'generation-timeout') return generationFailure('generation-timeout', error, attempt.modelAttempted);
      return generationFailure('generation-failed', error, attempt.modelAttempted);
    }
  }
}

export const voiceV1BotReplyPolicy = Object.freeze({ voiceProfileRequiredForText: false, voiceProfileName: 'male-polite-dangerous', directCharacterOnly: true, maxTranscriptEntries: MAX_PROMPT_TRANSCRIPT, maxReplySegments: MAX_REPLY_SEGMENTS, llmDeadlineMs: CALL_LLM_DEADLINE_MS, deliveryMode: CALL_LLM_DELIVERY_MODE.COMPLETE_RESPONSE, incremental: false, incrementalReason: CALL_LLM_INCREMENTAL_REASON });
