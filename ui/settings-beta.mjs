import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';
import { requireText } from '../domain/identity/identity-record.mjs';
import { EXPERIENCE_PRESET, PHONE_NUMBER_DISCOVERY, resolveExperiencePreset } from './experience-presets.mjs';
import { normalizeVoiceDelivery, normalizeVoiceLanguage, VOICE_DEFAULT_DELIVERY, VOICE_LANGUAGE } from '../domain/voice/voice-profile.mjs';
import { normalizePhoneTheme } from './themes.mjs';

const preferenceId = (scope, playerInstanceId) => `phone-ui-preferences:${scope.storyId}:${scope.branchId}:${playerInstanceId}`;
const normalizeBotSavedNames = value => Object.freeze(Object.fromEntries(Object.entries(value && typeof value === 'object' && !Array.isArray(value) ? value : {}).filter(([id, name]) => id && typeof name === 'string').slice(0, 100).map(([id, name]) => [id, name.replace(/\s+/gu, ' ').trim().slice(0, 60)]).filter(([, name]) => name)));
export const GLOBAL_VOICE_SETTINGS_KEY = 'tmrw-phone:global-voice-settings:v1';
export const GLOBAL_IMAGE_SETTINGS_KEY = 'tmrw-phone:global-image-settings:v1';
export const DEFAULT_VOICE_RUNTIME_BASE_URL = 'http://127.0.0.1:18769';
const GLOBAL_VOICE_FIELDS = Object.freeze(['voiceCallsEnabled', 'botCallsWithVoice', 'voiceLanguagePreference', 'voiceDefaultDelivery', 'voiceRuntimeBaseUrl', 'voiceCaptionsEnabled', 'voiceSetupInitialized']);
export const PLAYABLE_BOOTSTRAP_STATUS = Object.freeze({ IDLE: 'idle', RUNNING: 'running', QUICK_READY: 'quick-ready', READY: 'ready', FAILED: 'failed' });

function normalizeStringList(values, { limit = 12, itemLength = 240 } = {}) {
  return Object.freeze((Array.isArray(values) ? values : []).map(value => String(value || '').replace(/\s+/gu, ' ').trim()).filter(Boolean).slice(0, limit).map(value => value.slice(0, itemLength)));
}

export function normalizeWorldSocialBible(input = {}) {
  if (!input || typeof input !== 'object') input = {};
  return Object.freeze({
    version: 1,
    sourceFingerprint: input.sourceFingerprint ? String(input.sourceFingerprint).slice(0, 80) : null,
    worldSummary: String(input.worldSummary || '').trim().slice(0, 1600),
    socialOrder: String(input.socialOrder || '').trim().slice(0, 1200),
    economyAndLaw: String(input.economyAndLaw || '').trim().slice(0, 1200),
    technologyAndMedia: String(input.technologyAndMedia || '').trim().slice(0, 1000),
    languageStyle: String(input.languageStyle || '').trim().slice(0, 800),
    publicNorms: normalizeStringList(input.publicNorms),
    institutions: normalizeStringList(input.institutions),
    tensions: normalizeStringList(input.tensions),
    currentPublicEvents: normalizeStringList(input.currentPublicEvents, { limit: 16, itemLength: 360 }),
    updatedAt: input.updatedAt ? String(input.updatedAt).slice(0, 80) : null,
  });
}

