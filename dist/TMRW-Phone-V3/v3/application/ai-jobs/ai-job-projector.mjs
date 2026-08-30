import { defineProjector } from '../../domain/projections/projection-runner.mjs';
import { projectionCheckpointId } from '../../domain/projections/projection-checkpoint.mjs';
import { KNOWLEDGE_GRANT_PROJECTOR_ID } from '../../domain/knowledge/grant-projector.mjs';

export const AI_JOB_PROJECTOR_ID = 'tmrw-event-scoped-ai-jobs-v1';

function project(event) {
  const commit = event.payload?.aiJobCommit;
  if (!commit?.jobId || !commit?.sourceEventId || !commit?.outputDigest) return [];
  return [{ kind: 'ai-job-commit-source', projectionKey: `job:${commit.jobId}`, groupKey: `job:${commit.jobId}`, data: { commit, resultEventType: event.eventType } }];
}

async function rows(repositories, scope, groupKey) { return repositories.projections.listByIndexRange('by_scope_projector_group_sequence', { lower: [scope.storyId, scope.branchId, AI_JOB_PROJECTOR_ID, groupKey, 0], upper: [scope.storyId, scope.branchId, AI_JOB_PROJECTOR_ID, groupKey, Number.MAX_SAFE_INTEGER] }); }

async function applyJob(repositories, scope, groupKey, updatedAt) {
  const jobId = groupKey.slice(4); const job = await repositories.jobs.get(jobId); if (!job) throw new Error(`Canonical AI consequence references unknown job: ${jobId}`); const current = (await rows(repositories, scope, groupKey)).sort((a, b) => a.sourceEventSequence - b.sourceEventSequence).at(-1);
  if (!current) { if (job.status === 'committed') await repositories.jobs.put(Object.freeze({ ...job, status: 'superseded', resultEventId: null, updatedAt })); return { sourceRowsRead: 0, rowsWritten: job.status === 'committed' ? 1 : 0 }; }
  const commit = current.data.commit; const replayingCommitted = job.status === 'committed' && job.resultEventId === current.sourceEventId;
  if (job.status !== 'validated' && !replayingCommitted) throw new Error('AI job is no longer eligible for canonical commit');
  if (commit.sourceEventId !== job.sourceEventId || commit.outputDigest !== job.outputDigest || commit.attemptId !== job.attemptId) throw new Error('AI job commit provenance does not match the validated job');
  if (job.actionType && commit.actionType !== job.actionType) throw new Error('AI job canonical action type does not match its authorization envelope');
  for (const field of ['targetActorId', 'targetInstanceId', 'targetAccountId', 'targetDeviceId']) if ((job[field] || null) !== (commit[field] || null)) throw new Error(`AI job ${field} does not match its canonical authorization envelope`);
  if (job.allowedEventTypes?.length && !job.allowedEventTypes.includes(current.data.resultEventType)) throw new Error('AI job attempted to commit an unauthorized canonical Event type');
  if (!replayingCommitted) { const source = await repositories.events.get(job.sourceEventId); if (!source || source.status !== 'active' || source.revision !== job.sourceEventRevision || source.currentRevisionId !== job.sourceRevisionId || commit.sourceEventRevision !== job.sourceEventRevision || commit.sourceRevisionId !== job.sourceRevisionId) throw new Error('AI job source Event changed before canonical commit');
    if (job.contextAuthorizationRevision != null) { const checkpoint = await repositories.projectionCheckpoints.get(projectionCheckpointId(scope, KNOWLEDGE_GRANT_PROJECTOR_ID)); const resultEvent = await repositories.events.get(current.sourceEventId); const expectedResultSequence = job.contextAuthorizationRevision + 1; if ((checkpoint?.lastCommitSequence || 0) !== resultEvent?.lastCommitSequence || resultEvent?.lastCommitSequence !== expectedResultSequence || commit.contextAuthorizationRevision !== job.contextAuthorizationRevision) throw new Error('AI job authorized Knowledge context changed before canonical commit'); } }
  await repositories.jobs.put(Object.freeze({ ...job, status: 'committed', resultEventId: current.sourceEventId, committedAt: updatedAt, updatedAt })); return { sourceRowsRead: 1, rowsWritten: 1 };
}

async function applyAggregate({ repositories, scope, previousRows, currentRows, updatedAt }) { let sourceRowsRead = 0; let rowsWritten = 0; for (const groupKey of new Set([...previousRows, ...currentRows].map(row => row.groupKey))) { const result = await applyJob(repositories, scope, groupKey, updatedAt); sourceRowsRead += result.sourceRowsRead; rowsWritten += result.rowsWritten; } return { sourceRowsRead, rowsWritten, eventHistoryScans: 0 }; }
async function rebuildAggregate({ repositories, scope, updatedAt }) { const projectionRows = await repositories.projections.listByIndex('by_scope_projector', [scope.storyId, scope.branchId, AI_JOB_PROJECTOR_ID]); const groups = new Set(projectionRows.map(row => row.groupKey)); let sourceRowsRead = 0; let rowsWritten = 0; for (const job of await repositories.jobs.list()) { const groupKey = `job:${job.id}`; if (!groups.has(groupKey) && job.status === 'committed') { await repositories.jobs.put(Object.freeze({ ...job, status: 'superseded', resultEventId: null, updatedAt })); rowsWritten += 1; } } for (const groupKey of groups) { const result = await applyJob(repositories, scope, groupKey, updatedAt); sourceRowsRead += result.sourceRowsRead; rowsWritten += result.rowsWritten; } return { sourceRowsRead, rowsWritten }; }

export function createAiJobProjector() { return defineProjector({ id: AI_JOB_PROJECTOR_ID, version: 1, stores: ['jobs'], project, applyAggregate, rebuildAggregate }); }
