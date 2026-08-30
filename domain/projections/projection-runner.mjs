import { requireText } from '../identity/identity-record.mjs';
import { V3EventValidationError, V3ProjectionStaleError } from '../../storage/errors.mjs';
import { assertEventJson } from '../events/event-validator.mjs';
import { createProjectionCheckpoint, projectionCheckpointId } from './projection-checkpoint.mjs';

export function defineProjector({ id, version, project, stores = [], applyAggregate = null, rebuildAggregate = null }) {
  const projectorId = requireText(id, 'projector.id');
  if (!Number.isInteger(version) || version < 1) throw new TypeError('projector.version must be a positive integer');
  if (typeof project !== 'function') throw new TypeError('projector.project must be a synchronous function');
  if (!Array.isArray(stores) || stores.some(store => typeof store !== 'string' || !store)) throw new TypeError('projector.stores must be an array of store names');
  if (applyAggregate !== null && typeof applyAggregate !== 'function') throw new TypeError('projector.applyAggregate must be a function');
  if (rebuildAggregate !== null && typeof rebuildAggregate !== 'function') throw new TypeError('projector.rebuildAggregate must be a function');
  if ((applyAggregate === null) !== (rebuildAggregate === null)) throw new TypeError('aggregate projectors require both applyAggregate and rebuildAggregate');
  return Object.freeze({ id: projectorId, version, project, stores: Object.freeze([...new Set(stores)]), applyAggregate, rebuildAggregate });
}

function projectionId(scope, projectorId, eventId, projectionKey) {
  return `projection:${scope.storyId}:${scope.branchId}:${projectorId}:${eventId}:${projectionKey}`;
}

function rowsForEvent({ scope, projector, event, updatedAt }) {
  if (event.status !== 'active') return [];
  const output = projector.project(structuredClone(event));
  if (output && typeof output.then === 'function') throw new V3EventValidationError(`Projector ${projector.id} must be synchronous inside the canonical transaction`);
  if (!Array.isArray(output)) throw new V3EventValidationError(`Projector ${projector.id} must return an array`);
  const keys = new Set();
  return output.map((candidate, index) => {
    const kind = requireText(candidate?.kind, `${projector.id}[${index}].kind`);
    const projectionKey = requireText(candidate?.projectionKey, `${projector.id}[${index}].projectionKey`);
    const groupKey = candidate?.groupKey === undefined || candidate?.groupKey === null
      ? null
      : requireText(candidate.groupKey, `${projector.id}[${index}].groupKey`);
    const unique = `${kind}:${projectionKey}`;
    if (keys.has(unique)) throw new V3EventValidationError(`Projector ${projector.id} produced duplicate key ${unique}`);
    keys.add(unique);
    return Object.freeze({
      id: projectionId(scope, projector.id, event.id, projectionKey),
      storyId: scope.storyId,
      branchId: scope.branchId,
      projectorId: projector.id,
      projectorVersion: projector.version,
      kind,
      projectionKey,
      groupKey,
      sourceEventId: event.id,
      sourceEventRevision: event.revision,
      sourceEventSequence: event.sequence,
      data: assertEventJson(candidate.data ?? null, 'projection data'),
      derived: true,
      updatedAt: event.updatedAt,
      phase: 3,
    });
  });
}

async function replaceEventRows({ repositories, scope, projector, event, updatedAt }) {
  const existing = await repositories.projections.listByIndex('by_scope_event_projector', [scope.storyId, scope.branchId, event.id, projector.id]);
  for (const row of existing) await repositories.projections.delete(row.id);
  const rows = rowsForEvent({ scope, projector, event, updatedAt });
  for (const row of rows) await repositories.projections.put(row);
  return { deleted: existing.length, written: rows.length, previousRows: existing, currentRows: rows };
}

