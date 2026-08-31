import test from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATION_BATCH_STATUS, MIGRATION_ITEM_STATE } from '../../migration/preview37/constants.mjs';
import { previewDigest } from '../../migration/preview37/digest.mjs';
import { inventoryPreview37 } from '../../migration/preview37/inventory.mjs';
import { createMessageMigrationItem } from '../../migration/preview37/message-translator.mjs';
import { migrationCounts, preview37Project, setupPhase12 } from '../phase12/preview37-fixtures.mjs';

const branchOf = (source, suffix = 'base') => source.cards[`card-${suffix}`].stories[`story-${suffix}`].branches[`branch-${suffix}`];
const threadItem = (plan, threadId) => plan.items.find(item => item.sourceType === 'thread' && item.sourceRecordId.includes(`:thread:${threadId}`));
const messageItems = (plan, threadId) => plan.items.filter(item => item.sourceType === 'message' && item.sourceRecordId.includes(`:thread:${threadId}:message:`));
const stateCounts = items => Object.freeze(items.reduce((counts, item) => ({ ...counts, [item.state]: (counts[item.state] || 0) + 1 }), {}));
const planBasis = (sourceFingerprint, items) => ({ sourceFingerprint, items: items.map(item => ({ sourceRecordId: item.sourceRecordId, sourceFingerprint: item.sourceFingerprint, sourceType: item.sourceType, state: item.state, reasonCode: item.reasonCode || null, classification: item.classification || null })) });

async function syntheticPreFixPlan(plan, source, blockedThreadId) {
  const inventory = await inventoryPreview37({ available: true, sourceVersion: source.schemaVersion, sourceLocation: 'dependency-regression', record: structuredClone(source) });
  const scope = inventory.scopes[0];
  const card = inventory.cards.find(row => row.cardKey === scope.cardKey);
  const memberIds = new Set(['user', '{{user}}', '__user__', 'local-player-v1', ...card.cast.map(member => member.sourceMemberId)]);
  const thread = scope.threads.find(row => row.threadId === blockedThreadId);
  const legacyReadyMessage = await createMessageMigrationItem({ scope, thread, message: thread.messages[0], memberIds });
  assert.equal(legacyReadyMessage.state, MIGRATION_ITEM_STATE.READY, 'fixture must reproduce the pre-fix independently READY child');
  const items = plan.items.map(item => item.sourceRecordId === legacyReadyMessage.sourceRecordId ? legacyReadyMessage : item);
  const fingerprint = await previewDigest(planBasis(plan.sourceFingerprint, items));
  return Object.freeze({ ...plan, items: Object.freeze(items), counts: stateCounts(items), planFingerprint: fingerprint });
}

async function clearCurrentThreadCanonical(context, plan, sourceRecordId) {
  const row = await context.manifest.getItem(plan.batchId, sourceRecordId);
  await context.database.transaction(['previewMigrationItems'], 'readwrite', async tx => {
    await tx.store('previewMigrationItems').put(Object.freeze({ ...row, current: row.current === true ? 1 : 0, canonical: null }));
  });
}

test('dependency 1: READY Thread + valid Message migrate normally', async () => {
  const context = await setupPhase12({ source: preview37Project({ includeGroup: false, includeCall: false }) });
  const plan = await context.migration.dryRun();
  assert.equal(threadItem(plan, 'dm-base').state, MIGRATION_ITEM_STATE.READY);
  assert.equal(messageItems(plan, 'dm-base')[0].state, MIGRATION_ITEM_STATE.READY);
  const result = await context.migration.commit(plan);
  const counts = await migrationCounts(context.database);
  assert.equal(result.validation.passed, true); assert.equal(counts.threads, 1); assert.equal(counts.messages, 1); assert.equal(context.previewWrites, 0);
});

test('dependency 2: AMBIGUOUS Thread blocks an otherwise-valid Message during planning', async () => {
  const source = preview37Project({ includeGroup: false, includeCall: false }); branchOf(source).shared.conversations[0].participantIds = ['user'];
  const context = await setupPhase12({ source }); const plan = await context.migration.dryRun(); const child = messageItems(plan, 'dm-base')[0];
  assert.equal(threadItem(plan, 'dm-base').state, MIGRATION_ITEM_STATE.AMBIGUOUS); assert.equal(child.state, MIGRATION_ITEM_STATE.AMBIGUOUS); assert.equal(child.reasonCode, 'parent-thread-ambiguous:dm-participants-not-exactly-two'); assert.equal(child.data, null); assert.equal(context.previewWrites, 0);
});

