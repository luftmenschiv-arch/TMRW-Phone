import { requireText } from '../identity/identity-record.mjs';
import { playerAccessOverrideDecision } from '../knowledge/audience-policy.mjs';

export const PHONE_ACCESS_MODE = Object.freeze({ IMMERSIVE: 'immersive', ASSISTED: 'assisted', FREE_ACCESS: 'free-access' });
export const EXPERIENCE_PRESET = Object.freeze({ SIMPLE: 'simple', STORY: 'story', IMMERSIVE: 'immersive', CUSTOM: 'custom' });
const modes = new Set(Object.values(PHONE_ACCESS_MODE));

export function normalizePhoneAccessSettings(input = {}) {
  const preset = input.preset || EXPERIENCE_PRESET.STORY;
  // SettingsService persists this value as `phoneAccessMode`. Keep accepting the
  // older `mode` spelling for callers that construct the policy input directly.
  const mode = input.phoneAccessMode || input.mode || (preset === EXPERIENCE_PRESET.IMMERSIVE ? PHONE_ACCESS_MODE.IMMERSIVE : PHONE_ACCESS_MODE.ASSISTED);
  if (!modes.has(mode)) throw new TypeError(`Unsupported Phone Access Mode: ${mode}`);
  return Object.freeze({ preset, mode });
}

export function resolvePlayerAccess({ settings, canonicalAllowed, override = null, action = 'inspect' }) {
  const normalized = normalizePhoneAccessSettings(settings);
  const canonical = Boolean(canonicalAllowed);
  const overrideDecision = playerAccessOverrideDecision({ enabled: Boolean(override?.enabled), action: requireText(action, 'phone action') });
  if (canonical) return Object.freeze({ granted: true, basis: 'canonical-access', needsChoice: false, overrideDecision });
  if (overrideDecision.playerMayInspect || normalized.mode === PHONE_ACCESS_MODE.FREE_ACCESS) return Object.freeze({ granted: true, basis: overrideDecision.playerMayInspect ? 'player-only-override' : 'free-access-player-permission', needsChoice: false, overrideDecision });
  if (normalized.mode === PHONE_ACCESS_MODE.ASSISTED) return Object.freeze({ granted: false, basis: 'assisted-choice-required', needsChoice: true, choices: Object.freeze(['discover-naturally', 'unlock-for-me']), overrideDecision });
  return Object.freeze({ granted: false, basis: 'canonical-access-required', needsChoice: true, choices: Object.freeze(['discover-naturally', 'override-this-action']), overrideDecision });
}
