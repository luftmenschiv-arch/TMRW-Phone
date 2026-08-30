const TERMINAL = new Set(['ended', 'declined', 'cancelled', 'missed']);
const stateLabel = state => ({ ringing: 'Ringing', active: 'Active', ended: 'Ended', declined: 'Declined', cancelled: 'Cancelled', missed: 'Missed' }[state] || String(state || 'Unknown'));

export function formatCanonicalDuration(durationMs) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) return 'Story duration pending';
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return minutes + ':' + seconds;
}

export function callHistoryViewModel({ sessions = [], viewerAccountId, identities = new Map() }) {
  const base = sessions.map(session => {
    const outgoing = session.callingAccountId === viewerAccountId;
    const counterpartAccountId = outgoing ? session.calledAccountId : session.callingAccountId;
    const identity = identities.get(counterpartAccountId) || {};
    const displayLabel = identity.savedName || identity.displayName || 'Unknown caller';
    return { session, outgoing, counterpartAccountId, identity, displayLabel };
  });
  const duplicates = new Map();
  for (const row of base) {
    if (!duplicates.has(row.displayLabel)) duplicates.set(row.displayLabel, new Set());
    duplicates.get(row.displayLabel).add(row.counterpartAccountId);
  }
  return Object.freeze(base.map(row => Object.freeze({
    callSessionId: row.session.callSessionId,
    state: row.session.state,
    direction: row.outgoing ? 'outgoing' : 'incoming',
    counterpartAccountId: row.counterpartAccountId,
    displayLabel: duplicates.get(row.displayLabel).size > 1 ? row.displayLabel + ' · ' + row.counterpartAccountId.slice(-8) : row.displayLabel,
    displayName: row.identity.displayName || row.displayLabel,
    savedName: row.identity.savedName || null,
    aliases: Object.freeze([...(row.identity.aliases || [])]),
    statusLabel: stateLabel(row.session.state),
    terminal: TERMINAL.has(row.session.state),
    canonicalDurationMs: Number.isSafeInteger(row.session.durationEvidence?.durationMs) ? row.session.durationEvidence.durationMs : null,
    durationLabel: formatCanonicalDuration(row.session.durationEvidence?.durationMs),
    sourceEventId: row.session.sourceInitiatedEventId || null,
  })));
}
