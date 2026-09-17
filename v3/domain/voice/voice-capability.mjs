export const VOICE_RUNTIME_STATUS = Object.freeze({ UNAVAILABLE: 'unavailable', AVAILABLE: 'available', ERROR: 'error' });

export function createPhase19VoiceCapabilityState() {
  return Object.freeze({
    contractVersion: 'tmrw-voice-capability-v1',
    runtimeStatus: VOICE_RUNTIME_STATUS.UNAVAILABLE,
    runtimeAvailable: false,
    configured: false,
    testVoiceEnabled: false,
    textCallsReady: true,
    supportedLanguages: Object.freeze(['en', 'ja']),
    unavailableReason: 'Voice runtime unavailable / not configured.',
    providerNeutral: true,
    modelLoaded: false,
    warmActive: false,
    phase: 19,
  });
}

export function createProductionVoiceV1CapabilityState() {
  return Object.freeze({
    contractVersion: 'tmrw-voice-capability-v1',
    runtimeStatus: VOICE_RUNTIME_STATUS.UNAVAILABLE,
    runtimeAvailable: false,
    configured: true,
    testVoiceEnabled: false,
    textCallsReady: true,
    supportedLanguages: Object.freeze(['en', 'ja']),
    unavailableReason: 'TMRW Local Voice is health-checked on each eligible Call turn. Text Call remains available if the local service is offline.',
    providerNeutral: true,
    modelLoaded: false,
    warmActive: false,
    milestone: 'post-release-voice-v1',
    phase: 19,
  });
}

export function decideVoicePresentation({ voiceCallsEnabled, runtimeCapability = createPhase19VoiceCapabilityState(), renderStatus = 'idle' } = {}) {
  if (!voiceCallsEnabled) return Object.freeze({ mode: 'text-immediate', reason: 'voice-disabled', holdText: false, playAudio: false });
  if (!runtimeCapability.runtimeAvailable || runtimeCapability.runtimeStatus !== VOICE_RUNTIME_STATUS.AVAILABLE) return Object.freeze({ mode: 'text-immediate', reason: 'runtime-unavailable-fallback', holdText: false, playAudio: false });
  if (renderStatus === 'failed' || renderStatus === 'unavailable') return Object.freeze({ mode: 'text-immediate', reason: 'voice-render-fallback', holdText: false, playAudio: false });
  if (renderStatus === 'ready') return Object.freeze({ mode: 'text-and-audio', reason: 'voice-ready', holdText: false, playAudio: true });
  return Object.freeze({ mode: 'future-voice-pending', reason: 'adapter-owned-pending', holdText: true, playAudio: false });
}
