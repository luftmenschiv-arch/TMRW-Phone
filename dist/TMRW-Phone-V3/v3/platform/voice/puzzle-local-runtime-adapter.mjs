import { normalizeVoiceRenderRequest, normalizeVoiceRenderResult, VOICE_RENDER_STATUS } from '../../domain/voice/voice-adapter-contract.mjs';
import { VOICE_LANGUAGE } from '../../domain/voice/voice-profile.mjs';

export const PUZZLE_LOCAL_RUNTIME_BASE_URL = 'http://127.0.0.1:18769';
export const PUZZLE_VOICE_PROFILE_NAME = 'Puzzle';
const LANGUAGE_MAP = Object.freeze({ [VOICE_LANGUAGE.ENGLISH]: 'English', [VOICE_LANGUAGE.JAPANESE]: 'japanese' });

function cancelledResult(code = 'voice-cancelled') {
  return normalizeVoiceRenderResult({ status: VOICE_RENDER_STATUS.CANCELLED, errorCode: code });
}

function unavailableResult(code) {
  return normalizeVoiceRenderResult({ status: VOICE_RENDER_STATUS.UNAVAILABLE, errorCode: code });
}

function failedResult(code) {
  return normalizeVoiceRenderResult({ status: VOICE_RENDER_STATUS.FAILED, errorCode: code });
}

function normalizedBaseUrl(value, fallback) {
  try {
    const parsed = new URL(String(value || fallback).trim());
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) throw new Error('invalid-runtime-origin');
    return parsed.origin;
  } catch { throw new TypeError('Puzzle Voice runtime endpoint must be a valid http(s) origin'); }
}

async function responseJson(response) {
  try { return await response.json(); } catch { return null; }
}

export class PuzzleLocalRuntimeVoiceAdapter {
  #fetch;
  #baseUrl;
  #createObjectURL;
  #revokeObjectURL;
  #healthTimeoutMs;
  #requestTimeoutMs;
  #audioTimeoutMs;
  #refs = new Set();

  constructor({ fetchImpl = globalThis.fetch?.bind?.(globalThis) || null, baseUrl = PUZZLE_LOCAL_RUNTIME_BASE_URL, createObjectURL = globalThis.URL?.createObjectURL?.bind?.(globalThis.URL) || null, revokeObjectURL = globalThis.URL?.revokeObjectURL?.bind?.(globalThis.URL) || null, healthTimeoutMs = 1200, requestTimeoutMs = 2500, audioTimeoutMs = 45000 } = {}) {
    this.#fetch = typeof fetchImpl === 'function' ? fetchImpl : null;
    this.#baseUrl = String(baseUrl || PUZZLE_LOCAL_RUNTIME_BASE_URL).replace(/\/$/, '');
    this.#createObjectURL = typeof createObjectURL === 'function' ? createObjectURL : null;
    this.#revokeObjectURL = typeof revokeObjectURL === 'function' ? revokeObjectURL : null;
    this.#healthTimeoutMs = Math.max(100, Number(healthTimeoutMs) || 1200);
    this.#requestTimeoutMs = Math.max(100, Number(requestTimeoutMs) || 2500);
    this.#audioTimeoutMs = Math.max(1000, Number(audioTimeoutMs) || 45000);
  }

