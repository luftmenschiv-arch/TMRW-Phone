import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';
import { requireText } from '../domain/identity/identity-record.mjs';
import { normalizeActorVoiceProfile, normalizeInstanceVoiceOverride, resolveVoiceProfile } from '../domain/voice/voice-profile.mjs';

const actorProfileId = actorId => `voice-actor-profile:${requireText(actorId, 'actorId')}`;
const instanceOverrideId = (scope, instanceId) => `voice-instance-override:${scope.storyId}:${scope.branchId}:${requireText(instanceId, 'instanceId')}`;
const now = () => new Date().toISOString();

export class VoiceProfileService {
  #unitOfWork;
  constructor({ database }) { this.#unitOfWork = new V3UnitOfWork(database); }

  async getActorBase({ actorId }) {
    const id = actorProfileId(actorId);
    return this.#unitOfWork.readonly({ stores: ['actors', 'voiceActorProfiles'] }, async repositories => {
      const actor = await repositories.actors.get(actorId);
      if (!actor) throw new Error(`Unknown Actor identity: ${actorId}`);
      return (await repositories.voiceActorProfiles.get(id)) || null;
    });
  }

  async setActorBase({ actorId, profile = {}, userInitiated = true, provenance = null }) {
    const id = actorProfileId(actorId);
    return this.#unitOfWork.readwrite({ stores: ['actors', 'voiceActorProfiles'] }, async repositories => {
      const actor = await repositories.actors.get(actorId);
      if (!actor) throw new Error(`Unknown Actor identity: ${actorId}`);
      const current = await repositories.voiceActorProfiles.get(id);
      if (current?.lockedByUser && !userInitiated) throw new Error('Actor Base Voice Profile is user-locked');
      const timestamp = now();
      const row = normalizeActorVoiceProfile({
        ...current,
        ...profile,
        id,
        actorId,
        provenance: provenance || profile.provenance || current?.provenance || { authority: userInitiated ? 'tmrw-phase19-user' : 'tmrw-phase19-proposal', recordId: id, version: '1' },
        createdAt: current?.createdAt || timestamp,
        updatedAt: timestamp,
      });
      await repositories.voiceActorProfiles.put(row);
      return row;
    });
  }

  async resetActorBase({ actorId, userInitiated = true }) {
    const id = actorProfileId(actorId);
    return this.#unitOfWork.readwrite({ stores: ['actors', 'voiceActorProfiles'] }, async repositories => {
      const actor = await repositories.actors.get(actorId);
      if (!actor) throw new Error(`Unknown Actor identity: ${actorId}`);
      const current = await repositories.voiceActorProfiles.get(id);
      if (current?.lockedByUser && !userInitiated) throw new Error('Actor Base Voice Profile is user-locked');
      return repositories.voiceActorProfiles.delete(id);
    });
  }

  async getInstanceOverride({ scope: inputScope, instanceId }) {
    const scope = requireEventScope(inputScope); const id = instanceOverrideId(scope, instanceId);
    return this.#unitOfWork.readonly({ stores: ['instances', 'voiceInstanceOverrides'], scope }, async repositories => {
      const instance = await repositories.instances.get(instanceId);
      if (!instance) throw new Error(`Unknown Character Instance in scope: ${instanceId}`);
      return (await repositories.voiceInstanceOverrides.get(id)) || null;
    });
  }

  async setInstanceOverride({ scope: inputScope, instanceId, actorId = null, enabled = true, fields = {}, lockedByUser = false, userInitiated = true, provenance = null }) {
    const scope = requireEventScope(inputScope); const id = instanceOverrideId(scope, instanceId);
    return this.#unitOfWork.readwrite({ stores: ['instances', 'voiceInstanceOverrides'], scope }, async repositories => {
      const instance = await repositories.instances.get(instanceId);
      if (!instance) throw new Error(`Unknown Character Instance in scope: ${instanceId}`);
      if (actorId && actorId !== instance.actorId) throw new Error('Voice Profile override Actor/Instance mapping mismatch');
      const current = await repositories.voiceInstanceOverrides.get(id);
      if (current?.lockedByUser && !userInitiated) throw new Error('Character Instance Voice override is user-locked');
      const timestamp = now();
      const row = normalizeInstanceVoiceOverride({
        id,
        storyId: scope.storyId,
        branchId: scope.branchId,
        instanceId,
        actorId: instance.actorId,
        enabled,
        fields,
        lockedByUser,
        provenance: provenance || current?.provenance || { authority: userInitiated ? 'tmrw-phase19-user' : 'tmrw-phase19-proposal', recordId: id, version: '1' },
        createdAt: current?.createdAt || timestamp,
        updatedAt: timestamp,
      });
      await repositories.voiceInstanceOverrides.put(row);
      return row;
    });
  }

  async resolve({ scope: inputScope, actorId, instanceId }) {
    const scope = requireEventScope(inputScope);
    const [baseProfile, instanceOverride] = await Promise.all([
      this.getActorBase({ actorId }),
      this.getInstanceOverride({ scope, instanceId }),
    ]);
    return this.#unitOfWork.readonly({ stores: ['instances'], scope }, async repositories => {
      const instance = await repositories.instances.get(instanceId);
      if (!instance || instance.actorId !== actorId) throw new Error('Ambiguous or mismatched Actor/Character Instance Voice mapping');
      return resolveVoiceProfile({ actorId, instanceId, baseProfile, instanceOverride });
    });
  }
}
