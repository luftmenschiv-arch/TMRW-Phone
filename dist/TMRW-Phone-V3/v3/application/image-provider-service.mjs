import { normalizeImageSearchRequest } from '../domain/media/image-provider.mjs';
import { selectBestImageCandidate } from '../domain/media/image-selection-policy.mjs';

export const IMAGE_RESOLUTION_STATUS = Object.freeze({
  RESOLVED: 'resolved',
  NO_MATCH: 'no-match',
  UNAVAILABLE: 'unavailable',
  PROVIDER_FAILURE: 'provider-failure',
  CACHE_FAILURE: 'cache-failure',
});

function nowNumber(clock) {
  const value = Number(clock());
  return Number.isFinite(value) ? value : Date.now();
}

export function imageSearchCacheKey(providerId, request) {
  const normalized = normalizeImageSearchRequest(request);
  return `image-search:v1:${String(providerId)}:${JSON.stringify([
    normalized.query,
    normalized.imageType,
    normalized.orientation,
    normalized.category,
    normalized.lang,
    normalized.limit,
    normalized.safeSearch,
    normalized.peoplePolicy,
  ])}`;
}

function result(status, extra = {}) {
  return Object.freeze({ status, asset: null, source: null, reason: status, ...extra });
}

export class ImageProviderService {
  #provider;
  #cache;
  #clock;
  #ttlMs;

  constructor({ provider, cache, clock = () => Date.now(), cacheTtlMs = null } = {}) {
    if (!provider?.id || typeof provider?.capabilities !== 'function' || typeof provider?.search !== 'function') throw new TypeError('ImageProviderService requires an image provider');
    if (!cache || typeof cache.get !== 'function' || typeof cache.putSearchResult !== 'function') throw new TypeError('ImageProviderService requires an image asset cache');
    this.#provider = provider;
    this.#cache = cache;
    this.#clock = clock;
    const providerTtl = Number(provider.capabilities()?.cacheTtlMs);
    this.#ttlMs = Math.max(86_400_000, Number(cacheTtlMs) || providerTtl || 86_400_000);
  }

  capability() {
    const capability = this.#provider.capabilities();
    return Object.freeze({
      providerId: this.#provider.id,
      configured: capability.configured === true,
      available: this.#provider.available === true && capability.available !== false,
      search: capability.search === true,
      attribution: capability.attribution === true,
      safeSearch: capability.safeSearch !== false,
      cacheTtlMs: this.#ttlMs,
    });
  }

  configureApiKey(apiKey) { if (typeof this.#provider.configure !== 'function') return this.capability(); this.#provider.configure({ apiKey }); return this.capability(); }

  async resolveExternalAsset(input = {}) {
    const request = normalizeImageSearchRequest(input);
    const cacheKey = imageSearchCacheKey(this.#provider.id, request);
    const now = nowNumber(this.#clock);
    let cached = null;
    try {
      cached = await this.#cache.get(cacheKey);
    } catch {
      cached = null;
    }
    if (cached && Number(cached.expiresAt) > now) {
      if (cached.status === 'resolved' && cached.selectedAsset) return result(IMAGE_RESOLUTION_STATUS.RESOLVED, { asset: Object.freeze(structuredClone(cached.selectedAsset)), source: 'cache', reason: 'cache-hit', cacheKey });
      if (cached.status === 'empty') return result(IMAGE_RESOLUTION_STATUS.NO_MATCH, { source: 'cache', reason: 'cached-empty', cacheKey });
    }

    const capability = this.capability();
    if (!capability.available || !capability.search) return result(IMAGE_RESOLUTION_STATUS.UNAVAILABLE, { reason: capability.configured ? 'provider-unavailable' : 'provider-not-configured', cacheKey });

    let candidates;
    try {
      candidates = await this.#provider.search(request);
    } catch {
      return result(IMAGE_RESOLUTION_STATUS.PROVIDER_FAILURE, { reason: 'provider-request-failed', cacheKey });
    }

    const selected = selectBestImageCandidate(request, candidates);
    const expiresAt = now + this.#ttlMs;
    if (!selected) {
      try {
        await this.#cache.putSearchResult({ cacheKey, providerId: this.#provider.id, status: 'empty', selectedAsset: null, cachedAt: now, expiresAt });
      } catch {
        // Empty result is already a safe text-only outcome; never escalate cache failure into Phone/canon failure.
      }
      return result(IMAGE_RESOLUTION_STATUS.NO_MATCH, { source: 'provider', reason: 'no-suitable-image', cacheKey });
    }

    try {
      await this.#cache.putSearchResult({ cacheKey, providerId: this.#provider.id, status: 'resolved', selectedAsset: selected, cachedAt: now, expiresAt });
    } catch {
      return result(IMAGE_RESOLUTION_STATUS.CACHE_FAILURE, { reason: 'provider-result-not-cacheable', cacheKey });
    }
    return result(IMAGE_RESOLUTION_STATUS.RESOLVED, { asset: selected, source: 'provider', reason: 'selected-and-cached', cacheKey });
  }
}
