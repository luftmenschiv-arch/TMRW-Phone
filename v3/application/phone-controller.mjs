import { getPhoneApp } from '../domain/phone/app-registry.mjs';
import { canonicalDeviceAccess } from '../domain/phone/possession-access.mjs';
import { resolvePlayerAccess } from '../domain/phone/player-access-policy.mjs';
import { PhoneLifecycleBudget } from './lifecycle-budget.mjs';

export class PhoneController {
  #phoneStates; #overrides; #budget = new PhoneLifecycleBudget(); #uiState = new Map();
  constructor({ phoneStateService, playerAccessOverrides }) {
    if (!phoneStateService || !playerAccessOverrides) throw new TypeError('PhoneController requires phone state and player-only override services');
    this.#phoneStates = phoneStateService; this.#overrides = playerAccessOverrides;
  }
  async open({ scope, deviceId, playerActorId, playerInstanceId, settings, action = 'inspect', appId = 'launcher' }) {
    if (!getPhoneApp(appId)) throw new Error(`Unknown foundation Phone app: ${appId}`);
    const state = await this.#phoneStates.getPhoneState(scope, deviceId); if (!state) throw new Error('Phone state is not initialized');
    const override = await this.#overrides.get(scope, deviceId, action);
    const canonical = canonicalDeviceAccess(state, playerActorId);
    const authorization = resolvePlayerAccess({ settings, canonicalAllowed: canonical.allowed, override, action });
    const perspective = await this.#phoneStates.getPerspective(scope, deviceId);
    this.#budget.open(deviceId);
    this.#uiState.set(`${scope.storyId}:${scope.branchId}:${deviceId}`, Object.freeze({ appId, openedAt: Date.now() }));
    return Object.freeze({ perspective, authorization, hydrated: Object.freeze({ deviceState: 1, accountSession: perspective.accountId ? 1 : 0, appSummary: 1, fullHistoryScans: 0 }), lifecycle: this.#budget.inspect() });
  }
  close({ scope, deviceId }) { this.#budget.close(deviceId); this.#uiState.delete(`${scope.storyId}:${scope.branchId}:${deviceId}`); return this.#budget.inspect(); }
  disableBeta() { this.#uiState.clear(); this.#budget.clear(); return this.#budget.inspect(); }
  inspectLifecycle() { return this.#budget.inspect(); }
}
