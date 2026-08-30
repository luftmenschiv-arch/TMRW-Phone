import { defineProjector } from '../projections/projection-runner.mjs';
import { MESSAGING_EVENT_TYPES, normalizeMessageSentPayload, normalizeMessageUnsentPayload, normalizeReactionStatePayload } from '../messaging/messaging-event-types.mjs';
import { CALL_EVENT_TYPES, normalizeCallInitiatedPayload, normalizeCallTransitionPayload, normalizeVoicemailPayload } from '../calls/call-event-types.mjs';
import { CALL_STATE } from '../calls/call-state-machine.mjs';
import { SOCIAL_EVENT_TYPES, normalizeCommentPayload, normalizeEngagementPayload, normalizeGraphPayload } from '../social/social-event-types.mjs';
import { SOCIAL_RELATION } from '../social/social-graph.mjs';
import { LIVE_EVENT_TYPES, normalizeLiveMessagePayload, normalizeLiveReactionPayload, normalizeLiveSessionPayload } from '../live/live-event-types.mjs';
import { LIVE_STATUS } from '../live/live-session.mjs';
import { NOTIFICATION_PREVIEW_POLICY, NOTIFICATION_READ_STATE, NOTIFICATION_TYPE, NOTIFICATION_VISIBLE_STATE, boundedNotificationDisplay, notificationProjectionId } from './notification.mjs';

export const NOTIFICATION_PROJECTOR_ID = 'tmrw-notifications-v1';
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;
const sourceMeta = event => ({ eventType: event.eventType, sourceEventId: event.id, sourceEventRevision: event.revision, sourceEventSequence: event.sequence, causes: event.causes || [], provenance: event.provenance, storyTimeRef: event.payload?.storyTimeRef || event.payload?.message?.storyTimeRef || event.payload?.comment?.storyTimeRef || event.payload?.reaction?.storyTimeRef || event.payload?.session?.startedStoryTimeRef || event.payload?.session?.createdStoryTimeRef || null });
const row = (groupKey, projectionKey, data) => ({ kind: 'notification-eligibility-source', projectionKey, groupKey, data });

