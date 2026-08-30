import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { requireEventScope } from '../events/event-validator.mjs';
import { requireText } from '../identity/identity-record.mjs';

export function playerAccessOverrideId(scope, deviceId, action) { return `phone-player-override:${scope.storyId}:${scope.branchId}:${requireText(deviceId, 'deviceId')}:${requireText(action, 'action')}`; }

export class PlayerAccessOverrideRepository {
  #unitOfWork;
  constructor({ database }) { if (!database) throw new TypeError('PlayerAccessOverrideRepository requires the isolated v3 database'); this.#unitOfWork = new V3UnitOfWork(database); }
  async get(scopeInput, deviceId, action = 'inspect') { const scope = requireEventScope(scopeInput); return this.#unitOfWork.readonly({ stores: ['phonePlayerAccessOverrides'], scope }, repositories => repositories.phonePlayerAccessOverrides.get(playerAccessOverrideId(scope, deviceId, action))); }
  async grant({ scope: scopeInput, deviceId, action = 'inspect', playerActorId, playerInstanceId, reason = 'player-choice' }) {
    const scope = requireEventScope(scopeInput); const id = playerAccessOverrideId(scope, deviceId, action);
    return this.#unitOfWork.readwrite({ stores: ['phonePlayerAccessOverrides'], scope }, async repositories => {
      const existing = await repositories.phonePlayerAccessOverrides.get(id);
      const row = Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, deviceId: requireText(deviceId, 'deviceId'), action: requireText(action, 'action'), playerActorId: requireText(playerActorId, 'playerActorId'), playerInstanceId: requireText(playerInstanceId, 'playerInstanceId'), enabled: true, reason: requireText(reason, 'reason'), playerOnly: true, createsCanonicalKnowledge: false, createsOwnerAwareness: false, phase: 6, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
      await repositories.phonePlayerAccessOverrides.put(row); return row;
    });
  }
  async clear({ scope: scopeInput, deviceId, action = 'inspect' }) { const scope = requireEventScope(scopeInput); return this.#unitOfWork.readwrite({ stores: ['phonePlayerAccessOverrides'], scope }, repositories => repositories.phonePlayerAccessOverrides.delete(playerAccessOverrideId(scope, deviceId, action))); }
}
