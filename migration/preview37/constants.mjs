export const PREVIEW37_SOURCE_AUTHORITY = 'preview37';
export const PREVIEW37_MIGRATION_VERSION = 2;
export const PREVIEW37_MAX_QUARANTINE = 500;
export const PREVIEW37_MAX_ITEMS = 20_000;

export const PREVIEW37_PERSONAL_CLASSIFICATION = Object.freeze({
  ELIGIBLE: 'ELIGIBLE_CANONICAL_PERSONAL_DATA',
  AMBIGUOUS: 'AMBIGUOUS_QUARANTINE',
  MOCK: 'MOCK_GENERATED_EXCLUDE',
});

export const MIGRATION_ITEM_STATE = Object.freeze({
  READY: 'ready',
  ALREADY_MIGRATED: 'already-migrated',
  AMBIGUOUS: 'ambiguous',
  CONFLICT: 'conflict',
  UNSUPPORTED: 'unsupported',
  QUARANTINED: 'quarantined',
});

export const MIGRATION_BATCH_STATUS = Object.freeze({
  PLANNED: 'planned',
  MIGRATING: 'migrating',
  VALIDATING: 'validating',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  ROLLED_BACK: 'rolled-back',
  ROLLBACK_FAILED: 'rollback-failed',
});

export const MIGRATION_IMPORT_STATUS = Object.freeze({
  PENDING: 'pending',
  STAGED: 'staged',
  ACTIVE: 'active',
  RETRACTED: 'retracted',
  ROLLED_BACK: 'rolled-back',
});

export const migrationBatchId = sourceFingerprint => `preview37-migration:v${PREVIEW37_MIGRATION_VERSION}:${sourceFingerprint}`;
export const migrationItemId = (batchId, sourceRecordId) => `${batchId}:item:${sourceRecordId}`;
export const migrationImportId = canonicalEventId => `preview37-import:${canonicalEventId}`;
export const migrationActivationId = () => 'preview37-migration-active';

