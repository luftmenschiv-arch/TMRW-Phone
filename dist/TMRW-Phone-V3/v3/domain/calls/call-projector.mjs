import { defineProjector } from '../projections/projection-runner.mjs';
import { CALL_EVENT_TYPES, normalizeCallInitiatedPayload, normalizeCallTranscriptPayload, normalizeCallTransitionPayload, normalizeVoicemailPayload } from './call-event-types.mjs';
import { callParticipantId, callSessionHeadId } from './call-session.mjs';
import { callTranscriptHeadId } from './call-transcript.mjs';
import { voicemailHeadId } from './voicemail.mjs';

export const CALL_PROJECTOR_ID = 'tmrw-calls-v1';
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;

function rowsForEvent(event) {
  if (event.eventType === CALL_EVENT_TYPES.SESSION_INITIATED) {
    const { session } = normalizeCallInitiatedPayload(event.payload);
    return [
      { kind: 'call-session-source', projectionKey: `session:${session.callSessionId}`, groupKey: `session:${session.callSessionId}`, data: { operation: 'initiate', session } },
      ...session.participants.map(member => ({ kind: 'call-participant-source', projectionKey: `participant:${session.callSessionId}:${member.accountId}`, groupKey: `participant:${session.callSessionId}:${member.accountId}`, data: { session, ...member } })),
    ];
  }
  if (event.eventType === CALL_EVENT_TYPES.SESSION_TRANSITIONED) {
    const transition = normalizeCallTransitionPayload(event.payload);
    return [{ kind: 'call-session-transition-source', projectionKey: `transition:${transition.callSessionId}:${event.id}`, groupKey: `session:${transition.callSessionId}`, data: { operation: 'transition', transition } }];
  }
  if (event.eventType === CALL_EVENT_TYPES.TRANSCRIPT_ADDED) {
    const { transcript, recipientAccountIds } = normalizeCallTranscriptPayload(event.payload);
    return [
      { kind: 'call-transcript-source', projectionKey: `transcript:${transcript.transcriptEntryId}`, groupKey: `transcript:${transcript.transcriptEntryId}`, data: { transcript } },
      ...recipientAccountIds.map(recipientAccountId => ({ kind: 'call-transcript-recipient-source', projectionKey: `recipient:${transcript.transcriptEntryId}:${recipientAccountId}`, groupKey: `recipient:${transcript.transcriptEntryId}:${recipientAccountId}`, data: { transcript, recipientAccountId } })),
    ];
  }
  if (event.eventType === CALL_EVENT_TYPES.VOICEMAIL_LEFT) { const { voicemail } = normalizeVoicemailPayload(event.payload); return [{ kind: 'call-voicemail-source', projectionKey: `voicemail:${voicemail.voicemailId}`, groupKey: `voicemail:${voicemail.voicemailId}`, data: { voicemail } }]; }
  return [];
}

async function groupRows(repositories, scope, groupKey) { return repositories.projections.listByIndexRange('by_scope_projector_group_sequence', { lower: [scope.storyId, scope.branchId, CALL_PROJECTOR_ID, groupKey, 0], upper: [scope.storyId, scope.branchId, CALL_PROJECTOR_ID, groupKey, MAX_SEQUENCE] }); }
function sorted(rows) { return [...rows].sort((left, right) => left.sourceEventSequence - right.sourceEventSequence || left.id.localeCompare(right.id)); }