test('dependency 3: QUARANTINED Thread blocks every dependent Message', async () => {
  const source = preview37Project({ includeGroup: false, includeCall: false }); branchOf(source).shared.conversations[0].id = null;
  const context = await setupPhase12({ source }); const plan = await context.migration.dryRun(); const parent = plan.items.find(item => item.sourceType === 'thread'); const child = plan.items.find(item => item.sourceType === 'message');
  assert.equal(parent.state, MIGRATION_ITEM_STATE.QUARANTINED); assert.equal(child.state, MIGRATION_ITEM_STATE.QUARANTINED); assert.equal(child.reasonCode, 'parent-thread-quarantined:thread-missing-stable-id'); assert.equal(child.data, null); assert.equal(context.previewWrites, 0);
});

test('dependency 4: UNSUPPORTED Thread blocks an otherwise-valid Message', async () => {
  const source = preview37Project({ includeGroup: false, includeCall: false }); branchOf(source).shared.conversations[0].type = 'channel';
  const context = await setupPhase12({ source }); const plan = await context.migration.dryRun(); const child = messageItems(plan, 'dm-base')[0];
  assert.equal(threadItem(plan, 'dm-base').state, MIGRATION_ITEM_STATE.UNSUPPORTED); assert.equal(child.state, MIGRATION_ITEM_STATE.UNSUPPORTED); assert.equal(child.reasonCode, 'parent-thread-unsupported:unsupported-thread-kind'); assert.equal(context.previewWrites, 0);
});

test('dependency 5: malformed/unmapped Thread membership blocks its Message', async () => {
  const source = preview37Project({ includeGroup: false, includeCall: false }); branchOf(source).shared.conversations[0].participantIds = ['user', 'ghost-member'];
  const context = await setupPhase12({ source }); const plan = await context.migration.dryRun(); const child = messageItems(plan, 'dm-base')[0];
  assert.equal(threadItem(plan, 'dm-base').state, MIGRATION_ITEM_STATE.AMBIGUOUS); assert.equal(child.state, MIGRATION_ITEM_STATE.AMBIGUOUS); assert.equal(child.reasonCode, 'parent-thread-ambiguous:thread-participant-unmapped'); assert.equal(context.previewWrites, 0);
});

test('dependency 6: one blocked Thread blocks multiple child Messages deterministically', async () => {
  const source = preview37Project({ includeGroup: false, includeCall: false }); const thread = branchOf(source).shared.conversations[0]; thread.type = 'channel'; thread.messages.push(['member-1', 'second', '18:02', 'message-second', { source: 'manual', actualAuthorId: 'member-1', deviceOwnerId: 'member-1' }]);
  const context = await setupPhase12({ source }); const plan = await context.migration.dryRun(); const children = messageItems(plan, 'dm-base');
  assert.equal(children.length, 2); assert.deepEqual(children.map(item => item.state), [MIGRATION_ITEM_STATE.UNSUPPORTED, MIGRATION_ITEM_STATE.UNSUPPORTED]); assert.deepEqual(new Set(children.map(item => item.reasonCode)), new Set(['parent-thread-unsupported:unsupported-thread-kind'])); assert.equal(context.previewWrites, 0);
});

test('dependency 7: valid and blocked Thread families coexist; only the valid family migrates', async () => {
  const source = preview37Project({ includeGroup: true, includeCall: false }); branchOf(source).shared.conversations[1].type = 'channel';
  const sourceHash = await previewDigest(source); const context = await setupPhase12({ source }); const plan = await context.migration.dryRun();
  assert.equal(threadItem(plan, 'dm-base').state, MIGRATION_ITEM_STATE.READY); assert.equal(threadItem(plan, 'group-base').state, MIGRATION_ITEM_STATE.UNSUPPORTED); assert.equal(messageItems(plan, 'group-base')[0].state, MIGRATION_ITEM_STATE.UNSUPPORTED);
  const result = await context.migration.commit(plan); const counts = await migrationCounts(context.database);
  assert.equal(result.validation.passed, true); assert.equal(counts.threads, 1); assert.equal(counts.messages, 1); assert.equal(await previewDigest(context.source()), sourceHash); assert.equal(context.previewWrites, 0);
});

test('dependency 8: an ALREADY_MIGRATED Thread reuses its valid canonical mapping for a later Message', async () => {
  const source = preview37Project({ includeGroup: false, includeCall: false }); const context = await setupPhase12({ source }); const firstPlan = await context.migration.dryRun(); await context.migration.commit(firstPlan); const before = await migrationCounts(context.database);
  const changed = context.source(); branchOf(changed).shared.conversations[0].messages.push(['member-1', 'later', '18:04', 'message-later', { source: 'manual', actualAuthorId: 'member-1', deviceOwnerId: 'member-1' }]); context.setSource(changed);
  const plan = await context.migration.dryRun(); assert.equal(threadItem(plan, 'dm-base').state, MIGRATION_ITEM_STATE.ALREADY_MIGRATED); const later = plan.items.find(item => item.sourceType === 'message' && item.sourceRecordId.endsWith(':message:message-later')); assert.equal(later.state, MIGRATION_ITEM_STATE.READY);
  const result = await context.migration.commit(plan); const after = await migrationCounts(context.database);
  assert.equal(result.validation.passed, true); assert.equal(after.threads, before.threads); assert.equal(after.messages, before.messages + 1); assert.equal(context.previewWrites, 0);
});

