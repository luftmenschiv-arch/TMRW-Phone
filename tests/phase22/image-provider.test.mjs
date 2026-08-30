import test from 'node:test';
import assert from 'node:assert/strict';

import { setupPhase15 } from '../phase15/social-fixtures.mjs';
import { ImageAssetCache } from '../../domain/media/asset-cache.mjs';
import { ImageProvider, defineImageCandidate } from '../../domain/media/image-provider.mjs';
import { ImageProviderService, IMAGE_RESOLUTION_STATUS } from '../../application/image-provider-service.mjs';
import { PostVisualResolver, POST_VISUAL_MODE } from '../../application/post-visual-resolver.mjs';
import { PixabayImageProvider } from '../../platform/image-providers/pixabay.mjs';

class FixtureProvider extends ImageProvider {
  calls = 0;
  #handler;
  constructor(handler) { super({ id: 'fixture-provider', available: true }); this.#handler = handler; }
  capabilities() { return Object.freeze({ providerId: this.id, search: true, attribution: true, offline: false, configured: true, available: true, safeSearch: true, cacheTtlMs: 86_400_000 }); }
  async search(request) { this.calls += 1; return this.#handler(request); }
}

const candidate = (id, tags, extra = {}) => defineImageCandidate({
  providerId: 'fixture-provider',
  providerAssetId: id,
  urls: { preview: `https://img.test/${id}-preview.jpg`, display: `https://img.test/${id}.jpg`, sourcePage: `https://source.test/${id}` },
  width: 640,
  height: 480,
  tags,
  attribution: { providerName: 'Fixture', creatorName: 'fixture-user' },
  rankSignals: { likes: 10, views: 100, downloads: 20 },
  ...extra,
});

async function serviceFor(provider, clock = () => 1_000) {
  const context = await setupPhase15();
  const cache = new ImageAssetCache({ database: context.database });
  const service = new ImageProviderService({ provider, cache, clock });
  return { context, cache, service };
}

test('no Pixabay key is an unavailable capability and never performs a request', async () => {
  let fetchCalls = 0;
  const provider = new PixabayImageProvider({ apiKey: null, fetchImpl: async () => { fetchCalls += 1; throw new Error('must not call'); } });
  const { service } = await serviceFor(provider);
  const result = await service.resolveExternalAsset({ query: 'rainy window city', peoplePolicy: 'avoid' });
  assert.equal(result.status, IMAGE_RESOLUTION_STATUS.UNAVAILABLE);
  assert.equal(service.capability().configured, false);
  assert.equal(service.capability().available, false);
  assert.equal(fetchCalls, 0);
});

test('provider network failure degrades to text-only without throwing into the consumer', async () => {
  const provider = new PixabayImageProvider({ apiKey: 'fixture-key-not-secret', fetchImpl: async () => { throw new Error('offline'); } });
  const { service } = await serviceFor(provider);
  const direct = await service.resolveExternalAsset({ query: 'rainy window city' });
  assert.equal(direct.status, IMAGE_RESOLUTION_STATUS.PROVIDER_FAILURE);
  const resolver = new PostVisualResolver({ imageProviderService: service });
  const visual = await resolver.resolve({ mode: POST_VISUAL_MODE.EXTERNAL_CONTEXTUAL_ASSET, externalRequest: { query: 'rainy window city' } });
  assert.equal(visual.mode, POST_VISUAL_MODE.TEXT_ONLY);
  assert.equal(visual.assetRef, null);
});

test('empty provider results are a valid cached no-match and do not duplicate the request', async () => {
  const provider = new FixtureProvider(async () => []);
  const { service } = await serviceFor(provider);
  const first = await service.resolveExternalAsset({ query: 'empty rainy street' });
  const second = await service.resolveExternalAsset({ query: 'empty rainy street' });
  assert.equal(first.status, IMAGE_RESOLUTION_STATUS.NO_MATCH);
  assert.equal(second.status, IMAGE_RESOLUTION_STATUS.NO_MATCH);
  assert.equal(second.source, 'cache');
  assert.equal(provider.calls, 1);
});

test('contextual no-people selection rejects human-tagged stock and caches one safe reference for 24h', async () => {
  const provider = new FixtureProvider(async () => [
    candidate('human', ['rain', 'woman', 'umbrella']),
    candidate('window', ['rain', 'raindrops', 'window', 'city']),
  ]);
  let now = 5_000;
  const { service, cache } = await serviceFor(provider, () => now);
  const request = { query: 'rain window city', peoplePolicy: 'avoid', orientation: 'horizontal' };
  const first = await service.resolveExternalAsset(request);
  assert.equal(first.status, IMAGE_RESOLUTION_STATUS.RESOLVED);
  assert.equal(first.asset.providerAssetId, 'window');
  assert.equal(first.source, 'provider');
  const cached = await cache.get(first.cacheKey);
  assert.equal(cached.status, 'resolved');
  assert.equal(cached.expiresAt - cached.cachedAt, 86_400_000);
  assert.equal('bytes' in cached, false);
  now += 60_000;
  const second = await service.resolveExternalAsset(request);
  assert.equal(second.source, 'cache');
  assert.equal(second.asset.providerAssetId, 'window');
  assert.equal(provider.calls, 1);
});

test('canonical/local asset always wins and external provider is not consulted', async () => {
  const provider = new FixtureProvider(async () => [candidate('external', ['rain', 'window'])]);
  const { service } = await serviceFor(provider);
  const resolver = new PostVisualResolver({ imageProviderService: service });
  const visual = await resolver.resolve({
    mode: POST_VISUAL_MODE.EXTERNAL_CONTEXTUAL_ASSET,
    canonicalAssetRef: 'canonical-photo:story-owned-1',
    externalRequest: { query: 'rain window' },
  });
  assert.equal(visual.mode, POST_VISUAL_MODE.CANONICAL_LOCAL_ASSET);
  assert.equal(visual.assetRef, 'canonical-photo:story-owned-1');
  assert.equal(provider.calls, 0);
});

test('Pixabay adapter enforces bounded photo SafeSearch request and normalizes provider-specific response', async () => {
  let requestedUrl = null;
  const provider = new PixabayImageProvider({
    apiKey: 'fixture-key-not-secret',
    fetchImpl: async url => {
      requestedUrl = String(url);
      return {
        ok: true,
        status: 200,
        async json() {
          return { hits: [{ id: 42, type: 'photo', pageURL: 'https://pixabay.com/photos/example-42/', previewURL: 'https://cdn.example/42-preview.jpg', webformatURL: 'https://cdn.example/42-640.jpg', webformatWidth: 640, webformatHeight: 426, tags: 'rain, window, city', likes: 12, views: 500, downloads: 80, user: 'fixture' }] };
        },
      };
    },
  });
  const rows = await provider.search({ query: 'rain window city', orientation: 'horizontal', category: 'places', limit: 6, peoplePolicy: 'avoid' });
  const url = new URL(requestedUrl);
  assert.equal(url.origin + url.pathname, 'https://pixabay.com/api/');
  assert.equal(url.searchParams.get('safesearch'), 'true');
  assert.equal(url.searchParams.get('image_type'), 'photo');
  assert.equal(url.searchParams.get('orientation'), 'horizontal');
  assert.equal(url.searchParams.get('category'), 'places');
  assert.equal(url.searchParams.get('per_page'), '6');
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['attribution', 'contentSignals', 'height', 'imageType', 'kind', 'mediaType', 'providerAssetId', 'providerId', 'rankSignals', 'ref', 'tags', 'urls', 'width'].sort());
  assert.equal(rows[0].providerId, 'pixabay');
  assert.equal(rows[0].providerAssetId, '42');
});
