export const TMRW_VOICE_MANAGER_BASE_URL = 'http://127.0.0.1:18768';
// Resolve from the installed module, including ST's per-user extension route.
export function presetPreviewBaseUrl(moduleUrl = import.meta.url) {
  const packed = new URL(moduleUrl).pathname.endsWith('/v3/platform/voice/tmrw-voice-manager-client.mjs');
  return new URL(packed ? '../../../voice-packs/previews/' : '../../voice-packs/previews/', moduleUrl).href;
}
const PRESET_PREVIEW_PATH = presetPreviewBaseUrl();
const PRESET_PREVIEW_VERSION = 'clone-only-20260926';

export class TMRWVoiceManagerClient {
  #fetch;
  #baseUrl;
  constructor({ fetchImpl = globalThis.fetch?.bind?.(globalThis) || null, baseUrl = TMRW_VOICE_MANAGER_BASE_URL } = {}) {
    this.#fetch = fetchImpl;
    this.#baseUrl = String(baseUrl).replace(/\/$/u, '');
  }
  async #json(path, options = {}) {
    if (!this.#fetch) throw new Error('voice-manager-fetch-unavailable');
    const response = await this.#fetch(`${this.#baseUrl}${path}`, options);
    const value = await response.json().catch(() => null);
    if (!response.ok) throw new Error(value?.error || `voice-manager-http-${response.status}`);
    return value;
  }
  health() { return this.#json('/v1/health'); }
  catalog() { return this.#json('/v1/catalog'); }
  profiles() { return this.#json('/v1/profiles'); }
  presetPreviewUrl({ profileId, language = 'en' }) {
    return /^(?:male|female)-[a-z0-9-]+$/u.test(profileId)
      ? `${PRESET_PREVIEW_PATH}${profileId}-${language === 'ja' ? 'ja' : 'en'}.wav?v=${PRESET_PREVIEW_VERSION}`
      : null;
  }
  async preview({ profileId, language = 'en' }) {
    if (!this.#fetch) throw new Error('voice-manager-fetch-unavailable');
    const presetUrl = this.presetPreviewUrl({ profileId, language });
    const response = presetUrl
      ? await this.#fetch(presetUrl)
      : await this.#fetch(`${this.#baseUrl}/v1/previews`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId, language }) });
    if (!response.ok) { const value = await response.json().catch(() => null); throw new Error(value?.error || `voice-manager-http-${response.status}`); }
    return response.blob();
  }
  async installPack({ manifestUrl, packId, onUpdate = null }) {
    const job = await this.#json('/v1/packs/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manifestUrl, packId }) });
    return this.waitJob(job.id, { timeoutMs: 90 * 60 * 1000, onUpdate });
  }
  async startRuntime({ onUpdate = null } = {}) {
    const job = await this.#json('/v1/runtime/start', { method: 'POST' });
    return this.waitJob(job.id, { timeoutMs: 5 * 60 * 1000, onUpdate });
  }
  async waitJob(id, { intervalMs = 450, timeoutMs = 10 * 60 * 1000, onUpdate = null } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const job = await this.#json(`/v1/jobs/${encodeURIComponent(id)}`); onUpdate?.(job);
      if (job.status === 'complete') return job.result;
      if (job.status === 'failed') throw new Error(job.error || 'voice-manager-job-failed');
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error('voice-manager-job-timeout');
  }
  async transcribe(file, { language = 'auto', onUpdate = null } = {}) {
    const job = await this.#json('/v1/transcriptions', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-TMRW-Filename': file.name || 'reference-audio', 'X-TMRW-Language': language }, body: file });
    return this.waitJob(job.id, { onUpdate });
  }
  async clone({ characterId, name, audioId, transcript, language = 'en', onUpdate = null }) {
    const job = await this.#json('/v1/voices/clone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ characterId, name, audioId, transcript, language }) });
    return this.waitJob(job.id, { onUpdate });
  }
}
