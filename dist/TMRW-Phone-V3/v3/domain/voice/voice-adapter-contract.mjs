import { requireText } from '../identity/identity-record.mjs';
import { normalizeVoiceLanguage } from './voice-profile.mjs';

export const VOICE_ADAPTER_CONTRACT_VERSION = 'tmrw-voice-adapter-v1';
export const VOICE_RENDER_STATUS = Object.freeze({ READY: 'ready', FAILED: 'failed', UNAVAILABLE: 'unavailable', CANCELLED: 'cancelled' });
const RESULT_STATUSES = new Set(Object.values(VOICE_RENDER_STATUS));

export function normalizeVoiceRenderRequest(input) {
  if (!input?.resolvedProfile?.providerNeutral) throw new TypeError('Voice render request requires a provider-neutral resolved Voice Profile');
  return Object.freeze({
    contractVersion: VOICE_ADAPTER_CONTRACT_VERSION,
    actorId: requireText(input.actorId, 'voice request actorId'),
    instanceId: requireText(input.instanceId, 'voice request instanceId'),
    callSessionId: requireText(input.callSessionId, 'voice request callSessionId'),
    canonicalText: requireText(input.canonicalText, 'voice request canonicalText'),
    subtitleText: input.subtitleText == null ? requireText(input.canonicalText, 'voice request canonicalText') : requireText(input.subtitleText, 'voice request subtitleText'),
    language: normalizeVoiceLanguage(input.language),
    resolvedProfile: structuredClone(input.resolvedProfile),
    delivery: Object.freeze({ ...(input.delivery || {}) }),
  });
}

export function normalizeVoiceRenderResult(input) {
  const status = requireText(input?.status, 'voice result status').toLowerCase();
  if (!RESULT_STATUSES.has(status)) throw new TypeError(`Unsupported Voice render result status: ${status}`);
  const durationMs = input?.durationMs == null ? null : Number(input.durationMs);
  if (durationMs != null && (!Number.isFinite(durationMs) || durationMs < 0)) throw new TypeError('voice result durationMs must be non-negative');
  return Object.freeze({
    contractVersion: VOICE_ADAPTER_CONTRACT_VERSION,
    status,
    audioArtifactRef: input?.audioArtifactRef == null ? null : requireText(input.audioArtifactRef, 'voice result audioArtifactRef'),
    audioBlob: input?.audioBlob || null,
    mimeType: input?.mimeType == null ? null : requireText(input.mimeType, 'voice result mimeType'),
    durationMs,
    capabilityState: input?.capabilityState ? Object.freeze({ ...input.capabilityState }) : null,
    errorCode: input?.errorCode == null ? null : requireText(input.errorCode, 'voice result errorCode'),
    derivedOnly: true,
    mutatesCanonicalText: false,
  });
}