function project(event) {
  const meta = sourceMeta(event);
  if (event.eventType === MESSAGING_EVENT_TYPES.MESSAGE_SENT) {
    const { message, recipientAccountIds } = normalizeMessageSentPayload(event.payload);
    return recipientAccountIds.filter(accountId => accountId !== message.senderAccountId).map(accountId => row(`message:${message.messageId}:${accountId}`, `message:${message.messageId}:${accountId}`, { ...meta, operation: 'sent', message, recipientAccountId: accountId }));
  }
  if (event.eventType === MESSAGING_EVENT_TYPES.MESSAGE_UNSENT) {
    const { unsend } = normalizeMessageUnsentPayload(event.payload);
    return unsend.recipientAccountIds.filter(accountId => accountId !== unsend.accountId).map(accountId => row(`message:${unsend.messageId}:${accountId}`, `message-unsent:${unsend.messageId}:${accountId}`, { ...meta, operation: 'unsent', unsend, recipientAccountId: accountId }));
  }
  if (event.eventType === MESSAGING_EVENT_TYPES.REACTION_STATE) {
    const { reaction } = normalizeReactionStatePayload(event.payload); return [row(`message-reaction:${reaction.reactionId}`, `message-reaction:${reaction.reactionId}`, { ...meta, reaction })];
  }
  if (event.eventType === CALL_EVENT_TYPES.SESSION_INITIATED) {
    const { session } = normalizeCallInitiatedPayload(event.payload); return [row(`call:${session.callSessionId}`, `call:${session.callSessionId}:initiated`, { ...meta, operation: 'initiated', callSessionId: session.callSessionId })];
  }
  if (event.eventType === CALL_EVENT_TYPES.SESSION_TRANSITIONED) {
    const transition = normalizeCallTransitionPayload(event.payload); return [row(`call:${transition.callSessionId}`, `call:${transition.callSessionId}:${event.id}`, { ...meta, operation: 'transition', callSessionId: transition.callSessionId })];
  }
  if (event.eventType === CALL_EVENT_TYPES.VOICEMAIL_LEFT) {
    const { voicemail } = normalizeVoicemailPayload(event.payload); return [row(`voicemail:${voicemail.voicemailId}`, `voicemail:${voicemail.voicemailId}`, { ...meta, voicemail })];
  }
  if (event.eventType === SOCIAL_EVENT_TYPES.COMMENT_CREATED) {
    const { comment, recipientAccountIds } = normalizeCommentPayload(event.payload); return [row(`social-comment:${comment.commentId}`, `social-comment:${comment.commentId}`, { ...meta, comment, recipientAccountIds })];
  }
  if (event.eventType === SOCIAL_EVENT_TYPES.ENGAGEMENT_STATE) {
    const { engagement } = normalizeEngagementPayload(event.payload); return [row(`social-engagement:${engagement.engagementId}`, `social-engagement:${engagement.engagementId}`, { ...meta, engagement })];
  }
  if (event.eventType === SOCIAL_EVENT_TYPES.GRAPH_STATE) {
    const { edge } = normalizeGraphPayload(event.payload); return [row(`social-graph:${edge.edgeId}`, `social-graph:${edge.edgeId}`, { ...meta, edge })];
  }
  if (event.eventType === LIVE_EVENT_TYPES.SESSION_STATE) {
    const { session } = normalizeLiveSessionPayload(event.payload); return [row(`live-session:${session.sessionId}`, `live-session:${session.sessionId}`, { ...meta, session })];
  }
  if (event.eventType === LIVE_EVENT_TYPES.MESSAGE_CREATED) {
    const { message } = normalizeLiveMessagePayload(event.payload); return [row(`live-message:${message.messageId}`, `live-message:${message.messageId}`, { ...meta, message })];
  }
  if (event.eventType === LIVE_EVENT_TYPES.REACTION_STATE) {
    const { reaction } = normalizeLiveReactionPayload(event.payload); return [row(`live-reaction:${reaction.reactionId}`, `live-reaction:${reaction.reactionId}`, { ...meta, reaction })];
  }
  return [];
}

async function groupRows(repositories, scope, groupKey) {
  return repositories.projections.listByIndexRange('by_scope_projector_group_sequence', { lower: [scope.storyId, scope.branchId, NOTIFICATION_PROJECTOR_ID, groupKey, 0], upper: [scope.storyId, scope.branchId, NOTIFICATION_PROJECTOR_ID, groupKey, MAX_SEQUENCE] });
}
const ordered = rows => [...rows].sort((a, b) => a.sourceEventSequence - b.sourceEventSequence || a.id.localeCompare(b.id));
const newest = rows => ordered(rows).at(-1) || null;
const generic = (row, values) => ({ ...values, sourceEventId: row.sourceEventId, sourceEventRevision: row.sourceEventRevision, sourceEventSequence: row.sourceEventSequence, storyTimeRef: row.data.storyTimeRef || null, provenance: row.data.provenance || null, causes: row.data.causes || [] });

