import { requireText } from '../identity/identity-record.mjs';
import { CALL_STATE } from './call-state-machine.mjs';

function ids(values, field) {
  const normalized = [...new Set((values || []).map(value => requireText(value, field)))].sort();
  if (normalized.length < 2) throw new TypeError(`${field} requires at least two stable identities`);
  return Object.freeze(normalized);
}

export function normalizeCallSession(input) {
  const participants = Object.freeze((input?.participants || []).map(item => Object.freeze({ accountId: requireText(item?.accountId, 'call.participant.accountId'), actorId: requireText(item?.actorId, 'call.participant.actorId'), instanceId: requireText(item?.instanceId, 'call.participant.instanceId') })).sort((left, right) => left.accountId.localeCompare(right.accountId)));
  if (participants.length < 2 || new Set(participants.map(item => item.accountId)).size !== participants.length) throw new TypeError('call.participants requires two or more distinct Account identities');
  const participantAccountIds = Object.freeze(participants.map(item => item.accountId));
  const participantActorIds = ids(participants.map(item => item.actorId), 'call.participantActorIds');
  const participantInstanceIds = ids(participants.map(item => item.instanceId), 'call.participantInstanceIds');
  const callingAccountId = requireText(input?.callingAccountId, 'call.callingAccountId'); const calledAccountId = requireText(input?.calledAccountId, 'call.calledAccountId');
  if (!participantAccountIds.includes(callingAccountId) || !participantAccountIds.includes(calledAccountId)) throw new TypeError('Call endpoints must be canonical participants');
  return Object.freeze({
    callSessionId: requireText(input?.callSessionId, 'call.callSessionId'),
    participants, participantAccountIds, participantActorIds, participantInstanceIds, callingAccountId, calledAccountId,
    initiatingActualActorId: requireText(input?.initiatingActualActorId, 'call.initiatingActualActorId'),
    initiatingActualInstanceId: requireText(input?.initiatingActualInstanceId, 'call.initiatingActualInstanceId'),
    initiatingDeviceId: requireText(input?.initiatingDeviceId, 'call.initiatingDeviceId'),
    state: CALL_STATE.RINGING,
    sourceMode: input?.sourceMode === 'historical-import' ? 'historical-import' : 'live',
    uiOwner: input?.uiOwner || 'tmrw-v3-text',
  });
}

export const callSessionHeadId = (scope, callSessionId) => `call-session:${scope.storyId}:${scope.branchId}:${requireText(callSessionId, 'callSessionId')}`;
export const callParticipantId = (scope, callSessionId, accountId) => `call-participant:${scope.storyId}:${scope.branchId}:${requireText(callSessionId, 'callSessionId')}:${requireText(accountId, 'accountId')}`;
