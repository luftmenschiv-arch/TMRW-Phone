const ORIENTATIONS = new Set(['all', 'horizontal', 'vertical']);
const IMAGE_TYPES = new Set(['photo', 'illustration', 'vector']);
const PEOPLE_POLICIES = new Set(['avoid', 'allow', 'require']);

function cleanText(value, max = 100) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function finiteInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function freezeRecord(value) {
  return Object.freeze(structuredClone(value));
}

export class ImageProviderUnavailableError extends Error {
  constructor(providerId, reason = 'unavailable') {
    super(`Image provider ${providerId} is unavailable: ${reason}`);
    this.name = 'ImageProviderUnavailableError';
    this.providerId = providerId;
    this.reason = reason;
  }
}

export class ImageProviderRequestError extends Error {
  constructor(providerId, reason = 'request-failed', status = null) {
    super(`Image provider ${providerId} request failed${status ? ` (HTTP ${status})` : ''}: ${reason}`);
    this.name = 'ImageProviderRequestError';
    this.providerId = providerId;
    this.reason = reason;
    this.status = status;
  }
}

export function normalizeImageSearchRequest(input = {}) {
  const query = cleanText(input.query ?? input.visualDescription, 100);
  if (!query) throw new TypeError('Image search requires a visual query');
  const orientation = ORIENTATIONS.has(input.orientation) ? input.orientation : 'all';
  const imageType = IMAGE_TYPES.has(input.imageType) ? input.imageType : 'photo';
  const peoplePolicy = PEOPLE_POLICIES.has(input.peoplePolicy) ? input.peoplePolicy : 'avoid';
  const category = cleanText(input.category, 32).toLowerCase() || null;
  const lang = cleanText(input.lang || 'en', 8).toLowerCase() || 'en';
  return Object.freeze({
    query,
    imageType,
    orientation,
    category,
    lang,
    limit: finiteInt(input.limit, 6, 3, 20),
    safeSearch: true,
    peoplePolicy,
  });
}

export function defineImageCandidate(input = {}) {
  const providerId = cleanText(input.providerId, 64);
  const providerAssetId = cleanText(input.providerAssetId, 128);
  const displayUrl = cleanText(input.urls?.display, 2048);
  const sourcePageUrl = cleanText(input.urls?.sourcePage, 2048);
  if (!providerId || !providerAssetId || !displayUrl || !sourcePageUrl) throw new TypeError('Image candidate is incomplete');
  const tags = Object.freeze([...(input.tags || [])].map(value => cleanText(value, 64).toLowerCase()).filter(Boolean).slice(0, 24));
  const people = ['present', 'absent', 'unknown'].includes(input.contentSignals?.people) ? input.contentSignals.people : 'unknown';
  return Object.freeze({
    ref: `external-image:${providerId}:${providerAssetId}`,
    kind: 'external-image',
    providerId,
    providerAssetId,
    mediaType: 'image',
    imageType: IMAGE_TYPES.has(input.imageType) ? input.imageType : 'photo',
    urls: Object.freeze({
      preview: cleanText(input.urls?.preview, 2048) || displayUrl,
      display: displayUrl,
      sourcePage: sourcePageUrl,
    }),
    width: finiteInt(input.width, 0, 0, Number.MAX_SAFE_INTEGER),
    height: finiteInt(input.height, 0, 0, Number.MAX_SAFE_INTEGER),
    tags,
    attribution: freezeRecord({
      providerName: cleanText(input.attribution?.providerName || providerId, 80),
      creatorName: cleanText(input.attribution?.creatorName, 120) || null,
      sourcePageUrl,
    }),
    contentSignals: freezeRecord({ people }),
    rankSignals: freezeRecord({
      likes: finiteInt(input.rankSignals?.likes, 0, 0, Number.MAX_SAFE_INTEGER),
      views: finiteInt(input.rankSignals?.views, 0, 0, Number.MAX_SAFE_INTEGER),
      downloads: finiteInt(input.rankSignals?.downloads, 0, 0, Number.MAX_SAFE_INTEGER),
    }),
  });
}

export class ImageProvider {
  constructor({ id, available = false } = {}) {
    if (!id) throw new TypeError('Image provider id is required');
    this.id = String(id);
    this.available = Boolean(available);
  }

  capabilities() {
    return Object.freeze({
      providerId: this.id,
      search: false,
      attribution: false,
      offline: false,
      configured: false,
      available: this.available,
      safeSearch: true,
      cacheTtlMs: 86_400_000,
    });
  }

  async search() {
    throw new ImageProviderUnavailableError(this.id);
  }
}

export class UnavailableImageProvider extends ImageProvider {
  constructor({ id = 'unavailable', reason = 'not-configured' } = {}) {
    super({ id, available: false });
    this.reason = reason;
  }

  capabilities() {
    return Object.freeze({ ...super.capabilities(), reason: this.reason });
  }

  async search() {
    throw new ImageProviderUnavailableError(this.id, this.reason);
  }
}
