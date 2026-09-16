import { requireText } from '../identity/identity-record.mjs';

export const VOICE_AUDIO_RETENTION = Object.freeze({ TEMPORARY: 'temporary', KEPT: 'kept' });
const RETENTION = new Set(Object.values(VOICE_AUDIO_RETENTION));
const LANGUAGES = new Set(['en', 'ja']);

export function normalizeVoiceAudioArtifact(input) {
  const retention = requireText(input?.retention || VOICE_AUDIO_RETENTION.TEMPORARY, 'voice audio retention').toLowerCase();
  if (!RETENTION.has(retention)) throw new TypeError(`Unsupported voice audio retention: ${retention}`);
  const language = requireText(input?.language, 'voice audio language').toLowerCase();
  if (!LANGUAGES.has(language)) throw new TypeError(`Unsupported voice audio language: ${language}`);
  const durationMs = Number(input?.durationMs || 0);
  if (!Number.isFinite(durationMs) || durationMs < 0) throw new TypeError('voice audio durationMs must be non-negative');
  const segmentIndex = Number(input?.segmentIndex || 0);
  if (!Number.isSafeInteger(segmentIndex) || segmentIndex < 0) throw new TypeError('voice audio segmentIndex must be a non-negative integer');
  const audioBlob = input?.audioBlob || null;
  const byteLength = Number(audioBlob?.size ?? input?.byteLength ?? 0);
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) throw new TypeError('voice audio byteLength must be a non-negative integer');
  return Object.freeze({
    id: requireText(input?.id, 'voice audio artifact id'),
    storyId: requireText(input?.storyId, 'voice audio storyId'),
    branchId: requireText(input?.branchId, 'voice audio branchId'),
    callSessionId: requireText(input?.callSessionId, 'voice audio callSessionId'),
    transcriptEntryId: input?.transcriptEntryId == null ? null : requireText(input.transcriptEntryId, 'voice audio transcriptEntryId'),
    actorId: requireText(input?.actorId, 'voice audio actorId'),
    instanceId: requireText(input?.instanceId, 'voice audio instanceId'),
    language,
    artifactRef: requireText(input?.artifactRef, 'voice audio artifactRef'),
    audioBlob,
    mimeType: input?.mimeType == null ? (audioBlob?.type || 'audio/wav') : requireText(input.mimeType, 'voice audio mimeType'),
    byteLength,
    segmentIndex,
    subtitleThai: input?.subtitleThai == null ? null : requireText(input.subtitleThai, 'voice audio subtitleThai'),
    spokenText: input?.spokenText == null ? null : requireText(input.spokenText, 'voice audio spokenText'),
    filename: input?.filename == null ? null : requireText(input.filename, 'voice audio filename'),
    recoverable: Boolean(audioBlob && byteLength > 0),
    durationMs,
    retention,
    createdAt: requireText(input?.createdAt, 'voice audio createdAt'),
    updatedAt: requireText(input?.updatedAt, 'voice audio updatedAt'),
    sourceKind: requireText(input?.sourceKind || 'future-voice-adapter', 'voice audio sourceKind'),
    derivedFromCanonicalText: true,
    galleryExported: false,
    filesExported: false,
    phase: 19,
  });
}
