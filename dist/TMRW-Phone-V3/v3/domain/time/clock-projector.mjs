import { V3ChronologyError } from '../../storage/errors.mjs';
import { defineProjector } from '../projections/projection-runner.mjs';
import { addLocalDuration, normalizeClockAnchor } from './clock-anchor.mjs';
import { CLOCK_RECONCILIATION_OUTCOME } from './clock-reconciliation.mjs';
import { isClockEvidenceEvent, TIME_EVENT_TYPES } from './time-event-types.mjs';
import { normalizeTimeAdvance, timeAdvanceRank } from './time-advance.mjs';

export const CLOCK_PROJECTOR_ID = 'tmrw-story-clock-v1';
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;
const headId = scope => `clock-head:${scope.storyId}:${scope.branchId}`;
const eventCheckpointId = (scope, eventId) => `clock-event:${scope.storyId}:${scope.branchId}:${eventId}`;
const selectionId = (scope, activityId) => `clock-advance:${scope.storyId}:${scope.branchId}:${activityId}`;

export function emptyStoryClock(scope) {
  return Object.freeze({
    storyId: scope.storyId,
    branchId: scope.branchId,
    mode: 'unknown',
    ordinal: 0,
    revision: 0,
    activeAnchorEventId: null,
    activeAnchorSequence: 0,
    activeAnchorAuthority: null,
    precision: 'relative',
    anchorLocalDate: null,
    anchorLocalTime: null,
    timezone: null,
    elapsedOffsetMs: 0,
    timelineElapsedMs: 0,
    displayLocalDate: null,
    displayLocalTime: null,
    dayOffset: 0,
    confidence: null,
    conflictCount: 0,
    lastConflict: null,
    inheritedFrom: null,
    lastChronologyEventId: null,
    storyTimeRef: Object.freeze({ storyId: scope.storyId, branchId: scope.branchId, mode: 'unknown', anchorEventId: null, elapsedOffsetMs: 0, chronologyEventId: null }),
  });
}

function displayState(state) {
  const withReference = value => ({
    ...value,
    storyTimeRef: Object.freeze({
      storyId: value.storyId,
      branchId: value.branchId,
      mode: value.mode,
      anchorEventId: value.activeAnchorEventId,
      elapsedOffsetMs: value.elapsedOffsetMs,
      chronologyEventId: value.lastChronologyEventId,
    }),
  });
  if (!state.activeAnchorEventId || state.mode === 'conflicted') return withReference({ ...state, displayLocalDate: null, displayLocalTime: null, dayOffset: 0 });
  const display = addLocalDuration({ localDate: state.anchorLocalDate, localTime: state.anchorLocalTime }, state.elapsedOffsetMs);
  return withReference({ ...state, ...{ displayLocalDate: display.localDate, displayLocalTime: display.localTime, dayOffset: display.dayOffset } });
}

function evidenceForEvent(event) {
  const base = { eventType: event.eventType, eventId: event.id, eventSequence: event.sequence, eventRevision: event.revision, priorChronologyEventId: event.payload?.priorChronologyEventId ?? null };
  if (event.eventType === TIME_EVENT_TYPES.CLOCK_ANCHOR) return { ...base, evidenceKind: 'anchor', anchor: normalizeClockAnchor(event.payload.anchor) };
  if (event.eventType === TIME_EVENT_TYPES.CLOCK_RECONCILIATION) return { ...base, evidenceKind: 'reconciliation', anchor: normalizeClockAnchor(event.payload.anchor), outcome: event.payload.outcome, reason: event.payload.reason, priorAnchorEventId: event.payload.priorAnchorEventId, pausesExactTime: event.payload.pausesExactTime };
  if (event.eventType === TIME_EVENT_TYPES.TIME_ADVANCE) return { ...base, evidenceKind: 'advance', advance: normalizeTimeAdvance(event.payload.advance) };
  if (event.eventType === TIME_EVENT_TYPES.ACTIVITY_SESSION_CLOSED) return { ...base, evidenceKind: 'advance', advance: normalizeTimeAdvance(event.payload.durationEvidence) };
  if (event.eventType === TIME_EVENT_TYPES.BRANCH_FORK) return { ...base, evidenceKind: 'fork', parentStoryId: event.payload.parentStoryId, parentBranchId: event.payload.parentBranchId, parentForkOrdinal: event.payload.parentForkOrdinal, clockSnapshot: event.payload.clockSnapshot };
  if (event.payload?.storyClockAdvance) return { ...base, evidenceKind: 'advance', advance: normalizeTimeAdvance(event.payload.storyClockAdvance) };
  return null;
}

function applyAnchor(state, anchor, row) {
  return displayState({
    ...state,
    mode: anchor.precision === 'relative' ? 'relative' : 'anchored',
    activeAnchorEventId: row.sourceEventId,
    activeAnchorSequence: row.sourceEventSequence,
    activeAnchorAuthority: anchor.authority,
    precision: anchor.precision,
    anchorLocalDate: anchor.localDate,
    anchorLocalTime: anchor.localTime,
    timezone: anchor.timezone,
    elapsedOffsetMs: 0,
    confidence: anchor.confidence,
    lastConflict: null,
  });
}

