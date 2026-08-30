import { defineEventType } from '../events/event-types.mjs';
import { normalizeKnowledgeDisclosurePayload } from '../knowledge/knowledge-event-types.mjs';
import { createPhase15EventTypeRegistry } from '../social/social-event-types.mjs';
import { normalizeLiveSession } from './live-session.mjs';
import { normalizeViewerState } from './viewer-persona.mjs';
import { normalizeLiveMessage } from './live-message.mjs';
import { normalizeLiveReaction } from './reaction.mjs';

export const LIVE_EVENT_TYPES = Object.freeze({ SESSION_STATE: 'live.session-state.v1', VIEWER_STATE: 'live.viewer-state.v1', MESSAGE_CREATED: 'live.message-created.v1', REACTION_STATE: 'live.reaction-state.v1' });
const disclosures = input => input?.knowledgeDisclosures?.length ? normalizeKnowledgeDisclosurePayload({ disclosures: input.knowledgeDisclosures }).disclosures : Object.freeze([]);
export const normalizeLiveSessionPayload = input => Object.freeze({ session: normalizeLiveSession(input?.session), knowledgeDisclosures: disclosures(input) });
export const normalizeLiveViewerPayload = input => Object.freeze({ viewer: normalizeViewerState(input?.viewer), knowledgeDisclosures: disclosures(input) });
export const normalizeLiveMessagePayload = input => Object.freeze({ message: normalizeLiveMessage(input?.message), knowledgeDisclosures: disclosures(input) });
export const normalizeLiveReactionPayload = input => Object.freeze({ reaction: normalizeLiveReaction(input?.reaction) });

const definitions = Object.freeze([
  defineEventType({ id: LIVE_EVENT_TYPES.SESSION_STATE, validatePayload: payload => Boolean(normalizeLiveSessionPayload(payload)) }),
  defineEventType({ id: LIVE_EVENT_TYPES.VIEWER_STATE, validatePayload: payload => Boolean(normalizeLiveViewerPayload(payload)) }),
  defineEventType({ id: LIVE_EVENT_TYPES.MESSAGE_CREATED, validatePayload: payload => Boolean(normalizeLiveMessagePayload(payload)) }),
  defineEventType({ id: LIVE_EVENT_TYPES.REACTION_STATE, validatePayload: payload => Boolean(normalizeLiveReactionPayload(payload)) }),
]);
export function createPhase16EventTypeRegistry(additional = []) { return createPhase15EventTypeRegistry([...definitions, ...additional]); }
