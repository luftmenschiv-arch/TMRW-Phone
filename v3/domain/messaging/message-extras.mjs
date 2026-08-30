import { requireText } from '../identity/identity-record.mjs';

export const MESSAGE_CONTENT_KIND = Object.freeze({ TEXT: 'text', STICKER: 'sticker' });
export const REACTION_ACTION = Object.freeze({ SET: 'set', REMOVE: 'remove' });

export function normalizeDraft(input) {
  if (input == null) return null;
  const text = String(input.text || '');
  if (text.length > 8000) throw new TypeError('draft.text exceeds the bounded limit');
  return Object.freeze({
    draftId: requireText(input.draftId, 'draft.draftId'),
    threadId: requireText(input.threadId, 'draft.threadId'),
    ownerAccountId: requireText(input.ownerAccountId, 'draft.ownerAccountId'),
    actualAuthorActorId: requireText(input.actualAuthorActorId, 'draft.actualAuthorActorId'),
    actualAuthorInstanceId: requireText(input.actualAuthorInstanceId, 'draft.actualAuthorInstanceId'),
    deviceId: requireText(input.deviceId, 'draft.deviceId'),
    text,
  });
}

export function normalizeUnsend(input) {
  const recipientAccountIds = Object.freeze([...new Set((input?.recipientAccountIds || []).map(value => requireText(value, 'unsend.recipientAccountId')))].sort());
  return Object.freeze({
    messageId: requireText(input?.messageId, 'unsend.messageId'),
    threadId: requireText(input?.threadId, 'unsend.threadId'),
    actorId: requireText(input?.actorId, 'unsend.actorId'),
    instanceId: requireText(input?.instanceId, 'unsend.instanceId'),
    accountId: requireText(input?.accountId, 'unsend.accountId'),
    deviceId: requireText(input?.deviceId, 'unsend.deviceId'),
    recipientAccountIds,
    reason: String(input?.reason || 'unsent').slice(0, 256),
  });
}

export function normalizeReaction(input) {
  const action = requireText(input?.action, 'reaction.action');
  if (!Object.values(REACTION_ACTION).includes(action)) throw new TypeError('Unsupported reaction action');
  const value = action === REACTION_ACTION.SET ? requireText(input?.value, 'reaction.value') : null;
  if (value && value.length > 64) throw new TypeError('reaction.value exceeds the bounded limit');
  return Object.freeze({
    reactionId: requireText(input?.reactionId, 'reaction.reactionId'),
    messageId: requireText(input?.messageId, 'reaction.messageId'),
    threadId: requireText(input?.threadId, 'reaction.threadId'),
    reactorAccountId: requireText(input?.reactorAccountId, 'reaction.reactorAccountId'),
    actualActorId: requireText(input?.actualActorId, 'reaction.actualActorId'),
    actualInstanceId: requireText(input?.actualInstanceId, 'reaction.actualInstanceId'),
    deviceId: requireText(input?.deviceId, 'reaction.deviceId'),
    action,
    value,
  });
}

export function normalizeStickerOwnership(input) {
  return Object.freeze({
    ownershipId: requireText(input?.ownershipId, 'stickerOwnership.ownershipId'),
    stickerAssetId: requireText(input?.stickerAssetId, 'stickerOwnership.stickerAssetId'),
    ownerAccountId: requireText(input?.ownerAccountId, 'stickerOwnership.ownerAccountId'),
    ownerActorId: requireText(input?.ownerActorId, 'stickerOwnership.ownerActorId'),
    ownerInstanceId: requireText(input?.ownerInstanceId, 'stickerOwnership.ownerInstanceId'),
    active: input?.active !== false,
  });
}

export const draftHeadId = (scope, draftId) => `message-draft:${scope.storyId}:${scope.branchId}:${requireText(draftId, 'draftId')}`;
export const reactionHeadId = (scope, reactionId) => `message-reaction:${scope.storyId}:${scope.branchId}:${requireText(reactionId, 'reactionId')}`;
export const stickerOwnershipHeadId = (scope, ownershipId) => `sticker-ownership:${scope.storyId}:${scope.branchId}:${requireText(ownershipId, 'ownershipId')}`;