async function applyAdvance(state, row, repositories, scope) {
  const advance = row.data.advance;
  const id = selectionId(scope, advance.sourceActivityId);
  const previous = await repositories.clockCheckpoints.get(id);
  const nextRank = timeAdvanceRank(advance);
  if (previous && (previous.rank > nextRank || (previous.rank === nextRank && previous.selectedSourceEventSequence > row.sourceEventSequence))) {
    return { state, selectionDelta: null };
  }
  const appliesAtOrdinal = previous?.appliesAtOrdinal ?? row.sourceEventSequence;
  const previousDuration = previous?.durationMs || 0;
  const delta = advance.durationMs - previousDuration;
  const nextSelection = Object.freeze({
    id, storyId: scope.storyId, branchId: scope.branchId, kind: 'advance-selection',
    selectedSourceEventId: row.sourceEventId, selectedSourceEventSequence: row.sourceEventSequence,
    activityId: advance.sourceActivityId, appliesAtOrdinal,
    durationMs: advance.durationMs, rank: nextRank, basis: advance.basis, confidence: advance.confidence,
    updatedAt: row.updatedAt, phase: 4,
  });
  await repositories.clockCheckpoints.put(nextSelection);
  const afterAnchor = !state.activeAnchorEventId || appliesAtOrdinal > state.activeAnchorSequence;
  const nextState = displayState({
    ...state,
    mode: state.activeAnchorEventId ? state.mode : 'relative',
    timelineElapsedMs: state.timelineElapsedMs + delta,
    elapsedOffsetMs: afterAnchor ? state.elapsedOffsetMs + delta : state.elapsedOffsetMs,
    confidence: state.activeAnchorEventId ? state.confidence : advance.confidence,
  });
  return { state: nextState, selectionDelta: { activityId: advance.sourceActivityId, previous: previous || null, next: nextSelection } };
}

async function reduceEvidence(stateInput, row, repositories, scope) {
  let state = { ...stateInput, ordinal: Math.max(stateInput.ordinal, row.sourceEventSequence), revision: stateInput.revision + 1, lastChronologyEventId: row.sourceEventId };
  let selectionDelta = null;
  if (row.data.evidenceKind === 'fork') {
    const inheritedAnchor = Boolean(row.data.clockSnapshot?.activeAnchorEventId);
    state = displayState({ ...emptyStoryClock(scope), ...row.data.clockSnapshot, storyId: scope.storyId, branchId: scope.branchId, ordinal: row.sourceEventSequence, revision: state.revision, activeAnchorEventId: inheritedAnchor ? row.sourceEventId : null, activeAnchorSequence: inheritedAnchor ? row.sourceEventSequence : 0, inheritedFrom: { storyId: row.data.parentStoryId, branchId: row.data.parentBranchId, ordinal: row.data.parentForkOrdinal }, lastChronologyEventId: row.sourceEventId });
  } else if (row.data.evidenceKind === 'anchor') {
    state = applyAnchor(state, row.data.anchor, row);
  } else if (row.data.evidenceKind === 'reconciliation') {
    if ([CLOCK_RECONCILIATION_OUTCOME.ACCEPTED, CLOCK_RECONCILIATION_OUTCOME.ACCEPTED_CORRECTION].includes(row.data.outcome)) {
      state = applyAnchor(state, row.data.anchor, row);
    } else {
      state = displayState({ ...state, mode: row.data.pausesExactTime ? 'conflicted' : state.mode, conflictCount: state.conflictCount + 1, lastConflict: { eventId: row.sourceEventId, outcome: row.data.outcome, reason: row.data.reason, proposedAnchor: row.data.anchor } });
    }
  } else if (row.data.evidenceKind === 'advance') {
    ({ state, selectionDelta } = await applyAdvance(state, row, repositories, scope));
  }
  return { state: Object.freeze(state), selectionDelta };
}

function createEventCheckpoint(scope, row, state, selectionDelta) {
  return Object.freeze({
    id: eventCheckpointId(scope, row.sourceEventId), storyId: scope.storyId, branchId: scope.branchId,
    kind: 'event-checkpoint', sourceEventId: row.sourceEventId, sourceEventSequence: row.sourceEventSequence,
    state: structuredClone(state), selectionDelta: structuredClone(selectionDelta), updatedAt: row.updatedAt, phase: 4,
  });
}

function createHead(scope, state, updatedAt) {
  return Object.freeze({
    id: headId(scope), storyId: scope.storyId, branchId: scope.branchId, kind: 'head',
    state: structuredClone(state), lastProjectedOrdinal: state.ordinal,
    activeAnchorEventId: state.activeAnchorEventId, accumulatedElapsedDuration: state.timelineElapsedMs,
    mode: state.mode, revision: state.revision, sourceEventId: undefined, sourceEventSequence: undefined,
    updatedAt, phase: 4,
  });
}

