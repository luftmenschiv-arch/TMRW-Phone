const checkpointKey = (storyId, branchId, name) => `checkpoint:${storyId}:${branchId}:${name}`;

function requireScope(scope) {
  if (!scope?.storyId || !scope?.branchId) throw new Error('Checkpoint Story and Branch scope are required');
}

export class V3CheckpointRepository {
  #database;

  constructor(database) {
    this.#database = database;
  }

  async read(scope, name) {
    requireScope(scope);
    return this.#database.transaction(['metadata'], 'readonly', tx => tx.store('metadata').get(checkpointKey(scope.storyId, scope.branchId, name)));
  }

  async write(scope, name, value, now = new Date().toISOString()) {
    requireScope(scope);
    const record = { key: checkpointKey(scope.storyId, scope.branchId, name), storyId: scope.storyId, branchId: scope.branchId, name, value: structuredClone(value), updatedAt: now };
    await this.#database.transaction(['metadata'], 'readwrite', tx => tx.store('metadata').put(record));
    return record;
  }
}
