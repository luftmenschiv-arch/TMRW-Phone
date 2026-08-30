import { defineProjector } from '../projections/projection-runner.mjs';
import { TIME_EVENT_TYPES } from './time-event-types.mjs';

export const ACTIVITY_SESSION_PROJECTOR_ID = 'tmrw-activity-session-v1';
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;
const headId = (scope, sessionId) => `activity-head:${scope.storyId}:${scope.branchId}:${sessionId}`;

function project(event) {
  if (event.eventType === TIME_EVENT_TYPES.ACTIVITY_SESSION_OPENED) {
    return [{ kind: 'activity-session-change', projectionKey: `open:${event.payload.session.id}`, groupKey: event.payload.session.id, data: { operation: 'open', session: event.payload.session } }];
  }
  if (event.eventType === TIME_EVENT_TYPES.ACTIVITY_SESSION_CLOSED) {
    return [{ kind: 'activity-session-change', projectionKey: `close:${event.payload.session.id}:${event.id}`, groupKey: event.payload.session.id, data: { operation: 'close', session: event.payload.session, durationEvidence: event.payload.durationEvidence } }];
  }
  return [];
}

function reduce(scope, sessionId, rows) {
  let state = null;
  for (const row of rows.sort((left, right) => left.sourceEventSequence - right.sourceEventSequence || left.id.localeCompare(right.id))) {
    if (row.data.operation === 'open') {
      state = {
        ...row.data.session,
        id: headId(scope, sessionId),
        sessionId,
        sourceOpenEventId: row.sourceEventId,
        sourceOpenSequence: row.sourceEventSequence,
        sourceCloseEventId: null,
        sourceCloseSequence: null,
        durationEvidence: null,
        revision: 1,
        phase: 4,
        updatedAt: row.updatedAt,
      };
    } else if (row.data.operation === 'close' && state) {
      state = {
        ...state,
        ...row.data.session,
        id: headId(scope, sessionId),
        sessionId,
        sourceCloseEventId: row.sourceEventId,
        sourceCloseSequence: row.sourceEventSequence,
        durationEvidence: row.data.durationEvidence,
        revision: state.revision + 1,
        updatedAt: row.updatedAt,
      };
    }
  }
  return state ? Object.freeze(state) : null;
}

async function groupRows(repositories, scope, sessionId) {
  return repositories.projections.listByIndexRange('by_scope_projector_group_sequence', {
    lower: [scope.storyId, scope.branchId, ACTIVITY_SESSION_PROJECTOR_ID, sessionId, 0],
    upper: [scope.storyId, scope.branchId, ACTIVITY_SESSION_PROJECTOR_ID, sessionId, MAX_SEQUENCE],
  });
}

async function materialize(repositories, scope, sessionId) {
  const rows = await groupRows(repositories, scope, sessionId);
  const current = reduce(scope, sessionId, rows);
  if (current) await repositories.activitySessions.put(current);
  else await repositories.activitySessions.delete(headId(scope, sessionId));
  return { sourceRowsRead: rows.length, rowsWritten: current ? 1 : 0 };
}

async function applyAggregate({ repositories, scope, previousRows, currentRows }) {
  const groups = new Set([...previousRows, ...currentRows].map(row => row.groupKey).filter(Boolean));
  let sourceRowsRead = 0;
  let rowsWritten = 0;
  for (const sessionId of groups) {
    const result = await materialize(repositories, scope, sessionId);
    sourceRowsRead += result.sourceRowsRead;
    rowsWritten += result.rowsWritten;
  }
  return { sourceRowsRead, rowsWritten };
}

async function rebuildAggregate({ repositories, scope }) {
  const existing = await repositories.activitySessions.list();
  for (const row of existing) await repositories.activitySessions.delete(row.id);
  const rows = await repositories.projections.listByIndex('by_scope_projector', [scope.storyId, scope.branchId, ACTIVITY_SESSION_PROJECTOR_ID]);
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.groupKey)) groups.set(row.groupKey, []);
    groups.get(row.groupKey).push(row);
  }
  for (const [sessionId, group] of groups) {
    const current = reduce(scope, sessionId, group);
    if (current) await repositories.activitySessions.put(current);
  }
  return { sourceRowsRead: rows.length, rowsWritten: groups.size };
}

export function createActivitySessionProjector() {
  return defineProjector({
    id: ACTIVITY_SESSION_PROJECTOR_ID,
    version: 1,
    stores: ['activitySessions'],
    project,
    applyAggregate,
    rebuildAggregate,
  });
}

export function activitySessionHeadId(scope, sessionId) {
  return headId(scope, sessionId);
}
