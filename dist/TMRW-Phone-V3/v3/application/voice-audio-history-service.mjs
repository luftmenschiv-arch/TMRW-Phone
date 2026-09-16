import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';
import { requireText } from '../domain/identity/identity-record.mjs';
import { normalizeVoiceAudioArtifact, VOICE_AUDIO_RETENTION } from '../domain/voice/audio-artifact.mjs';

const timestamp = () => new Date().toISOString();
export const VOICE_AUDIO_RETENTION_LIMITS = Object.freeze({ temporaryCallCount: 20, temporaryBytes: 200 * 1024 * 1024 });
const bytesOf = row => Number.isSafeInteger(Number(row?.byteLength)) ? Number(row.byteLength) : Number(row?.audioBlob?.size || 0);

export class VoiceAudioHistoryService {
  #unitOfWork;
  constructor({ database }) { this.#unitOfWork = new V3UnitOfWork(database); }

  async registerDerivedArtifact({ scope: inputScope, artifact }) {
    const scope = requireEventScope(inputScope);
    const persisted = await this.#unitOfWork.readwrite({ stores: ['callSessions', 'voiceAudioArtifacts'], scope }, async repositories => {
      const call = await repositories.callSessions.getByIndex('by_scope_session', [scope.storyId, scope.branchId, requireText(artifact?.callSessionId, 'callSessionId')]);
      if (!call) throw new Error('Voice audio metadata requires an existing canonical Call Session');
      const now = timestamp();
      const row = normalizeVoiceAudioArtifact({ ...artifact, storyId: scope.storyId, branchId: scope.branchId, createdAt: artifact?.createdAt || now, updatedAt: now });
      await repositories.voiceAudioArtifacts.put(row);
      return row;
    });
    await this.enforceRetention({ scope });
    return persisted;
  }

  async listByCall({ scope: inputScope, callSessionId }) {
    const scope = requireEventScope(inputScope);
    const rows = await this.#unitOfWork.readonly({ stores: ['voiceAudioArtifacts'], scope }, repositories => repositories.voiceAudioArtifacts.listByIndex('by_scope_call', [scope.storyId, scope.branchId, requireText(callSessionId, 'callSessionId')]));
    return Object.freeze(rows.sort((left, right) => Number(left.segmentIndex || 0) - Number(right.segmentIndex || 0) || String(left.createdAt).localeCompare(String(right.createdAt)) || left.id.localeCompare(right.id)));
  }

  async storageSummary({ scope: inputScope }) {
    const scope = requireEventScope(inputScope);
    const rows = await this.#unitOfWork.readonly({ stores: ['voiceAudioArtifacts'], scope }, repositories => repositories.voiceAudioArtifacts.list());
    const temporary = rows.filter(row => row.retention === VOICE_AUDIO_RETENTION.TEMPORARY);
    const kept = rows.filter(row => row.retention === VOICE_AUDIO_RETENTION.KEPT);
    return Object.freeze({
      temporaryBytes: temporary.reduce((sum, row) => sum + bytesOf(row), 0),
      keptBytes: kept.reduce((sum, row) => sum + bytesOf(row), 0),
      totalBytes: rows.reduce((sum, row) => sum + bytesOf(row), 0),
      temporaryArtifacts: temporary.length,
      keptArtifacts: kept.length,
      temporaryCalls: new Set(temporary.map(row => row.callSessionId)).size,
      keptCalls: new Set(kept.map(row => row.callSessionId)).size,
      limits: VOICE_AUDIO_RETENTION_LIMITS,
    });
  }

  async enforceRetention({ scope: inputScope }) {
    const scope = requireEventScope(inputScope);
    return this.#unitOfWork.readwrite({ stores: ['voiceAudioArtifacts'], scope }, async repositories => {
      const temporary = (await repositories.voiceAudioArtifacts.listByIndex('by_scope_retention', [scope.storyId, scope.branchId, VOICE_AUDIO_RETENTION.TEMPORARY]))
        .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || left.id.localeCompare(right.id));
      const byCall = new Map();
      for (const row of temporary) { if (!byCall.has(row.callSessionId)) byCall.set(row.callSessionId, []); byCall.get(row.callSessionId).push(row); }
      let bytes = temporary.reduce((sum, row) => sum + bytesOf(row), 0);
      let calls = byCall.size;
      const evictedArtifactIds = [];
      for (const [, rows] of byCall) {
        if (calls <= VOICE_AUDIO_RETENTION_LIMITS.temporaryCallCount && bytes <= VOICE_AUDIO_RETENTION_LIMITS.temporaryBytes) break;
        if (calls <= 1) break;
        for (const row of rows) { await repositories.voiceAudioArtifacts.delete(row.id); bytes -= bytesOf(row); evictedArtifactIds.push(row.id); }
        calls -= 1;
      }
      return Object.freeze({ evictedArtifactIds: Object.freeze(evictedArtifactIds), temporaryCalls: calls, temporaryBytes: Math.max(0, bytes), keptProtected: true });
    });
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

  async setCallKept({ scope: inputScope, callSessionId, kept }) {
    const scope = requireEventScope(inputScope);
    const id = requireText(callSessionId, 'callSessionId');
    const updated = await this.#unitOfWork.readwrite({ stores: ['voiceAudioArtifacts'], scope }, async repositories => {
      const rows = await repositories.voiceAudioArtifacts.listByIndex('by_scope_call', [scope.storyId, scope.branchId, id]);
      const output = [];
      for (const row of rows) {
        const next = normalizeVoiceAudioArtifact({ ...row, retention: kept ? VOICE_AUDIO_RETENTION.KEPT : VOICE_AUDIO_RETENTION.TEMPORARY, updatedAt: timestamp() });
        await repositories.voiceAudioArtifacts.put(next); output.push(next);
      }
      return Object.freeze(output);
    });
    if (!kept) await this.enforceRetention({ scope });
    return updated;
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
