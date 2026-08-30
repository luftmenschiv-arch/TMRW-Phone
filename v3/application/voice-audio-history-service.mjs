import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';
import { requireText } from '../domain/identity/identity-record.mjs';
import { normalizeVoiceAudioArtifact, VOICE_AUDIO_RETENTION } from '../domain/voice/audio-artifact.mjs';

const timestamp = () => new Date().toISOString();

export class VoiceAudioHistoryService {
  #unitOfWork;
  constructor({ database }) { this.#unitOfWork = new V3UnitOfWork(database); }

  async registerDerivedArtifact({ scope: inputScope, artifact }) {
    const scope = requireEventScope(inputScope);
    return this.#unitOfWork.readwrite({ stores: ['callSessions', 'voiceAudioArtifacts'], scope }, async repositories => {
      const call = await repositories.callSessions.getByIndex('by_scope_session', [scope.storyId, scope.branchId, requireText(artifact?.callSessionId, 'callSessionId')]);
      if (!call) throw new Error('Voice audio metadata requires an existing canonical Call Session');
      const now = timestamp();
      const row = normalizeVoiceAudioArtifact({ ...artifact, storyId: scope.storyId, branchId: scope.branchId, createdAt: artifact?.createdAt || now, updatedAt: now });
      await repositories.voiceAudioArtifacts.put(row);
      return row;
    });
  }

  async listByCall({ scope: inputScope, callSessionId }) {
    const scope = requireEventScope(inputScope);
    return this.#unitOfWork.readonly({ stores: ['voiceAudioArtifacts'], scope }, repositories => repositories.voiceAudioArtifacts.listByIndex('by_scope_call', [scope.storyId, scope.branchId, requireText(callSessionId, 'callSessionId')]));
  }

  async setKept({ scope: inputScope, artifactId, kept }) {
    const scope = requireEventScope(inputScope);
    return this.#unitOfWork.readwrite({ stores: ['voiceAudioArtifacts'], scope }, async repositories => {
      const row = await repositories.voiceAudioArtifacts.get(requireText(artifactId, 'artifactId'));
      if (!row) throw new Error(`Unknown Voice audio artifact: ${artifactId}`);
      const updated = normalizeVoiceAudioArtifact({ ...row, retention: kept ? VOICE_AUDIO_RETENTION.KEPT : VOICE_AUDIO_RETENTION.TEMPORARY, updatedAt: timestamp() });
      await repositories.voiceAudioArtifacts.put(updated);
      return updated;
    });
  }

  async deleteSelected({ scope: inputScope, artifactIds = [] }) {
    const scope = requireEventScope(inputScope);
    const ids = [...new Set(artifactIds.map(id => requireText(id, 'artifactId')))];
    return this.#unitOfWork.readwrite({ stores: ['voiceAudioArtifacts'], scope }, async repositories => {
      let deleted = 0;
      for (const id of ids) if (await repositories.voiceAudioArtifacts.delete(id)) deleted += 1;
      return Object.freeze({ deleted, canonicalCallWrites: 0, transcriptWrites: 0, knowledgeWrites: 0, galleryWrites: 0, filesWrites: 0 });
    });
  }

  async deleteTemporary({ scope: inputScope }) {
    const scope = requireEventScope(inputScope);
    return this.#unitOfWork.readwrite({ stores: ['voiceAudioArtifacts'], scope }, async repositories => {
      const rows = await repositories.voiceAudioArtifacts.listByIndex('by_scope_retention', [scope.storyId, scope.branchId, VOICE_AUDIO_RETENTION.TEMPORARY]);
      for (const row of rows) await repositories.voiceAudioArtifacts.delete(row.id);
      return Object.freeze({ deleted: rows.length, keptProtected: true, canonicalCallWrites: 0, transcriptWrites: 0, knowledgeWrites: 0, galleryWrites: 0, filesWrites: 0 });
    });
  }
}