async function materializeSession(repositories, scope, callSessionId, rows, updatedAt) {
  let current = null;
  for (const row of sorted(rows)) {
    if (row.data.operation === 'initiate') current = { ...row.data.session, startedAt: row.updatedAt, connectedAt: null, endedAt: null, sourceInitiatedEventId: row.sourceEventId, sourceInitiatedSequence: row.sourceEventSequence, lastLifecycleEventId: row.sourceEventId, lastLifecycleSequence: row.sourceEventSequence, durationEvidence: null, durationSourceEventId: null, revision: 1 };
    else if (row.data.operation === 'transition' && current) {
      const transition = row.data.transition;
      const connectedAt = transition.action === 'accept' ? (current.connectedAt || row.updatedAt) : current.connectedAt;
      const endedAt = ['ended', 'declined', 'cancelled', 'missed'].includes(transition.state) ? row.updatedAt : current.endedAt;
      current = { ...current, state: transition.state, connectedAt, endedAt, lastLifecycleEventId: row.sourceEventId, lastLifecycleSequence: row.sourceEventSequence, lastActualActorId: transition.actualActorId, lastActualInstanceId: transition.actualInstanceId, lastDeviceId: transition.deviceId, durationEvidence: transition.storyClockAdvance || current.durationEvidence, durationSourceEventId: transition.storyClockAdvance ? row.sourceEventId : current.durationSourceEventId, revision: current.revision + 1 };
    }
  }
  const id = callSessionHeadId(scope, callSessionId);
  if (!current) { await repositories.callSessions.delete(id); return { rowsWritten: 0 }; }
  await repositories.callSessions.put(Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, ...current, sourceEventSequence: current.lastLifecycleSequence, reverseSequence: MAX_SEQUENCE - current.sourceInitiatedSequence, updatedAt, phase: 9 }));
  return { rowsWritten: 1 };
}

async function materializeParticipant(repositories, scope, groupKey, rows, updatedAt) {
  const row = sorted(rows).at(-1); const data = row?.data || rows[0]?.data; if (!data) return { rowsWritten: 0 };
  const id = callParticipantId(scope, data.session.callSessionId, data.accountId);
  if (!row) { await repositories.callParticipants.delete(id); return { rowsWritten: 0 }; }
  await repositories.callParticipants.put(Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, callSessionId: data.session.callSessionId, accountId: data.accountId, actorId: data.actorId, instanceId: data.instanceId, sourceEventId: row.sourceEventId, sourceEventSequence: row.sourceEventSequence, updatedAt, phase: 9 }));
  return { rowsWritten: 1 };
}

async function materializeTranscript(repositories, scope, transcriptEntryId, rows, updatedAt) {
  const row = sorted(rows).at(-1); const id = callTranscriptHeadId(scope, transcriptEntryId);
  if (!row) { await repositories.callTranscripts.delete(id); return { rowsWritten: 0 }; }
  await repositories.callTranscripts.put(Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, ...row.data.transcript, sourceEventId: row.sourceEventId, sourceEventRevision: row.sourceEventRevision, sourceEventSequence: row.sourceEventSequence, reverseSequence: MAX_SEQUENCE - row.sourceEventSequence, updatedAt, phase: 9 }));
  return { rowsWritten: 1 };
}

async function materializeRecipient(repositories, scope, rows, updatedAt) {
  const row = sorted(rows).at(-1); const data = row?.data || rows[0]?.data; if (!data) return { rowsWritten: 0 };
  const id = `call-transcript-recipient:${scope.storyId}:${scope.branchId}:${data.transcript.transcriptEntryId}:${data.recipientAccountId}`;
  if (!row) { await repositories.callTranscriptRecipients.delete(id); return { rowsWritten: 0 }; }
  await repositories.callTranscriptRecipients.put(Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, transcriptEntryId: data.transcript.transcriptEntryId, callSessionId: data.transcript.callSessionId, recipientAccountId: data.recipientAccountId, sourceEventId: row.sourceEventId, sourceEventSequence: row.sourceEventSequence, reverseSequence: MAX_SEQUENCE - row.sourceEventSequence, updatedAt, phase: 9 }));
  return { rowsWritten: 1 };
}
async function materializeVoicemail(repositories, scope, voicemailId, rows, updatedAt) { const row = sorted(rows).at(-1); const id = voicemailHeadId(scope, voicemailId); if (!row) { await repositories.callVoicemails.delete(id); return { rowsWritten: 0 }; } const voicemail = row.data.voicemail; await repositories.callVoicemails.put(Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, ...voicemail, sourceEventId: row.sourceEventId, sourceEventRevision: row.sourceEventRevision, sourceEventSequence: row.sourceEventSequence, reverseSequence: MAX_SEQUENCE - row.sourceEventSequence, updatedAt, phase: 13 })); return { rowsWritten: 1 }; }

