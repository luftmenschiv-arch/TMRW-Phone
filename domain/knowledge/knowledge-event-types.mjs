import { V3KnowledgeError } from '../../storage/errors.mjs';
import { defineEventType } from '../events/event-types.mjs';
import { createPhase4EventTypeRegistry } from '../time/time-event-types.mjs';
import { normalizeAudiencePolicy, audiencePermitsActor } from './audience-policy.mjs';
import { normalizeKnowledgeClaim } from './claim.mjs';
import { normalizeDisclosureObservation } from './disclosure-observation.mjs';
import { normalizeEvidenceFragment } from './evidence-fragment.mjs';

export const KNOWLEDGE_EVENT_TYPES = Object.freeze({
  DISCLOSURE: 'knowledge.disclosure.v1',
  BRANCH_FORK: 'knowledge.branch-fork.v1',
});

export function normalizeDisclosureBundle(input) {
  const claim = normalizeKnowledgeClaim(input?.claim);
  const audience = normalizeAudiencePolicy(input?.audience);
  const fragments = Object.freeze((input?.fragments || []).map(normalizeEvidenceFragment));
  if (fragments.length === 0) throw new V3KnowledgeError('A disclosure requires at least one exact Evidence Fragment');
  const fragmentIds = new Set();
  for (const fragment of fragments) {
    if (fragment.claimId !== claim.claimId) throw new V3KnowledgeError('Evidence Fragment claim identity does not match its disclosure Claim');
    if (fragmentIds.has(fragment.fragmentId)) throw new V3KnowledgeError(`Duplicate Evidence Fragment: ${fragment.fragmentId}`);
    fragmentIds.add(fragment.fragmentId);
  }
  const observations = Object.freeze((input?.observations || []).map(normalizeDisclosureObservation));
  const observationIds = new Set();
  for (const observation of observations) {
    if (observationIds.has(observation.observationId)) throw new V3KnowledgeError(`Duplicate observation: ${observation.observationId}`);
    observationIds.add(observation.observationId);
    if (observation.fragmentIds.some(id => !fragmentIds.has(id))) throw new V3KnowledgeError('Observation references a Fragment outside its disclosure');
    if (!audiencePermitsActor(audience, { actorId: observation.targetActorId, instanceId: observation.targetInstanceId })) {
      throw new V3KnowledgeError('Observation target is outside the canonical Audience policy');
    }
  }
  return Object.freeze({ claim, audience, fragments, observations });
}

export function normalizeKnowledgeDisclosurePayload(input) {
  if (input?.playerAccessOverride === true) throw new V3KnowledgeError('Player-only access cannot create canonical Knowledge');
  const disclosures = Object.freeze((input?.disclosures || []).map(normalizeDisclosureBundle));
  if (disclosures.length === 0) throw new V3KnowledgeError('Knowledge Event requires at least one disclosure');
  return Object.freeze({
    disclosures,
    inheritedFrom: input?.inheritedFrom == null ? null : structuredClone(input.inheritedFrom),
  });
}

// A domain Event may carry prepared, participant-scoped disclosures without
// becoming a second canonical Knowledge Event. The owning domain remains the
// canonical Event; this normalizer is only the shared projection contract.
export function disclosuresForKnowledgeProjection(event) {
  if (isKnowledgeEventType(event?.eventType)) return normalizeKnowledgeDisclosurePayload(event.payload);
  if (event?.payload?.knowledgeDisclosures) return normalizeKnowledgeDisclosurePayload({ disclosures: event.payload.knowledgeDisclosures });
  return null;
}

const definitions = Object.freeze([
  defineEventType({ id: KNOWLEDGE_EVENT_TYPES.DISCLOSURE, description: 'Explicit scoped disclosure/observation evidence; Event existence alone creates no grant.', validatePayload: payload => Boolean(normalizeKnowledgeDisclosurePayload(payload)) }),
  defineEventType({ id: KNOWLEDGE_EVENT_TYPES.BRANCH_FORK, description: 'One-time child-Branch snapshot of effective parent Knowledge Grants.', validatePayload: payload => Boolean(normalizeKnowledgeDisclosurePayload(payload)?.inheritedFrom) }),
]);

export function createPhase5EventTypeRegistry(additional = []) {
  return createPhase4EventTypeRegistry([...definitions, ...additional]);
}

export function isKnowledgeEventType(eventType) {
  return Object.values(KNOWLEDGE_EVENT_TYPES).includes(eventType);
}
