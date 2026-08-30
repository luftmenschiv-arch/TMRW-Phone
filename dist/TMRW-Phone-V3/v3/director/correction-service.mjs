import { requireEventScope } from '../domain/events/event-validator.mjs';
import { requireText } from '../domain/identity/identity-record.mjs';
import { DIRECTOR_EVENT_TYPES } from './event-types.mjs';
import { DirectorDependencyPreview } from './dependency-preview.mjs';

const sourceFor = key => ({ authority: 'tmrw-director', kind: 'director-correction', recordId: `director:${key}`, version: '1' });

function correctionSpec({ action, target, reason, directorActorId, affectedEventIds, previewId, changedFields = [], idempotencyKey, supersedesCorrectionEventId = null }) {
  return Object.freeze({
    eventType: DIRECTOR_EVENT_TYPES.CORRECTION,
    payload: { action, targetEventId: target.id, targetRevisionBefore: target.revision, targetRevisionAfter: target.revision + 1, reason, directorActorId: directorActorId || null, affectedEventIds, previewId, changedFields, supersedesCorrectionEventId },
    references: directorActorId ? [{ entityType: 'actor', id: directorActorId, role: 'director-actor' }] : [],
    source: sourceFor(idempotencyKey),
  });
}

export class DirectorCorrectionService {
  #events; #previews;
  constructor({ database, eventEngine, dependencyPreview = null }) { if (!database || !eventEngine) throw new TypeError('DirectorCorrectionService requires isolated storage and canonical Events'); this.#events = eventEngine; this.#previews = dependencyPreview || new DirectorDependencyPreview({ database }); }
  get lastPreviewMetrics() { return this.#previews.lastMetrics; }
  previewUndo(input) { return this.#previews.build(input); }
  savePreview(preview) { return this.#previews.save(preview); }

  async editEvent({ scope: inputScope, eventId, expectedRevision, payload, references, reason, directorActorId = null, idempotencyKey }) {
    const scope = requireEventScope(inputScope); const targetId = requireText(eventId, 'eventId');
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new TypeError('expectedRevision must be a positive integer');
    // Keep the correction request stable across retries. CanonicalEventEngine performs
    // the authoritative target/revision validation after checking idempotent replay.
    const fields = Object.keys(payload || {}).sort();
    const target = { id: targetId, revision: expectedRevision };
    return this.#events.revise({ scope, eventId: targetId, expectedRevision, payload, references, producer: 'tmrw-director', idempotencyKey, reason: requireText(reason, 'reason'), correction: correctionSpec({ action: 'edit', target, reason, directorActorId, affectedEventIds: [targetId], previewId: null, changedFields: fields, idempotencyKey }) });
  }

  async retractWithPreview({ scope: inputScope, preview, reason, directorActorId = null, idempotencyKey, action = 'make-non-canon' }) {
    const scope = requireEventScope(inputScope); if (preview.storyId !== scope.storyId || preview.branchId !== scope.branchId || preview.status !== 'ready' || preview.truncated) throw new Error('A complete matching impact preview is required');
    const target = { id: requireText(preview.targetEventId, 'preview.targetEventId'), revision: preview.targetRevision };
    // The Event transaction checks idempotency before validating freshness. This
    // preserves safe retry while a genuinely stale, new request still fails closed.
    return this.#events.retract({ scope, eventId: target.id, expectedRevision: target.revision, producer: 'tmrw-director', idempotencyKey, reason: requireText(reason, 'reason'), cascade: true, correction: correctionSpec({ action, target, reason, directorActorId, affectedEventIds: [...preview.affectedEventIds], previewId: preview.previewId, idempotencyKey }) });
  }
}
