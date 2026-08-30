import { formatCanonicalDuration } from './history.mjs';

export function endedCallViewModel({ session, historyItem }) {
  if (!session || !['ended', 'declined', 'cancelled', 'missed'].includes(session.state)) return null;
  return Object.freeze({
    kind: 'ended',
    title: session.state === 'missed' ? 'Missed call' : session.state === 'declined' ? 'Call declined' : session.state === 'cancelled' ? 'Call cancelled' : 'Call ended',
    callSessionId: session.callSessionId,
    counterpartAccountId: historyItem?.counterpartAccountId || null,
    counterpartLabel: historyItem?.displayLabel || 'Call participant',
    state: session.state,
    canonicalDurationMs: Number.isSafeInteger(session.durationEvidence?.durationMs) ? session.durationEvidence.durationMs : null,
    durationLabel: formatCanonicalDuration(session.durationEvidence?.durationMs),
    actions: Object.freeze([]),
  });
}
