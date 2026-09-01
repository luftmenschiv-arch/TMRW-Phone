import { formatCanonicalDuration } from './history.mjs';

export function activeCallViewModel({ session, historyItem, transcript = [], canAct }) {
  if (!session || session.state !== 'active') return null;
  return Object.freeze({
    kind: 'active',
    title: 'Active call',
    callSessionId: session.callSessionId,
    counterpartAccountId: historyItem?.counterpartAccountId || null,
    counterpartLabel: historyItem?.displayLabel || 'Call participant',
    state: session.state,
    transcript: Object.freeze(transcript.slice(-100).map(entry => Object.freeze({ transcriptEntryId: entry.transcriptEntryId, speakerAccountId: entry.speakerAccountId, text: entry.text }))),
    canonicalDurationMs: Number.isSafeInteger(session.durationEvidence?.durationMs) ? session.durationEvidence.durationMs : null,
    durationLabel: Number.isSafeInteger(session.durationEvidence?.durationMs) ? formatCanonicalDuration(session.durationEvidence.durationMs) : 'เชื่อมต่ออยู่',
    actions: Object.freeze([Object.freeze({ id: 'end', label: 'End call', enabled: Boolean(canAct) })]),
  });
}