export async function applyProjectorsIncrementally({ repositories, scope, event, projectors, expectedPriorCommitSequence, commitSequence, updatedAt }) {
  const metrics = { projectors: projectors.length, projectionsDeleted: 0, projectionsWritten: 0, aggregateSourceRowsRead: 0, aggregateRowsWritten: 0 };
  for (const projector of projectors) {
    const checkpoint = await repositories.projectionCheckpoints.get(projectionCheckpointId(scope, projector.id));
    if (checkpoint && (checkpoint.projectorVersion !== projector.version || checkpoint.lastCommitSequence !== expectedPriorCommitSequence)) {
      throw new V3ProjectionStaleError(projector.id);
    }
    if (!checkpoint && expectedPriorCommitSequence !== 0) throw new V3ProjectionStaleError(projector.id);
    const changed = await replaceEventRows({ repositories, scope, projector, event, updatedAt });
    metrics.projectionsDeleted += changed.deleted;
    metrics.projectionsWritten += changed.written;
    if (projector.applyAggregate) {
      const aggregate = await projector.applyAggregate({ repositories, scope, event, previousRows: changed.previousRows, currentRows: changed.currentRows, expectedPriorCommitSequence, commitSequence, updatedAt });
      metrics.aggregateSourceRowsRead += aggregate?.sourceRowsRead || 0;
      metrics.aggregateRowsWritten += aggregate?.rowsWritten || 0;
    }
    await repositories.projectionCheckpoints.put(createProjectionCheckpoint({
      scope,
      projector,
      lastCommitSequence: commitSequence,
      eventCount: null,
      updatedAt,
      mode: 'incremental',
    }));
  }
  return metrics;
}

export async function rebuildProjectors({ repositories, scope, projectors, currentCommitSequence, updatedAt }) {
  const events = (await repositories.events.list()).sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  const metrics = { sourceEventsRead: events.length, projectors: projectors.length, projectionsDeleted: 0, projectionsWritten: 0, aggregateSourceRowsRead: 0, aggregateRowsWritten: 0 };
  for (const projector of projectors) {
    const existing = await repositories.projections.listByIndex('by_scope_projector', [scope.storyId, scope.branchId, projector.id]);
    for (const row of existing) await repositories.projections.delete(row.id);
    metrics.projectionsDeleted += existing.length;
    for (const event of events) {
      const rows = rowsForEvent({ scope, projector, event, updatedAt });
      for (const row of rows) await repositories.projections.put(row);
      metrics.projectionsWritten += rows.length;
    }
    if (projector.rebuildAggregate) {
      const aggregate = await projector.rebuildAggregate({ repositories, scope, currentCommitSequence, updatedAt });
      metrics.aggregateSourceRowsRead += aggregate?.sourceRowsRead || 0;
      metrics.aggregateRowsWritten += aggregate?.rowsWritten || 0;
    }
    await repositories.projectionCheckpoints.put(createProjectionCheckpoint({
      scope,
      projector,
      lastCommitSequence: currentCommitSequence,
      eventCount: events.length,
      updatedAt,
      mode: 'full-rebuild',
    }));
  }
  return metrics;
}

export async function catchUpProjectors({ repositories, scope, projectors, currentCommitSequence, updatedAt }) {
  const metrics = { sourceEventsRead: 0, projectors: projectors.length, projectionsDeleted: 0, projectionsWritten: 0, aggregateSourceRowsRead: 0, aggregateRowsWritten: 0 };
  for (const projector of projectors) {
    const checkpoint = await repositories.projectionCheckpoints.get(projectionCheckpointId(scope, projector.id));
    if (checkpoint && checkpoint.projectorVersion !== projector.version) throw new V3ProjectionStaleError(projector.id);
    const from = (checkpoint?.lastCommitSequence || 0) + 1;
    if (from <= currentCommitSequence) {
      const events = await repositories.events.listByIndexRange('by_scope_commit_sequence', {
        lower: [scope.storyId, scope.branchId, from],
        upper: [scope.storyId, scope.branchId, currentCommitSequence],
      });
      metrics.sourceEventsRead += events.length;
      for (const event of events) {
        const changed = await replaceEventRows({ repositories, scope, projector, event, updatedAt });
        metrics.projectionsDeleted += changed.deleted;
        metrics.projectionsWritten += changed.written;
        if (projector.applyAggregate) {
          const aggregate = await projector.applyAggregate({ repositories, scope, event, previousRows: changed.previousRows, currentRows: changed.currentRows, expectedPriorCommitSequence: event.lastCommitSequence - 1, commitSequence: event.lastCommitSequence, updatedAt });
          metrics.aggregateSourceRowsRead += aggregate?.sourceRowsRead || 0;
          metrics.aggregateRowsWritten += aggregate?.rowsWritten || 0;
        }
      }
    }
    await repositories.projectionCheckpoints.put(createProjectionCheckpoint({
      scope,
      projector,
      lastCommitSequence: currentCommitSequence,
      eventCount: null,
      updatedAt,
      mode: 'checkpoint-catch-up',
    }));
  }
  return metrics;
}
