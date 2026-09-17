import { PHONE_ACCESS_MODE } from '../domain/phone/player-access-policy.mjs';

export const PHONE_NUMBER_DISCOVERY = Object.freeze({ SMART: 'smart', ON: 'on', OFF: 'off' });
export const EXPERIENCE_PRESET = Object.freeze({ SIMPLE: 'simple', STORY: 'story', IMMERSIVE: 'immersive', CUSTOM: 'custom' });
const presets = Object.freeze({
  [EXPERIENCE_PRESET.SIMPLE]: { phoneNumberDiscovery: PHONE_NUMBER_DISCOVERY.ON, phoneAccessMode: PHONE_ACCESS_MODE.FREE_ACCESS },
  [EXPERIENCE_PRESET.STORY]: { phoneNumberDiscovery: PHONE_NUMBER_DISCOVERY.SMART, phoneAccessMode: PHONE_ACCESS_MODE.ASSISTED },
  [EXPERIENCE_PRESET.IMMERSIVE]: { phoneNumberDiscovery: PHONE_NUMBER_DISCOVERY.ON, phoneAccessMode: PHONE_ACCESS_MODE.IMMERSIVE },
});

export function resolveExperiencePreset(preset, custom = {}) {
  if (preset === EXPERIENCE_PRESET.CUSTOM) return Object.freeze({ preset, phoneNumberDiscovery: custom.phoneNumberDiscovery || PHONE_NUMBER_DISCOVERY.SMART, phoneAccessMode: custom.phoneAccessMode || PHONE_ACCESS_MODE.ASSISTED });
  if (!presets[preset]) throw new TypeError(`Unknown Experience Preset: ${preset}`);
  return Object.freeze({ preset, ...presets[preset] });
}
