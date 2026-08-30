export class V3StorageError extends Error {
  constructor(message, code = 'V3_STORAGE_ERROR', options) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class V3StorageUnavailableError extends V3StorageError {
  constructor(message = 'IndexedDB is unavailable for the isolated TMRW v3 store', options) {
    super(message, 'V3_STORAGE_UNAVAILABLE', options);
  }
}

export class V3SchemaError extends V3StorageError {
  constructor(message, options) {
    super(message, 'V3_SCHEMA_ERROR', options);
  }
}

export class V3ScopeRequiredError extends V3StorageError {
  constructor(storeName) {
    super(`Story and Branch scope are required for repository: ${storeName}`, 'V3_SCOPE_REQUIRED');
    this.storeName = storeName;
  }
}

export class V3UniqueConstraintError extends V3StorageError {
  constructor(storeName, indexName) {
    super(`Unique index ${indexName} was violated in ${storeName}`, 'V3_UNIQUE_CONSTRAINT');
    this.storeName = storeName;
    this.indexName = indexName;
  }
}

export class V3RuntimeOwnershipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'V3RuntimeOwnershipError';
    this.code = 'V3_RUNTIME_OWNERSHIP';
  }
}

export class V3EventValidationError extends Error {
  constructor(message, code = 'V3_EVENT_VALIDATION') {
    super(message);
    this.name = 'V3EventValidationError';
    this.code = code;
  }
}

export class V3EventConflictError extends Error {
  constructor(message, code = 'V3_EVENT_CONFLICT') {
    super(message);
    this.name = 'V3EventConflictError';
    this.code = code;
  }
}

export class V3ProjectionStaleError extends Error {
  constructor(projectorId) {
    super(`Projection ${projectorId} requires a deterministic rebuild before incremental application`);
    this.name = 'V3ProjectionStaleError';
    this.code = 'V3_PROJECTION_STALE';
    this.projectorId = projectorId;
  }
}

export class V3ChronologyError extends Error {
  constructor(message, code = 'V3_CHRONOLOGY_ERROR') {
    super(message);
    this.name = 'V3ChronologyError';
    this.code = code;
  }
}

export class V3PendingWorldEventError extends Error {
  constructor(message, code = 'V3_PENDING_WORLD_EVENT_ERROR') {
    super(message);
    this.name = 'V3PendingWorldEventError';
    this.code = code;
  }
}

export class V3KnowledgeError extends Error {
  constructor(message, code = 'V3_KNOWLEDGE_ERROR') {
    super(message);
    this.name = 'V3KnowledgeError';
    this.code = code;
  }
}
