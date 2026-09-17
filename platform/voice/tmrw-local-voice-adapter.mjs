import { normalizeVoiceRenderRequest, normalizeVoiceRenderResult, VOICE_RENDER_STATUS } from '../../domain/voice/voice-adapter-contract.mjs';
import { VOICE_LANGUAGE } from '../../domain/voice/voice-profile.mjs';

export const TMRW_LOCAL_RUNTIME_BASE_URL = 'http://127.0.0.1:18769';
export const TMRW_DEFAULT_VOICE_PROFILE_NAME = 'TMRW Male Core';
const LANGUAGE_MAP = Object.freeze({ [VOICE_LANGUAGE.ENGLISH]: 'English', [VOICE_LANGUAGE.JAPANESE]: 'japanese' });
const runtimeProfileId = value => /^[a-z0-9][a-z0-9._-]{0,95}$/u.test(String(value || '').trim()) ? String(value).trim() : 'tmrw-male-core';

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
  } catch { throw new TypeError('TMRW Local Voice endpoint must be a valid http(s) origin'); }
}

async function responseJson(response) {
  try { return await response.json(); } catch { return null; }
}

function emitTiming(callback, phase, detail = {}) {
  try { callback?.(Object.freeze({ phase, ...detail })); } catch {}
}

const ascii = (view, offset, length) => Array.from({ length }, (_, index) => String.fromCharCode(view.getUint8(offset + index))).join('');
async function mergePcmWavBlobs(blobs) {
  if (blobs.length === 1) return blobs[0];
  const parsed = [];
  for (const blob of blobs) {
    const buffer = await blob.arrayBuffer(); const view = new DataView(buffer);
    if (buffer.byteLength < 44 || ascii(view, 0, 4) !== 'RIFF' || ascii(view, 8, 4) !== 'WAVE') throw new Error('invalid-stored-wav');
    let offset = 12, format = null, data = null;
    while (offset + 8 <= buffer.byteLength) {
      const id = ascii(view, offset, 4); const size = view.getUint32(offset + 4, true); const start = offset + 8;
      if (start + size > buffer.byteLength) break;
      if (id === 'fmt ') format = new Uint8Array(buffer.slice(start, start + size));
      if (id === 'data') data = new Uint8Array(buffer.slice(start, start + size));
      offset = start + size + (size % 2);
    }
    if (!format || !data) throw new Error('invalid-stored-wav'); parsed.push({ format, data });
  }
  const signature = bytes => Array.from(bytes).join(','); const expected = signature(parsed[0].format);
  if (parsed.some(row => signature(row.format) !== expected)) throw new Error('incompatible-stored-wav');
  const format = parsed[0].format; const dataSize = parsed.reduce((sum, row) => sum + row.data.byteLength, 0);
  const output = new ArrayBuffer(12 + 8 + format.byteLength + (format.byteLength % 2) + 8 + dataSize); const view = new DataView(output); const bytes = new Uint8Array(output);
  const write = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, output.byteLength - 8, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, format.byteLength, true); bytes.set(format, 20);
  let offset = 20 + format.byteLength + (format.byteLength % 2); write(offset, 'data'); view.setUint32(offset + 4, dataSize, true); offset += 8;
  for (const row of parsed) { bytes.set(row.data, offset); offset += row.data.byteLength; }
  return new Blob([output], { type: 'audio/wav' });
}

export class TMRWLocalVoiceAdapter {
  #fetch;
  #baseUrl;
  #createObjectURL;
  #revokeObjectURL;
  #healthTimeoutMs;
  #requestTimeoutMs;
  #audioTimeoutMs;
  #refs = new Set();
  #readyByCall = new Map();

  constructor({ fetchImpl = globalThis.fetch?.bind?.(globalThis) || null, baseUrl = TMRW_LOCAL_RUNTIME_BASE_URL, createObjectURL = globalThis.URL?.createObjectURL?.bind?.(globalThis.URL) || null, revokeObjectURL = globalThis.URL?.revokeObjectURL?.bind?.(globalThis.URL) || null, healthTimeoutMs = 1200, requestTimeoutMs = 2500, audioTimeoutMs = 20000 } = {}) {
    this.#fetch = typeof fetchImpl === 'function' ? fetchImpl : null;
    this.#baseUrl = String(baseUrl || TMRW_LOCAL_RUNTIME_BASE_URL).replace(/\/$/, '');
    this.#createObjectURL = typeof createObjectURL === 'function' ? createObjectURL : null;
    this.#revokeObjectURL = typeof revokeObjectURL === 'function' ? revokeObjectURL : null;
    this.#healthTimeoutMs = Math.max(100, Number(healthTimeoutMs) || 1200);
    this.#requestTimeoutMs = Math.max(100, Number(requestTimeoutMs) || 2500);
    this.#audioTimeoutMs = Math.max(1000, Number(audioTimeoutMs) || 20000);
  }