async function clockRows(repositories, scope, lowerSequence = 0) {
  return repositories.projections.listByIndexRange('by_scope_projector_sequence', {
    lower: [scope.storyId, scope.branchId, CLOCK_PROJECTOR_ID, lowerSequence],
    upper: [scope.storyId, scope.branchId, CLOCK_PROJECTOR_ID, MAX_SEQUENCE],
  });
}

async function rebuildAggregate({ repositories, scope, updatedAt }) {
  const existing = await repositories.clockCheckpoints.list();
  for (const row of existing) await repositories.clockCheckpoints.delete(row.id);
  const rows = await clockRows(repositories, scope, 0);
  let state = emptyStoryClock(scope);
  for (const row of rows) {
    const reduced = await reduceEvidence(state, row, repositories, scope);
    state = reduced.state;
    await repositories.clockCheckpoints.put(createEventCheckpoint(scope, row, state, reduced.selectionDelta));
  }
  await repositories.clockCheckpoints.put(createHead(scope, state, updatedAt));
  return { sourceRowsRead: rows.length, rowsWritten: rows.length + 1 };
}

async function rollbackSelections(checkpoints, repositories) {
  for (const checkpoint of [...checkpoints].sort((left, right) => right.sourceEventSequence - left.sourceEventSequence)) {
    const delta = checkpoint.selectionDelta;
    if (!delta) continue;
    const id = selectionId({ storyId: checkpoint.storyId, branchId: checkpoint.branchId }, delta.activityId);
    if (delta.previous) await repositories.clockCheckpoints.put(delta.previous);
    else await repositories.clockCheckpoints.delete(id);
  }
}

async function applyAggregate({ repositories, scope, event, updatedAt }) {
  if (!isClockEvidenceEvent(event)) return { sourceRowsRead: 0, rowsWritten: 0 };
  const head = await repositories.clockCheckpoints.get(headId(scope));
  const rowsForEvent = await repositories.projections.listByIndex('by_scope_event_projector', [scope.storyId, scope.branchId, event.id, CLOCK_PROJECTOR_ID]);
  const normalAppend = event.revision === 1 && event.status === 'active' && (!head || event.sequence > head.lastProjectedOrdinal);
  if (normalAppend) {
    const expectedPrior = event.payload.priorChronologyEventId ?? null;
    const actualPrior = head?.state.lastChronologyEventId ?? null;
    if (expectedPrior !== actualPrior) throw new V3ChronologyError('Chronology append does not continue the current Branch clock chain');
    const row = rowsForEvent[0];
    if (!row) throw new V3ChronologyError('Clock Event did not produce chronology evidence');
    const reduced = await reduceEvidence(head?.state || emptyStoryClock(scope), row, repositories, scope);
    await repositories.clockCheckpoints.put(createEventCheckpoint(scope, row, reduced.state, reduced.selectionDelta));
    await repositories.clockCheckpoints.put(createHead(scope, reduced.state, updatedAt));
    return { sourceRowsRead: 1, rowsWritten: 2 + (reduced.selectionDelta ? 1 : 0) };
  }

  const affectedCheckpoints = await repositories.clockCheckpoints.listByIndexRange('by_scope_ordinal', {
    lower: [scope.storyId, scope.branchId, event.sequence],
    upper: [scope.storyId, scope.branchId, MAX_SEQUENCE],
  });
  await rollbackSelections(affectedCheckpoints, repositories);
  for (const checkpoint of affectedCheckpoints) await repositories.clockCheckpoints.delete(checkpoint.id);
  const priorId = event.payload?.priorChronologyEventId;
  const prior = priorId ? await repositories.clockCheckpoints.get(eventCheckpointId(scope, priorId)) : null;
  let state = prior?.state || emptyStoryClock(scope);
  const rows = await clockRows(repositories, scope, event.sequence);
  for (const row of rows) {
    const reduced = await reduceEvidence(state, row, repositories, scope);
    state = reduced.state;
    await repositories.clockCheckpoints.put(createEventCheckpoint(scope, row, state, reduced.selectionDelta));
  }
  await repositories.clockCheckpoints.put(createHead(scope, state, updatedAt));
  return { sourceRowsRead: rows.length, rowsWritten: rows.length + 1 };
}

export function createClockProjector() {
  return defineProjector({
    id: CLOCK_PROJECTOR_ID,
    version: 1,
    stores: ['clockCheckpoints'],
    project: event => {
      const evidence = evidenceForEvent(event);
      return evidence ? [{ kind: 'story-clock-evidence', projectionKey: event.id, data: evidence }] : [];
    },
    applyAggregate,
    rebuildAggregate,
  });
}

export function storyClockHeadId(scope) {
  return headId(scope);
}