async function candidates(repositories, scope, groupKey, rows) {
  const last = newest(rows); if (!last) return [];
  if (groupKey.startsWith('message:')) {
    if (last.data.operation === 'unsent') return [];
    const sent = ordered(rows).filter(item => item.data.operation === 'sent').at(-1); if (!sent) return [];
    const thread = await repositories.threads.getByIndex('by_scope_thread', [scope.storyId, scope.branchId, sent.data.message.threadId]); if (!thread) return [];
    return [generic(sent, { recipientAccountId: sent.data.recipientAccountId, sourceAccountId: sent.data.message.senderAccountId, sourceActorId: sent.data.message.actualAuthorActorId, type: thread.kind === 'group' ? NOTIFICATION_TYPE.GROUP : NOTIFICATION_TYPE.DM, appId: 'messages', groupingKey: `conversation:${thread.threadId}`, eligibilityBasis: 'explicit-message-recipient', previewPolicy: NOTIFICATION_PREVIEW_POLICY.SENDER_ONLY, display: boundedNotificationDisplay({ title: thread.kind === 'group' ? 'New group message' : 'New private message' }), navigation: { kind: 'thread', id: thread.threadId } })];
  }
  if (groupKey.startsWith('message-reaction:')) {
    const reaction = last.data.reaction; if (reaction.action === 'remove') return [];
    const message = await repositories.messages.getByIndex('by_scope_message', [scope.storyId, scope.branchId, reaction.messageId]); if (!message || message.visibility !== 'visible' || message.senderAccountId === reaction.reactorAccountId) return [];
    return [generic(last, { recipientAccountId: message.senderAccountId, sourceAccountId: reaction.reactorAccountId, sourceActorId: reaction.actualActorId, type: NOTIFICATION_TYPE.MESSAGE_REACTION, appId: 'messages', groupingKey: `message-reactions:${reaction.messageId}`, eligibilityBasis: 'authored-message-reaction', previewPolicy: NOTIFICATION_PREVIEW_POLICY.HIDDEN_CONTENT, display: boundedNotificationDisplay({ title: 'New message reaction' }), navigation: { kind: 'thread', id: reaction.threadId } })];
  }
  if (groupKey.startsWith('call:')) {
    const callSessionId = last.data.callSessionId; const session = await repositories.callSessions.getByIndex('by_scope_session', [scope.storyId, scope.branchId, callSessionId]); if (!session) return [];
    const type = session.state === CALL_STATE.RINGING ? NOTIFICATION_TYPE.CALL_INCOMING : session.state === CALL_STATE.MISSED ? NOTIFICATION_TYPE.CALL_MISSED : session.state === CALL_STATE.ENDED ? NOTIFICATION_TYPE.CALL_ENDED : null;
    if (!type) return [];
    return [generic(last, { recipientAccountId: session.calledAccountId, sourceAccountId: session.callingAccountId, sourceActorId: session.initiatingActualActorId, type, appId: 'calls', groupingKey: `call:${callSessionId}`, eligibilityBasis: 'explicit-call-endpoint', previewPolicy: NOTIFICATION_PREVIEW_POLICY.SENDER_ONLY, display: boundedNotificationDisplay({ title: type === NOTIFICATION_TYPE.CALL_MISSED ? 'Missed call' : type === NOTIFICATION_TYPE.CALL_ENDED ? 'Call ended' : 'Incoming call' }), navigation: { kind: 'call', id: callSessionId } })];
  }
  if (groupKey.startsWith('voicemail:')) {
    const voicemail = last.data.voicemail; return [generic(last, { recipientAccountId: voicemail.recipientAccountId, sourceAccountId: voicemail.callerAccountId, sourceActorId: voicemail.actualAuthorActorId, type: NOTIFICATION_TYPE.VOICEMAIL, appId: 'calls', groupingKey: `voicemail:${voicemail.callSessionId}`, eligibilityBasis: 'explicit-voicemail-recipient', previewPolicy: NOTIFICATION_PREVIEW_POLICY.SENDER_ONLY, display: boundedNotificationDisplay({ title: 'New voicemail' }), navigation: { kind: 'call', id: voicemail.callSessionId } })];
  }
  if (groupKey.startsWith('social-comment:')) {
    const { comment, recipientAccountIds } = last.data; const type = comment.parentCommentId ? NOTIFICATION_TYPE.SOCIAL_REPLY : NOTIFICATION_TYPE.SOCIAL_COMMENT; const recipients = new Set(recipientAccountIds);
    const post = await repositories.socialPosts.getByIndex('by_scope_post', [scope.storyId, scope.branchId, comment.postId]); if (post) recipients.add(post.authorAccountId);
    if (comment.parentCommentId) { const parent = await repositories.socialComments.getByIndex('by_scope_comment', [scope.storyId, scope.branchId, comment.parentCommentId]); if (parent) recipients.add(parent.authorAccountId); }
    recipients.delete(comment.authorAccountId);
    return [...recipients].map(recipientAccountId => generic(last, { recipientAccountId, sourceAccountId: comment.authorAccountId, sourceActorId: comment.actualAuthorActorId, type, appId: 'feed', groupingKey: `${type}:${comment.parentCommentId || comment.postId}`, eligibilityBasis: 'authored-or-explicit-social-recipient', previewPolicy: NOTIFICATION_PREVIEW_POLICY.BOUNDED_CONTENT, display: boundedNotificationDisplay({ title: type === NOTIFICATION_TYPE.SOCIAL_REPLY ? 'New reply' : 'New comment', preview: comment.text }), navigation: { kind: 'post', id: comment.postId } }));
  }
  if (groupKey.startsWith('social-engagement:')) {
    const engagement = last.data.engagement; if (!engagement.active) return [];
    const target = engagement.targetKind === 'comment' ? await repositories.socialComments.getByIndex('by_scope_comment', [scope.storyId, scope.branchId, engagement.targetId]) : await repositories.socialPosts.getByIndex('by_scope_post', [scope.storyId, scope.branchId, engagement.targetId]);
    const recipientAccountId = target?.authorAccountId; if (!recipientAccountId || recipientAccountId === engagement.actorAccountId) return [];
    const postId = engagement.targetKind === 'comment' ? target.postId : target.postId;
    return [generic(last, { recipientAccountId, sourceAccountId: engagement.actorAccountId, sourceActorId: engagement.actualActorId, type: NOTIFICATION_TYPE.SOCIAL_REACTION, appId: 'feed', groupingKey: `social-engagement:${engagement.targetId}:${engagement.kind}`, eligibilityBasis: 'authored-social-target', previewPolicy: NOTIFICATION_PREVIEW_POLICY.HIDDEN_CONTENT, display: boundedNotificationDisplay({ title: `New ${engagement.kind}` }), navigation: { kind: 'post', id: postId } })];
  }
  if (groupKey.startsWith('social-graph:')) {
    const edge = last.data.edge; if (!edge.active || edge.relation !== SOCIAL_RELATION.FOLLOW) return [];
    return [generic(last, { recipientAccountId: edge.targetAccountId, sourceAccountId: edge.ownerAccountId, sourceActorId: null, type: NOTIFICATION_TYPE.SOCIAL_FOLLOW, appId: 'feed', groupingKey: 'social-follows', eligibilityBasis: 'canonical-follow-target', previewPolicy: NOTIFICATION_PREVIEW_POLICY.SENDER_ONLY, display: boundedNotificationDisplay({ title: 'New follower' }), navigation: { kind: 'account', id: edge.ownerAccountId } })];
  }
  if (groupKey.startsWith('live-session:')) {
    const session = last.data.session; if (![LIVE_STATUS.ACTIVE, LIVE_STATUS.ENDED].includes(session.status)) return [];
    const type = session.status === LIVE_STATUS.ACTIVE ? NOTIFICATION_TYPE.LIVE_STARTED : NOTIFICATION_TYPE.LIVE_ENDED;
    return session.audience.recipientAccountIds.filter(accountId => accountId !== session.hostAccountId).map(recipientAccountId => generic(last, { recipientAccountId, sourceAccountId: session.hostAccountId, sourceActorId: session.actualActorId, type, appId: 'live', groupingKey: `live-session:${session.sessionId}`, eligibilityBasis: `explicit-live-${session.audience.kind}-recipient`, previewPolicy: NOTIFICATION_PREVIEW_POLICY.SENDER_ONLY, display: boundedNotificationDisplay({ title: type === NOTIFICATION_TYPE.LIVE_STARTED ? 'Live started' : 'Live ended' }), navigation: { kind: 'live', id: session.sessionId } }));
  }
  if (groupKey.startsWith('live-message:')) {
    const message = last.data.message; const session = await repositories.liveSessions.getByIndex('by_scope_session', [scope.storyId, scope.branchId, message.sessionId]); if (!session) return [];
    const recipients = new Set(); if (message.authorAccountId !== session.hostAccountId && message.observerAccountIds.includes(session.hostAccountId)) recipients.add(session.hostAccountId);
    if (message.parentMessageId) { const parent = await repositories.liveMessages.getByIndex('by_scope_message', [scope.storyId, scope.branchId, message.parentMessageId]); if (parent && parent.authorAccountId !== message.authorAccountId && message.observerAccountIds.includes(parent.authorAccountId)) recipients.add(parent.authorAccountId); }
    const type = message.parentMessageId ? NOTIFICATION_TYPE.LIVE_REPLY : NOTIFICATION_TYPE.LIVE_COMMENT;
    return [...recipients].map(recipientAccountId => generic(last, { recipientAccountId, sourceAccountId: message.authorAccountId, sourceActorId: message.actualAuthorActorId, type, appId: 'live', groupingKey: `${type}:${message.parentMessageId || message.sessionId}`, eligibilityBasis: 'live-observer-recipient', previewPolicy: NOTIFICATION_PREVIEW_POLICY.BOUNDED_CONTENT, display: boundedNotificationDisplay({ title: type === NOTIFICATION_TYPE.LIVE_REPLY ? 'New Live reply' : 'New Live comment', preview: message.text }), navigation: { kind: 'live', id: message.sessionId } }));
  }
  if (groupKey.startsWith('live-reaction:')) {
    const reaction = last.data.reaction; if (!reaction.active) return []; const session = await repositories.liveSessions.getByIndex('by_scope_session', [scope.storyId, scope.branchId, reaction.sessionId]); if (!session || session.hostAccountId === reaction.actorAccountId) return [];
    return [generic(last, { recipientAccountId: session.hostAccountId, sourceAccountId: reaction.actorAccountId, sourceActorId: reaction.actualActorId, type: NOTIFICATION_TYPE.LIVE_REACTION, appId: 'live', groupingKey: `live-reaction:${reaction.sessionId}:${reaction.kind}`, eligibilityBasis: 'live-host-reaction', previewPolicy: NOTIFICATION_PREVIEW_POLICY.HIDDEN_CONTENT, display: boundedNotificationDisplay({ title: `New Live ${reaction.kind}` }), navigation: { kind: 'live', id: reaction.sessionId } })];
  }
  return [];
}

