import {
  V3_DATABASE_NAME,
  V3_SCHEMA_ID,
  V3_SCHEMA_METADATA_KEY,
  V3_SCHEMA_VERSION,
  normalizePreviewMigrationCurrentStorage,
  V3_STORE_DEFINITIONS,
  schemaMetadata,
} from './schema.mjs';
import { V3SchemaError } from './errors.mjs';

function createIndexedDbStore(database, transaction, storeName, definition) {
  const store = database.objectStoreNames.contains(storeName)
    ? transaction.objectStore(storeName)
    : database.createObjectStore(storeName, { keyPath: definition.keyPath });
  for (const index of definition.indexes) {
    if (!store.indexNames.contains(index.name)) {
      store.createIndex(index.name, index.keyPath, { unique: index.unique });
    }
  }
  return store;
}

function schedulePreviewMigrationCurrentStorageUpgrade(transaction, oldVersion) {
  if (oldVersion >= 19) return;
  const store = transaction.objectStore('previewMigrationItems');
  const request = store.openCursor();
  request.onerror = () => transaction.abort();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    try {
      const record = cursor.value;
      const current = normalizePreviewMigrationCurrentStorage(record?.current);
      if (record.current !== current) cursor.update({ ...record, current });
      cursor.continue();
    } catch {
      transaction.abort();
    }
  };
}

function schedulePreviewMigrationBatchVersionIndexUpgrade(transaction, oldVersion) {
  if (oldVersion >= 21) return;
  const store = transaction.objectStore('previewMigrationBatches');
  if (store.indexNames.contains('by_source_fingerprint')) store.deleteIndex('by_source_fingerprint');
  store.createIndex('by_source_fingerprint', ['sourceAuthority', 'migrationVersion', 'sourceFingerprint'], { unique: true });
}

export function applyIndexedDbUpgrade({ database, transaction, oldVersion, newVersion, now = new Date().toISOString() }) {
  if (newVersion !== V3_SCHEMA_VERSION || oldVersion < 0 || oldVersion >= newVersion) {
    throw new V3SchemaError(`Unsupported v3 schema upgrade ${oldVersion} -> ${newVersion}`);
  }
  for (const [storeName, definition] of Object.entries(V3_STORE_DEFINITIONS)) {
    createIndexedDbStore(database, transaction, storeName, definition);
  }
  schedulePreviewMigrationCurrentStorageUpgrade(transaction, oldVersion);
  schedulePreviewMigrationBatchVersionIndexUpgrade(transaction, oldVersion);
  transaction.objectStore('metadata').put(schemaMetadata(now));
  for (const migration of V3_SCHEMA_MIGRATIONS.filter(row => row.toVersion > oldVersion && row.toVersion <= newVersion)) {
    transaction.objectStore('migrations').put({
      id: `schema-${migration.toVersion}`,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
      name: migration.name,
      status: 'applied',
      appliedAt: now,
      databaseName: V3_DATABASE_NAME,
      schemaId: V3_SCHEMA_ID,
      legacyDataRead: migration.readsLegacyData,
      legacyDataWritten: migration.writesLegacyData,
    });
  }
}

export async function validateSchemaMetadata(database) {
  const row = await database.transaction(['metadata'], 'readonly', tx => tx.store('metadata').get(V3_SCHEMA_METADATA_KEY));
  if (!row || row.schemaId !== V3_SCHEMA_ID || row.schemaVersion !== V3_SCHEMA_VERSION || row.databaseName !== V3_DATABASE_NAME) {
    throw new V3SchemaError('The isolated v3 database metadata does not match the expected schema identity');
  }
  return row;
}

export const V3_SCHEMA_MIGRATIONS = Object.freeze([
  Object.freeze({
    fromVersion: 0,
    toVersion: 1,
    name: 'initialize-empty-isolated-v3-schema',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
  Object.freeze({
    fromVersion: 1,
    toVersion: 2,
    name: 'add-normalized-identity-kernel-stores-and-indexes',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
  Object.freeze({
    fromVersion: 2,
    toVersion: 3,
    name: 'add-canonical-event-journal-causality-and-projection-engine-stores',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
  Object.freeze({
    fromVersion: 3,
    toVersion: 4,
    name: 'add-branch-clock-pending-activity-heads-and-chronology-projection-indexes',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
  Object.freeze({
    fromVersion: 4,
    toVersion: 5,
    name: 'add-scoped-claims-audience-evidence-and-knowledge-grant-projections',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
  Object.freeze({
    fromVersion: 5,
    toVersion: 6,
    name: 'add-scoped-phone-state-account-session-and-player-access-override-projections',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
  Object.freeze({
    fromVersion: 6,
    toVersion: 7,
    name: 'add-scoped-contact-number-provenance-and-phone-ui-preference-stores',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
  Object.freeze({
    fromVersion: 7,
    toVersion: 8,
    name: 'add-scoped-canonical-thread-membership-message-and-recipient-projections',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
  Object.freeze({
    fromVersion: 8,
    toVersion: 9,
    name: 'add-scoped-canonical-call-session-participant-and-transcript-projections',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
  Object.freeze({
    fromVersion: 9,
    toVersion: 10,
    name: 'add-scoped-main-rp-handoff-proposal-link-and-live-source-cursor-stores',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
  Object.freeze({
    fromVersion: 10,
    toVersion: 11,
    name: 'add-isolated-read-only-pocket-shadow-capability-mapping-cursor-observation-quarantine-parity-and-call-fingerprint-stores',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
  Object.freeze({
    fromVersion: 11,
    toVersion: 12,
    name: 'add-preview37-copy-migration-manifest-item-mapping-quarantine-import-and-activation-stores',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
  Object.freeze({
    fromVersion: 12,
    toVersion: 13,
    name: 'add-milestone1-draft-reaction-sticker-voicemail-and-event-scoped-job-foundations',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
  Object.freeze({
    fromVersion: 13,
    toVersion: 14,
    name: 'add-director-correction-preview-lock-promotion-audit-and-scope-move-foundations',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
  Object.freeze({
    fromVersion: 14,
    toVersion: 15,
    name: 'add-scoped-social-persona-graph-post-comment-engagement-decision-and-asset-projections',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
  Object.freeze({
    fromVersion: 15,
    toVersion: 16,
    name: 'add-scoped-live-session-viewer-message-reaction-persona-and-archive-projections',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
  Object.freeze({
    fromVersion: 16,
    toVersion: 17,
    name: 'add-scoped-bounded-notification-and-phone-world-projections',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
  Object.freeze({
    fromVersion: 17,
    toVersion: 18,
    name: 'add-provider-neutral-voice-profile-instance-override-and-derived-audio-artifact-foundations',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
  Object.freeze({
    fromVersion: 18,
    toVersion: 19,
    name: 'normalize-preview-migration-current-index-key-to-numeric-sentinel',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
  Object.freeze({
    fromVersion: 19,
    toVersion: 20,
    name: 'add-scoped-phone-world-utility-projection-stores',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
  Object.freeze({
    fromVersion: 20,
    toVersion: 21,
    name: 'version-preview-migration-batch-source-fingerprint-index',
    readsLegacyData: false,
    writesLegacyData: false,
  }),
]);
