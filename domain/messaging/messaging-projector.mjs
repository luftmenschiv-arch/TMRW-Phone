import { defineProjector } from '../projections/projection-runner.mjs';
import { MESSAGING_EVENT_TYPES, normalizeDraftStatePayload, normalizeMembershipSnapshotPayload, normalizeMessageSentPayload, normalizeMessageUnsentPayload, normalizeReactionStatePayload, normalizeStickerOwnershipPayload, normalizeThreadCreatedPayload } from './messaging-event-types.mjs';
import { membershipHeadId } from './membership.mjs';
import { messageHeadId } from './message.mjs';
import { draftHeadId, reactionHeadId, stickerOwnershipHeadId } from './message-extras.mjs';
import { threadHeadId, threadParticipantId } from './thread.mjs';

export const MESSAGING_PROJECTOR_ID = 'tmrw-messaging-v1';
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;

function rowsForEvent(event) {
  if (event.eventType === MESSAGING_EVENT_TYPES.THREAD_CREATED) {
    const payload = normalizeThreadCreatedPayload(event.payload);
    const rows = [{ kind: 'messaging-thread-source', projectionKey: `thread:${payload.thread.threadId}`, groupKey: `thread:${payload.thread.threadId}`, data: { thread: payload.thread } }, { kind: 'messaging-membership-source', projectionKey: `membership:${payload.initialMembership.snapshotId}`, groupKey: `membership:${payload.initialMembership.snapshotId}`, data: { snapshot: payload.initialMembership } }];
    for (const member of payload.initialMembership.members) rows.push({ kind: 'messaging-thread-participant-source', projectionKey: `participant:${payload.thread.threadId}:${member.accountId}`, groupKey: `participant:${payload.thread.threadId}:${member.accountId}`, data: { threadId: payload.thread.threadId, member } });
    return rows;
  }
  if (event.eventType === MESSAGING_EVENT_TYPES.MEMBERSHIP_SNAPSHOT) {
    const { snapshot } = normalizeMembershipSnapshotPayload(event.payload);
    return [{ kind: 'messaging-membership-source', projectionKey: `membership:${snapshot.snapshotId}`, groupKey: `membership:${snapshot.snapshotId}`, data: { snapshot } }];
  }
  if (event.eventType === MESSAGING_EVENT_TYPES.MESSAGE_SENT) {
    const { message, recipientAccountIds } = normalizeMessageSentPayload(event.payload);
    return [
      { kind: 'messaging-message-source', projectionKey: `message:${message.messageId}`, groupKey: `message:${message.messageId}`, data: { operation: 'sent', message } },
      ...recipientAccountIds.map(recipientAccountId => ({ kind: 'messaging-recipient-source', projectionKey: `recipient:${message.messageId}:${recipientAccountId}`, groupKey: `recipient:${message.messageId}:${recipientAccountId}`, data: { operation: 'sent', message, recipientAccountId } })),
    ];
  }
  if (event.eventType === MESSAGING_EVENT_TYPES.DRAFT_STATE) {
    const { draft } = normalizeDraftStatePayload(event.payload); const key = draft?.draftId || event.payload?.draftId;
    return [{ kind: 'messaging-draft-source', projectionKey: `draft:${key}`, groupKey: `draft:${key}`, data: { draft } }];
  }
  if (event.eventType === MESSAGING_EVENT_TYPES.MESSAGE_UNSENT) {
    const { unsend } = normalizeMessageUnsentPayload(event.payload);
    return [
      { kind: 'messaging-unsend-source', projectionKey: `unsend:${unsend.messageId}`, groupKey: `message:${unsend.messageId}`, data: { operation: 'unsent', unsend } },
      ...unsend.recipientAccountIds.map(recipientAccountId => ({ kind: 'messaging-recipient-unsend-source', projectionKey: `unsend-recipient:${unsend.messageId}:${recipientAccountId}`, groupKey: `recipient:${unsend.messageId}:${recipientAccountId}`, data: { operation: 'unsent', unsend, recipientAccountId } })),
    ];
  }
  if (event.eventType === MESSAGING_EVENT_TYPES.REACTION_STATE) { const { reaction } = normalizeReactionStatePayload(event.payload); return [{ kind: 'messaging-reaction-source', projectionKey: `reaction:${reaction.reactionId}`, groupKey: `reaction:${reaction.reactionId}`, data: { reaction } }]; }
  if (event.eventType === MESSAGING_EVENT_TYPES.STICKER_OWNERSHIP_STATE) { const { ownership } = normalizeStickerOwnershipPayload(event.payload); return [{ kind: 'messaging-sticker-ownership-source', projectionKey: `sticker-ownership:${ownership.ownershipId}`, groupKey: `sticker-ownership:${ownership.ownershipId}`, data: { ownership } }]; }
  return [];
}

async function groupRows(repositories, scope, groupKey) {
  return repositories.projections.listByIndexRange('by_scope_projector_group_sequence', { lower: [scope.storyId, scope.branchId, MESSAGING_PROJECTOR_ID, groupKey, 0], upper: [scope.storyId, scope.branchId, MESSAGING_PROJECTOR_ID, groupKey, MAX_SEQUENCE] });
}

