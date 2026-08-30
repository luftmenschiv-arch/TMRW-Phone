import { requireText } from '../identity/identity-record.mjs';

export const NOTIFICATION_TYPE = Object.freeze({
  DM: 'message.dm', GROUP: 'message.group', MESSAGE_REACTION: 'message.reaction',
  CALL_INCOMING: 'call.incoming', CALL_MISSED: 'call.missed', CALL_ENDED: 'call.ended', VOICEMAIL: 'call.voicemail',
  SOCIAL_COMMENT: 'social.comment', SOCIAL_REPLY: 'social.reply', SOCIAL_REACTION: 'social.reaction', SOCIAL_FOLLOW: 'social.follow',
  LIVE_STARTED: 'live.started', LIVE_ENDED: 'live.ended', LIVE_COMMENT: 'live.comment', LIVE_REPLY: 'live.reply', LIVE_REACTION: 'live.reaction',
});

export const NOTIFICATION_READ_STATE = Object.freeze({ UNREAD: 'unread', READ: 'read' });
export const NOTIFICATION_VISIBLE_STATE = Object.freeze({ VISIBLE: 'visible', DISMISSED: 'dismissed' });
export const NOTIFICATION_PREVIEW_POLICY = Object.freeze({ HIDDEN_CONTENT: 'hidden-content', SENDER_ONLY: 'sender-only', BOUNDED_CONTENT: 'bounded-content' });

export const notificationProjectionId = (scope, logicalGroup, accountId, deviceId) =>
  `notification:${scope.storyId}:${scope.branchId}:${requireText(logicalGroup, 'logicalGroup')}:${requireText(accountId, 'accountId')}:${requireText(deviceId, 'deviceId')}`;

export function boundedNotificationDisplay({ title, preview = null, maxPreview = 180 }) {
  const safeTitle = String(title || '').trim().slice(0, 120);
  if (!safeTitle) throw new TypeError('notification title is required');
  const safePreview = preview == null ? null : String(preview).trim().slice(0, maxPreview) || null;
  return Object.freeze({ title: safeTitle, preview: safePreview });
}

