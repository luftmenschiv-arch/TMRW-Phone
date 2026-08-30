import { defineEventType } from '../domain/events/event-types.mjs';
import { createPhase9EventTypeRegistry } from '../domain/calls/call-event-types.mjs';
import { normalizeKnowledgeDisclosurePayload } from '../domain/knowledge/knowledge-event-types.mjs';

export const DIRECTOR_EVENT_TYPES = Object.freeze({
  CORRECTION: 'director.correction.v1',
  KNOWLEDGE_CORRECTION: 'director.knowledge-correction.v1',
  VALUE_LOCK: 'director.value-lock.v1',
  MAPPING_CORRECTION: 'director.mapping-correction.v1',
  PROMOTE_TO_CANON: 'director.promote-to-canon.v1',
  SCOPE_MOVE: 'director.scope-move.v1',
});

const text = value => typeof value === 'string' && value.trim().length > 0;
const arrayOfText = value => Array.isArray(value) && value.every(text);

export function normalizeDirectorCorrection(input) {
  if (!text(input?.action) || !text(input?.targetEventId) || !text(input?.reason)) throw new TypeError('Director correction requires action, target Event, and reason');
  if (!Number.isInteger(input.targetRevisionBefore) || input.targetRevisionBefore < 1) throw new TypeError('Director correction requires targetRevisionBefore');
  if (!Number.isInteger(input.targetRevisionAfter) || input.targetRevisionAfter <= input.targetRevisionBefore) throw new TypeError('Director correction requires a later targetRevisionAfter');
  if (!arrayOfText(input.affectedEventIds) || !input.affectedEventIds.includes(input.targetEventId)) throw new TypeError('Director correction affected Events must include its target');
  return Object.freeze({
    action: input.action.trim(),
    targetEventId: input.targetEventId.trim(),
    targetRevisionBefore: input.targetRevisionBefore,
    targetRevisionAfter: input.targetRevisionAfter,
    reason: input.reason.trim(),
    directorActorId: text(input.directorActorId) ? input.directorActorId.trim() : null,
    affectedEventIds: Object.freeze([...new Set(input.affectedEventIds)].sort()),
    previewId: text(input.previewId) ? input.previewId.trim() : null,
    changedFields: Object.freeze([...(input.changedFields || [])].map(String).sort()),
    supersedesCorrectionEventId: text(input.supersedesCorrectionEventId) ? input.supersedesCorrectionEventId.trim() : null,
  });
}

export function normalizeDirectorValueLock(input) {
  if (!text(input?.lockId) || !text(input?.targetKind) || !text(input?.targetId) || !text(input?.field) || !text(input?.reason)) throw new TypeError('Director value lock is incomplete');
  return Object.freeze({ lockId: input.lockId.trim(), targetKind: input.targetKind.trim(), targetId: input.targetId.trim(), field: input.field.trim(), value: structuredClone(input.value ?? null), locked: input.locked !== false, reason: input.reason.trim(), lockedByActorId: text(input.lockedByActorId) ? input.lockedByActorId.trim() : null });
}

export function normalizeDirectorMappingCorrection(input) {
  const mapping = input?.mapping;
  if (!text(mapping?.id) || !text(mapping?.sourceAuthority) || !text(mapping?.sourceType) || !text(mapping?.sourceId) || !text(mapping?.canonicalType) || !text(mapping?.canonicalId) || !text(input?.reason)) throw new TypeError('Director mapping correction is incomplete');
  return Object.freeze({ mapping: structuredClone(mapping), reason: input.reason.trim(), priorMappingId: text(input.priorMappingId) ? input.priorMappingId.trim() : null });
}

export function normalizePromotion(input) {
  if (!text(input?.proposalId) || !text(input?.overrideId) || !text(input?.reason) || !Array.isArray(input?.facts) || input.facts.length === 0) throw new TypeError('Promote to Canon requires a proposal, override, facts, and reason');
  if (input.ownerAwareness === true && !input.ownerAwarenessEvidence) throw new TypeError('Owner awareness requires explicit evidence');
  const knowledgeDisclosures = input.knowledgeDisclosures?.length ? normalizeKnowledgeDisclosurePayload({ disclosures: input.knowledgeDisclosures }).disclosures : Object.freeze([]);
  return Object.freeze({ proposalId: input.proposalId.trim(), overrideId: input.overrideId.trim(), reason: input.reason.trim(), facts: structuredClone(input.facts), ownerAwareness: Boolean(input.ownerAwareness), ownerAwarenessEvidence: input.ownerAwarenessEvidence ? structuredClone(input.ownerAwarenessEvidence) : null, knowledgeDisclosures });
}

export function normalizeKnowledgeCorrection(input) {
  if (!text(input?.reason)) throw new TypeError('Knowledge correction requires a reason');
  const knowledgeDisclosures = normalizeKnowledgeDisclosurePayload({ disclosures: input?.knowledgeDisclosures }).disclosures;
  return Object.freeze({ reason: input.reason.trim(), knowledgeDisclosures });
}

export function normalizeScopeMove(input) {
  for (const field of ['moveId', 'sourceStoryId', 'sourceBranchId', 'sourceEventId', 'destinationStoryId', 'destinationBranchId', 'destinationEventId', 'reason']) if (!text(input?.[field])) throw new TypeError(`Director scope move requires ${field}`);
  return Object.freeze({ moveId: input.moveId.trim(), sourceStoryId: input.sourceStoryId.trim(), sourceBranchId: input.sourceBranchId.trim(), sourceEventId: input.sourceEventId.trim(), destinationStoryId: input.destinationStoryId.trim(), destinationBranchId: input.destinationBranchId.trim(), destinationEventId: input.destinationEventId.trim(), reason: input.reason.trim(), status: 'completed' });
}

const definitions = Object.freeze([
  defineEventType({ id: DIRECTOR_EVENT_TYPES.CORRECTION, validatePayload: payload => Boolean(normalizeDirectorCorrection(payload)) }),
  defineEventType({ id: DIRECTOR_EVENT_TYPES.KNOWLEDGE_CORRECTION, validatePayload: payload => Boolean(normalizeKnowledgeCorrection(payload)) }),
  defineEventType({ id: DIRECTOR_EVENT_TYPES.VALUE_LOCK, validatePayload: payload => Boolean(normalizeDirectorValueLock(payload)) }),
  defineEventType({ id: DIRECTOR_EVENT_TYPES.MAPPING_CORRECTION, validatePayload: payload => Boolean(normalizeDirectorMappingCorrection(payload)) }),
  defineEventType({ id: DIRECTOR_EVENT_TYPES.PROMOTE_TO_CANON, validatePayload: payload => Boolean(normalizePromotion(payload)) }),
  defineEventType({ id: DIRECTOR_EVENT_TYPES.SCOPE_MOVE, validatePayload: payload => Boolean(normalizeScopeMove(payload)) }),
]);

export function createPhase14EventTypeRegistry(additional = []) {
  return createPhase9EventTypeRegistry([...definitions, ...additional]);
}