  get capability() {
    return Object.freeze({ providerId: 'tmrw-local-puzzle-v093', profileName: PUZZLE_VOICE_PROFILE_NAME, supportedLanguages: Object.freeze([VOICE_LANGUAGE.ENGLISH, VOICE_LANGUAGE.JAPANESE]), endpoint: this.#baseUrl, configured: Boolean(this.#fetch), local: true });
  }

  async #fetchTimed(path, options = {}, timeoutMs = this.#requestTimeoutMs, externalSignal = null, baseUrl = this.#baseUrl) {
    if (!this.#fetch) throw new Error('voice-fetch-unavailable');
    const controller = new AbortController();
    let timedOut = false;
    const externalAbort = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener?.('abort', externalAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      return await this.#fetch(`${baseUrl}${path}`, { ...options, signal: controller.signal });
    } catch (error) {
      if (externalSignal?.aborted) {
        const cancelled = new Error('voice-cancelled'); cancelled.code = 'voice-cancelled'; throw cancelled;
      }
      if (timedOut) {
        const timeout = new Error('voice-timeout'); timeout.code = 'voice-timeout'; throw timeout;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener?.('abort', externalAbort);
    }
  }

  async health({ signal = null, baseUrl = null } = {}) {
    if (!this.#fetch) return Object.freeze({ ok: false, ready: false, reason: 'voice-fetch-unavailable' });
    let endpoint;
    try { endpoint = normalizedBaseUrl(baseUrl, this.#baseUrl); }
    catch (error) { return Object.freeze({ ok: false, ready: false, reason: 'invalid-runtime-endpoint', error: String(error?.message || error) }); }
    try {
      const response = await this.#fetchTimed('/health', { method: 'GET' }, this.#healthTimeoutMs, signal, endpoint);
      const body = await responseJson(response);
      const ok = response.ok === true && body?.ok === true && body?.ready === true && String(body?.voice || '').toLowerCase() === 'puzzle';
      return Object.freeze({ ok, ready: ok, status: response.status, voice: body?.voice || null, endpoint, error: body?.error || null, reason: ok ? null : 'runtime-not-ready' });
    } catch (error) {
      return Object.freeze({ ok: false, ready: false, endpoint, reason: error?.code || 'runtime-unreachable', error: String(error?.message || error) });
    }
  }

  async render(input, { signal = null, baseUrl = null } = {}) {
    let request;
    try { request = normalizeVoiceRenderRequest(input); } catch { return failedResult('invalid-render-request'); }
    if (signal?.aborted) return cancelledResult();
    if (!String(request.resolvedProfile?.profileName || '').trim()) return unavailableResult('voice-profile-required');
    const runtimeLanguage = LANGUAGE_MAP[request.language];
    if (!runtimeLanguage) return unavailableResult('unsupported-language');
    if (!this.#fetch || !this.#createObjectURL) return unavailableResult('runtime-client-unavailable');

    let endpoint;
    try { endpoint = normalizedBaseUrl(baseUrl, this.#baseUrl); }
    catch { return unavailableResult('invalid-runtime-endpoint'); }
    const health = await this.health({ signal, baseUrl: endpoint });
    if (signal?.aborted) return cancelledResult();
    if (!health.ready) return unavailableResult(health.reason || 'runtime-unavailable');

    try {
      const startResponse = await this.#fetchTimed('/turn/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_chunks: 1, language: runtimeLanguage, calibration: false }),
      }, this.#requestTimeoutMs, signal, endpoint);
      const start = await responseJson(startResponse);
      if (!startResponse.ok || start?.ok !== true || !start?.turn_id) return failedResult('turn-start-failed');

      const turnId = String(start.turn_id);
      const pushResponse = await this.#fetchTimed('/turn/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turn_id: turnId, index: 0, text: request.canonicalText, subtitle: request.canonicalText }),
      }, this.#requestTimeoutMs, signal, endpoint);
      const push = await responseJson(pushResponse);
      if (!pushResponse.ok || push?.ok !== true) return failedResult('turn-push-failed');

      const audioResponse = await this.#fetchTimed(`/turn/audio?wait=1&turn_id=${encodeURIComponent(turnId)}&index=0`, { method: 'GET' }, this.#audioTimeoutMs, signal, endpoint);
      if (!audioResponse.ok) return failedResult('audio-fetch-failed');
      const contentType = String(audioResponse.headers?.get?.('Content-Type') || '').toLowerCase();
      if (contentType && !contentType.includes('audio/wav') && !contentType.includes('audio/x-wav')) return failedResult('invalid-audio-content-type');
      const blob = await audioResponse.blob();
      if (!blob || Number(blob.size || 0) < 44) return failedResult('invalid-audio-payload');
      if (signal?.aborted) return cancelledResult();
      const audioArtifactRef = this.#createObjectURL(blob);
      if (!audioArtifactRef) return failedResult('audio-url-failed');
      this.#refs.add(audioArtifactRef);
      const durationSeconds = Number(audioResponse.headers?.get?.('X-TMRW-Duration'));
      const durationMs = Number.isFinite(durationSeconds) && durationSeconds >= 0 ? durationSeconds * 1000 : null;
      return normalizeVoiceRenderResult({
        status: VOICE_RENDER_STATUS.READY,
        audioArtifactRef,
        durationMs,
        capabilityState: { providerId: 'tmrw-local-puzzle-v093', voice: PUZZLE_VOICE_PROFILE_NAME, runtimeLanguage, endpoint, local: true },
      });
    } catch (error) {
      if (signal?.aborted || error?.code === 'voice-cancelled') return cancelledResult();
      if (error?.code === 'voice-timeout') return failedResult('runtime-timeout');
      return failedResult('runtime-error');
    }
  }

  release(resultOrRef) {
    const ref = typeof resultOrRef === 'string' ? resultOrRef : resultOrRef?.audioArtifactRef;
    if (!ref || !this.#refs.has(ref)) return false;
    this.#refs.delete(ref);
    try { this.#revokeObjectURL?.(ref); } catch {}
    return true;
  }

  dispose() {
    for (const ref of [...this.#refs]) this.release(ref);
  }
}
