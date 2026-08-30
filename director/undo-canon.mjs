import { requireEventScope } from '../domain/events/event-validator.mjs';
import { requireText } from '../domain/identity/identity-record.mjs';
import { DIRECTOR_EVENT_TYPES, normalizeDirectorCorrection } from './event-types.mjs';
import { DirectorCorrectionService } from './correction-service.mjs';

const restoreCorrection = ({ target, priorCorrection, reason, directorActorId, idempotencyKey }) => ({
  eventType: DIRECTOR_EVENT_TYPES.CORRECTION,
  payload: { action: 'restore-canon', targetEventId: target.id, targetRevisionBefore: target.revision, targetRevisionAfter: target.revision + 1, reason, directorActorId: directorActorId || null, affectedEventIds: priorCorrection.affectedEventIds, previewId: priorCorrection.previewId, changedFields: [], supersedesCorrectionEventId: priorCorrection.correctionEventId },
  references: directorActorId ? [{ entityType: 'actor', id: directorActorId, role: 'director-actor' }] : [],
  source: { authority: 'tmrw-director', kind: 'director-restore', recordId: `director:${idempotencyKey}`, version: '1' },
});

export class UndoCanonService {
  #events; #corrections;
  constructor({ database, eventEngine }) { if (!database || !eventEngine) throw new TypeError('UndoCanonService requires isolated storage and canonical Events'); this.#events = eventEngine; this.#corrections = new DirectorCorrectionService({ database, eventEngine }); }
  get lastPreviewMetrics() { return this.#corrections.lastPreviewMetrics; }
  preview(input) { return this.#corrections.previewUndo(input); }
  async undo({ scope, preview, reason, directorActorId = null, idempotencyKey }) { return this.#corrections.retractWithPreview({ scope, preview, reason, directorActorId, idempotencyKey, action: 'make-non-canon' }); }
  async delete({ scope, preview, reason, directorActorId = null, idempotencyKey }) { return this.#corrections.retractWithPreview({ scope, preview, reason, directorActorId, idempotencyKey, action: 'director-delete' }); }

  async redo({ scope: inputScope, correctionEventId, reason, directorActorId = null, idempotencyKey }) {
    const scope = requireEventScope(inputScope); const correctionEvent = await this.#events.getEvent(scope, requireText(correctionEventId, 'correctionEventId')); if (!correctionEvent || correctionEvent.eventType !== DIRECTOR_EVENT_TYPES.CORRECTION) throw new Error('Redo requires a Director correction Event');
    const prior = normalizeDirectorCorrection(correctionEvent.payload); if (!['make-non-canon', 'director-delete'].includes(prior.action)) throw new Error('Only Event-level Undo/Delete corrections can be restored');
    const target = await this.#events.getEvent(scope, prior.targetEventId); if (!target || target.status !== 'retracted') throw new Error('Redo target is not retracted');
    return this.#events.restore({ scope, eventId: target.id, expectedRevision: target.revision, affectedEventIds: prior.affectedEventIds, producer: 'tmrw-director', idempotencyKey, reason: requireText(reason, 'reason'), correction: restoreCorrection({ target, priorCorrection: { ...prior, correctionEventId: correctionEvent.id }, reason, directorActorId, idempotencyKey }) });
  }
}