function newest(rows) {
  return [...rows].sort((left, right) => left.sourceEventSequence - right.sourceEventSequence || left.id.localeCompare(right.id)).at(-1) || null;
}

async function materializeThread(repositories, scope, threadId, rows, updatedAt) {
  const newestRow = newest(rows); const id = threadHeadId(scope, threadId);
  if (!newestRow) { await repositories.threads.delete(id); return { rowsWritten: 0 }; }
  const thread = newestRow.data.thread;
  await repositories.threads.put(Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, ...thread, sourceEventId: newestRow.sourceEventId, sourceEventRevision: newestRow.sourceEventRevision, sourceEventSequence: newestRow.sourceEventSequence, updatedAt, phase: 8 }));
  return { rowsWritten: 1 };
}

async function materializeMembership(repositories, scope, snapshotId, rows, updatedAt) {
  const newestRow = newest(rows); const id = membershipHeadId(scope, snapshotId);
  if (!newestRow) { await repositories.threadMembershipSnapshots.delete(id); return { rowsWritten: 0 }; }
  const snapshot = newestRow.data.snapshot;
  await repositories.threadMembershipSnapshots.put(Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, ...snapshot, sourceEventId: newestRow.sourceEventId, sourceEventRevision: newestRow.sourceEventRevision, sourceEventSequence: newestRow.sourceEventSequence, updatedAt, phase: 8 }));
  return { rowsWritten: 1 };
}

async function materializeMessage(repositories, scope, messageId, rows, updatedAt) {
  const ordered = [...rows].sort((a, b) => a.sourceEventSequence - b.sourceEventSequence || a.id.localeCompare(b.id)); const sentRow = ordered.filter(row => row.data.operation === 'sent').at(-1); const newestRow = ordered.at(-1); const id = messageHeadId(scope, messageId);
  if (!sentRow) { await repositories.messages.delete(id); return { rowsWritten: 0 }; }
  const message = sentRow.data.message; const unsent = newestRow?.data.operation === 'unsent';
  await repositories.messages.put(Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, ...message, visibility: unsent ? 'unsent' : 'visible', unsentByEventId: unsent ? newestRow.sourceEventId : null, sourceEventId: sentRow.sourceEventId, sourceEventRevision: sentRow.sourceEventRevision, sourceEventSequence: sentRow.sourceEventSequence, reverseSequence: MAX_SEQUENCE - sentRow.sourceEventSequence, updatedAt, phase: 13 }));
  return { rowsWritten: 1 };
}

async function materializeRecipient(repositories, scope, groupKey, rows, updatedAt) {
  const newestRow = newest(rows); const prior = rows.find(row => row.data.operation === 'sent')?.data || rows[0]?.data; const data = prior || newestRow?.data;
  if (!data) return { rowsWritten: 0 };
  const id = `message-recipient:${scope.storyId}:${scope.branchId}:${data.message.messageId}:${data.recipientAccountId}`;
  if (!newestRow || newestRow.data.operation === 'unsent') { await repositories.messageRecipients.delete(id); return { rowsWritten: 0 }; }
  await repositories.messageRecipients.put(Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, messageId: data.message.messageId, threadId: data.message.threadId, recipientAccountId: data.recipientAccountId, sourceEventId: newestRow.sourceEventId, sourceEventRevision: newestRow.sourceEventRevision, sourceEventSequence: newestRow.sourceEventSequence, reverseSequence: MAX_SEQUENCE - newestRow.sourceEventSequence, updatedAt, phase: 8 }));
  return { rowsWritten: 1 };
}

async function materializeDraft(repositories, scope, draftId, rows, updatedAt) { const row = newest(rows); const id = draftHeadId(scope, draftId); const draft = row?.data?.draft; if (!row || !draft || draft.text === '') { await repositories.messageDrafts.delete(id); return { rowsWritten: 0 }; } await repositories.messageDrafts.put(Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, ...draft, sourceEventId: row.sourceEventId, sourceEventRevision: row.sourceEventRevision, updatedAt, phase: 13 })); return { rowsWritten: 1 }; }
async function materializeReaction(repositories, scope, reactionId, rows, updatedAt) { const row = newest(rows); const id = reactionHeadId(scope, reactionId); const reaction = row?.data?.reaction; if (!row || !reaction || reaction.action === 'remove') { await repositories.messageReactions.delete(id); return { rowsWritten: 0 }; } await repositories.messageReactions.put(Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, ...reaction, sourceEventId: row.sourceEventId, sourceEventRevision: row.sourceEventRevision, updatedAt, phase: 13 })); return { rowsWritten: 1 }; }
async function materializeStickerOwnership(repositories, scope, ownershipId, rows, updatedAt) { const row = newest(rows); const id = stickerOwnershipHeadId(scope, ownershipId); const ownership = row?.data?.ownership; if (!row || !ownership || !ownership.active) { await repositories.stickerOwnerships.delete(id); return { rowsWritten: 0 }; } await repositories.stickerOwnerships.put(Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, ...ownership, sourceEventId: row.sourceEventId, sourceEventRevision: row.sourceEventRevision, updatedAt, phase: 13 })); return { rowsWritten: 1 }; }