test('dependency 9: apparent migrated Thread with missing canonical mapping fails closed without fabricating a Thread or Message', async () => {
  const context = await setupPhase12({ source: preview37Project({ includeGroup: false, includeCall: false }) }); const firstPlan = await context.migration.dryRun(); await context.migration.commit(firstPlan); const before = await migrationCounts(context.database); const parent = threadItem(firstPlan, 'dm-base');
  await clearCurrentThreadCanonical(context, firstPlan, parent.sourceRecordId);
  const plan = await context.migration.dryRun(); const nextParent = threadItem(plan, 'dm-base'); const child = messageItems(plan, 'dm-base')[0];
  assert.equal(nextParent.state, MIGRATION_ITEM_STATE.CONFLICT); assert.equal(nextParent.reasonCode, 'canonical-thread-mapping-missing'); assert.equal(child.state, MIGRATION_ITEM_STATE.CONFLICT); assert.equal(child.reasonCode, 'parent-thread-canonical-mapping-missing');
  await assert.rejects(context.migration.commit(plan), /classification|state|plan/i); const after = await migrationCounts(context.database); assert.equal(after.threads, before.threads); assert.equal(after.messages, before.messages); assert.equal(context.previewWrites, 0);
});

test('dependency 10: retry after the exact pre-fix orphan failure reconciles only the blocked child and creates no duplicates', async () => {
  const source = preview37Project({ includeGroup: true, includeCall: false }); branchOf(source).shared.conversations[1].type = 'channel'; const context = await setupPhase12({ source }); const fixedPlan = await context.migration.dryRun(); const legacyPlan = await syntheticPreFixPlan(fixedPlan, source, 'group-base');
  assert.notEqual(legacyPlan.planFingerprint, fixedPlan.planFingerprint); await assert.rejects(context.migration.commit(legacyPlan), /Message migration requires its canonical Thread/); assert.equal((await context.manifest.getBatch(legacyPlan.batchId)).status, MIGRATION_BATCH_STATUS.FAILED); const staged = await migrationCounts(context.database); assert.equal(staged.threads, 1); assert.equal(staged.messages, 1);
  const result = await context.migration.commit(fixedPlan); const complete = await migrationCounts(context.database); const blocked = messageItems(fixedPlan, 'group-base')[0];
  assert.equal(result.validation.passed, true); assert.equal(blocked.state, MIGRATION_ITEM_STATE.UNSUPPORTED); assert.equal(blocked.reasonCode, 'parent-thread-unsupported:unsupported-thread-kind'); assert.equal(complete.threads, 1); assert.equal(complete.messages, 1); assert.ok(complete.previewMigrationQuarantine >= 2); assert.equal(context.previewWrites, 0);
});

test('dependency 11: completed blocked migration replay preserves dependency classification deterministically', async () => {
  const source = preview37Project({ includeGroup: false, includeCall: false }); branchOf(source).shared.conversations[0].type = 'channel'; const sourceHash = await previewDigest(source); const context = await setupPhase12({ source }); const firstPlan = await context.migration.dryRun(); const firstChild = messageItems(firstPlan, 'dm-base')[0]; const first = await context.migration.commit(firstPlan); assert.equal(first.validation.passed, true);
  const replayPlan = await context.migration.dryRun(); const replayChild = messageItems(replayPlan, 'dm-base')[0]; assert.equal(replayChild.state, firstChild.state); assert.equal(replayChild.reasonCode, firstChild.reasonCode); const replay = await context.migration.commit(replayPlan); assert.equal(replay.replayed, true); assert.equal(await previewDigest(context.source()), sourceHash); assert.equal(context.previewWrites, 0);
});

test('dependency 12: plan fingerprint changes when dependency state/reason differs from the pre-fix orphan classification', async () => {
  const source = preview37Project({ includeGroup: false, includeCall: false }); branchOf(source).shared.conversations[0].type = 'channel'; const context = await setupPhase12({ source }); const fixedPlan = await context.migration.dryRun(); const legacyPlan = await syntheticPreFixPlan(fixedPlan, source, 'dm-base'); const child = messageItems(fixedPlan, 'dm-base')[0];
  assert.equal(child.state, MIGRATION_ITEM_STATE.UNSUPPORTED); assert.equal(child.reasonCode, 'parent-thread-unsupported:unsupported-thread-kind'); assert.notEqual(fixedPlan.planFingerprint, legacyPlan.planFingerprint); assert.equal(context.previewWrites, 0);
});
