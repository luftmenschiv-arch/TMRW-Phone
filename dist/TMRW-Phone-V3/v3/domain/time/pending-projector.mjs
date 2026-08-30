import { defineProjector } from '../projections/projection-runner.mjs';
import { PENDING_WORLD_STATUS, normalizePendingCreate, normalizePendingTransition } from './pending-world-event.mjs';
import { TIME_EVENT_TYPES } from './time-event-types.mjs';

export const PENDING_PROJECTOR_ID = 'tmrw-pending-world-v1';
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;
const pendingHeadId = (scope, pendingId) => `pending-head:${scope.storyId}:${scope.branchId}:${pendingId}`;

function rowsForEvent(event) {
  if (event.eventType === TIME_EVENT_TYPES.PENDING_CREATED) {
    const pending = normalizePendingCreate(event.payload.pending);
    return [{
      kind: 'pending-world-change',
      projectionKey: `create:${pending.pendingId}`,
      groupKey: pending.pendingId,
      data: { operation: 'create', pending },
    }];
  }
  if (event.eventType === TIME_EVENT_TYPES.PENDING_TRANSITION) {
    const transition = normalizePendingTransition(event.payload.transition);
    return [{
      kind: 'pending-world-change',
      projectionKey: `transition:${transition.pendingId}:${event.id}`,
      groupKey: transition.pendingId,
      data: { operation: 'transition', transition },
    }];
  }
  if (event.eventType === TIME_EVENT_TYPES.BRANCH_FORK) {
    return event.payload.pendingSnapshots.map(snapshot => {
      const pending = normalizePendingCreate(snapshot.pending);
      return {
        kind: 'pending-world-change',
        projectionKey: `fork:${pending.pendingId}`,
        groupKey: pending.pendingId,
        data: { operation: 'fork-create', pending, inheritedFrom: snapshot.inheritedFrom },
      };
    });
  }
  return [];
}

function reducePending(scope, pendingId, rows) {
  let state = null;
  let lastUpdatedAt = null;
  for (const row of rows.sort((left, right) => left.sourceEventSequence - right.sourceEventSequence || left.id.localeCompare(right.id))) {
    lastUpdatedAt = row.updatedAt;
    if (row.data.operation === 'create' || row.data.operation === 'fork-create') {
      const pending = row.data.pending;
      state = {
        id: pendingHeadId(scope, pendingId),
        storyId: scope.storyId,
        branchId: scope.branchId,
        pendingId,
        category: pending.category,
        summary: pending.summary,
        relevantActorIds: pending.relevantActorIds,
        relevantInstanceIds: pending.relevantInstanceIds,
        due: pending.due,
        awarenessPolicyRef: pending.awarenessPolicyRef,
        sourceDomainEventId: pending.sourceEventId,
        sourceCreateEventId: row.sourceEventId,
        sourceCreateSequence: row.sourceEventSequence,
        lifecycleStatus: PENDING_WORLD_STATUS.PENDING,
        status: PENDING_WORLD_STATUS.PENDING,
        lastTransitionEventId: null,
        lastTransitionSequence: null,
        resolutionReason: null,
        inheritedFrom: row.data.inheritedFrom || null,
        revision: 1,
        phase: 4,
      };
    } else if (row.data.operation === 'transition' && state) {
      state = {
        ...state,
        lifecycleStatus: row.data.transition.status,
        status: row.data.transition.status,
        lastTransitionEventId: row.sourceEventId,
        lastTransitionSequence: row.sourceEventSequence,
        resolutionReason: row.data.transition.reason,
        revision: state.revision + 1,
      };
    }
  }
  return state ? Object.freeze({ ...state, updatedAt: lastUpdatedAt }) : null;
}

async function groupRows(repositories, scope, pendingId) {
  return repositories.projections.listByIndexRange('by_scope_projector_group_sequence', {
    lower: [scope.storyId, scope.branchId, PENDING_PROJECTOR_ID, pendingId, 0],
    upper: [scope.storyId, scope.branchId, PENDING_PROJECTOR_ID, pendingId, MAX_SEQUENCE],
  });
}

async function materializeGroup(repositories, scope, pendingId, updatedAt) {
  const rows = await groupRows(repositories, scope, pendingId);
  const current = reducePending(scope, pendingId, rows);
  if (current) await repositories.pendingWorldEvents.put(current);
  else await repositories.pendingWorldEvents.delete(pendingHeadId(scope, pendingId));
  return { sourceRowsRead: rows.length, rowsWritten: current ? 1 : 0 };
}

async function applyAggregate({ repositories, scope, previousRows, currentRows, updatedAt }) {
  const groups = new Set([...previousRows, ...currentRows].map(row => row.groupKey).filter(Boolean));
  let sourceRowsRead = 0;
  let rowsWritten = 0;
  for (const pendingId of groups) {
    const result = await materializeGroup(repositories, scope, pendingId, updatedAt);
    sourceRowsRead += result.sourceRowsRead;
    rowsWritten += result.rowsWritten;
  }
  return { sourceRowsRead, rowsWritten };
}

async function rebuildAggregate({ repositories, scope, updatedAt }) {
  const existing = await repositories.pendingWorldEvents.list();
  for (const row of existing) await repositories.pendingWorldEvents.delete(row.id);
  const rows = await repositories.projections.listByIndex('by_scope_projector', [scope.storyId, scope.branchId, PENDING_PROJECTOR_ID]);
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.groupKey)) groups.set(row.groupKey, []);
    groups.get(row.groupKey).push(row);
  }
  for (const [pendingId, group] of groups) {
    const current = reducePending(scope, pendingId, group);
    if (current) await repositories.pendingWorldEvents.put(current);
  }
  return { sourceRowsRead: rows.length, rowsWritten: groups.size };
}

export function createPendingProjector() {
  return defineProjector({
    id: PENDING_PROJECTOR_ID,
    version: 1,
    stores: ['pendingWorldEvents'],
    project: rowsForEvent,
    applyAggregate,
    rebuildAggregate,
  });
}

export function pendingWorldEventHeadId(scope, pendingId) {
  return pendingHeadId(scope, pendingId);
}