async function materializeGroup(repositories, scope, groupKey, updatedAt) {
  const rows = await groupRows(repositories, scope, groupKey);
  if (groupKey.startsWith('session:')) return { sourceRowsRead: rows.length, ...(await materializeSession(repositories, scope, groupKey.slice(8), rows, updatedAt)) };
  if (groupKey.startsWith('participant:')) return { sourceRowsRead: rows.length, ...(await materializeParticipant(repositories, scope, groupKey, rows, updatedAt)) };
  if (groupKey.startsWith('transcript:')) return { sourceRowsRead: rows.length, ...(await materializeTranscript(repositories, scope, groupKey.slice(11), rows, updatedAt)) };
  if (groupKey.startsWith('recipient:')) return { sourceRowsRead: rows.length, ...(await materializeRecipient(repositories, scope, rows, updatedAt)) };
  if (groupKey.startsWith('voicemail:')) return { sourceRowsRead: rows.length, ...(await materializeVoicemail(repositories, scope, groupKey.slice(10), rows, updatedAt)) };
  return { sourceRowsRead: 0, rowsWritten: 0 };
}

async function applyAggregate({ repositories, scope, previousRows, currentRows, updatedAt }) {
  let sourceRowsRead = 0; let rowsWritten = 0;
  for (const groupKey of new Set([...previousRows, ...currentRows].map(row => row.groupKey).filter(Boolean))) {
    const present = await groupRows(repositories, scope, groupKey);
    if (present.length === 0 && groupKey.startsWith('participant:')) { const data = previousRows.find(row => row.groupKey === groupKey)?.data; if (data) await repositories.callParticipants.delete(callParticipantId(scope, data.session.callSessionId, data.accountId)); }
    if (present.length === 0 && groupKey.startsWith('recipient:')) { const data = previousRows.find(row => row.groupKey === groupKey)?.data; if (data) await repositories.callTranscriptRecipients.delete(`call-transcript-recipient:${scope.storyId}:${scope.branchId}:${data.transcript.transcriptEntryId}:${data.recipientAccountId}`); }
    const result = await materializeGroup(repositories, scope, groupKey, updatedAt); sourceRowsRead += result.sourceRowsRead; rowsWritten += result.rowsWritten;
  }
  return { sourceRowsRead, rowsWritten, eventHistoryScans: 0 };
}

async function rebuildAggregate({ repositories, scope, updatedAt }) {
  for (const storeName of ['callSessions', 'callParticipants', 'callTranscripts', 'callTranscriptRecipients', 'callVoicemails']) for (const row of await repositories[storeName].list()) await repositories[storeName].delete(row.id);
  const rows = await repositories.projections.listByIndex('by_scope_projector', [scope.storyId, scope.branchId, CALL_PROJECTOR_ID]); let sourceRowsRead = 0; let rowsWritten = 0;
  for (const key of new Set(rows.map(row => row.groupKey).filter(Boolean))) { const result = await materializeGroup(repositories, scope, key, updatedAt); sourceRowsRead += result.sourceRowsRead; rowsWritten += result.rowsWritten; }
  return { sourceRowsRead, rowsWritten };
}

export function createCallHistoryProjector() { return defineProjector({ id: CALL_PROJECTOR_ID, version: 2, stores: ['callSessions', 'callParticipants', 'callTranscripts', 'callTranscriptRecipients', 'callVoicemails'], project: rowsForEvent, applyAggregate, rebuildAggregate }); }
