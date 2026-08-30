import { scopedKnowledgeHeadId } from './knowledge-id.mjs';

export const MAX_KNOWLEDGE_ORDINAL = Number.MAX_SAFE_INTEGER;

export function knowledgeGrantId(sourceEventId, observationId, fragmentId) {
  return `grant:${sourceEventId}:${observationId}:${fragmentId}`;
}

export function createKnowledgeGrant({ scope, event, claim, audience, fragment, observation }) {
  const grantId = knowledgeGrantId(event.id, observation.observationId, fragment.fragmentId);
  return Object.freeze({
    id: scopedKnowledgeHeadId('knowledge-grant', scope, grantId),
    storyId: scope.storyId,
    branchId: scope.branchId,
    grantId,
    targetActorId: observation.targetActorId,
    targetInstanceId: observation.targetInstanceId,
    claimId: claim.claimId,
    policyId: audience.policyId,
    fragmentId: fragment.fragmentId,
    confidence: observation.confidence,
    evidence: structuredClone(observation.evidence),
    observationId: observation.observationId,
    acquisitionOrdinal: event.sequence,
    reverseOrdinal: MAX_KNOWLEDGE_ORDINAL - event.sequence,
    sourceDisclosureEventId: event.id,
    sourceDisclosureRevision: event.revision,
    status: 'active',
    phase: 5,
  });
}
