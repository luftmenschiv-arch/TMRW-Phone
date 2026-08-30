import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { POCKET_COMPARISON, POCKET_MATCH_STATE } from './constants.mjs';

export class PocketParityReporter {
  #unitOfWork;
  constructor({ database }) { this.#unitOfWork = new V3UnitOfWork(database); }
  async compare(observation) {
    if (observation.matchState !== POCKET_MATCH_STATE.EXACT) return Object.freeze({ observationId: observation.observationId, comparison: observation.matchState === POCKET_MATCH_STATE.UNSUPPORTED ? POCKET_COMPARISON.UNSUPPORTED : POCKET_COMPARISON.AMBIGUOUS, reason: observation.reason, canonicalCandidate: observation.canonical || {} });
    const canonical = observation.canonical || {}; let record = null; let kind = null;
    if (canonical.messageId) { kind = 'message'; record = await this.#unitOfWork.readonly({ stores: ['messages'], scope: observation.scope }, repositories => repositories.messages.getByIndex('by_scope_message', [observation.scope.storyId, observation.scope.branchId, canonical.messageId])); }
    else if (canonical.callSessionId) { kind = 'call'; record = await this.#unitOfWork.readonly({ stores: ['callSessions'], scope: observation.scope }, repositories => repositories.callSessions.getByIndex('by_scope_session', [observation.scope.storyId, observation.scope.branchId, canonical.callSessionId])); }
    else if (canonical.threadId) { kind = 'thread'; record = await this.#unitOfWork.readonly({ stores: ['threads'], scope: observation.scope }, repositories => repositories.threads.getByIndex('by_scope_thread', [observation.scope.storyId, observation.scope.branchId, canonical.threadId])); }
    if (!kind) return Object.freeze({ observationId: observation.observationId, comparison: POCKET_COMPARISON.POCKET_ONLY, reason: 'No explicit canonical comparison target is configured.', canonicalCandidate: canonical });
    if (!record) return Object.freeze({ observationId: observation.observationId, comparison: POCKET_COMPARISON.V3_ONLY, reason: `Explicit canonical ${kind} target does not exist in this scope.`, canonicalCandidate: canonical });
    const equivalent = kind === 'message' ? record.text === observation.content.text : kind === 'call' ? record.state !== 'ringing' : true;
    return Object.freeze({ observationId: observation.observationId, comparison: equivalent ? POCKET_COMPARISON.EQUIVALENT : POCKET_COMPARISON.CONFLICTING, reason: equivalent ? null : 'Pocket shadow content conflicts with the explicit canonical comparison target.', canonicalCandidate: canonical });
  }
}
