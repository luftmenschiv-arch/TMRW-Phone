export const POCKET_INJECTOR_OWNER = Object.freeze({ STORY_BRIDGE: 'story-bridge', TMRW: 'tmrw-v3', NONE: 'none', CONFLICT: 'conflict' });

export class PocketInjectorParityGuard {
  inspect({ storyBridgeInterceptor, tmrwPocketContextEnabled = false, pocketShadowCanonical = false } = {}) {
    const bridgeActive = typeof storyBridgeInterceptor === 'function'; const tmrwActive = Boolean(tmrwPocketContextEnabled); const activeCount = Number(bridgeActive) + Number(tmrwActive); const owner = activeCount === 0 ? POCKET_INJECTOR_OWNER.NONE : activeCount > 1 ? POCKET_INJECTOR_OWNER.CONFLICT : (bridgeActive ? POCKET_INJECTOR_OWNER.STORY_BRIDGE : POCKET_INJECTOR_OWNER.TMRW);
    return Object.freeze({ owner, activeCount, exactlyOne: activeCount === 1, bridgeActive, tmrwActive, pocketShadowCanonical: Boolean(pocketShadowCanonical), safeForMilestone1: activeCount === 1 && bridgeActive && !tmrwActive && !pocketShadowCanonical, rule: 'During Milestone 1, untouched Story Bridge owns Pocket context and TMRW shadow is excluded.' });
  }
  assertMilestone1(input) { const result = this.inspect(input); if (!result.safeForMilestone1) throw new Error(`Pocket context injector parity failed: owner=${result.owner}, active=${result.activeCount}`); return result; }
}