async function materialize(repositories, scope, groupKey, updatedAt, preserved = null) {
  const rows = await groupRows(repositories, scope, groupKey); const existing = await repositories.notificationProjections.listByIndex('by_scope_logical_group', [scope.storyId, scope.branchId, groupKey]);
  const local = new Map(existing.map(item => [item.id, item])); if (preserved) for (const [id, item] of preserved) if (!local.has(id)) local.set(id, item);
  const nextIds = new Set(); const resolved = await candidates(repositories, scope, groupKey, rows); let writes = 0;
  for (const candidate of resolved) {
    const account = await repositories.accounts.get(candidate.recipientAccountId); if (!account) continue;
    const instance = await repositories.instances.get(account.ownerInstanceId); if (!instance) continue;
    for (const deviceId of account.deviceIds) {
      const device = await repositories.devices.get(deviceId); if (!device || device.ownerInstanceId !== account.ownerInstanceId) continue;
      const phone = await repositories.phoneStates.getByIndex('by_scope_device', [scope.storyId, scope.branchId, deviceId]);
      const id = notificationProjectionId(scope, groupKey, account.id, device.id); nextIds.add(id); const prior = local.get(id);
      await repositories.notificationProjections.put(Object.freeze({ id, notificationId: id, storyId: scope.storyId, branchId: scope.branchId, logicalGroup: groupKey, sourceEventId: candidate.sourceEventId, sourceEventRevision: candidate.sourceEventRevision, sourceCanonicalState: 'active', sourceEventSequence: candidate.sourceEventSequence, reverseSequence: MAX_SEQUENCE - candidate.sourceEventSequence, storyTimeRef: candidate.storyTimeRef, timestampBasis: candidate.storyTimeRef ? 'explicit-story-clock-reference' : 'canonical-event-sequence', recipientActorId: instance.actorId, recipientInstanceId: instance.id, recipientAccountId: account.id, recipientDeviceId: device.id, deviceOwnerInstanceId: device.ownerInstanceId, currentHolderActorId: phone?.currentHolderActorId || null, currentHolderInstanceId: phone?.currentHolderInstanceId || null, sourceAccountId: candidate.sourceAccountId || null, sourceActorId: candidate.sourceActorId || null, notificationType: candidate.type, appId: candidate.appId, display: candidate.display, previewPolicy: candidate.previewPolicy, eligibilityBasis: candidate.eligibilityBasis, provenance: candidate.provenance ? { authority: candidate.provenance.authority, kind: candidate.provenance.kind, recordId: candidate.provenance.recordId || null } : null, causalEventIds: candidate.causes, groupingKey: candidate.groupingKey, navigation: candidate.navigation, readState: prior?.readState || NOTIFICATION_READ_STATE.UNREAD, visibleState: prior?.visibleState || NOTIFICATION_VISIBLE_STATE.VISIBLE, localStateRevision: prior?.localStateRevision || 0, localStateUpdatedAt: prior?.localStateUpdatedAt || null, updatedAt, derived: true, phase: 17 })); writes += 1;
    }
  }
  for (const prior of existing) if (!nextIds.has(prior.id)) await repositories.notificationProjections.delete(prior.id);
  return { sourceRowsRead: rows.length, rowsWritten: writes };
}

