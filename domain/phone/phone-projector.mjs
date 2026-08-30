import { defineProjector } from '../projections/projection-runner.mjs';
import { PHONE_EVENT_TYPES } from './phone-event-types.mjs';
import { normalizePhoneState, phoneStateId } from './device-state.mjs';
import { normalizeAccountSession, accountSessionId } from './account-session.mjs';

export const PHONE_PROJECTOR_ID = 'tmrw-phone-state-v1';
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;

function rowsForEvent(event) {
  if (event.eventType === PHONE_EVENT_TYPES.DEVICE_STATE) {
    const state = normalizePhoneState(event.payload.state);
    return [{ kind: 'phone-device-change', projectionKey: `device:${state.deviceId}:${event.id}`, groupKey: `device:${state.deviceId}`, data: { state } }];
  }
  if (event.eventType === PHONE_EVENT_TYPES.ACCOUNT_SESSION) {
    const session = normalizeAccountSession(event.payload.session);
    return [{ kind: 'phone-account-change', projectionKey: `account:${session.accountId}:${event.id}`, groupKey: `account:${session.accountId}`, data: { session } }];
  }
  return [];
}

async function groupRows(repositories, scope, groupKey) {
  return repositories.projections.listByIndexRange('by_scope_projector_group_sequence', { lower: [scope.storyId, scope.branchId, PHONE_PROJECTOR_ID, groupKey, 0], upper: [scope.storyId, scope.branchId, PHONE_PROJECTOR_ID, groupKey, MAX_SEQUENCE] });
}

function newest(rows) {
  return [...rows].sort((left, right) => left.sourceEventSequence - right.sourceEventSequence || left.id.localeCompare(right.id)).at(-1) || null;
}

async function materializeGroup(repositories, scope, groupKey, updatedAt) {
  const rows = await groupRows(repositories, scope, groupKey);
  const row = newest(rows);
  if (groupKey.startsWith('device:')) {
    const deviceId = groupKey.slice('device:'.length);
    if (!row) await repositories.phoneStates.delete(phoneStateId(scope, deviceId));
    else await repositories.phoneStates.put(Object.freeze({ id: phoneStateId(scope, deviceId), storyId: scope.storyId, branchId: scope.branchId, ...row.data.state, sourceEventId: row.sourceEventId, sourceEventRevision: row.sourceEventRevision, sourceEventSequence: row.sourceEventSequence, updatedAt: row.updatedAt, phase: 6 }));
  } else {
    const accountId = groupKey.slice('account:'.length);
    if (!row) await repositories.accountSessions.delete(accountSessionId(scope, accountId));
    else await repositories.accountSessions.put(Object.freeze({ id: accountSessionId(scope, accountId), storyId: scope.storyId, branchId: scope.branchId, ...row.data.session, sourceEventId: row.sourceEventId, sourceEventRevision: row.sourceEventRevision, sourceEventSequence: row.sourceEventSequence, updatedAt: row.updatedAt, phase: 6 }));
  }
  return { sourceRowsRead: rows.length, rowsWritten: row ? 1 : 0 };
}

async function applyAggregate({ repositories, scope, previousRows, currentRows, updatedAt }) {
  const groups = new Set([...previousRows, ...currentRows].map(row => row.groupKey).filter(Boolean));
  let sourceRowsRead = 0; let rowsWritten = 0;
  for (const groupKey of groups) { const result = await materializeGroup(repositories, scope, groupKey, updatedAt); sourceRowsRead += result.sourceRowsRead; rowsWritten += result.rowsWritten; }
  return { sourceRowsRead, rowsWritten };
}

async function rebuildAggregate({ repositories, scope, updatedAt }) {
  const [states, sessions, rows] = await Promise.all([repositories.phoneStates.list(), repositories.accountSessions.list(), repositories.projections.listByIndex('by_scope_projector', [scope.storyId, scope.branchId, PHONE_PROJECTOR_ID])]);
  for (const row of states) await repositories.phoneStates.delete(row.id);
  for (const row of sessions) await repositories.accountSessions.delete(row.id);
  const groups = new Set(rows.map(row => row.groupKey).filter(Boolean));
  let sourceRowsRead = 0; let rowsWritten = 0;
  for (const groupKey of groups) { const result = await materializeGroup(repositories, scope, groupKey, updatedAt); sourceRowsRead += result.sourceRowsRead; rowsWritten += result.rowsWritten; }
  return { sourceRowsRead, rowsWritten };
}

export function createPhoneProjector() { return defineProjector({ id: PHONE_PROJECTOR_ID, version: 1, stores: ['phoneStates', 'accountSessions'], project: rowsForEvent, applyAggregate, rebuildAggregate }); }
