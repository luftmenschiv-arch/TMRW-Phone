import { requireText } from '../identity/identity-record.mjs';

export function normalizeCallTranscriptEntry(input) {
  const text = requireText(input?.text, 'callTranscript.text'); if (text.length > 8000) throw new TypeError('callTranscript.text exceeds bounded limit');
  return Object.freeze({
    transcriptEntryId: requireText(input?.transcriptEntryId, 'callTranscript.transcriptEntryId'), callSessionId: requireText(input?.callSessionId, 'callTranscript.callSessionId'),
    speakerAccountId: requireText(input?.speakerAccountId, 'callTranscript.speakerAccountId'), actualAuthorActorId: requireText(input?.actualAuthorActorId, 'callTranscript.actualAuthorActorId'), actualAuthorInstanceId: requireText(input?.actualAuthorInstanceId, 'callTranscript.actualAuthorInstanceId'), deviceId: requireText(input?.deviceId, 'callTranscript.deviceId'), text,
    sourceMode: input?.sourceMode === 'historical-import' ? 'historical-import' : 'live',
  });
}

export const callTranscriptHeadId = (scope, transcriptEntryId) => `call-transcript:${scope.storyId}:${scope.branchId}:${requireText(transcriptEntryId, 'transcriptEntryId')}`;
