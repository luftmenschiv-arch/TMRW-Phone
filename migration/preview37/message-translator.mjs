import { MIGRATION_ITEM_STATE } from './constants.mjs';
import { previewDigest } from './digest.mjs';

const unsafeSource = value => /(?:pocket-phone|pocket-phone-bridge|mock-seed|plot-link|phone-life|story-sync)/i.test(String(value || ''));

export async function createMessageMigrationItem({ scope, thread, message, memberIds }) {
  const sourceRecordId = `scope:${scope.sourceScopeKey}:thread:${thread.threadId || 'unknown'}:message:${message.messageId || message.sourceFingerprint}`; let state = MIGRATION_ITEM_STATE.READY; let reasonCode = null; const sourceMarker = message.metadata?.source || thread.source || '';
  if (!message.messageId) { state = MIGRATION_ITEM_STATE.QUARANTINED; reasonCode = 'message-missing-stable-id'; }
  else if (!message.text) { state = MIGRATION_ITEM_STATE.UNSUPPORTED; reasonCode = 'empty-message'; }
  else if (!memberIds.has(message.senderId)) { state = MIGRATION_ITEM_STATE.AMBIGUOUS; reasonCode = 'message-sender-unmapped'; }
  else if (unsafeSource(sourceMarker)) { state = MIGRATION_ITEM_STATE.QUARANTINED; reasonCode = /pocket/i.test(sourceMarker) ? 'pocket-origin-not-preview-migration-input' : 'synthetic-or-generated-preview-message'; }
  let membershipSourceIds = thread.participantIds;
  if (thread.type === 'group') {
    membershipSourceIds = Array.isArray(message.metadata?.memberIds) ? [...new Set(message.metadata.memberIds.map(String))] : [];
    if (!membershipSourceIds.length || membershipSourceIds.some(id => !memberIds.has(id)) || !membershipSourceIds.includes(message.senderId)) { state = MIGRATION_ITEM_STATE.AMBIGUOUS; reasonCode = 'group-message-membership-snapshot-unproven'; }
  }
  const actualAuthorSourceId = String(message.metadata?.actualAuthorId || message.senderId);
  if (!memberIds.has(actualAuthorSourceId)) { state = MIGRATION_ITEM_STATE.AMBIGUOUS; reasonCode = 'actual-author-unmapped'; }
  return Object.freeze({ sourceRecordId, sourceScopeKey: scope.sourceScopeKey, sourceType: 'message', state, reasonCode, sourceFingerprint: await previewDigest({ threadId: thread.threadId, message }), data: state === MIGRATION_ITEM_STATE.READY ? Object.freeze({ threadSourceId: thread.threadId, messageSourceId: message.messageId, senderSourceId: message.senderId, actualAuthorSourceId, deviceSourceId: String(message.metadata?.deviceOwnerId || message.senderId), membershipSourceIds: Object.freeze(membershipSourceIds), text: message.text, sourceOccurredAt: message.metadata?.createdAt || null, displayedTime: message.displayedTime, originalSource: sourceMarker || 'preview37-record' }) : null });
}