function normalizePlayableBootstrap(input = {}) {
  const status = Object.values(PLAYABLE_BOOTSTRAP_STATUS).includes(input?.status) ? input.status : PLAYABLE_BOOTSTRAP_STATUS.IDLE;
  return Object.freeze({
    version: 1,
    status,
    stage: String(input?.stage || (status === PLAYABLE_BOOTSTRAP_STATUS.IDLE ? 'not-started' : status)).slice(0, 80),
    runId: input?.runId ? String(input.runId).slice(0, 160) : null,
    processedOrdinal: Math.max(0, Math.trunc(Number(input?.processedOrdinal) || 0)),
    totalMessages: Math.max(0, Math.trunc(Number(input?.totalMessages) || 0)),
    headFingerprint: input?.headFingerprint ? String(input.headFingerprint).slice(0, 80) : null,
    castFingerprint: input?.castFingerprint ? String(input.castFingerprint).slice(0, 80) : null,
    castCount: Math.max(0, Math.trunc(Number(input?.castCount) || 0)),
    candidateCount: Math.max(0, Math.trunc(Number(input?.candidateCount) || 0)),
    selectionConfirmed: input?.selectionConfirmed === true,
    selectedSourceActorIds: normalizeStringList(input?.selectedSourceActorIds, { limit: 32, itemLength: 200 }),
    lastError: input?.lastError ? String(input.lastError).slice(0, 500) : null,
    completedAt: input?.completedAt ? String(input.completedAt).slice(0, 80) : null,
  });
}

