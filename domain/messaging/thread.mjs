import { requireText } from '../identity/identity-record.mjs';

export const THREAD_KIND = Object.freeze({ DM: 'dm', GROUP: 'group' });
const THREAD_KINDS = new Set(Object.values(THREAD_KIND));

const unique = (values, field) => Object.freeze([...new Set((values || []).map((value, index) => requireText(value, `${field}[${index}]`)))].sort());

export function normalizeThread(input) {
  const threadId = requireText(input?.threadId, 'thread.threadId');
  const kind = requireText(input?.kind, 'thread.kind');
  if (!THREAD_KINDS.has(kind)) throw new TypeError(`Unsupported thread kind: ${kind}`);
  const participantAccountIds = unique(input?.participantAccountIds, 'thread.participantAccountIds');
  const participantActorIds = unique(input?.participantActorIds, 'thread.participantActorIds');
  const participantInstanceIds = unique(input?.participantInstanceIds, 'thread.participantInstanceIds');
  const required = kind === THREAD_KIND.DM ? 2 : 3;
  if (participantAccountIds.length < required || participantActorIds.length !== participantAccountIds.length || participantInstanceIds.length !== participantAccountIds.length) {
    throw new TypeError(`${kind} thread requires ${required}+ aligned canonical participants`);
  }
  return Object.freeze({
    threadId,
    kind,
    participantAccountIds,
    participantActorIds,
    participantInstanceIds,
    sourceMode: input?.sourceMode === 'historical-import' ? 'historical-import' : 'live',
  });
}

export const threadHeadId = (scope, threadId) => `thread:${scope.storyId}:${scope.branchId}:${requireText(threadId, 'threadId')}`;
export const threadParticipantId = (scope, threadId, accountId) => `thread-participant:${scope.storyId}:${scope.branchId}:${requireText(threadId, 'threadId')}:${requireText(accountId, 'accountId')}`;
