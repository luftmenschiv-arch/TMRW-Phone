import { V3KnowledgeError } from '../../storage/errors.mjs';
import { requireText } from '../identity/identity-record.mjs';

export const EVIDENCE_BASIS = Object.freeze({
  DIRECT_PARTICIPANT: 'direct-participant',
  DIRECT_WITNESS: 'direct-witness',
  EXPLICIT_RECIPIENT: 'explicit-recipient',
  GROUP_MEMBER: 'group-member',
  PUBLIC_EXPOSURE: 'public-exposure',
  COMMUNICATED: 'communicated',
  DEVICE_ACCESS: 'device-access',
  MAIN_RP_EXPLICIT: 'main-rp-explicit',
  DIRECTOR_AUTHORIZED: 'director-authorized',
  EXTERNAL_EXPLICIT: 'external-explicit',
});

export const KNOWLEDGE_CONFIDENCE = Object.freeze({
  CONFIRMED: 'confirmed',
  REPORTED: 'reported',
  UNCERTAIN: 'uncertain',
  DISPUTED: 'disputed',
});

const bases = new Set(Object.values(EVIDENCE_BASIS));
const confidenceValues = new Set(Object.values(KNOWLEDGE_CONFIDENCE));

export function normalizeDisclosureObservation(input) {
  const observationId = requireText(input?.observationId, 'observation.observationId');
  const targetActorId = requireText(input?.targetActorId, 'observation.targetActorId');
  const targetInstanceId = requireText(input?.targetInstanceId, 'observation.targetInstanceId');
  const basis = requireText(input?.evidence?.basis, 'observation.evidence.basis');
  if (!bases.has(basis)) throw new V3KnowledgeError(`Unsupported evidence basis: ${basis}`);
  const confidence = requireText(input?.confidence || KNOWLEDGE_CONFIDENCE.CONFIRMED, 'observation.confidence');
  if (!confidenceValues.has(confidence)) throw new V3KnowledgeError(`Unsupported observation confidence: ${confidence}`);
  const fragmentIds = Object.freeze([...new Set((input?.fragmentIds || []).map((id, index) => requireText(id, `observation.fragmentIds[${index}]`)))].sort());
  if (fragmentIds.length === 0) throw new V3KnowledgeError('An observation must reveal at least one exact Evidence Fragment');
  const evidence = Object.freeze({
    basis,
    sourceEventId: input.evidence.sourceEventId == null ? null : requireText(input.evidence.sourceEventId, 'observation.evidence.sourceEventId'),
    sourceActorId: input.evidence.sourceActorId == null ? null : requireText(input.evidence.sourceActorId, 'observation.evidence.sourceActorId'),
    sourceDeviceId: input.evidence.sourceDeviceId == null ? null : requireText(input.evidence.sourceDeviceId, 'observation.evidence.sourceDeviceId'),
    sourceAccountId: input.evidence.sourceAccountId == null ? null : requireText(input.evidence.sourceAccountId, 'observation.evidence.sourceAccountId'),
    provenanceAuthority: requireText(input.evidence.provenanceAuthority, 'observation.evidence.provenanceAuthority'),
    provenanceRecordId: requireText(input.evidence.provenanceRecordId, 'observation.evidence.provenanceRecordId'),
  });
  return Object.freeze({ observationId, targetActorId, targetInstanceId, fragmentIds, confidence, evidence });
}
