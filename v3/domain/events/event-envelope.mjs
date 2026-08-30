import { requireText, requireTimestamp } from '../identity/identity-record.mjs';

export function revisionId(eventId, revision) {
  return `revision:${requireText(eventId, 'eventId')}:${Number(revision)}`;
}

export function createCanonicalEventHead({ id, scope, eventType, sequence, commitSequence, payload, references, provenance, causes, committedAt, appendDigest }) {
  return Object.freeze({
    entityType: 'canonical-event',
    id: requireText(id, 'id'),
    storyId: scope.storyId,
    branchId: scope.branchId,
    eventType: requireText(eventType, 'eventType'),
    sequence,
    lastCommitSequence: commitSequence,
    revision: 1,
    currentRevisionId: revisionId(id, 1),
    status: 'active',
    payload: structuredClone(payload),
    references: structuredClone(references),
    causes: [...causes],
    provenance: structuredClone(provenance),
    sourceAuthority: provenance.authority,
    sourceRecordId: provenance.recordId || undefined,
    appendDigest,
    createdAt: requireTimestamp(committedAt, 'committedAt'),
    updatedAt: requireTimestamp(committedAt, 'committedAt'),
    phase: 3,
  });
}

export function createEventRevision({ event, operation, commitSequence, committedAt, reason = null, priorRevision = null }) {
  return Object.freeze({
    entityType: 'canonical-event-revision',
    id: event.currentRevisionId,
    eventId: event.id,
    storyId: event.storyId,
    branchId: event.branchId,
    eventType: event.eventType,
    revision: event.revision,
    operation,
    commitSequence,
    priorRevision,
    status: event.status,
    payload: structuredClone(event.payload),
    references: structuredClone(event.references),
    causes: [...event.causes],
    provenance: structuredClone(event.provenance),
    reason,
    committedAt: requireTimestamp(committedAt, 'committedAt'),
    phase: 3,
  });
}
