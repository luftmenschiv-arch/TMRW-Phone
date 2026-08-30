import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';
import { requireText } from '../domain/identity/identity-record.mjs';
import { requestDigest } from '../domain/events/idempotency.mjs';

export class DirectorDependencyPreview {
  #unit; #lastMetrics = Object.freeze({ operation: 'none' });
  constructor({ database }) { if (!database) throw new TypeError('DirectorDependencyPreview requires isolated v3 storage'); this.#unit = new V3UnitOfWork(database); }
  get lastMetrics() { return structuredClone(this.#lastMetrics); }

  async build({ scope: inputScope, targetEventId, maxEvents = 100, maxDepth = 16 }) {
    const scope = requireEventScope(inputScope); const rootId = requireText(targetEventId, 'targetEventId');
    if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 500 || !Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 64) throw new TypeError('Dependency preview bounds are invalid');
    const result = await this.#unit.readonly({ stores: ['events', 'eventCausalEdges', 'projections', 'knowledgeGrants', 'jobs'], scope }, async repositories => {
      const root = await repositories.events.get(rootId); if (!root || root.status !== 'active') throw new Error('Undo Canon target must be an active Event in this Story/Branch');
      const selected = new Set([rootId]); const queue = [{ id: rootId, depth: 0 }]; let edgeRowsRead = 0; let directEventReads = 1; let truncated = false;
      while (queue.length) {
        const current = queue.shift(); if (current.depth >= maxDepth) { truncated = true; continue; }
        const outgoing = await repositories.eventCausalEdges.listByIndex('by_scope_cause', [scope.storyId, scope.branchId, current.id]); edgeRowsRead += outgoing.length;
        for (const effectId of [...new Set(outgoing.map(edge => edge.effectEventId))].sort()) {
          if (selected.has(effectId)) continue;
          if (selected.size >= maxEvents) { truncated = true; break; }
          const effect = await repositories.events.get(effectId); directEventReads += 1; if (!effect || effect.status !== 'active') continue;
          const incoming = await repositories.eventCausalEdges.listByIndex('by_scope_effect', [scope.storyId, scope.branchId, effectId]); edgeRowsRead += incoming.length;
          let independentlySupported = false;
          for (const edge of incoming) { const source = await repositories.events.get(edge.causeEventId); directEventReads += 1; if (source?.status === 'active' && !selected.has(edge.causeEventId)) { independentlySupported = true; break; } }
          if (!independentlySupported) { selected.add(effectId); queue.push({ id: effectId, depth: current.depth + 1 }); }
        }
      }
      const affectedEventIds = [...selected]; let projectionCount = 0; let knowledgeGrantCount = 0; let aiJobCount = 0;
      for (const eventId of affectedEventIds) {
        projectionCount += (await repositories.projections.listByIndex('by_scope_source_event', [scope.storyId, scope.branchId, eventId])).length;
        knowledgeGrantCount += (await repositories.knowledgeGrants.listByIndex('by_scope_source_event', [scope.storyId, scope.branchId, eventId])).length;
        aiJobCount += (await repositories.jobs.listByIndex('by_scope_source_event', [scope.storyId, scope.branchId, eventId])).length;
      }
      const previewId = `director-preview:${(await requestDigest({ scope, rootId, revision: root.revision, affectedEventIds })).slice(0, 32)}`;
      return Object.freeze({ previewId, storyId: scope.storyId, branchId: scope.branchId, targetEventId: root.id, targetRevision: root.revision, affectedEventIds: Object.freeze(affectedEventIds), impact: Object.freeze({ eventCount: affectedEventIds.length, dependentEventCount: affectedEventIds.length - 1, projectionCount, knowledgeGrantCount, aiJobCount }), truncated, bounded: true, status: truncated ? 'incomplete' : 'ready' });
    });
    this.#lastMetrics = Object.freeze({ operation: 'dependency-preview', sourceEventsScanned: 0, eventHistoryScans: 0, storiesScanned: 0, branchesScanned: 0, affectedEvents: result.affectedEventIds.length, boundedAt: maxEvents });
    return result;
  }

  async save(preview) {
    const scope = requireEventScope(preview); if (preview.status !== 'ready' || preview.truncated) throw new Error('An incomplete dependency preview cannot be confirmed');
    return this.#unit.readwrite({ stores: ['directorDependencyPreviews', 'events'], scope }, async repositories => {
      const target = await repositories.events.get(preview.targetEventId); if (!target || target.status !== 'active' || target.revision !== preview.targetRevision) throw new Error('Dependency preview is stale');
      const row = Object.freeze({ id: preview.previewId, storyId: scope.storyId, branchId: scope.branchId, targetEventId: preview.targetEventId, targetRevision: preview.targetRevision, affectedEventIds: [...preview.affectedEventIds], impact: structuredClone(preview.impact), status: 'confirmed', createdAt: new Date().toISOString(), phase: 14 });
      await repositories.directorDependencyPreviews.put(row); return row;
    });
  }
}
