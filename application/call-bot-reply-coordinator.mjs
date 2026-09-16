import { requireEventScope } from '../domain/events/event-validator.mjs';
import { CALL_EVENT_TYPES } from '../domain/calls/call-event-types.mjs';
import { CALL_STATE } from '../domain/calls/call-state-machine.mjs';
import { VOICE_LANGUAGE } from '../domain/voice/voice-profile.mjs';

const MAX_PROMPT_TRANSCRIPT = 12;
const MAX_PROMPT_CHARACTERS = 6000;

function committedTranscript(commit) {
  if (!commit || commit.event?.eventType !== CALL_EVENT_TYPES.TRANSCRIPT_ADDED) return null;
  return commit.transcript || commit.event?.payload?.transcript || null;
}

function resolveLanguage(profile, settings) {
  if ([VOICE_LANGUAGE.ENGLISH, VOICE_LANGUAGE.JAPANESE].includes(profile?.language)) return profile.language;
  if ([VOICE_LANGUAGE.ENGLISH, VOICE_LANGUAGE.JAPANESE].includes(settings?.voiceLanguagePreference)) return settings.voiceLanguagePreference;
  return null;
}

function languageInstruction(language) {
  if (language === VOICE_LANGUAGE.ENGLISH) return 'Reply in English.';
  if (language === VOICE_LANGUAGE.JAPANESE) return 'Reply in Japanese.';
  return 'Use the language that is natural for this character and the caller. Do not translate merely for Voice.';
}

function promptFor({ transcript, botAccountId, language }) {
  const rows = transcript.slice(-MAX_PROMPT_TRANSCRIPT).map(row => {
    const label = row.speakerAccountId === botAccountId ? 'YOU' : 'CALLER';
    return `${label}: ${String(row.text || '').trim()}`;
  });
  let history = rows.join('\n');
  if (history.length > MAX_PROMPT_CHARACTERS) history = history.slice(-MAX_PROMPT_CHARACTERS);
  return [
    'You are currently speaking inside an active private TMRW phone call.',
    'Return only the character\'s next spoken reply.',
    'Do not add narration, action markers, speaker labels, quotes, metadata, or an explanation.',
    'Treat the transcript below as the authoritative call conversation.',
    languageInstruction(language),
    '',
    'CANONICAL CALL TRANSCRIPT:',
    history,
    '',
    'NEXT SPOKEN REPLY:',
  ].join('\n');
}

function normalizeGeneratedText(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text.length <= 8000 ? text : text.slice(0, 8000).trim();
}

export class CallBotReplyCoordinator {
  #calls;
  #voiceProfiles;
  #settings;
  #bindingResolver;
  #getContext;
  #inflight = new Map();
  #completed = new Map();

  constructor({ callService, voiceProfileService, settingsService, bindingResolver, getContext }) {
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
  }

  async replyToCommittedUserTranscript({ scope: inputScope, playerInstanceId, commit }) {
    const scope = requireEventScope(inputScope);
    const userTranscript = committedTranscript(commit);
    if (!userTranscript) return Object.freeze({ status: 'skipped', reason: 'not-committed-transcript' });
    const key = String(userTranscript.transcriptEntryId || commit.event?.id || '').trim();
    if (!key) return Object.freeze({ status: 'skipped', reason: 'missing-transcript-id' });
    if (this.#completed.has(key)) return this.#completed.get(key);
    if (this.#inflight.has(key)) return this.#inflight.get(key);
    const promise = this.#reply({ scope, playerInstanceId, commit, userTranscript }).then(result => {
      this.#completed.set(key, result);
      while (this.#completed.size > 256) this.#completed.delete(this.#completed.keys().next().value);
      return result;
    }).finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, promise);
    return promise;
  }

  async #reply({ scope, playerInstanceId, commit, userTranscript }) {
    const session = await this.#calls.getSession({ scope, callSessionId: userTranscript.callSessionId });
    if (!session || session.state !== CALL_STATE.ACTIVE) return Object.freeze({ status: 'skipped', reason: 'call-not-active' });
    if (!session.participantAccountIds.includes(userTranscript.speakerAccountId)) return Object.freeze({ status: 'skipped', reason: 'speaker-not-participant' });

    const context = this.#getContext();
    if (!context || typeof context !== 'object') return Object.freeze({ status: 'skipped', reason: 'sillytavern-context-unavailable' });
    if (context.groupId) return Object.freeze({ status: 'skipped', reason: 'v1-direct-character-only' });
    if (typeof context.generateQuietPrompt !== 'function') return Object.freeze({ status: 'skipped', reason: 'quiet-generation-unavailable' });

    const resolved = await this.#bindingResolver({
      scope,
      role: 'assistant',
      context,
      message: Object.freeze({ is_user: false, name: String(context.name2 || ''), extra: Object.freeze({}) }),
    });
    const bot = resolved?.actorBinding || null;
    if (!bot || !session.participantAccountIds.includes(bot.accountId) || bot.accountId === userTranscript.speakerAccountId) {
      return Object.freeze({ status: 'skipped', reason: 'current-character-not-call-counterpart' });
    }

    const profile = await this.#voiceProfiles.resolve({ scope, actorId: bot.actorId, instanceId: bot.instanceId });
    const settings = await this.#settings.get({ scope, playerInstanceId });
    const language = resolveLanguage(profile, settings);
    const transcript = await this.#calls.listTranscript({ scope, viewerAccountId: userTranscript.speakerAccountId, callSessionId: session.callSessionId, limit: MAX_PROMPT_TRANSCRIPT });
    const prompt = promptFor({ transcript, botAccountId: bot.accountId, language });
    const forceChId = Number.isInteger(context.characterId) ? context.characterId : null;
    const generated = await context.generateQuietPrompt({
      quietPrompt: prompt,
      quietToLoud: false,
      skipWIAN: false,
      quietName: 'TMRW Call',
      responseLength: 220,
      forceChId,
      removeReasoning: true,
      trimToSentence: false,
    });
    const text = normalizeGeneratedText(generated);
    if (!text) return Object.freeze({ status: 'skipped', reason: 'empty-model-response' });

    const current = await this.#calls.getSession({ scope, callSessionId: session.callSessionId });
    if (!current || current.state !== CALL_STATE.ACTIVE) return Object.freeze({ status: 'skipped', reason: 'call-ended-before-bot-commit' });

    const sourceKey = String(commit.event?.id || userTranscript.transcriptEntryId);
    const source = Object.freeze({ authority: 'tmrw-production-call-bot-v1', kind: 'quiet-call-reply', recordId: `${session.callSessionId}:${sourceKey}`, version: '1' });
    const result = await this.#calls.addTranscript({
      scope,
      callSessionId: session.callSessionId,
      speakerAccountId: bot.accountId,
      actualAuthorActorId: bot.actorId,
      actualAuthorInstanceId: bot.instanceId,
      deviceId: bot.deviceId,
      text,
      sourceMode: 'live',
      causeEventIds: [commit.event?.id].filter(Boolean),
      source,
      producer: 'post-release-voice-v1-call-bot',
      idempotencyKey: `voice-v1-bot-reply:${sourceKey}`,
    });
    return Object.freeze({ status: 'committed', committed: true, language, resolvedProfile: profile, botBinding: bot, ...result });
  }
}

export const voiceV1BotReplyPolicy = Object.freeze({ voiceProfileRequiredForText: false, voiceProfileName: 'Puzzle', directCharacterOnly: true, maxTranscriptEntries: MAX_PROMPT_TRANSCRIPT });