export function normalizeVoiceRuntimeBaseUrl(value = DEFAULT_VOICE_RUNTIME_BASE_URL) {
  let parsed;
  try { parsed = new URL(String(value || DEFAULT_VOICE_RUNTIME_BASE_URL).trim()); }
  catch { throw new TypeError('Voice Runtime URL must be a valid http:// or https:// address'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) throw new TypeError('Voice Runtime URL must be an origin only, without credentials, path, query, or fragment');
  return parsed.origin;
}
function voiceDefaults() {
  return Object.freeze({
    voiceCallsEnabled: false,
    botCallsWithVoice: false,
    voiceLanguagePreference: VOICE_LANGUAGE.AUTO,
    voiceDefaultDelivery: VOICE_DEFAULT_DELIVERY.NATURAL,
    voiceRuntimeBaseUrl: DEFAULT_VOICE_RUNTIME_BASE_URL,
    voiceCaptionsEnabled: true,
    voiceSetupInitialized: false,
  });
}

function normalizeImageApiKey(value) { return String(value || '').trim().slice(0, 512); }

function normalizeVoiceFields(input = {}) {
  return Object.freeze({
    voiceCallsEnabled: Boolean(input.voiceCallsEnabled),
    botCallsWithVoice: Boolean(input.botCallsWithVoice),
    voiceLanguagePreference: normalizeVoiceLanguage(input.voiceLanguagePreference || VOICE_LANGUAGE.AUTO),
    voiceDefaultDelivery: normalizeVoiceDelivery(input.voiceDefaultDelivery || VOICE_DEFAULT_DELIVERY.NATURAL),
    voiceRuntimeBaseUrl: normalizeVoiceRuntimeBaseUrl(input.voiceRuntimeBaseUrl),
    voiceCaptionsEnabled: input.voiceCaptionsEnabled !== false,
    voiceSetupInitialized: Boolean(input.voiceSetupInitialized),
  });
}

export class BetaSettingsService {
  #unitOfWork;
  #globalStorage;
  constructor({ database, globalStorage = globalThis.localStorage || null }) {
    this.#unitOfWork = new V3UnitOfWork(database);
    this.#globalStorage = globalStorage && typeof globalStorage.getItem === 'function' && typeof globalStorage.setItem === 'function' ? globalStorage : null;
  }

  #readGlobalVoice() {
    if (!this.#globalStorage) return null;
    try {
      const parsed = JSON.parse(this.#globalStorage.getItem(GLOBAL_VOICE_SETTINGS_KEY) || 'null');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? normalizeVoiceFields({ ...voiceDefaults(), ...parsed }) : null;
    } catch { return null; }
  }

  #writeGlobalVoice(settings) {
    if (!this.#globalStorage) return false;
    try {
      const normalized = normalizeVoiceFields(settings);
      this.#globalStorage.setItem(GLOBAL_VOICE_SETTINGS_KEY, JSON.stringify(normalized));
      return true;
    } catch { return false; }
  }

  #readGlobalImage() {
    if (!this.#globalStorage) return Object.freeze({ imageApiKey: '' });
    try { const parsed = JSON.parse(this.#globalStorage.getItem(GLOBAL_IMAGE_SETTINGS_KEY) || 'null'); return Object.freeze({ imageApiKey: normalizeImageApiKey(parsed?.imageApiKey) }); }
    catch { return Object.freeze({ imageApiKey: '' }); }
  }

  #writeGlobalImage(imageApiKey) {
    if (!this.#globalStorage) return false;
    try { this.#globalStorage.setItem(GLOBAL_IMAGE_SETTINGS_KEY, JSON.stringify({ imageApiKey: normalizeImageApiKey(imageApiKey) })); return true; }
    catch { return false; }
  }

  async get({ scope: inputScope, playerInstanceId }) {
    const scope = requireEventScope(inputScope);
    const player = requireText(playerInstanceId, 'playerInstanceId');
    const id = preferenceId(scope, player);
    return this.#unitOfWork.readonly({ stores: ['phoneUiPreferences'], scope }, async repositories => {
      const current = await repositories.phoneUiPreferences.get(id);
      const base = current || Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, playerInstanceId: player, ...resolveExperiencePreset(EXPERIENCE_PRESET.STORY), themeId: normalizePhoneTheme(null), developerDiagnosticsEnabled: false, continueStoryAfterCalls: false, playableBootstrap: normalizePlayableBootstrap(), worldSocialBible: normalizeWorldSocialBible(), ...voiceDefaults(), phase: 23 });
      const currentPreset = current?.preset === EXPERIENCE_PRESET.SIMPLE ? resolveExperiencePreset(EXPERIENCE_PRESET.SIMPLE) : null;
      const globalVoice = this.#readGlobalVoice();
      return Object.freeze({
        ...base,
        ...(currentPreset || {}),
        ...(globalVoice || normalizeVoiceFields({ ...voiceDefaults(), ...base })),
        ...this.#readGlobalImage(),
        playableBootstrap: normalizePlayableBootstrap(base.playableBootstrap),
        botSavedNames: normalizeBotSavedNames(base.botSavedNames),
        worldSocialBible: normalizeWorldSocialBible(base.worldSocialBible),
        themeId: normalizePhoneTheme(base.themeId),
        phase: 23,
      });
    });
  }

  async #update({ scope: inputScope, playerInstanceId, patch, globalVoice = false }) {
    const scope = requireEventScope(inputScope);
    const player = requireText(playerInstanceId, 'playerInstanceId');
    const current = await this.get({ scope, playerInstanceId: player });
    const row = Object.freeze({ ...current, ...patch, id: preferenceId(scope, player), storyId: scope.storyId, branchId: scope.branchId, playerInstanceId: player, updatedAt: new Date().toISOString(), createdAt: current.createdAt || new Date().toISOString(), phase: 23 });
    const { imageApiKey, ...persistableRow } = row;
    await this.#unitOfWork.readwrite({ stores: ['phoneUiPreferences'], scope }, repositories => repositories.phoneUiPreferences.put(Object.freeze(persistableRow)));
    if (globalVoice) this.#writeGlobalVoice(Object.fromEntries(GLOBAL_VOICE_FIELDS.map(field => [field, row[field]])));
    return row;
  }

  async setBotSavedName({ scope, playerInstanceId, ownerInstanceId, savedName }) {
    const owner = requireText(ownerInstanceId, 'ownerInstanceId');
    const name = String(savedName || '').replace(/\s+/gu, ' ').trim().slice(0, 60);
    if (!name || /^(?:คุณ|ผู้เล่น|user|you|\{\{user\}\})$/iu.test(name)) throw new TypeError('A distinctive bot-saved name is required');
    const current = await this.get({ scope, playerInstanceId });
    return this.#update({ scope, playerInstanceId, patch: { botSavedNames: normalizeBotSavedNames({ ...current.botSavedNames, [owner]: name }) } });
  }

  async setPreset({ scope, playerInstanceId, preset, custom = {} }) {
    const resolved = resolveExperiencePreset(preset, custom);
    return this.#update({ scope, playerInstanceId, patch: { ...resolved, preset } });
  }

  async setPhoneNumberDiscovery({ scope, playerInstanceId, value }) {
    const normalized = String(value || '').trim();
    if (!Object.values(PHONE_NUMBER_DISCOVERY).includes(normalized)) throw new TypeError(`Unsupported Phone Number Discovery: ${value}`);
    return this.#update({ scope, playerInstanceId, patch: { preset: EXPERIENCE_PRESET.CUSTOM, phoneNumberDiscovery: normalized } });
  }

  setTheme({ scope, playerInstanceId, themeId }) { return this.#update({ scope, playerInstanceId, patch: { themeId: normalizePhoneTheme(themeId) } }); }
  setDeveloperDiagnostics({ scope, playerInstanceId, enabled }) { return this.#update({ scope, playerInstanceId, patch: { developerDiagnosticsEnabled: Boolean(enabled) } }); }
  setContinueStoryAfterCalls({ scope, playerInstanceId, enabled }) { return this.#update({ scope, playerInstanceId, patch: { continueStoryAfterCalls: Boolean(enabled) } }); }
  setPlayableBootstrapState({ scope, playerInstanceId, state }) { return this.#update({ scope, playerInstanceId, patch: { playableBootstrap: normalizePlayableBootstrap(state) } }); }
  setWorldSocialBible({ scope, playerInstanceId, bible }) { return this.#update({ scope, playerInstanceId, patch: { worldSocialBible: normalizeWorldSocialBible(bible) } }); }
  async setImageApiKey({ scope, playerInstanceId, apiKey }) { this.#writeGlobalImage(apiKey); return this.get({ scope, playerInstanceId }); }
  setVoiceCalls({ scope, playerInstanceId, enabled }) { return this.#update({ scope, playerInstanceId, patch: { voiceCallsEnabled: Boolean(enabled), voiceSetupInitialized: true }, globalVoice: true }); }
  setBotCallsWithVoice({ scope, playerInstanceId, enabled }) { return this.#update({ scope, playerInstanceId, patch: { botCallsWithVoice: Boolean(enabled), voiceSetupInitialized: true }, globalVoice: true }); }
  setVoiceCaptions({ scope, playerInstanceId, enabled }) { return this.#update({ scope, playerInstanceId, patch: { voiceCaptionsEnabled: Boolean(enabled), voiceSetupInitialized: true }, globalVoice: true }); }

  setVoiceLanguagePreference({ scope, playerInstanceId, language }) {
    const voiceLanguagePreference = normalizeVoiceLanguage(language);
    return this.#update({ scope, playerInstanceId, patch: { voiceLanguagePreference, voiceSetupInitialized: true }, globalVoice: true });
  }

  setVoiceDefaultDelivery({ scope, playerInstanceId, delivery }) {
    const voiceDefaultDelivery = normalizeVoiceDelivery(delivery);
    return this.#update({ scope, playerInstanceId, patch: { voiceDefaultDelivery, voiceSetupInitialized: true }, globalVoice: true });
  }

  async setVoiceRuntimeBaseUrl({ scope, playerInstanceId, baseUrl }) {
    const voiceRuntimeBaseUrl = normalizeVoiceRuntimeBaseUrl(baseUrl);
    return this.#update({ scope, playerInstanceId, patch: { voiceRuntimeBaseUrl }, globalVoice: true });
  }

  async activateDetectedVoice({ scope, playerInstanceId, language = VOICE_LANGUAGE.ENGLISH }) {
    const current = await this.get({ scope, playerInstanceId });
    if (current.voiceSetupInitialized) return current;
    const selected = [VOICE_LANGUAGE.ENGLISH, VOICE_LANGUAGE.JAPANESE].includes(current.voiceLanguagePreference) ? current.voiceLanguagePreference : normalizeVoiceLanguage(language);
    return this.#update({ scope, playerInstanceId, patch: { voiceCallsEnabled: true, botCallsWithVoice: true, voiceLanguagePreference: selected, voiceCaptionsEnabled: true, voiceSetupInitialized: true }, globalVoice: true });
  }
}
