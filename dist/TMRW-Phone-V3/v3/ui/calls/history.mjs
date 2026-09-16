const TERMINAL = new Set(['ended', 'declined', 'cancelled', 'missed']);
const terminalPresentation = (state, outgoing) => {
  if (state === 'ended') return Object.freeze({ statusCategory: 'ended', statusLabel: 'Ended' });
  if (state === 'cancelled' || (state === 'declined' && outgoing)) return Object.freeze({ statusCategory: 'cancelled', statusLabel: 'Cancelled' });
  if (state === 'missed' || state === 'declined') return Object.freeze({ statusCategory: 'missed', statusLabel: 'Missed' });
  return Object.freeze({ statusCategory: String(state || 'unknown'), statusLabel: ({ ringing: 'Ringing', active: 'Active' }[state] || String(state || 'Unknown')) });
};

function parseTimestamp(value) {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
}

function localDateKey(value) {
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-');
}

function datePresentation(value, now) {
  const started = parseTimestamp(value);
  if (!started) return Object.freeze({ dateGroupKey: 'unknown', dateGroupLabel: 'ไม่ทราบวันที่', timeLabel: '—' });
  const current = parseTimestamp(now) || new Date();
  const today = new Date(current.getFullYear(), current.getMonth(), current.getDate());
  const startedDay = new Date(started.getFullYear(), started.getMonth(), started.getDate());
  const dayDifference = Math.round((today.getTime() - startedDay.getTime()) / 86_400_000);
  const dateGroupLabel = dayDifference === 0
    ? 'วันนี้'
    : dayDifference === 1
      ? 'เมื่อวาน'
      : new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }).format(started);
  return Object.freeze({
    dateGroupKey: localDateKey(started),
    dateGroupLabel,
    timeLabel: `${String(started.getHours()).padStart(2, '0')}:${String(started.getMinutes()).padStart(2, '0')}`,
  });
}

export function formatCanonicalDuration(durationMs) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) return 'Story duration pending';
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return minutes + ':' + seconds;
}

export function callHistoryViewModel({ sessions = [], viewerAccountId, identities = new Map(), now = () => new Date() }) {
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
  const currentTime = typeof now === 'function' ? now() : now;
  return Object.freeze(base.map(row => {
    const startedAt = row.session.startedAt || row.session.updatedAt || null;
    const presentation = datePresentation(startedAt, currentTime);
    const terminal = terminalPresentation(row.session.state, row.outgoing);
    return Object.freeze({
    callSessionId: row.session.callSessionId,
    state: row.session.state,
    direction: row.outgoing ? 'outgoing' : 'incoming',
    counterpartAccountId: row.counterpartAccountId,
    counterpartActorId: row.identity.actorId || null,
    counterpartInstanceId: row.identity.instanceId || null,
    counterpartNumber: row.identity.number || null,
    displayLabel: duplicates.get(row.displayLabel).size > 1 ? row.displayLabel + ' · ' + row.counterpartAccountId.slice(-8) : row.displayLabel,
    displayName: row.identity.displayName || row.displayLabel,
    savedName: row.identity.savedName || null,
    aliases: Object.freeze([...(row.identity.aliases || [])]),
    statusCategory: terminal.statusCategory,
    statusLabel: terminal.statusLabel,
    terminal: TERMINAL.has(row.session.state),
    canonicalDurationMs: Number.isSafeInteger(row.session.durationEvidence?.durationMs) ? row.session.durationEvidence.durationMs : null,
    durationLabel: formatCanonicalDuration(row.session.durationEvidence?.durationMs),
    sourceEventId: row.session.sourceInitiatedEventId || null,
    startedAt,
    connectedAt: row.session.connectedAt || null,
    endedAt: row.session.endedAt || null,
    ...presentation,
  }); }));
}
