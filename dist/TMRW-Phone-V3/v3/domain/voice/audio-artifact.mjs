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
