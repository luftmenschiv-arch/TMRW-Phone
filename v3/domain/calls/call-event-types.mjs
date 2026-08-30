import { defineEventType } from '../events/event-types.mjs';
import { createPhase8EventTypeRegistry } from '../messaging/messaging-event-types.mjs';
import { normalizeKnowledgeDisclosurePayload } from '../knowledge/knowledge-event-types.mjs';
import { normalizeTimeAdvance } from '../time/time-advance.mjs';
import { CALL_ACTION, CALL_STATE, transitionCallState } from './call-state-machine.mjs';
import { normalizeCallSession } from './call-session.mjs';
import { normalizeCallTranscriptEntry } from './call-transcript.mjs';
import { normalizeVoicemail } from './voicemail.mjs';

export const CALL_EVENT_TYPES = Object.freeze({ SESSION_INITIATED: 'calls.session-initiated.v1', SESSION_TRANSITIONED: 'calls.session-transitioned.v1', TRANSCRIPT_ADDED: 'calls.transcript-added.v1', VOICEMAIL_LEFT: 'calls.voicemail-left.v1' });

export function normalizeCallInitiatedPayload(input) { return Object.freeze({ session: normalizeCallSession(input?.session), knowledgeDisclosures: normalizeKnowledgeDisclosurePayload({ disclosures: input?.knowledgeDisclosures }).disclosures }); }
export function normalizeCallTransitionPayload(input) {
  const callSessionId = String(input?.callSessionId || '').trim(); const action = String(input?.action || '').trim(); const state = String(input?.state || '').trim();
  if (!callSessionId || !Object.values(CALL_ACTION).includes(action) || !Object.values(CALL_STATE).includes(state)) throw new TypeError('Invalid Call transition payload');
  if (input?.storyClockAdvance != null) normalizeTimeAdvance(input.storyClockAdvance);
  if (!Object.hasOwn(input || {}, 'priorChronologyEventId')) throw new TypeError('Call transition must preserve chronology chain input');
  return Object.freeze({ callSessionId, action, state, actualActorId: String(input?.actualActorId || '').trim() || null, actualInstanceId: String(input?.actualInstanceId || '').trim() || null, deviceId: String(input?.deviceId || '').trim() || null, storyClockAdvance: input?.storyClockAdvance ? normalizeTimeAdvance(input.storyClockAdvance) : null, priorChronologyEventId: input.priorChronologyEventId ?? null });
}
export function normalizeCallTranscriptPayload(input) {
  const transcript = normalizeCallTranscriptEntry(input?.transcript); const recipientAccountIds = Object.freeze([...new Set((input?.recipientAccountIds || []).map(value => String(value || '').trim()).filter(Boolean))].sort());
  if (recipientAccountIds.length < 2 || !recipientAccountIds.includes(transcript.speakerAccountId)) throw new TypeError('Call transcript recipients must include participating speaker and listener');
  return Object.freeze({ transcript, recipientAccountIds, knowledgeDisclosures: normalizeKnowledgeDisclosurePayload({ disclosures: input?.knowledgeDisclosures }).disclosures });
}
export function normalizeVoicemailPayload(input) { const voicemail = normalizeVoicemail(input?.voicemail); return Object.freeze({ voicemail, knowledgeDisclosures: normalizeKnowledgeDisclosurePayload({ disclosures: input?.knowledgeDisclosures }).disclosures }); }

const definitions = Object.freeze([
  defineEventType({ id: CALL_EVENT_TYPES.SESSION_INITIATED, description: 'Canonical text Call Session with participant-scoped existence evidence.', validatePayload: payload => Boolean(normalizeCallInitiatedPayload(payload)) }),
  defineEventType({ id: CALL_EVENT_TYPES.SESSION_TRANSITIONED, description: 'Canonical deterministic Call lifecycle transition with optional measured duration evidence.', validatePayload: payload => Boolean(normalizeCallTransitionPayload(payload)) }),
  defineEventType({ id: CALL_EVENT_TYPES.TRANSCRIPT_ADDED, description: 'Canonical participant-scoped text Call transcript entry.', validatePayload: payload => Boolean(normalizeCallTranscriptPayload(payload)) }),
  defineEventType({ id: CALL_EVENT_TYPES.VOICEMAIL_LEFT, description: 'Canonical private text Voicemail related to a Call Session, independent of Voice providers.', validatePayload: payload => Boolean(normalizeVoicemailPayload(payload)) }),
]);

export function createPhase9EventTypeRegistry(additional = []) { return createPhase8EventTypeRegistry([...definitions, ...additional]); }
