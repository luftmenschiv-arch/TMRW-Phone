export const POST_VISUAL_MODE = Object.freeze({
  TEXT_ONLY: 'text-only',
  CANONICAL_LOCAL_ASSET: 'canonical-local-asset',
  EXTERNAL_CONTEXTUAL_ASSET: 'external-contextual-asset',
});

function textOnly(reason) {
  return Object.freeze({ mode: POST_VISUAL_MODE.TEXT_ONLY, assetRef: null, externalAsset: null, reason });
}

export class PostVisualResolver {
  #images;

  constructor({ imageProviderService } = {}) {
    if (!imageProviderService || typeof imageProviderService.resolveExternalAsset !== 'function') throw new TypeError('PostVisualResolver requires ImageProviderService');
    this.#images = imageProviderService;
  }

  async resolve({ mode = POST_VISUAL_MODE.TEXT_ONLY, canonicalAssetRef = null, externalRequest = null } = {}) {
    const canonical = String(canonicalAssetRef || '').trim();
    if (mode === POST_VISUAL_MODE.TEXT_ONLY) return textOnly('consumer-selected-text-only');
    if (canonical) return Object.freeze({ mode: POST_VISUAL_MODE.CANONICAL_LOCAL_ASSET, assetRef: canonical, externalAsset: null, reason: 'canonical-asset-preferred' });
    if (mode === POST_VISUAL_MODE.CANONICAL_LOCAL_ASSET) return textOnly('canonical-asset-missing');
    if (mode !== POST_VISUAL_MODE.EXTERNAL_CONTEXTUAL_ASSET || !externalRequest) return textOnly('external-image-not-authorized');

    let resolved;
    try {
      resolved = await this.#images.resolveExternalAsset(externalRequest);
    } catch {
      return textOnly('external-image-resolution-failed');
    }
    if (!resolved?.asset) return textOnly(resolved?.reason || 'external-image-unavailable');
    return Object.freeze({ mode: POST_VISUAL_MODE.EXTERNAL_CONTEXTUAL_ASSET, assetRef: resolved.asset.ref, externalAsset: resolved.asset, reason: resolved.reason });
  }
}