async function applyAggregate({ repositories, scope, previousRows, currentRows, updatedAt }) {
  let sourceRowsRead = 0; let rowsWritten = 0;
  for (const key of new Set([...previousRows, ...currentRows].map(item => item.groupKey).filter(Boolean))) { const result = await materialize(repositories, scope, key, updatedAt); sourceRowsRead += result.sourceRowsRead; rowsWritten += result.rowsWritten; }
  return { sourceRowsRead, rowsWritten, eventHistoryScans: 0 };
}

async function rebuildAggregate({ repositories, scope, updatedAt }) {
  const existing = await repositories.notificationProjections.list(); const preserved = new Map(existing.map(item => [item.id, item])); for (const item of existing) await repositories.notificationProjections.delete(item.id);
  const rows = await repositories.projections.listByIndex('by_scope_projector', [scope.storyId, scope.branchId, NOTIFICATION_PROJECTOR_ID]); let sourceRowsRead = 0; let rowsWritten = 0;
  for (const key of new Set(rows.map(item => item.groupKey).filter(Boolean))) { const result = await materialize(repositories, scope, key, updatedAt, preserved); sourceRowsRead += result.sourceRowsRead; rowsWritten += result.rowsWritten; }
  return { sourceRowsRead, rowsWritten };
}

export function createNotificationProjector() {
  return defineProjector({ id: NOTIFICATION_PROJECTOR_ID, version: 1, stores: ['notificationProjections', 'accounts', 'instances', 'devices', 'phoneStates', 'threads', 'messages', 'callSessions', 'socialPosts', 'socialComments', 'liveSessions', 'liveMessages'], project, applyAggregate, rebuildAggregate });
}
