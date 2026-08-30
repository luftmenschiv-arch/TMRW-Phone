import { defineProjector } from '../domain/projections/projection-runner.mjs';
import { DIRECTOR_EVENT_TYPES, normalizeDirectorCorrection, normalizeDirectorMappingCorrection, normalizeDirectorValueLock, normalizeKnowledgeCorrection, normalizePromotion, normalizeScopeMove } from './event-types.mjs';

export const DIRECTOR_PROJECTOR_ID = 'tmrw-director-v1';
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;

function auditData(event, action, targetEventId, reason) {
  return { audit: { action, targetEventId: targetEventId || null, reason, provenance: event.provenance, sourceEventId: event.id } };
}

function project(event) {
  if (event.eventType === DIRECTOR_EVENT_TYPES.CORRECTION) {
    const correction = normalizeDirectorCorrection(event.payload);
    return [
      { kind: 'director-audit-source', projectionKey: `audit:${event.id}`, groupKey: `audit:${event.id}`, data: auditData(event, correction.action, correction.targetEventId, correction.reason) },
      { kind: 'director-retraction-batch-source', projectionKey: `batch:${event.id}`, groupKey: `batch:${event.id}`, data: { correction } },
    ];
  }
  if (event.eventType === DIRECTOR_EVENT_TYPES.VALUE_LOCK) {
    const lock = normalizeDirectorValueLock(event.payload);
    return [
      { kind: 'director-value-lock-source', projectionKey: `lock:${event.id}`, groupKey: `lock:${lock.lockId}`, data: { lock } },
      { kind: 'director-audit-source', projectionKey: `audit:${event.id}`, groupKey: `audit:${event.id}`, data: auditData(event, lock.locked ? 'lock-value' : 'unlock-value', null, lock.reason) },
    ];
  }
  if (event.eventType === DIRECTOR_EVENT_TYPES.MAPPING_CORRECTION) {
    const correction = normalizeDirectorMappingCorrection(event.payload);
    return [
      { kind: 'director-mapping-source', projectionKey: `mapping:${event.id}`, groupKey: `mapping:${correction.mapping.id}`, data: { correction } },
      { kind: 'director-audit-source', projectionKey: `audit:${event.id}`, groupKey: `audit:${event.id}`, data: auditData(event, 'mapping-correction', null, correction.reason) },
    ];
  }
  if (event.eventType === DIRECTOR_EVENT_TYPES.PROMOTE_TO_CANON) {
    const promotion = normalizePromotion(event.payload);
    return [
      { kind: 'director-promotion-source', projectionKey: `promotion:${event.id}`, groupKey: `promotion:${promotion.proposalId}`, data: { promotion } },
      { kind: 'director-audit-source', projectionKey: `audit:${event.id}`, groupKey: `audit:${event.id}`, data: auditData(event, 'promote-to-canon', null, promotion.reason) },
    ];
  }
  if (event.eventType === DIRECTOR_EVENT_TYPES.KNOWLEDGE_CORRECTION) {
    const correction = normalizeKnowledgeCorrection(event.payload);
    return [{ kind: 'director-audit-source', projectionKey: `audit:${event.id}`, groupKey: `audit:${event.id}`, data: auditData(event, 'knowledge-correction', null, correction.reason) }];
  }
  if (event.eventType === DIRECTOR_EVENT_TYPES.SCOPE_MOVE) {
    const move = normalizeScopeMove(event.payload);
    return [
      { kind: 'director-scope-move-source', projectionKey: `move:${event.id}`, groupKey: `move:${move.moveId}`, data: { move } },
      { kind: 'director-audit-source', projectionKey: `audit:${event.id}`, groupKey: `audit:${event.id}`, data: auditData(event, 'scope-move', move.sourceEventId, move.reason) },
    ];
  }
  return [];
}

async function groupRows(repositories, scope, groupKey) {
  return repositories.projections.listByIndexRange('by_scope_projector_group_sequence', { lower: [scope.storyId, scope.branchId, DIRECTOR_PROJECTOR_ID, groupKey, 0], upper: [scope.storyId, scope.branchId, DIRECTOR_PROJECTOR_ID, groupKey, MAX_SEQUENCE] });
}

const newest = rows => [...rows].sort((left, right) => left.sourceEventSequence - right.sourceEventSequence || left.id.localeCompare(right.id)).at(-1) || null;

