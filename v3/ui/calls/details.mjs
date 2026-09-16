const TERMINAL = new Set(['ended', 'declined', 'cancelled', 'missed']);

const directionLabel = direction => direction === 'outgoing' ? 'สายโทรออก' : 'สายเรียกเข้า';
const languageLabel = language => language === 'ja' ? 'Japanese' : language === 'en' ? 'English' : null;

export function callDetailsViewModel({ session, historyItem, transcript = [], audioArtifacts = [], viewerAccountId, callbackTarget = null }) {
  if (!session || !TERMINAL.has(session.state) || !historyItem) return null;
  const artifactsByTranscript = new Map();
  for (const artifact of audioArtifacts) {
    if (!artifact?.transcriptEntryId) continue;
    if (!artifactsByTranscript.has(artifact.transcriptEntryId)) artifactsByTranscript.set(artifact.transcriptEntryId, []);
    artifactsByTranscript.get(artifact.transcriptEntryId).push(artifact);
  }
  const entries = transcript.map((entry, turnIndex) => {
    const audioSegments = (artifactsByTranscript.get(entry.transcriptEntryId) || []).slice().sort((left, right) => Number(left.segmentIndex || 0) - Number(right.segmentIndex || 0));
    const fromPlayer = entry.speakerAccountId === viewerAccountId;
    return Object.freeze({
      transcriptEntryId: entry.transcriptEntryId,
      turnIndex,
      speakerAccountId: entry.speakerAccountId,
      speakerKind: fromPlayer ? 'player' : 'character',
      speakerLabel: fromPlayer ? 'คุณ' : historyItem.displayLabel,
      text: entry.text,
      audioSegments: Object.freeze(audioSegments.map(artifact => Object.freeze({
        artifactId: artifact.id,
        language: artifact.language,
        languageLabel: languageLabel(artifact.language),
        subtitleThai: artifact.subtitleThai || entry.text,
        spokenText: artifact.spokenText || null,
        segmentIndex: Number(artifact.segmentIndex || 0),
        durationMs: Number(artifact.durationMs || 0),
        retention: artifact.retention || 'temporary',
      }))),
    });
  });
  const languages = [...new Set(audioArtifacts.map(artifact => languageLabel(artifact.language)).filter(Boolean))];
  return Object.freeze({
    callSessionId: session.callSessionId,
    counterpartAccountId: historyItem.counterpartAccountId,
    counterpartLabel: historyItem.displayLabel,
    direction: historyItem.direction,
    directionLabel: directionLabel(historyItem.direction),
    state: historyItem.state,
    statusLabel: historyItem.statusLabel,
    dateLabel: historyItem.dateGroupLabel,
    timeLabel: historyItem.timeLabel,
    durationLabel: historyItem.durationLabel,
    startedAt: historyItem.startedAt,
    endedAt: historyItem.endedAt,
    languages: Object.freeze(languages),
    languageSummary: languages.length ? languages.join(' + ') : 'ยังไม่มีเสียงที่บันทึกไว้',
    transcript: Object.freeze(entries),
    callbackTarget: callbackTarget ? Object.freeze({ ...callbackTarget }) : null,
  });
}
