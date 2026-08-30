import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';

const SEARCH_CACHE_STATUS = new Set(['resolved', 'empty']);

function requireText(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${name} is required`);
  return text;
}

export class ImageAssetCache {
  #unit;

  constructor({ database }) {
    this.#unit = new V3UnitOfWork(database);
  }

  async get(cacheKey) {
    return this.#unit.readonly({ stores: ['socialAssets'], privileged: true }, repositories => repositories.socialAssets.getByIndex('by_cache_key', cacheKey));
  }

  async putMetadata(row) {
    if (!row?.cacheKey || !row?.providerId || !row?.providerAssetId) throw new TypeError('Cached asset metadata is incomplete');
    return this.#unit.readwrite({ stores: ['socialAssets'], privileged: true }, async repositories => {
      const record = Object.freeze({ id: `social-asset:${row.providerId}:${row.providerAssetId}`, status: 'cached-reference', ...structuredClone(row) });
      await repositories.socialAssets.put(record);
      return record;
    });
  }

  async putSearchResult({ cacheKey, providerId, status, selectedAsset = null, cachedAt, expiresAt }) {
    const normalizedCacheKey = requireText(cacheKey, 'cacheKey');
    const normalizedProviderId = requireText(providerId, 'providerId');
    if (!SEARCH_CACHE_STATUS.has(status)) throw new TypeError('Search cache status must be resolved or empty');
    if (status === 'resolved' && !selectedAsset?.providerAssetId) throw new TypeError('Resolved search cache requires a selected asset');
    const record = Object.freeze({
      id: `image-search-cache:${normalizedProviderId}:${normalizedCacheKey}`,
      cacheKey: normalizedCacheKey,
      providerId: normalizedProviderId,
      providerAssetId: `search:${normalizedCacheKey}`,
      status,
      selectedAsset: selectedAsset ? structuredClone(selectedAsset) : null,
      cachedAt: Number(cachedAt),
      expiresAt: Number(expiresAt),
    });
    return this.#unit.readwrite({ stores: ['socialAssets'], privileged: true }, async repositories => {
      await repositories.socialAssets.put(record);
      return record;
    });
  }
}
