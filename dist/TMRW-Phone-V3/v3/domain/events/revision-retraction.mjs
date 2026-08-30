import { revisionId } from './event-envelope.mjs';

export function reviseCanonicalEvent(current, { payload, references, commitSequence, committedAt }) {
  const revision = current.revision + 1;
  return Object.freeze({
    ...current,
    payload: structuredClone(payload),
    references: structuredClone(references),
    revision,
    currentRevisionId: revisionId(current.id, revision),
    lastCommitSequence: commitSequence,
    updatedAt: committedAt,
  });
}

export function retractCanonicalEvent(current, { commitSequence, committedAt }) {
  const revision = current.revision + 1;
  return Object.freeze({
    ...current,
    status: 'retracted',
    revision,
    currentRevisionId: revisionId(current.id, revision),
    lastCommitSequence: commitSequence,
    updatedAt: committedAt,
  });
}

export function restoreCanonicalEvent(current, { commitSequence, committedAt }) {
  const revision = current.revision + 1;
  return Object.freeze({
    ...current,
    status: 'active',
    revision,
    currentRevisionId: revisionId(current.id, revision),
    lastCommitSequence: commitSequence,
    updatedAt: committedAt,
  });
}