async function materialize(repositories, scope, groupKey, updatedAt) {
  const rows = await groupRows(repositories, scope, groupKey);
  const row = newest(rows);
  if (groupKey.startsWith('audit:')) {
    const eventId = groupKey.slice(6); const id = `director-audit:${scope.storyId}:${scope.branchId}:${eventId}`;
    if (!row) await repositories.directorAudits.delete(id);
    else await repositories.directorAudits.put(Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, ...row.data.audit, sourceEventSequence: row.sourceEventSequence, updatedAt, phase: 14 }));
  } else if (groupKey.startsWith('batch:')) {
    const correctionEventId = groupKey.slice(6); const id = `director-retraction-batch:${scope.storyId}:${scope.branchId}:${correctionEventId}`;
    if (!row) await repositories.directorRetractionBatches.delete(id);
    else await repositories.directorRetractionBatches.put(Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, rootEventId: row.data.correction.targetEventId, correctionEventId, affectedEventIds: row.data.correction.affectedEventIds, action: row.data.correction.action, reason: row.data.correction.reason, status: row.data.correction.action === 'restore-canon' ? 'superseded' : 'applied', updatedAt, phase: 14 }));
    if (row && row.data.correction.action !== 'restore-canon') {
      for (const sourceEventId of row.data.correction.affectedEventIds) {
        const jobs = await repositories.jobs.listByIndex('by_scope_source_event', [scope.storyId, scope.branchId, sourceEventId]);
        for (const job of jobs) if (!['failed', 'cancelled', 'superseded'].includes(job.status)) await repositories.jobs.put(Object.freeze({ ...job, status: job.status === 'committed' ? 'superseded' : 'cancelled', cancellationReason: `director:${row.data.correction.action}:${correctionEventId}`, validatedOutput: null, updatedAt }));
      }
    }
  } else if (groupKey.startsWith('lock:')) {
    const lock = row?.data.lock; const id = groupKey.slice(5);
    if (row && lock.locked) await repositories.directorUserLocks.put(Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, ...lock, sourceEventId: row.sourceEventId, sourceEventSequence: row.sourceEventSequence, updatedAt, phase: 14 }));
    else if (row) await repositories.directorUserLocks.delete(id);
  } else if (groupKey.startsWith('mapping:') && row) {
    await repositories.identityMappings.put(Object.freeze({ ...row.data.correction.mapping, correctionSourceEventId: row.sourceEventId, correctionReason: row.data.correction.reason, updatedAt }));
  } else if (groupKey.startsWith('promotion:') && row) {
    const proposal = await repositories.directorPromotionProposals.get(row.data.promotion.proposalId);
    if (!proposal) throw new Error('Promote-to-Canon Event references an unknown proposal');
    await repositories.directorPromotionProposals.put(Object.freeze({ ...proposal, status: 'confirmed', canonicalEventId: row.sourceEventId, confirmedAt: updatedAt, updatedAt }));
  } else if (groupKey.startsWith('move:') && row) {
    const move = row.data.move;
    await repositories.directorScopeMoves.put(Object.freeze({ id: move.moveId, ...move, correctionEventId: row.sourceEventId, updatedAt, phase: 14 }));
  }
  return { sourceRowsRead: rows.length, rowsWritten: row ? 1 : 0 };
}

async function applyAggregate({ repositories, scope, previousRows, currentRows, updatedAt }) {
  let sourceRowsRead = 0; let rowsWritten = 0;
  for (const groupKey of new Set([...previousRows, ...currentRows].map(row => row.groupKey).filter(Boolean))) { const result = await materialize(repositories, scope, groupKey, updatedAt); sourceRowsRead += result.sourceRowsRead; rowsWritten += result.rowsWritten; }
  return { sourceRowsRead, rowsWritten, eventHistoryScans: 0 };
}

async function rebuildAggregate({ repositories, scope, updatedAt }) {
  for (const storeName of ['directorAudits', 'directorRetractionBatches', 'directorUserLocks']) for (const row of await repositories[storeName].list()) await repositories[storeName].delete(row.id);
  const rows = await repositories.projections.listByIndex('by_scope_projector', [scope.storyId, scope.branchId, DIRECTOR_PROJECTOR_ID]);
  let sourceRowsRead = 0; let rowsWritten = 0;
  for (const groupKey of new Set(rows.map(row => row.groupKey).filter(Boolean))) { const result = await materialize(repositories, scope, groupKey, updatedAt); sourceRowsRead += result.sourceRowsRead; rowsWritten += result.rowsWritten; }
  return { sourceRowsRead, rowsWritten };
}

export function createDirectorProjector() {
  return defineProjector({ id: DIRECTOR_PROJECTOR_ID, version: 1, stores: ['directorAudits', 'directorRetractionBatches', 'directorUserLocks', 'directorPromotionProposals', 'directorScopeMoves', 'identityMappings', 'jobs'], project, applyAggregate, rebuildAggregate });
}
