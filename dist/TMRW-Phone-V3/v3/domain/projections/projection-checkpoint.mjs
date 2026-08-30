export function projectionCheckpointId(scope, projectorId) {
  return `projection-checkpoint:${scope.storyId}:${scope.branchId}:${projectorId}`;
}

export function createProjectionCheckpoint({ scope, projector, lastCommitSequence, eventCount, updatedAt, mode }) {
  return Object.freeze({
    id: projectionCheckpointId(scope, projector.id),
    storyId: scope.storyId,
    branchId: scope.branchId,
    projectorId: projector.id,
    projectorVersion: projector.version,
    lastCommitSequence,
    eventCount,
    mode,
    status: 'ready',
    updatedAt,
    phase: 3,
  });
}
