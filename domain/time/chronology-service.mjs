import { V3ChronologyError, V3PendingWorldEventError } from '../../storage/errors.mjs';
import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { requireEventScope } from '../events/event-validator.mjs';
import { deriveCanonicalEventId } from '../events/idempotency.mjs';
import { normalizeClockAnchor } from './clock-anchor.mjs';
import { closeActivitySession as closeSessionRecord, createActivitySession } from './activity-session.mjs';
import { activitySessionHeadId } from './activity-session-projector.mjs';
import { emptyStoryClock, storyClockHeadId } from './clock-projector.mjs';
import { reconcileClockAnchor } from './clock-reconciliation.mjs';
import {
  PENDING_WORLD_STATUS,
  derivePendingDueStatus,
  derivePendingWorldEventId,
  normalizePendingCreate,
  normalizePendingTransition,
} from './pending-world-event.mjs';
import { pendingWorldEventHeadId } from './pending-projector.mjs';
import { TIME_EVENT_TYPES } from './time-event-types.mjs';
import { normalizeTimeAdvance } from './time-advance.mjs';

function uniqueReferences(references) {
  const output = [];
  const seen = new Set();
  for (const reference of references || []) {
    const key = `${reference.entityType}:${reference.id}:${reference.role}`;
    if (!seen.has(key)) output.push(reference);
    seen.add(key);
  }
  return output;
}

function pendingReferences(pending, additional = []) {
  return uniqueReferences([
    ...pending.relevantActorIds.map(id => ({ entityType: 'actor', id, role: 'pending-relevant-actor' })),
    ...pending.relevantInstanceIds.map(id => ({ entityType: 'character-instance', id, role: 'pending-relevant-instance' })),
    ...additional,
  ]);
}

function currentPendingView(row, clock) {
  if (!row) return null;
  const status = row.lifecycleStatus === PENDING_WORLD_STATUS.PENDING
    ? derivePendingDueStatus(row, clock)
    : row.lifecycleStatus;
  return Object.freeze({ ...row, status });
}

export class StoryChronologyService {
  #unitOfWork;
  #events;

  constructor({ database, eventEngine }) {
    if (!database || !eventEngine) throw new TypeError('StoryChronologyService requires the isolated v3 database and canonical Event engine');
    this.#unitOfWork = new V3UnitOfWork(database);
    this.#events = eventEngine;
  }

