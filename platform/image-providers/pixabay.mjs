import {
  ImageProvider,
  ImageProviderRequestError,
  ImageProviderUnavailableError,
  defineImageCandidate,
  normalizeImageSearchRequest,
} from '../../domain/media/image-provider.mjs';

const PIXABAY_CATEGORIES = new Set([
  'backgrounds', 'fashion', 'nature', 'science', 'education', 'feelings', 'health', 'people', 'religion', 'places',
  'animals', 'industry', 'computer', 'food', 'sports', 'transportation', 'travel', 'buildings', 'business', 'music',
]);
const PIXABAY_LANGUAGES = new Set(['cs', 'da', 'de', 'en', 'es', 'fr', 'id', 'it', 'hu', 'nl', 'no', 'pl', 'pt', 'ro', 'sk', 'fi', 'sv', 'tr', 'vi', 'th', 'bg', 'ru', 'el', 'ja', 'ko', 'zh']);
const CACHE_TTL_MS = 86_400_000;

function boundedNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function tags(value) {
  return String(value || '').split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean).slice(0, 24);
}

export class PixabayImageProvider extends ImageProvider {
  #apiKey;
  #fetch;
  #endpoint;

  constructor({ apiKey = null, fetchImpl = globalThis.fetch?.bind(globalThis), endpoint = 'https://pixabay.com/api/' } = {}) {
    const normalizedKey = String(apiKey || '').trim();
    super({ id: 'pixabay', available: Boolean(normalizedKey && typeof fetchImpl === 'function') });
    this.#apiKey = normalizedKey;
    this.#fetch = typeof fetchImpl === 'function' ? fetchImpl : null;
    this.#endpoint = String(endpoint || 'https://pixabay.com/api/');
  }

  configure({ apiKey = null } = {}) { this.#apiKey = String(apiKey || '').trim(); this.available = Boolean(this.#apiKey && this.#fetch); return this.capabilities(); }

  capabilities() {
    return Object.freeze({
      providerId: this.id,
      search: true,
      attribution: true,
      offline: false,
      configured: Boolean(this.#apiKey),
      available: this.available,
      safeSearch: true,
      cacheTtlMs: CACHE_TTL_MS,
    });
  }

  async search(input = {}) {
    const request = normalizeImageSearchRequest(input);
    if (!this.available || !this.#apiKey || !this.#fetch) throw new ImageProviderUnavailableError(this.id, 'missing-key-or-fetch');

    const params = new URLSearchParams();
    params.set('key', this.#apiKey);
    params.set('q', request.query);
    params.set('image_type', request.imageType);
    params.set('safesearch', 'true');
    params.set('order', 'popular');
    params.set('per_page', String(request.limit));
    if (request.orientation !== 'all') params.set('orientation', request.orientation);
    if (request.category && PIXABAY_CATEGORIES.has(request.category)) params.set('category', request.category);
    if (PIXABAY_LANGUAGES.has(request.lang)) params.set('lang', request.lang);

    let response;
    try {
      response = await this.#fetch(`${this.#endpoint}?${params.toString()}`, { method: 'GET', headers: { Accept: 'application/json' }, signal: input.signal });
    } catch {
      throw new ImageProviderRequestError(this.id, 'network-error');
    }
    if (!response?.ok) throw new ImageProviderRequestError(this.id, 'http-error', Number(response?.status) || null);

    let body;
    try {
      body = await response.json();
    } catch {
      throw new ImageProviderRequestError(this.id, 'invalid-json');
    }

    const hits = Array.isArray(body?.hits) ? body.hits : [];
    return Object.freeze(hits.slice(0, request.limit).map(hit => defineImageCandidate({
      providerId: this.id,
      providerAssetId: String(hit?.id ?? ''),
      imageType: hit?.type || 'photo',
      urls: {
        preview: hit?.previewURL || hit?.webformatURL || '',
        display: hit?.webformatURL || hit?.previewURL || '',
        sourcePage: hit?.pageURL || '',
      },
      width: boundedNumber(hit?.webformatWidth || hit?.imageWidth),
      height: boundedNumber(hit?.webformatHeight || hit?.imageHeight),
      tags: tags(hit?.tags),
      attribution: {
        providerName: 'Pixabay',
        creatorName: String(hit?.user || '').trim() || null,
      },
      contentSignals: { people: 'unknown' },
      rankSignals: {
        likes: boundedNumber(hit?.likes),
        views: boundedNumber(hit?.views),
        downloads: boundedNumber(hit?.downloads),
      },
    })));
  }
}

export const PIXABAY_IMAGE_CACHE_TTL_MS = CACHE_TTL_MS;
