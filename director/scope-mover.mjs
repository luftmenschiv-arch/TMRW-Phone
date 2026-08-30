import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';
import { requestDigest } from '../domain/events/idempotency.mjs';
import { DIRECTOR_EVENT_TYPES } from './event-types.mjs';
import { DirectorCorrectionService } from './correction-service.mjs';

export class DirectorScopeMover {
  #unit; #events; #corrections;
  constructor({ database, eventEngine }) { if (!database || !eventEngine) throw new TypeError('DirectorScopeMover requires storage and Events'); this.#unit = new V3UnitOfWork(database); this.#events = eventEngine; this.#corrections = new DirectorCorrectionService({ database, eventEngine }); }
  async plan({ sourceScope: sourceInput, destinationScope: destinationInput, eventId, destinationReferences = null }) {
    const sourceScope = requireEventScope(sourceInput); const destinationScope = requireEventScope(destinationInput); const event = await this.#events.getEvent(sourceScope, eventId); if (!event || event.status !== 'active') throw new Error('Scope move source Event must be active');
    const destination = await this.#unit.readonly({ stores: ['stories', 'branches'], scope: destinationScope }, async repositories => ({ story: await repositories.stories.get(destinationScope.storyId), branch: await repositories.branches.get(destinationScope.branchId) })); if (!destination.story || !destination.branch) throw new Error('Scope move destination does not exist');
    if (!destinationReferences) throw new Error('Scope move requires explicit destination identity references; implicit cross-scope mapping is forbidden');
    const preview = await this.#corrections.previewUndo({ scope: sourceScope, targetEventId: event.id });
    return Object.freeze({ sourceScope, destinationScope, sourceEvent: event, destinationReferences: structuredClone(destinationReferences), undoPreview: preview, status: 'ready', failClosed: true });
  }
  async move({ plan, reason, directorActorId = null, idempotencyKey }) {
    if (plan?.status !== 'ready') throw new Error('A complete scope-move plan is required');
    const moveId = `director-scope-move:${(await requestDigest({ sourceScope: plan.sourceScope, destinationScope: plan.destinationScope, eventId: plan.sourceEvent.id, idempotencyKey })).slice(0, 32)}`;
    let destinationEvent = null;
    try {
      destinationEvent = (await this.#events.append({ scope: plan.destinationScope, eventType: plan.sourceEvent.eventType, payload: plan.sourceEvent.payload, references: plan.destinationReferences, causes: [], source: { authority: 'tmrw-director-scope-move', kind: 'canonical-copy', recordId: `${moveId}:destination`, version: '1' }, producer: 'tmrw-director', idempotencyKey: `${idempotencyKey}:destination` })).event;
      const sourceUndo = await this.#corrections.retractWithPreview({ scope: plan.sourceScope, preview: plan.undoPreview, reason, directorActorId, idempotencyKey: `${idempotencyKey}:source`, action: 'scope-move-source' });
      const audit = await this.#events.append({ scope: plan.destinationScope, eventType: DIRECTOR_EVENT_TYPES.SCOPE_MOVE, payload: { moveId, sourceStoryId: plan.sourceScope.storyId, sourceBranchId: plan.sourceScope.branchId, sourceEventId: plan.sourceEvent.id, destinationStoryId: plan.destinationScope.storyId, destinationBranchId: plan.destinationScope.branchId, destinationEventId: destinationEvent.id, reason }, references: directorActorId ? [{ entityType: 'actor', id: directorActorId, role: 'director-actor' }] : [], causes: [], source: { authority: 'tmrw-director', kind: 'scope-move-audit', recordId: `${moveId}:audit`, version: '1' }, producer: 'tmrw-director', idempotencyKey: `${idempotencyKey}:audit` });
      return Object.freeze({ moveId, destinationEvent, sourceCorrectionEvent: sourceUndo.correctionEvent, auditEvent: audit.event, recovery: 'complete' });
    } catch (error) {
      if (destinationEvent?.status === 'active') { try { await this.#events.retract({ scope: plan.destinationScope, eventId: destinationEvent.id, expectedRevision: destinationEvent.revision, producer: 'tmrw-director-recovery', idempotencyKey: `${idempotencyKey}:compensate`, reason: 'scope-move-failed-compensation', cascade: true }); } catch (recoveryError) { throw new AggregateError([error, recoveryError], 'Scope move failed and requires explicit recovery'); } }
      throw error;
    }
  }
}
