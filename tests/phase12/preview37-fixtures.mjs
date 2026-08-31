import { setupPhase11 } from '../phase11/pocket-shadow-fixtures.mjs';
import { Preview37RawReader } from '../../migration/preview37/raw-reader.mjs';
import { Preview37CopyMigrationCoordinator } from '../../migration/preview37/coordinator.mjs';
import { Preview37MigrationManifest } from '../../migration/preview37/manifest.mjs';
import { Preview37MigrationRollback } from '../../migration/preview37/rollback.mjs';

export function preview37Project({ castSize = 3, suffix = 'base', includeGroup = true, includeCall = true, ambiguous = false } = {}) {
  const cast = Array.from({ length: castSize }, (_, index) => ({ id: `member-${index + 1}`, actorId: ambiguous && index === 1 ? 'actor-1' : `actor-${index + 1}`, instanceId: `instance-${index + 1}`, name: index < 2 ? 'Same Name' : `Cast ${index + 1}`, aliases: [`Alias ${index + 1}`], hasPhone: true }));
  const first = cast[0]?.id; const second = cast[1]?.id;
  const conversations = first ? [{ id: `dm-${suffix}`, type: 'dm', participantIds: ['user', first], source: 'manual', messages: [
    ['user', `private-${suffix}`, '18:00', `message-${suffix}`, { source: 'manual', actualAuthorId: 'user', deviceOwnerId: 'user' }],
  ] }] : [];
  if (includeGroup && second) conversations.push({ id: `group-${suffix}`, type: 'group', participantIds: ['user', first, second], source: 'manual', messages: [
    [first, `group-${suffix}`, '18:01', `group-message-${suffix}`, { source: 'manual', actualAuthorId: first, deviceOwnerId: first, memberIds: ['user', first, second] }],
  ] });
  const callEvents = includeCall && first ? [{ id: `call-${suffix}`, callerId: 'user', calleeId: first, status: 'completed', durationSec: 90, clock: '18:03', source: 'manual', transcript: [] }] : [];
  const phones = Object.fromEntries(['user', ...cast.map(row => row.id)].map(id => [id, { contacts: [], contactNames: {}, notes: [], gallery: [], search: [] }]));
  return { schemaVersion: 2, cards: { [`card-${suffix}`]: { cardKey: `card-${suffix}`, cardName: `Card ${suffix}`, cast, stories: { [`story-${suffix}`]: { storyId: `story-${suffix}`, branches: { [`branch-${suffix}`]: { branchId: `branch-${suffix}`, phones, shared: { conversations, callEvents } } } } } } } };
}

export async function setupPhase12({ source = preview37Project(), castSize = 4, manifestId = 'phase12-host' } = {}) {
  const context = await setupPhase11({ castSize, manifestId }); let current = structuredClone(source); let previewReads = 0; let previewWrites = 0;
  const reader = new Preview37RawReader({ readSource: async () => { previewReads += 1; return current == null ? { available: false } : { available: true, sourceVersion: current.schemaVersion, sourceLocation: 'phase12-fixture', record: structuredClone(current) }; } });
  const manifest = new Preview37MigrationManifest({ database: context.database, now: () => '2026-08-13T12:00:00.000Z' });
  const migration = new Preview37CopyMigrationCoordinator({ database: context.database, rawReader: reader, identityKernel: context.kernel, phoneStateService: context.phones, messageService: context.messages, callService: context.calls, manifest });
  const rollback = new Preview37MigrationRollback({ database: context.database, eventEngine: context.engine, identityKernel: context.kernel, manifest });
  return { ...context, reader, manifest, migration, rollback, get previewReads() { return previewReads; }, get previewWrites() { return previewWrites; }, source: () => structuredClone(current), setSource: value => { current = structuredClone(value); } };
}

export async function migrationCounts(database) {
  const stores = ['events', 'threads', 'messages', 'callSessions', 'knowledgeGrants', 'previewMigrationBatches', 'previewMigrationItems', 'previewMigrationQuarantine'];
  return database.transaction(stores, 'readonly', async tx => Object.fromEntries(await Promise.all(stores.map(async store => [store, await tx.store(store).count()]))));
}