async function materializeParticipant(repositories, scope, groupKey, rows, updatedAt) {
  const newestRow = newest(rows); const [, encoded] = groupKey.split(':', 2);
  if (!newestRow) return { rowsWritten: 0 };
  const data = newestRow.data;
  if (!data.member) return { rowsWritten: 0 };
  const id = threadParticipantId(scope, data.threadId, data.member.accountId);
  await repositories.threadParticipants.put(Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, threadId: data.threadId, ...data.member, sourceEventId: newestRow.sourceEventId, sourceEventRevision: newestRow.sourceEventRevision, sourceEventSequence: newestRow.sourceEventSequence, updatedAt, phase: 8 }));
  return { rowsWritten: 1 };
}

async function materializeGroup(repositories, scope, groupKey, updatedAt) {
  const rows = await groupRows(repositories, scope, groupKey);
  if (groupKey.startsWith('thread:')) return { sourceRowsRead: rows.length, ...(await materializeThread(repositories, scope, groupKey.slice('thread:'.length), rows, updatedAt)) };
  if (groupKey.startsWith('membership:')) return { sourceRowsRead: rows.length, ...(await materializeMembership(repositories, scope, groupKey.slice('membership:'.length), rows, updatedAt)) };
  if (groupKey.startsWith('message:')) return { sourceRowsRead: rows.length, ...(await materializeMessage(repositories, scope, groupKey.slice('message:'.length), rows, updatedAt)) };
  if (groupKey.startsWith('recipient:')) return { sourceRowsRead: rows.length, ...(await materializeRecipient(repositories, scope, groupKey, rows, updatedAt)) };
  if (groupKey.startsWith('participant:')) return { sourceRowsRead: rows.length, ...(await materializeParticipant(repositories, scope, groupKey, rows, updatedAt)) };
  if (groupKey.startsWith('draft:')) return { sourceRowsRead: rows.length, ...(await materializeDraft(repositories, scope, groupKey.slice(6), rows, updatedAt)) };
  if (groupKey.startsWith('reaction:')) return { sourceRowsRead: rows.length, ...(await materializeReaction(repositories, scope, groupKey.slice(9), rows, updatedAt)) };
  if (groupKey.startsWith('sticker-ownership:')) return { sourceRowsRead: rows.length, ...(await materializeStickerOwnership(repositories, scope, groupKey.slice(18), rows, updatedAt)) };
  return { sourceRowsRead: 0, rowsWritten: 0 };
}

async function applyAggregate({ repositories, scope, previousRows, currentRows, updatedAt }) {
  let sourceRowsRead = 0; let rowsWritten = 0;
  for (const groupKey of new Set([...previousRows, ...currentRows].map(row => row.groupKey).filter(Boolean))) {
    const hasCurrent = currentRows.some(row => row.groupKey === groupKey);
    const hasAny = (await groupRows(repositories, scope, groupKey)).length > 0;
    if (!hasCurrent && !hasAny && groupKey.startsWith('participant:')) {
      const prior = previousRows.find(row => row.groupKey === groupKey)?.data;
      if (prior?.member) await repositories.threadParticipants.delete(threadParticipantId(scope, prior.threadId, prior.member.accountId));
    }
    if (!hasCurrent && !hasAny && groupKey.startsWith('recipient:')) {
      const prior = previousRows.find(row => row.groupKey === groupKey)?.data;
      if (prior) await repositories.messageRecipients.delete(`message-recipient:${scope.storyId}:${scope.branchId}:${prior.message.messageId}:${prior.recipientAccountId}`);
    }
    const result = await materializeGroup(repositories, scope, groupKey, updatedAt); sourceRowsRead += result.sourceRowsRead; rowsWritten += result.rowsWritten;
  }
  return { sourceRowsRead, rowsWritten, eventHistoryScans: 0 };
}

async function rebuildAggregate({ repositories, scope, updatedAt }) {
  for (const storeName of ['threads', 'threadMembershipSnapshots', 'threadParticipants', 'messages', 'messageRecipients', 'messageDrafts', 'messageReactions', 'stickerOwnerships']) for (const row of await repositories[storeName].list()) await repositories[storeName].delete(row.id);
  const rows = await repositories.projections.listByIndex('by_scope_projector', [scope.storyId, scope.branchId, MESSAGING_PROJECTOR_ID]);
  let sourceRowsRead = 0; let rowsWritten = 0;
  for (const groupKey of new Set(rows.map(row => row.groupKey).filter(Boolean))) { const result = await materializeGroup(repositories, scope, groupKey, updatedAt); sourceRowsRead += result.sourceRowsRead; rowsWritten += result.rowsWritten; }
  return { sourceRowsRead, rowsWritten };
}

export function createMessagingProjector() {
  return defineProjector({ id: MESSAGING_PROJECTOR_ID, version: 2, stores: ['threads', 'threadMembershipSnapshots', 'threadParticipants', 'messages', 'messageRecipients', 'messageDrafts', 'messageReactions', 'stickerOwnerships'], project: rowsForEvent, applyAggregate, rebuildAggregate });
}
