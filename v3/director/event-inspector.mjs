import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';
import { requireText } from '../domain/identity/identity-record.mjs';
import { buildProvenanceView } from './provenance-view.mjs';

function requireDirector(access) {
  if (access?.kind !== 'director-tool' || access?.authorized !== true) throw new Error('Authorized Director access is required; Actor phone perspectives cannot inspect privileged canon');
  return Object.freeze({ actorId: access.actorId || null });
}

export class DirectorEventInspector {
  #unit;
  #lastMetrics = Object.freeze({ operation: 'none' });
  constructor({ database }) { if (!database) throw new TypeError('DirectorEventInspector requires isolated v3 storage'); this.#unit = new V3UnitOfWork(database); }
  get lastMetrics() { return structuredClone(this.#lastMetrics); }

  async inspect({ scope: inputScope, eventId, access, dependencyLimit = 50 }) {
    const scope = requireEventScope(inputScope); requireDirector(access); const id = requireText(eventId, 'eventId');
    if (!Number.isInteger(dependencyLimit) || dependencyLimit < 1 || dependencyLimit > 100) throw new TypeError('dependencyLimit must be 1–100');
    const result = await this.#unit.readonly({ stores: ['events', 'eventRevisions', 'eventCausalEdges', 'projections', 'knowledgeGrants', 'jobs', 'handoffLinks', 'previewMigrationImports', 'directorAudits'], scope }, async repositories => {
      const event = await repositories.events.get(id); if (!event) throw new Error('Canonical Event was not found in this Story/Branch');
      const [revisions, causes, effects, projections, grants, jobs, handoff, migration, audits] = await Promise.all([
        repositories.eventRevisions.listByIndex('by_scope_event', [scope.storyId, scope.branchId, id]),
        repositories.eventCausalEdges.listByIndex('by_scope_effect', [scope.storyId, scope.branchId, id]),
        repositories.eventCausalEdges.listByIndex('by_scope_cause', [scope.storyId, scope.branchId, id]),
        repositories.projections.listByIndex('by_scope_source_event', [scope.storyId, scope.branchId, id]),
        repositories.knowledgeGrants.listByIndex('by_scope_source_event', [scope.storyId, scope.branchId, id]),
        repositories.jobs.listByIndex('by_scope_source_event', [scope.storyId, scope.branchId, id]),
        repositories.handoffLinks.getByIndex('by_scope_event', [scope.storyId, scope.branchId, id]),
        repositories.previewMigrationImports.getByIndex('by_event', id),
        repositories.directorAudits.listByIndex('by_scope_target', [scope.storyId, scope.branchId, id]),
      ]);
      const bounded = rows => Object.freeze(rows.slice(0, dependencyLimit));
      return Object.freeze({
        event: Object.freeze({ id: event.id, eventType: event.eventType, storyId: event.storyId, branchId: event.branchId, sequence: event.sequence, revision: event.revision, status: event.status, references: event.references, actualActorId: event.payload?.actualActorId || event.payload?.message?.actualAuthorActorId || event.payload?.transcript?.actualAuthorActorId || null, actualAuthorActorId: event.payload?.message?.actualAuthorActorId || event.payload?.transcript?.actualAuthorActorId || event.payload?.voicemail?.actualAuthorActorId || null, payload: structuredClone(event.payload) }),
        provenance: buildProvenanceView(event),
        revisions: bounded(revisions.sort((a, b) => a.revision - b.revision)),
        causal: Object.freeze({ causes: bounded(causes), effects: bounded(effects), truncated: causes.length > dependencyLimit || effects.length > dependencyLimit }),
        consequences: Object.freeze({ projections: bounded(projections.map(row => ({ kind: row.kind, projectorId: row.projectorId, projectionKey: row.projectionKey }))), knowledgeGrantIds: bounded(grants.map(row => row.grantId)), aiJobs: bounded(jobs.map(row => ({ id: row.id, status: row.status, jobType: row.jobType }))), handoff: handoff ? { sourceAuthority: handoff.sourceAuthority, sourceMessageId: handoff.sourceMessageId, actionKey: handoff.actionKey } : null, migration: migration ? { sourceAuthority: migration.sourceAuthority, sourceRecordId: migration.sourceRecordId, batchId: migration.batchId } : null, directorAuditIds: bounded(audits.map(row => row.id)) }),
      });
    });
    this.#lastMetrics = Object.freeze({ operation: 'director-inspect', directEventReads: 1, indexedQueries: 9, eventHistoryScans: 0, storiesScanned: 0, branchesScanned: 0, boundedAt: dependencyLimit, writes: 0 });
    return result;
  }
}
