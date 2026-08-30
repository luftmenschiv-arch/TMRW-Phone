import { requireEventScope } from '../domain/events/event-validator.mjs';
import { PlayerAccessOverrideRepository } from '../domain/phone/player-access-override.mjs';

export class DirectorAccessOverrideManager {
  #overrides;
  constructor({ database }) { this.#overrides = new PlayerAccessOverrideRepository({ database }); }
  grant(input) { return this.#overrides.grant(input); }
  revoke(input) { return this.#overrides.clear(input); }
  get(scope, deviceId, action = 'inspect') { return this.#overrides.get(requireEventScope(scope), deviceId, action); }
  async summarize(scope, deviceId, action = 'inspect') { const row = await this.get(scope, deviceId, action); return Object.freeze({ enabled: Boolean(row?.enabled), playerOnly: true, canonicalEventId: null, createsCanonicalKnowledge: false, createsOwnerAwareness: false, promotionRequired: Boolean(row?.enabled), overrideId: row?.id || null }); }
}
