import { requireText } from '../identity/identity-record.mjs';
import { MESSAGE_CONTENT_KIND } from './message-extras.mjs';

export function normalizeMessage(input) {
  const messageId = requireText(input?.messageId, 'message.messageId');
  const threadId = requireText(input?.threadId, 'message.threadId');
  const membershipSnapshotId = requireText(input?.membershipSnapshotId, 'message.membershipSnapshotId');
  const contentKind = input?.contentKind || MESSAGE_CONTENT_KIND.TEXT;
  if (!Object.values(MESSAGE_CONTENT_KIND).includes(contentKind)) throw new TypeError('Unsupported message content kind');
  const text = contentKind === MESSAGE_CONTENT_KIND.TEXT ? requireText(input?.text, 'message.text') : String(input?.text || '');
  if (text.length > 8000) throw new TypeError('message.text exceeds the bounded text limit');
  const sticker = contentKind === MESSAGE_CONTENT_KIND.STICKER ? Object.freeze({
    stickerAssetId: requireText(input?.sticker?.stickerAssetId, 'message.sticker.stickerAssetId'),
    label: String(input?.sticker?.label || '').slice(0, 128),
    assetRef: String(input?.sticker?.assetRef || '').slice(0, 1024) || null,
  }) : null;
  return Object.freeze({
    messageId,
    threadId,
    membershipSnapshotId,
    senderAccountId: requireText(input?.senderAccountId, 'message.senderAccountId'),
    actualAuthorActorId: requireText(input?.actualAuthorActorId, 'message.actualAuthorActorId'),
    actualAuthorInstanceId: requireText(input?.actualAuthorInstanceId, 'message.actualAuthorInstanceId'),
    deviceId: requireText(input?.deviceId, 'message.deviceId'),
    contentKind,
    text,
    sticker,
    sourceMode: input?.sourceMode === 'historical-import' ? 'historical-import' : 'live',
  });
}

export const messageHeadId = (scope, messageId) => `message:${scope.storyId}:${scope.branchId}:${requireText(messageId, 'messageId')}`;
