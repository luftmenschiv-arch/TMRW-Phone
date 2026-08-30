import { MIGRATION_ITEM_STATE } from './constants.mjs';
import { previewDigest } from './digest.mjs';

export async function createThreadMigrationItem({ scope, thread, memberIds }) {
  const sourceRecordId = `scope:${scope.sourceScopeKey}:thread:${thread.threadId || 'unknown'}`; let state = MIGRATION_ITEM_STATE.READY; let reasonCode = null;
  if (!thread.threadId) { state = MIGRATION_ITEM_STATE.QUARANTINED; reasonCode = 'thread-missing-stable-id'; }
  else if (!['dm', 'group'].includes(thread.type)) { state = MIGRATION_ITEM_STATE.UNSUPPORTED; reasonCode = 'unsupported-thread-kind'; }
  else if (thread.type === 'dm' && thread.participantIds.length !== 2) { state = MIGRATION_ITEM_STATE.AMBIGUOUS; reasonCode = 'dm-participants-not-exactly-two'; }
  else if (thread.type === 'group' && thread.participantIds.length < 2) { state = MIGRATION_ITEM_STATE.AMBIGUOUS; reasonCode = 'group-membership-missing'; }
  else if (thread.participantIds.some(id => !memberIds.has(id))) { state = MIGRATION_ITEM_STATE.AMBIGUOUS; reasonCode = 'thread-participant-unmapped'; }
  const structuralSource = { threadId: thread.threadId, type: thread.type, participantIds: thread.participantIds, name: thread.name, source: thread.source };
  return Object.freeze({ sourceRecordId, sourceScopeKey: scope.sourceScopeKey, sourceType: 'thread', state, reasonCode, sourceFingerprint: await previewDigest(structuralSource), data: state === MIGRATION_ITEM_STATE.READY ? Object.freeze({ threadId: thread.threadId, kind: thread.type, participantSourceIds: Object.freeze([...thread.participantIds]), name: thread.name || null }) : null });
}