  async #existingEvent(scope, source, producer, idempotencyKey) {
    const eventId = await deriveCanonicalEventId({
      scope,
      source: { authority: source?.authority, recordId: source?.recordId },
      producer,
      idempotencyKey,
    });
    return this.#events.getEvent(scope, eventId);
  }

  async readClock(scopeInput) {
    const scope = requireEventScope(scopeInput);
    return this.#unitOfWork.readonly({ stores: ['clockCheckpoints'], scope }, async repositories => {
      const head = await repositories.clockCheckpoints.get(storyClockHeadId(scope));
      return Object.freeze(structuredClone(head?.state || emptyStoryClock(scope)));
    });
  }

  async appendAnchor({ scope: inputScope, anchor: inputAnchor, references = [], source, producer, idempotencyKey, sourceEventId = null }) {
    const scope = requireEventScope(inputScope);
    const anchor = normalizeClockAnchor(inputAnchor);
    const [current, existing] = await Promise.all([this.readClock(scope), this.#existingEvent(scope, source, producer, idempotencyKey)]);
    const reconciliation = reconcileClockAnchor(current, anchor);
    const reconciliationEvent = existing ? existing.eventType === TIME_EVENT_TYPES.CLOCK_RECONCILIATION : reconciliation.kind === 'reconciliation';
    const priorChronologyEventId = existing?.payload.priorChronologyEventId ?? current.lastChronologyEventId;
    return this.#events.append({
      scope,
      eventType: reconciliationEvent ? TIME_EVENT_TYPES.CLOCK_RECONCILIATION : TIME_EVENT_TYPES.CLOCK_ANCHOR,
      payload: reconciliationEvent
        ? { ...(existing?.payload || {}), anchor, outcome: existing?.payload.outcome || reconciliation.outcome, reason: existing?.payload.reason || reconciliation.reason, priorAnchorEventId: existing?.payload.priorAnchorEventId ?? reconciliation.priorAnchorEventId, pausesExactTime: existing?.payload.pausesExactTime ?? reconciliation.pausesExactTime, priorChronologyEventId }
        : { anchor, priorChronologyEventId },
      references: uniqueReferences(references),
      causes: sourceEventId ? [sourceEventId] : [],
      source,
      producer,
      idempotencyKey,
    });
  }

  async appendAdvance({ scope: inputScope, advance: inputAdvance, references = [], source, producer, idempotencyKey, sourceEventId = null }) {
    const scope = requireEventScope(inputScope);
    const advance = normalizeTimeAdvance(inputAdvance);
    const [current, existing] = await Promise.all([this.readClock(scope), this.#existingEvent(scope, source, producer, idempotencyKey)]);
    return this.#events.append({
      scope,
      eventType: TIME_EVENT_TYPES.TIME_ADVANCE,
      payload: { advance, priorChronologyEventId: existing?.payload.priorChronologyEventId ?? current.lastChronologyEventId },
      references: uniqueReferences(references),
      causes: sourceEventId ? [sourceEventId] : [],
      source,
      producer,
      idempotencyKey,
    });
  }

  async createPending({ scope: inputScope, pending: inputPending, references = [], source, producer, idempotencyKey }) {
    const scope = requireEventScope(inputScope);
    const pendingId = inputPending?.pendingId || await derivePendingWorldEventId({
      scope,
      sourceAuthority: source?.authority,
      sourceRecordId: source?.recordId,
      producer,
      idempotencyKey,
    });
    const pending = normalizePendingCreate({ ...inputPending, pendingId });
    return this.#events.append({
      scope,
      eventType: TIME_EVENT_TYPES.PENDING_CREATED,
      payload: { pending },
      references: pendingReferences(pending, references),
      causes: pending.sourceEventId ? [pending.sourceEventId] : [],
      source,
      producer,
      idempotencyKey,
    });
  }

  async transitionPending({ scope: inputScope, transition: inputTransition, references = [], source, producer, idempotencyKey, sourceEventId = null }) {
    const scope = requireEventScope(inputScope);
    const transition = normalizePendingTransition(inputTransition);
    const current = await this.getPending(scope, transition.pendingId);
    if (!current) throw new V3PendingWorldEventError('Pending World Event does not exist in this Story/Branch');
    if (current.lifecycleStatus !== PENDING_WORLD_STATUS.PENDING) {
      const candidateEventId = await deriveCanonicalEventId({
        scope,
        source: { authority: source?.authority, recordId: source?.recordId },
        producer,
        idempotencyKey,
      });
      if (current.lastTransitionEventId !== candidateEventId) throw new V3PendingWorldEventError('Pending World Event is already terminal');
    }
    return this.#events.append({
      scope,
      eventType: TIME_EVENT_TYPES.PENDING_TRANSITION,
      payload: { transition },
      references: pendingReferences(current, references),
      causes: [...new Set([current.sourceCreateEventId, sourceEventId].filter(Boolean))],
      source,
      producer,
      idempotencyKey,
    });
  }

  async getPending(scopeInput, pendingId) {
    const scope = requireEventScope(scopeInput);
    return this.#unitOfWork.readonly({ stores: ['pendingWorldEvents', 'clockCheckpoints'], scope }, async repositories => {
      const [row, clockHead] = await Promise.all([
        repositories.pendingWorldEvents.get(pendingWorldEventHeadId(scope, pendingId)),
        repositories.clockCheckpoints.get(storyClockHeadId(scope)),
      ]);
      return currentPendingView(row, clockHead?.state || emptyStoryClock(scope));
    });
  }

  async listPending(scopeInput, { lifecycleStatus = null } = {}) {
    const scope = requireEventScope(scopeInput);
    return this.#unitOfWork.readonly({ stores: ['pendingWorldEvents', 'clockCheckpoints'], scope }, async repositories => {
      const [rows, clockHead] = await Promise.all([
        lifecycleStatus
          ? repositories.pendingWorldEvents.listByIndex('by_scope_status', [scope.storyId, scope.branchId, lifecycleStatus])
          : repositories.pendingWorldEvents.list(),
        repositories.clockCheckpoints.get(storyClockHeadId(scope)),
      ]);
      const clock = clockHead?.state || emptyStoryClock(scope);
      return rows.map(row => currentPendingView(row, clock)).sort((left, right) => left.sourceCreateSequence - right.sourceCreateSequence || left.pendingId.localeCompare(right.pendingId));
    });
  }

  async openActivitySession({ scope: inputScope, sessionId, interactionType = 'message', startedOrdinal, turnCount = 0, contentCharacters = 0, references = [], source, producer, idempotencyKey }) {
    const scope = requireEventScope(inputScope);
    const session = createActivitySession({ id: sessionId, scope, interactionType, startedOrdinal, turnCount, contentCharacters });
    return this.#events.append({
      scope,
      eventType: TIME_EVENT_TYPES.ACTIVITY_SESSION_OPENED,
      payload: { session },
      references: uniqueReferences(references),
      causes: [],
      source,
      producer,
      idempotencyKey,
    });
  }

  async getActivitySession(scopeInput, sessionId) {
    const scope = requireEventScope(scopeInput);
    return this.#unitOfWork.readonly({ stores: ['activitySessions'], scope }, repositories => repositories.activitySessions.get(activitySessionHeadId(scope, sessionId)));
  }

  async closeActivitySession({ scope: inputScope, sessionId, boundary, closedOrdinal, references = [], source, producer, idempotencyKey, sourceEventId = null }) {
    const scope = requireEventScope(inputScope);
    const existing = await this.#existingEvent(scope, source, producer, idempotencyKey);
    if (existing) {
      const requestedSession = { ...existing.payload.session, boundary, closedOrdinal };
      return this.#events.append({
        scope,
        eventType: existing.eventType,
        payload: { ...existing.payload, session: requestedSession },
        references: uniqueReferences(references),
        causes: [...new Set([existing.payload.session?.sourceOpenEventId, existing.causes?.[0], sourceEventId].filter(Boolean))],
        source,
        producer,
        idempotencyKey,
      });
    }
    const [current, clock] = await Promise.all([this.getActivitySession(scope, sessionId), this.readClock(scope)]);
    if (!current) throw new V3ChronologyError('Activity Session does not exist in this Story/Branch');
    const closed = closeSessionRecord({ ...current, id: current.sessionId }, { boundary, closedOrdinal });
    if (!closed.durationEvidence) throw new V3ChronologyError('This Phase 4 Activity Session type has no deterministic duration policy');
    return this.#events.append({
      scope,
      eventType: TIME_EVENT_TYPES.ACTIVITY_SESSION_CLOSED,
      payload: { session: closed.session, durationEvidence: closed.durationEvidence, priorChronologyEventId: clock.lastChronologyEventId },
      references: uniqueReferences(references),
      causes: [...new Set([current.sourceOpenEventId, sourceEventId].filter(Boolean))],
      source,
      producer,
      idempotencyKey,
    });
  }

  async forkFromSnapshot({ parentScope: inputParentScope, childScope: inputChildScope, instanceIdMap = {}, references = [], source, producer, idempotencyKey }) {
    const parentScope = requireEventScope(inputParentScope);
    const childScope = requireEventScope(inputChildScope);
    if (parentScope.storyId !== childScope.storyId) throw new V3ChronologyError('A Branch chronology fork must remain inside its Story');
    const relation = await this.#unitOfWork.readonly({ stores: ['branches'], privileged: true }, async repositories => ({
      parent: await repositories.branches.get(parentScope.branchId),
      child: await repositories.branches.get(childScope.branchId),
    }));
    if (!relation.parent || !relation.child || relation.child.storyId !== parentScope.storyId || relation.child.parentBranchId !== relation.parent.id) {
      throw new V3ChronologyError('Child Branch identity does not point to the requested parent Branch');
    }
    const existing = await this.#existingEvent(childScope, source, producer, idempotencyKey);
    if (existing) {
      return this.#events.append({
        scope: childScope,
        eventType: existing.eventType,
        payload: existing.payload,
        references: existing.references,
        causes: existing.causes,
        source,
        producer,
        idempotencyKey,
      });
    }
    const childClock = await this.readClock(childScope);
    if (childClock.lastChronologyEventId) throw new V3ChronologyError('Child Branch already has chronology evidence');
    const [parentClock, parentPending] = await Promise.all([
      this.readClock(parentScope),
      this.listPending(parentScope),
    ]);
    const active = parentPending.filter(item => [PENDING_WORLD_STATUS.PENDING, PENDING_WORLD_STATUS.DUE, PENDING_WORLD_STATUS.CONFLICTED].includes(item.status));
    const pendingSnapshots = [];
    const forkReferences = [...references];
    for (const item of active) {
      const pendingId = await derivePendingWorldEventId({ scope: childScope, sourceAuthority: 'tmrw-v3-branch-fork', sourceRecordId: item.pendingId, producer, idempotencyKey });
      const pending = normalizePendingCreate({
        pendingId,
        category: item.category,
        summary: item.summary,
        relevantActorIds: item.relevantActorIds,
        relevantInstanceIds: item.relevantInstanceIds.map(id => instanceIdMap[id]).filter(Boolean),
        due: item.due,
        sourceEventId: null,
        awarenessPolicyRef: item.awarenessPolicyRef,
      });
      pendingSnapshots.push({ pending, inheritedFrom: { storyId: parentScope.storyId, branchId: parentScope.branchId, pendingId: item.pendingId, sourceCreateEventId: item.sourceCreateEventId } });
      forkReferences.push(...pendingReferences(pending));
    }
    const clockSnapshot = structuredClone(parentClock);
    return this.#events.append({
      scope: childScope,
      eventType: TIME_EVENT_TYPES.BRANCH_FORK,
      payload: {
        parentStoryId: parentScope.storyId,
        parentBranchId: parentScope.branchId,
        parentForkOrdinal: parentClock.ordinal,
        clockSnapshot,
        pendingSnapshots,
        priorChronologyEventId: null,
      },
      references: uniqueReferences(forkReferences),
      causes: [],
      source,
      producer,
      idempotencyKey,
    });
  }
}

export function createStoryChronologyService(options) {
  return new StoryChronologyService(options);
}
