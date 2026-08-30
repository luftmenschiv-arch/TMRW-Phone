import { requireText } from '../identity/identity-record.mjs';

export function normalizeVoicemail(input) {
  const text = requireText(input?.text, 'voicemail.text');
  if (text.length > 8000) throw new TypeError('voicemail.text exceeds the bounded text limit');
  return Object.freeze({
    voicemailId: requireText(input?.voicemailId, 'voicemail.voicemailId'),
    callSessionId: requireText(input?.callSessionId, 'voicemail.callSessionId'),
    callerAccountId: requireText(input?.callerAccountId, 'voicemail.callerAccountId'),
    recipientAccountId: requireText(input?.recipientAccountId, 'voicemail.recipientAccountId'),
    actualAuthorActorId: requireText(input?.actualAuthorActorId, 'voicemail.actualAuthorActorId'),
    actualAuthorInstanceId: requireText(input?.actualAuthorInstanceId, 'voicemail.actualAuthorInstanceId'),
    deviceId: requireText(input?.deviceId, 'voicemail.deviceId'),
    text,
  });
}

export const voicemailHeadId = (scope, voicemailId) => `call-voicemail:${scope.storyId}:${scope.branchId}:${requireText(voicemailId, 'voicemailId')}`;
