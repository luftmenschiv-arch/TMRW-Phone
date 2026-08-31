import test from 'node:test';
import assert from 'node:assert/strict';

import { previewDigest } from '../../migration/preview37/digest.mjs';
import { inventoryPreview37 } from '../../migration/preview37/inventory.mjs';
import { Preview37RawReader } from '../../migration/preview37/raw-reader.mjs';
import { normalizePreview37MigrationSource } from '../../migration/preview37/source-normalizer.mjs';
import { migrationCounts, preview37Project, setupPhase12 } from './preview37-fixtures.mjs';

function branchOf(record) {
  return record.cards['card-base'].stories['story-base'].branches['branch-base'];
}

function mobileUndefinedMembershipSource() {
  const source = preview37Project();
  const branch = branchOf(source);
  Object.defineProperty(branch.shared.conversations[1], 'memberIds', {
    value: undefined,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return source;
}

test('Preview37 normalization removes only proven undefined optional membership fields from the cloned snapshot', async () => {
  const source = mobileUndefinedMembershipSource();
  const rawConversation = branchOf(source).shared.conversations[1];
  assert.equal(Object.prototype.hasOwnProperty.call(rawConversation, 'memberIds'), true);
  assert.equal(rawConversation.memberIds, undefined);

  const normalized = normalizePreview37MigrationSource(source);
  const normalizedConversation = branchOf(normalized).shared.conversations[1];
  assert.equal(Object.prototype.hasOwnProperty.call(normalizedConversation, 'memberIds'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(rawConversation, 'memberIds'), true);
  assert.equal(rawConversation.memberIds, undefined);
  assert.deepEqual(normalizedConversation.participantIds, ['user', 'member-1', 'member-2']);

  const firstDigest = await previewDigest(normalized);
  const secondDigest = await previewDigest(normalizePreview37MigrationSource(source));
  assert.equal(firstDigest, secondDigest);

  const snapshot = Object.freeze({ available: true, record: normalized });
  const inventory = await inventoryPreview37(snapshot);
  assert.equal(inventory.fatal, false);
  assert.equal(inventory.scopes.length, 1);
  assert.equal(inventory.scopes[0].cardKey, 'card-base');
  assert.equal(inventory.scopes[0].storyKey, 'story-base');
  assert.equal(inventory.scopes[0].branchKey, 'branch-base');
  assert.deepEqual(inventory.scopes[0].threads[1].participantIds, ['user', 'member-1', 'member-2']);
});

test('Preview37 raw reader fingerprints the normalized snapshot while preserving the raw source', async () => {
  const source = mobileUndefinedMembershipSource();
  const reader = new Preview37RawReader({ readSource: async () => ({ available: true, sourceVersion: source.schemaVersion, sourceLocation: 'legacy-undefined-fixture', record: source }) });
  const first = await reader.read();
  const second = await reader.read();
  assert.equal(first.available, true);
  assert.equal(first.sourceFingerprint, second.sourceFingerprint);
  assert.equal(Object.prototype.hasOwnProperty.call(branchOf(first.record).shared.conversations[1], 'memberIds'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(branchOf(source).shared.conversations[1], 'memberIds'), true);
  assert.equal(branchOf(source).shared.conversations[1].memberIds, undefined);
  assert.equal(await previewDigest(first.record), first.sourceFingerprint);
});

test('related optional undefined membership fields normalize to absence without changing current Array forms', async () => {
  const source = preview37Project();
  const branch = branchOf(source);
  const dm = branch.shared.conversations[0];
  const group = branch.shared.conversations[1];
  const currentGroupMembers = [...group.participantIds];
  const currentMessageMembers = [...group.messages[0][4].memberIds];

  Object.defineProperty(dm, 'participantIds', { value: undefined, writable: true, enumerable: true, configurable: true });
  dm.memberIds = ['user', 'member-1'];
  Object.defineProperty(group.messages[0][4], 'memberIds', { value: undefined, writable: true, enumerable: true, configurable: true });

  const normalized = normalizePreview37MigrationSource(source);
  const normalizedBranch = branchOf(normalized);
  assert.equal(Object.prototype.hasOwnProperty.call(normalizedBranch.shared.conversations[0], 'participantIds'), false);
  assert.deepEqual(normalizedBranch.shared.conversations[0].memberIds, ['user', 'member-1']);
  assert.equal(Object.prototype.hasOwnProperty.call(normalizedBranch.shared.conversations[1].messages[0][4], 'memberIds'), false);

  const modern = preview37Project();
  const modernNormalized = normalizePreview37MigrationSource(modern);
  assert.deepEqual(branchOf(modernNormalized).shared.conversations[1].participantIds, currentGroupMembers);
  assert.deepEqual(branchOf(modernNormalized).shared.conversations[1].messages[0][4].memberIds, currentMessageMembers);
  assert.equal(Object.prototype.hasOwnProperty.call(branchOf(modernNormalized).shared.conversations[0], 'memberIds'), false);

  const inventory = await inventoryPreview37({ available: true, record: normalized });
  assert.deepEqual(inventory.scopes[0].threads[0].participantIds, ['user', 'member-1']);
  assert.deepEqual(inventory.scopes[0].threads[1].messages[0].metadata.memberIds, undefined);
});

test('real-mobile undefined memberIds shape completes migration dry-run with zero writes and exact scope unchanged', async () => {
  const source = mobileUndefinedMembershipSource();
  const context = await setupPhase12({ source, manifestId: 'phase12-legacy-undefined' });
  const beforeCounts = await migrationCounts(context.database);
  const beforeWrites = context.database.diagnostics.writeCommits;
  const plan = await context.migration.dryRun();

  assert.equal(plan.fatal, false);
  assert.equal(plan.scopePlans.length, 1);
  assert.equal(plan.scopePlans[0].scope.cardKey, 'card-base');
  assert.equal(plan.scopePlans[0].scope.storyKey, 'story-base');
  assert.equal(plan.scopePlans[0].scope.branchKey, 'branch-base');
  assert.deepEqual(plan.scopePlans[0].scope.threads[1].participantIds, ['user', 'member-1', 'member-2']);
  assert.equal(context.database.diagnostics.writeCommits, beforeWrites);
  assert.deepEqual(await migrationCounts(context.database), beforeCounts);
  assert.equal(context.previewWrites, 0);

  const rawAfter = context.source();
  const rawConversation = branchOf(rawAfter).shared.conversations[1];
  assert.equal(Object.prototype.hasOwnProperty.call(rawConversation, 'memberIds'), true);
  assert.equal(rawConversation.memberIds, undefined);
});

test('unknown non-JSON membership values remain fail-closed after narrow normalization', async () => {
  const source = preview37Project();
  branchOf(source).shared.conversations[1].memberIds = new Set(['user', 'member-1', 'member-2']);
  const reader = new Preview37RawReader({ readSource: async () => ({ available: true, record: source }) });
  await assert.rejects(reader.read(), error => {
    assert.equal(error instanceof TypeError, true);
    assert.match(error.message, /shared\.conversations\[1\]\.memberIds must be JSON-serializable data/);
    assert.equal(error.code, 'TMRW_NON_JSON_VALUE');
    assert.equal(error.tmrwNonJsonDiagnostic?.tag, '[object Set]');
    return true;
  });
  assert.equal(branchOf(source).shared.conversations[1].memberIds instanceof Set, true);
});
