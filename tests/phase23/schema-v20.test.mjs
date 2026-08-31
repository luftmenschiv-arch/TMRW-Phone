import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryV3Database } from '../../storage/memory-v3-database.mjs';
import { V3_SCHEMA_MIGRATIONS } from '../../storage/migrations.mjs';
import { V3_DATABASE_NAME, V3_SCHEMA_ID, V3_SCHEMA_VERSION } from '../../storage/schema.mjs';

const NEW_STORES = Object.freeze([
  'phoneGalleryItems', 'phoneFiles', 'phoneNotes', 'phoneSearchEntries', 'phoneLocations',
  'phoneCalendarItems', 'phoneWalletEntries', 'phoneShopItems', 'phoneShopOrders',
  'phoneWeatherEntries', 'phoneHealthEntries',
]);

function v19Registry() {
  const registry = MemoryV3Database.createRegistry();
  const existingPreference = {
    id: 'phone-ui-preferences:story_keep:branch_keep:instance_keep',
    storyId: 'story_keep', branchId: 'branch_keep', playerInstanceId: 'instance_keep',
    preset: 'story', phoneNumberDiscovery: 'smart', phoneAccessMode: 'assisted', sentinel: 'v19-preserved',
  };
  registry.set(V3_DATABASE_NAME, {
    version: 19,
    stores: new Map([
      ['metadata', new Map([['schema', { key: 'schema', schemaId: V3_SCHEMA_ID, schemaVersion: 19, databaseName: V3_DATABASE_NAME }]])],
      ['migrations', new Map([['schema-19', { id: 'schema-19', sentinel: 'existing' }]])],
      ['phoneUiPreferences', new Map([[existingPreference.id, structuredClone(existingPreference)]])],
    ]),
    connections: 0, writeCommits: 7, lastCommit: { stores: ['phoneUiPreferences'] },
  });
  registry.set('tmrw-phone-project-storage-v1', { preview: 'must-remain-untouched' });
  return { registry, existingPreference };
}

test('P23 current schema preserves the v20 utility foundation and applies the version-aware Preview migration batch index', async () => {
  const database = new MemoryV3Database(); await database.open();
  assert.equal(V3_SCHEMA_VERSION, 21); assert.equal(database.diagnostics.version, 21);
  assert.ok(V3_SCHEMA_MIGRATIONS.some(row => row.fromVersion === 19 && row.toVersion === 20 && row.readsLegacyData === false && row.writesLegacyData === false));
  for (const store of NEW_STORES) assert.equal(await database.transaction([store], 'readonly', tx => tx.store(store).count()), 0, store);
  const metadata = await database.transaction(['metadata'], 'readonly', tx => tx.store('metadata').get('schema'));
  assert.equal(metadata.schemaVersion, 21); assert.equal(metadata.phoneWorldUtilityProjectionFoundationEnabled, true);
  assert.ok(V3_SCHEMA_MIGRATIONS.some(row => row.fromVersion === 20 && row.toVersion === 21 && row.readsLegacyData === false && row.writesLegacyData === false));
  database.close();
});

test('P23 v19 through v21 preserves existing canonical/settings data, creates empty utility stores, and never touches Preview37', async () => {
  const { registry, existingPreference } = v19Registry(); const previewBefore = structuredClone(registry.get('tmrw-phone-project-storage-v1'));
  const database = new MemoryV3Database({ registry }); await database.open();
  assert.equal(database.diagnostics.version, 21);
  assert.deepEqual(await database.transaction(['phoneUiPreferences'], 'readonly', tx => tx.store('phoneUiPreferences').get(existingPreference.id)), existingPreference);
  for (const store of NEW_STORES) assert.equal(await database.transaction([store], 'readonly', tx => tx.store(store).count()), 0, store);
  const migration = await database.transaction(['migrations'], 'readonly', tx => tx.store('migrations').get('schema-20'));
  assert.equal(migration.fromVersion, 19); assert.equal(migration.toVersion, 20); assert.equal(migration.legacyDataRead, false); assert.equal(migration.legacyDataWritten, false);
  const indexMigration = await database.transaction(['migrations'], 'readonly', tx => tx.store('migrations').get('schema-21'));
  assert.equal(indexMigration.fromVersion, 20); assert.equal(indexMigration.toVersion, 21); assert.equal(indexMigration.legacyDataRead, false); assert.equal(indexMigration.legacyDataWritten, false);
  assert.deepEqual(registry.get('tmrw-phone-project-storage-v1'), previewBefore);
  database.close();
});

test('P23 interrupted v19 to current upgrade leaves the stored v19 state untouched and retry can safely succeed', async () => {
  const { registry, existingPreference } = v19Registry(); const before = structuredClone(registry.get(V3_DATABASE_NAME));
  const interrupted = new MemoryV3Database({ registry, failNextUpgrade: true });
  await assert.rejects(() => interrupted.open(), /interrupted schema upgrade/i);
  assert.equal(registry.get(V3_DATABASE_NAME).version, 19);
  assert.deepEqual(registry.get(V3_DATABASE_NAME).stores.get('phoneUiPreferences').get(existingPreference.id), before.stores.get('phoneUiPreferences').get(existingPreference.id));
  assert.equal(registry.get(V3_DATABASE_NAME).stores.has('phoneGalleryItems'), false);
  const retry = new MemoryV3Database({ registry }); await retry.open(); assert.equal(retry.diagnostics.version, 21); retry.close();
});
