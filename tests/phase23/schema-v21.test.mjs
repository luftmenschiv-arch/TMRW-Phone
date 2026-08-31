import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryV3Database } from '../../storage/memory-v3-database.mjs';
import { V3_DATABASE_NAME, V3_SCHEMA_ID, V3_SCHEMA_VERSION } from '../../storage/schema.mjs';

function v20Registry() {
  const registry = MemoryV3Database.createRegistry();
  const batch = Object.freeze({
    id: 'preview37-migration:fp-shared',
    entityType: 'preview37-migration-batch',
    sourceAuthority: 'preview37',
    migrationVersion: 1,
    sourceFingerprint: 'fp-shared',
    sourceVersion: '2',
    sourceLocation: 'legacy-preview',
    planFingerprint: 'legacy-plan',
    status: 'completed',
    checkpointOrdinal: 3,
    activationStatus: 'active',
    counts: { ready: 4 },
    validation: { passed: true },
    priorActiveBatchId: null,
    identityManifestIds: ['legacy-identity'],
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    phase: 12,
  });
  registry.set(V3_DATABASE_NAME, {
    version: 20,
    stores: new Map([
      ['metadata', new Map([['schema', { key: 'schema', schemaId: V3_SCHEMA_ID, schemaVersion: 20, databaseName: V3_DATABASE_NAME }]])],
      ['migrations', new Map([['schema-20', { id: 'schema-20', fromVersion: 19, toVersion: 20, status: 'applied' }]])],
      ['previewMigrationBatches', new Map([[batch.id, structuredClone(batch)]])],
    ]),
    connections: 0,
    writeCommits: 4,
    lastCommit: { stores: ['previewMigrationBatches'] },
  });
  registry.set('tmrw-phone-project-storage-v1', { sentinel: 'preview-unchanged' });
  return { registry, batch };
}

test('P23 schema v21 preserves v20 migration history and allows same Preview fingerprint across migration versions only', async () => {
  const { registry, batch } = v20Registry(); const previewBefore = structuredClone(registry.get('tmrw-phone-project-storage-v1'));
  const database = new MemoryV3Database({ registry }); await database.open();
  assert.equal(V3_SCHEMA_VERSION, 21); assert.equal(database.diagnostics.version, 21);
  assert.deepEqual(await database.transaction(['previewMigrationBatches'], 'readonly', tx => tx.store('previewMigrationBatches').get(batch.id)), batch);
  const v2 = { ...batch, id: 'preview37-migration:v2:fp-shared', migrationVersion: 2, planFingerprint: 'v2-plan', status: 'planned', activationStatus: 'inactive' };
  await database.transaction(['previewMigrationBatches'], 'readwrite', tx => tx.store('previewMigrationBatches').put(v2));
  assert.equal(await database.transaction(['previewMigrationBatches'], 'readonly', tx => tx.store('previewMigrationBatches').count()), 2);
  await assert.rejects(() => database.transaction(['previewMigrationBatches'], 'readwrite', tx => tx.store('previewMigrationBatches').put({ ...v2, id: 'duplicate-v2' })), /by_source_fingerprint|unique/i);
  const migration = await database.transaction(['migrations'], 'readonly', tx => tx.store('migrations').get('schema-21'));
  assert.equal(migration.fromVersion, 20); assert.equal(migration.toVersion, 21); assert.equal(migration.legacyDataRead, false); assert.equal(migration.legacyDataWritten, false);
  assert.deepEqual(registry.get('tmrw-phone-project-storage-v1'), previewBefore);
  database.close();
});

test('P23 interrupted v20 to v21 index upgrade preserves the exact v20 batch and retry succeeds without Preview writes', async () => {
  const { registry, batch } = v20Registry(); const storedBefore = structuredClone(registry.get(V3_DATABASE_NAME)); const previewBefore = structuredClone(registry.get('tmrw-phone-project-storage-v1'));
  const interrupted = new MemoryV3Database({ registry, failNextUpgrade: true }); await assert.rejects(() => interrupted.open(), /interrupted schema upgrade/i);
  assert.equal(registry.get(V3_DATABASE_NAME).version, 20); assert.deepEqual(registry.get(V3_DATABASE_NAME).stores.get('previewMigrationBatches').get(batch.id), storedBefore.stores.get('previewMigrationBatches').get(batch.id)); assert.deepEqual(registry.get('tmrw-phone-project-storage-v1'), previewBefore);
  const retry = new MemoryV3Database({ registry }); await retry.open(); assert.equal(retry.diagnostics.version, 21); assert.deepEqual(await retry.transaction(['previewMigrationBatches'], 'readonly', tx => tx.store('previewMigrationBatches').get(batch.id)), batch); retry.close();
});