  get capability() {
    return Object.freeze({ providerId: 'tmrw-local-voice-v1', profileName: TMRW_DEFAULT_VOICE_PROFILE_NAME, supportedLanguages: Object.freeze([VOICE_LANGUAGE.ENGLISH, VOICE_LANGUAGE.JAPANESE]), endpoint: this.#baseUrl, configured: Boolean(this.#fetch), local: true });
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

  async health({ signal = null, baseUrl = null, onTiming = null, language = null } = {}) {
    emitTiming(onTiming, 'runtime-health-start', { language, cached: false });
    if (!this.#fetch) return Object.freeze({ ok: false, ready: false, reason: 'voice-fetch-unavailable' });
    let endpoint;
    try { endpoint = normalizedBaseUrl(baseUrl, this.#baseUrl); }
    catch (error) { return Object.freeze({ ok: false, ready: false, reason: 'invalid-runtime-endpoint', error: String(error?.message || error) }); }
    try {
      const response = await this.#fetchTimed('/health', { method: 'GET' }, this.#healthTimeoutMs, signal, endpoint);
      const body = await responseJson(response);
      const runtimeVoice = String(body?.voice || '').trim().toLowerCase();
      const ok = response.ok === true && body?.ok === true && body?.ready === true && (runtimeVoice === 'tmrw local voice' || runtimeVoice === 'tmrw male core');
      emitTiming(onTiming, 'runtime-health-end', { language, cached: false, outcome: ok ? 'ready' : 'not-ready' });
      return Object.freeze({ ok, ready: ok, status: response.status, voice: body?.voice || null, endpoint, error: body?.error || null, reason: ok ? null : 'runtime-not-ready' });
    } catch (error) {
      emitTiming(onTiming, 'runtime-health-end', { language, cached: false, outcome: error?.code || 'runtime-unreachable' });
      return Object.freeze({ ok: false, ready: false, endpoint, reason: error?.code || 'runtime-unreachable', error: String(error?.message || error) });
    }
  }

  async warm({ callSessionId, language, signal = null, baseUrl = null, onTiming = null } = {}) {
    const callId = String(callSessionId || '').trim();
    if (!callId || !LANGUAGE_MAP[language]) return Object.freeze({ ok: false, ready: false, reason: 'invalid-warmup-request' });
    let endpoint;
    try { endpoint = normalizedBaseUrl(baseUrl, this.#baseUrl); }
    catch (error) { return Object.freeze({ ok: false, ready: false, reason: 'invalid-runtime-endpoint', error: String(error?.message || error) }); }
    const cached = this.#readyByCall.get(callId);
    if (cached?.endpoint === endpoint && cached?.language === language && cached?.ready) {
      emitTiming(onTiming, 'runtime-health-end', { language, cached: true, outcome: 'ready' });
      return Object.freeze({ ok: true, ready: true, endpoint, language, cached: true });
    }
    if (cached?.endpoint === endpoint && cached?.language === language && cached?.pending) return cached.pending;
    this.#readyByCall.delete(callId);
    const pending = this.health({ signal, baseUrl: endpoint, onTiming, language }).then(result => {
      if (result.ready && !signal?.aborted) this.#readyByCall.set(callId, Object.freeze({ endpoint, language, ready: true }));
      else this.#readyByCall.delete(callId);
      return Object.freeze({ ...result, language, cached: false });
    }).catch(error => {
      this.#readyByCall.delete(callId);
      throw error;
    });
    this.#readyByCall.set(callId, Object.freeze({ endpoint, language, ready: false, pending }));
    return pending;
  }

  invalidateCall(callSessionId) {
    return this.#readyByCall.delete(String(callSessionId || '').trim());
  }

  async openSequence(inputs, { signal = null, baseUrl = null, onTiming = null } = {}) {
    const source = Array.isArray(inputs) ? inputs : [];
    if (!source.length || source.length > 12) throw Object.assign(new Error('invalid-render-sequence'), { code: 'invalid-render-sequence' });
    const requests = source.map(input => normalizeVoiceRenderRequest(input));
    if (signal?.aborted) throw Object.assign(new Error('voice-cancelled'), { code: 'voice-cancelled' });
    if (!this.#fetch || !this.#createObjectURL) throw Object.assign(new Error('runtime-client-unavailable'), { code: 'runtime-client-unavailable' });
    if (requests.some(request => !String(request.resolvedProfile?.profileName || '').trim())) throw Object.assign(new Error('voice-profile-required'), { code: 'voice-profile-required' });
    const runtimeLanguage = LANGUAGE_MAP[requests[0].language];
    if (!runtimeLanguage || requests.some(request => LANGUAGE_MAP[request.language] !== runtimeLanguage)) throw Object.assign(new Error('unsupported-language'), { code: 'unsupported-language' });
    let endpoint;
    try { endpoint = normalizedBaseUrl(baseUrl, this.#baseUrl); }
    catch { throw Object.assign(new Error('invalid-runtime-endpoint'), { code: 'invalid-runtime-endpoint' }); }
    const health = await this.warm({ callSessionId: requests[0].callSessionId, language: requests[0].language, signal, baseUrl: endpoint, onTiming });
    if (signal?.aborted) throw Object.assign(new Error('voice-cancelled'), { code: 'voice-cancelled' });
    if (!health.ready) throw Object.assign(new Error(health.reason || 'runtime-unavailable'), { code: health.reason || 'runtime-unavailable' });

    emitTiming(onTiming, 'runtime-turn-start', { segmentCount: requests.length, language: requests[0].language });
    let startResponse;
    try { startResponse = await this.#fetchTimed('/turn/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_chunks: requests.length, language: runtimeLanguage, calibration: false, profile_id: runtimeProfileId(requests[0].resolvedProfile?.profileName) }),
    }, this.#requestTimeoutMs, signal, endpoint); }
    catch (error) { this.invalidateCall(requests[0].callSessionId); throw error; }
    const start = await responseJson(startResponse);
    if (!startResponse.ok || start?.ok !== true || !start?.turn_id) { this.invalidateCall(requests[0].callSessionId); throw Object.assign(new Error('turn-start-failed'), { code: 'turn-start-failed' }); }
    emitTiming(onTiming, 'runtime-turn-ready', { segmentCount: requests.length, language: requests[0].language });
    const turnId = String(start.turn_id);
    for (let index = 0; index < requests.length; index += 1) {
      const request = requests[index];
      emitTiming(onTiming, 'runtime-chunk-push-start', { segmentIndex: index, segmentCount: requests.length, language: request.language });
      let pushResponse;
      try { pushResponse = await this.#fetchTimed('/turn/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turn_id: turnId, index, text: request.canonicalText, subtitle: request.subtitleText }),
      }, this.#requestTimeoutMs, signal, endpoint); }
      catch (error) { this.invalidateCall(request.callSessionId); throw error; }
      const push = await responseJson(pushResponse);
      if (!pushResponse.ok || push?.ok !== true) { this.invalidateCall(request.callSessionId); throw Object.assign(new Error('turn-push-failed'), { code: 'turn-push-failed' }); }
      emitTiming(onTiming, 'runtime-chunk-push-end', { segmentIndex: index, segmentCount: requests.length, language: request.language, outcome: 'accepted' });
    }
    const cache = new Map();
    const fetchAudio = async index => {
      try {
        emitTiming(onTiming, 'audio-fetch-start', { segmentIndex: index, segmentCount: requests.length, language: requests[index].language });
        const audioResponse = await this.#fetchTimed(`/turn/audio?wait=1&turn_id=${encodeURIComponent(turnId)}&index=${index}`, { method: 'GET' }, this.#audioTimeoutMs, signal, endpoint);
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
        emitTiming(onTiming, 'synthesis-ready', { segmentIndex: index, segmentCount: requests.length, language: requests[index].language, durationMs, outcome: 'ready' });
        emitTiming(onTiming, 'audio-fetch-ready', { segmentIndex: index, segmentCount: requests.length, language: requests[index].language, durationMs, outcome: 'ready' });
        return normalizeVoiceRenderResult({ status: VOICE_RENDER_STATUS.READY, audioArtifactRef, audioBlob: blob, mimeType: blob.type || contentType || 'audio/wav', durationMs, capabilityState: { providerId: 'tmrw-local-voice-v1', voice: TMRW_DEFAULT_VOICE_PROFILE_NAME, selectedProfile: requests[index].resolvedProfile?.profileName || TMRW_DEFAULT_VOICE_PROFILE_NAME, runtimeLanguage, endpoint, local: true, turnId, index, chunks: requests.length } });
      } catch (error) {
        if (!signal?.aborted) this.invalidateCall(requests[index].callSessionId);
        emitTiming(onTiming, 'audio-fetch-end', { segmentIndex: index, segmentCount: requests.length, language: requests[index].language, outcome: signal?.aborted ? 'cancelled' : (error?.code || 'runtime-error') });
        if (signal?.aborted || error?.code === 'voice-cancelled') return cancelledResult();
        if (error?.code === 'voice-timeout') return failedResult('runtime-timeout');
        return failedResult(error?.code || 'runtime-error');
      }
    };
    const renderAt = index => {
      if (!Number.isSafeInteger(index) || index < 0 || index >= requests.length) return Promise.resolve(failedResult('invalid-sequence-index'));
      if (cache.has(index)) return cache.get(index);
      emitTiming(onTiming, 'synthesis-start', { segmentIndex: index, segmentCount: requests.length, language: requests[index].language });
      const pending = fetchAudio(index);
      cache.set(index, pending);
      return pending;
    };
    const retryAt = index => {
      if (!Number.isSafeInteger(index) || index < 0 || index >= requests.length) return Promise.resolve(failedResult('invalid-sequence-index'));
      emitTiming(onTiming, 'synthesis-retry', { segmentIndex: index, segmentCount: requests.length, language: requests[index].language });
      const pending = fetchAudio(index);
      cache.set(index, pending);
      return pending;
    };
    return Object.freeze({ turnId, length: requests.length, runtimeLanguage, endpoint, renderAt, retryAt });
  }

  async render(input, options = {}) {
    try {
      const sequence = await this.openSequence([input], options);
      return sequence.renderAt(0);
    } catch (error) {
      if (options.signal?.aborted || error?.code === 'voice-cancelled') return cancelledResult();
      if (error?.code === 'voice-profile-required' || error?.code === 'unsupported-language' || error?.code === 'runtime-client-unavailable' || error?.code === 'invalid-runtime-endpoint' || error?.code === 'runtime-unavailable') return unavailableResult(error.code);
      if (error?.code === 'voice-timeout') return failedResult('runtime-timeout');
      return failedResult(error?.code || 'runtime-error');
    }
  }

  materializeStoredBlob(blob, { durationMs = null, mimeType = null } = {}) {
    if (!blob || Number(blob.size || 0) < 1 || !this.#createObjectURL) return failedResult('stored-audio-unavailable');
    const audioArtifactRef = this.#createObjectURL(blob);
    if (!audioArtifactRef) return failedResult('audio-url-failed');
    this.#refs.add(audioArtifactRef);
    return normalizeVoiceRenderResult({ status: VOICE_RENDER_STATUS.READY, audioArtifactRef, audioBlob: blob, mimeType: mimeType || blob.type || 'audio/wav', durationMs });
  }

  async combineStoredBlobs(blobs = []) {
    const source = blobs.filter(blob => blob && Number(blob.size || 0) > 0);
    if (!source.length) throw new Error('stored-audio-unavailable');
    return mergePcmWavBlobs(source);
  }

  async materializeStoredBlobs(blobs = [], { durationMs = null } = {}) {
    try { return this.materializeStoredBlob(await this.combineStoredBlobs(blobs), { durationMs, mimeType: 'audio/wav' }); }
    catch { return failedResult('stored-audio-merge-failed'); }
  }

  release(resultOrRef) {
    const ref = typeof resultOrRef === 'string' ? resultOrRef : resultOrRef?.audioArtifactRef;
    if (!ref || !this.#refs.has(ref)) return false;
    this.#refs.delete(ref);
    try { this.#revokeObjectURL?.(ref); } catch {}
    return true;
  }

  dispose() {
    this.#readyByCall.clear();
    for (const ref of [...this.#refs]) this.release(ref);
  }
}
