import { defineEventType } from '../events/event-types.mjs';
import { normalizeKnowledgeDisclosurePayload } from '../knowledge/knowledge-event-types.mjs';
import { createPhase14EventTypeRegistry } from '../../director/event-types.mjs';
import { normalizeSocialPersona } from './social-persona.mjs';
import { normalizeSocialGraphEdge } from './social-graph.mjs';
import { normalizeSocialPost } from './post.mjs';
import { normalizeSocialComment } from './comment.mjs';
import { normalizeSocialEngagement } from './engagement.mjs';

export const SOCIAL_EVENT_TYPES = Object.freeze({ PERSONA_STATE: 'social.persona-state.v1', GRAPH_STATE: 'social.graph-state.v1', POST_CREATED: 'social.post-created.v1', COMMENT_CREATED: 'social.comment-created.v1', ENGAGEMENT_STATE: 'social.engagement-state.v1', DECISION_RECORDED: 'social.decision-recorded.v1' });
const disclosures = input => input?.knowledgeDisclosures?.length ? normalizeKnowledgeDisclosurePayload({ disclosures: input.knowledgeDisclosures }).disclosures : Object.freeze([]);
export const normalizePersonaPayload = input => Object.freeze({ persona: normalizeSocialPersona(input?.persona) });
export const normalizeGraphPayload = input => Object.freeze({ edge: normalizeSocialGraphEdge(input?.edge) });
export const normalizePostPayload = input => Object.freeze({ post: normalizeSocialPost(input?.post), knowledgeDisclosures: disclosures(input) });
export const normalizeCommentPayload = input => Object.freeze({ comment: normalizeSocialComment(input?.comment), recipientAccountIds: Object.freeze([...(input?.recipientAccountIds || [])].map(String).sort()), knowledgeDisclosures: disclosures(input) });
export const normalizeEngagementPayload = input => Object.freeze({ engagement: normalizeSocialEngagement(input?.engagement) });
export const normalizeDecisionPayload = input => { if (!input?.decision?.triggerEventId || !input?.decision?.actorInstanceId || !['no-post', 'candidate'].includes(input.decision.outcome)) throw new TypeError('Social decision is invalid'); return Object.freeze({ decision: structuredClone(input.decision) }); };

const definitions = Object.freeze([
  defineEventType({ id: SOCIAL_EVENT_TYPES.PERSONA_STATE, validatePayload: payload => Boolean(normalizePersonaPayload(payload)) }),
  defineEventType({ id: SOCIAL_EVENT_TYPES.GRAPH_STATE, validatePayload: payload => Boolean(normalizeGraphPayload(payload)) }),
  defineEventType({ id: SOCIAL_EVENT_TYPES.POST_CREATED, validatePayload: payload => Boolean(normalizePostPayload(payload)) }),
  defineEventType({ id: SOCIAL_EVENT_TYPES.COMMENT_CREATED, validatePayload: payload => Boolean(normalizeCommentPayload(payload)) }),
  defineEventType({ id: SOCIAL_EVENT_TYPES.ENGAGEMENT_STATE, validatePayload: payload => Boolean(normalizeEngagementPayload(payload)) }),
  defineEventType({ id: SOCIAL_EVENT_TYPES.DECISION_RECORDED, validatePayload: payload => Boolean(normalizeDecisionPayload(payload)) }),
]);
export function createPhase15EventTypeRegistry(additional = []) { return createPhase14EventTypeRegistry([...definitions, ...additional]); }
