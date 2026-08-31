import test from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalEventEngine } from '../../domain/events/event-transaction.mjs';
import { createPhase23EventTypeRegistry } from '../../domain/utilities/phone-world-event-types.mjs';
import { createPhoneWorldProjector } from '../../domain/utilities/phone-world-projector.mjs';
import { PhoneWorldService } from '../../domain/utilities/phone-world-service.mjs';
import { StoryChronologyService } from '../../domain/time/chronology-service.mjs';
import { PhoneStateService } from '../../domain/phone/phone-state.mjs';
import { MessageService } from '../../domain/messaging/message-service.mjs';
import { CallService } from '../../domain/calls/call-service.mjs';
import { CalendarAppService } from '../../application/calendar-app-service.mjs';
import { CommerceAppService } from '../../application/commerce-app-service.mjs';
import { Preview37RawReader } from '../../migration/preview37/raw-reader.mjs';
import { Preview37MigrationManifest } from '../../migration/preview37/manifest.mjs';
import { Preview37CopyMigrationCoordinator } from '../../migration/preview37/coordinator.mjs';
import { PREVIEW37_PERSONAL_CLASSIFICATION } from '../../migration/preview37/constants.mjs';
import { previewDigest } from '../../migration/preview37/digest.mjs';
import { phase17Projectors } from '../phase17/notification-fixtures.mjs';
import { preview37Project, setupPhase12 } from '../phase12/preview37-fixtures.mjs';

function personalSource() {
  const source = preview37Project({ castSize: 2, suffix: 'personal', includeGroup: false, includeCall: false });
  const branch = source.cards['card-personal'].stories['story-personal'].branches['branch-personal'];
  branch.phones.user.notes.push({ id: 'note-1', title: 'Private legacy note', text: 'blue door', source: 'user-authored', createdAt: 'story-day-2' }, { id: 'note-mock', title: 'Sample note', text: 'demo', source: 'mock-generated' });
  branch.phones.user.gallery.push({ id: 'gallery-1', label: 'Door photo', assetRef: 'asset:door:1', source: 'manual', provenance: { source: 'user-authored', takenAt: 'story-day-2', locationLabel: 'Old Town' } }, { id: 'gallery-bad', label: 'Missing media', source: 'manual' });
  branch.phones.user.search.push({ id: 'search-1', query: 'blue door', source: 'user-authored' }, { id: 'search-suggestion', query: 'trending now', source: 'manual', suggestion: true });
  branch.phones.user.wallet = [{ id: 'wallet-1', entryKind: 'balance', label: 'Explicit story wallet', amount: 25, currency: 'USD', source: 'story-canonical' }, { id: 'wallet-default', entryKind: 'balance', label: 'Default balance', amount: 9999, currency: 'USD' }];
  branch.phones.user.shop = [{ id: 'shop-free', recordType: 'catalog-item', name: 'Free ticket', price: 0, currency: 'USD', source: 'story-canonical' }, { id: 'order-free', recordType: 'order', shopItemId: 'shop-free', quantity: 1, unitPrice: 0, currency: 'USD', source: 'user-authored' }, { id: 'order-paid', recordType: 'order', shopItemId: 'shop-free', quantity: 1, unitPrice: 10, currency: 'USD', source: 'user-authored' }];
  branch.phones.user.calendar = [{ id: 'calendar-reminder', itemKind: 'reminder', title: 'Legacy reminder', due: { kind: 'absolute', localTime: '18:30' }, source: 'user-authored' }, { id: 'calendar-invite', itemKind: 'invitation', title: 'Legacy invite', due: { kind: 'ordinal', targetOrdinal: 50 }, participantIds: ['member-1'], organizer: true, source: 'user-authored' }, { id: 'calendar-mock', itemKind: 'reminder', title: 'Decoration', due: { kind: 'ordinal', targetOrdinal: 2 }, source: 'sample' }];
  branch.phones.user.maps = [{ id: 'map-checkin', mode: 'check-in', label: 'Cafe', source: 'user-authored' }, { id: 'map-share', mode: 'shared', label: 'Station', audienceIds: ['member-1'], source: 'user-authored' }, { id: 'map-random', mode: 'check-in', label: 'Random pin', source: 'generated' }];
  branch.phones.user.weather = [{ id: 'weather-mock', condition: 'sunny', temperatureC: 30, source: 'generated' }];
  branch.phones.user.health = [{ id: 'health-mock', metric: 'steps', value: 12345, source: 'generated' }];
  branch.phones.user.files = [{ id: 'voice-auto', name: 'voice.wav', source: 'generated' }];
  return source;
}

async function setupMigration(source = personalSource()) {
  const base = await setupPhase12({ source: preview37Project({ castSize: 2, suffix: 'host', includeGroup: false, includeCall: false }), castSize: 2, manifestId: `p23-personal-host-${Math.random()}` });
  let current = structuredClone(source); let previewReads = 0; let previewWrites = 0;
  const reader = new Preview37RawReader({ readSource: async () => { previewReads += 1; return { available: true, sourceVersion: current.schemaVersion, sourceLocation: 'p23-personal-readonly', record: structuredClone(current) }; } });
  const engine = new CanonicalEventEngine({ database: base.database, eventTypes: createPhase23EventTypeRegistry(), projectors: [...phase17Projectors(), createPhoneWorldProjector()], now: () => '2026-08-31T07:15:00.000Z' });
  const phones = new PhoneStateService({ database: base.database, eventEngine: engine }); const messages = new MessageService({ database: base.database, eventEngine: engine }); const calls = new CallService({ database: base.database, eventEngine: engine });
  const phoneWorld = new PhoneWorldService({ database: base.database, eventEngine: engine }); const chronology = new StoryChronologyService({ database: base.database, eventEngine: engine }); const calendar = new CalendarAppService({ database: base.database, phoneWorldService: phoneWorld, chronologyService: chronology });
  const manifest = new Preview37MigrationManifest({ database: base.database, now: () => '2026-08-31T07:15:00.000Z' });
  const migration = new Preview37CopyMigrationCoordinator({ database: base.database, rawReader: reader, identityKernel: base.kernel, phoneStateService: phones, messageService: messages, callService: calls, phoneWorldService: phoneWorld, calendarService: calendar, manifest });
  return { ...base, migration, manifest, phoneWorld, chronology, engine, get previewReads() { return previewReads; }, get previewWrites() { return previewWrites; }, source: () => structuredClone(current), setSource: value => { current = structuredClone(value); } };
}

async function identityFor(c, plan) { const row = await c.manifest.getItem(plan.batchId, plan.scopePlans[0].identitySourceRecordId); return row.canonical; }
function personBySource(identity, sourceId) { return identity.people.find(row => row.sourceMemberId === sourceId) || (sourceId === 'user' ? identity.people[0] : null); }

async function counts(c, identity) {
  const user = personBySource(identity, 'user'); const scope = { storyId: identity.identity.storyId, branchId: identity.identity.branchId };
  return { scope, user,
    notes: await c.phoneWorld.listNotes({ scope, deviceId: user.deviceId }), gallery: await c.phoneWorld.listGallery({ scope, deviceId: user.deviceId }), search: await c.phoneWorld.listSearch({ scope, deviceId: user.deviceId }), wallet: await c.phoneWorld.listWallet({ scope, deviceId: user.deviceId }), shopItems: await c.phoneWorld.listShopItems({ scope, deviceId: user.deviceId }), shopOrders: await c.phoneWorld.listShopOrders({ scope, deviceId: user.deviceId }), calendar: await c.phoneWorld.listCalendar({ scope, deviceId: user.deviceId }), locations: await c.phoneWorld.listLocations({ scope, deviceId: user.deviceId, viewerAccountId: user.accountId }), weather: await c.phoneWorld.listWeather({ scope, deviceId: user.deviceId }), health: await c.phoneWorld.listHealth({ scope, deviceId: user.deviceId }) };
}

function legacyV1Plan(v2Plan) {
  const sourceTypes = new Set(['identity-scope', 'thread', 'message', 'call']);
  const items = v2Plan.items.filter(item => sourceTypes.has(item.sourceType));
  const counts = items.reduce((out, item) => ({ ...out, [item.state]: (out[item.state] || 0) + 1 }), {});
  return Object.freeze({ ...v2Plan, batchId: `preview37-migration:${v2Plan.sourceFingerprint}`, planFingerprint: `legacy-v1:${v2Plan.planFingerprint}`, counts: Object.freeze(counts), classificationCounts: Object.freeze({}), items: Object.freeze(items) });
}

function upgradeSource() {
  const source = personalSource();
  const branch = source.cards['card-personal'].stories['story-personal'].branches['branch-personal'];
  branch.shared.callEvents = [{ id: 'call-v1', callerId: 'user', calleeId: 'member-1', status: 'completed', durationSec: 30, clock: '18:03', source: 'manual', transcript: [] }];
  return source;
}

function sequencedWalletSource() {
  const source = personalSource(); const branch = source.cards['card-personal'].stories['story-personal'].branches['branch-personal'];
  branch.phones.user.wallet = [
    { id: 'wallet-snapshot', entryKind: 'balance', label: 'Known balance snapshot', amount: 100, currency: 'USD', sequence: 10, source: 'story-canonical' },
    { id: 'wallet-before', entryKind: 'transaction', label: 'Earlier purchase', amount: -20, currency: 'USD', sequence: 5, source: 'story-canonical' },
    { id: 'wallet-after', entryKind: 'transaction', label: 'Later purchase', amount: -10, currency: 'USD', sequence: 11, source: 'story-canonical' },
  ];
  return source;
}

function malformedPersonalSource() {
  const source = personalSource(); const branch = source.cards['card-personal'].stories['story-personal'].branches['branch-personal'];
  branch.phones.user.notes = [null, 'bad-record', [], { title: 'No stable id', text: 'x', source: 'user-authored' }];
  branch.phones.user.gallery = []; branch.phones.user.search = []; branch.phones.user.wallet = []; branch.phones.user.shop = []; branch.phones.user.calendar = []; branch.phones.user.maps = [];
  return source;
}

function unsequencedWalletSource() {
  const source = personalSource(); const branch = source.cards['card-personal'].stories['story-personal'].branches['branch-personal'];
  branch.phones.user.wallet = [
    { id: 'wallet-current', entryKind: 'balance', label: 'Current balance', amount: 100, currency: 'USD', source: 'story-canonical' },
    { id: 'wallet-ambiguous-tx', entryKind: 'transaction', label: 'Transaction with unknown relation to snapshot', amount: -10, currency: 'USD', source: 'story-canonical' },
  ];
  return source;
}

function patchPlanItem(plan, predicate, patch) {
  const next = structuredClone(plan);
  const index = next.items.findIndex(predicate);
  assert.notEqual(index, -1, 'expected migration plan item for replay-guard harness');
  next.items[index] = { ...next.items[index], ...patch };
  return next;
}

async function classificationSensitiveFingerprint(plan) {
  return previewDigest({ sourceFingerprint: plan.sourceFingerprint, items: plan.items.map(item => ({ sourceRecordId: item.sourceRecordId, sourceFingerprint: item.sourceFingerprint, sourceType: item.sourceType, state: item.state, reasonCode: item.reasonCode || null, classification: item.classification || null })) });
}

test('P23 Preview37 personal migration dry-run is read-only, versioned, classified, and excludes generated Weather/Health/Files', async () => {
  const c = await setupMigration(); const before = JSON.stringify(c.source()); const plan = await c.migration.dryRun();
  assert.match(plan.batchId, /^preview37-migration:v2:/); assert.equal(c.previewWrites, 0); assert.equal(JSON.stringify(c.source()), before);
  assert.ok((plan.classificationCounts[PREVIEW37_PERSONAL_CLASSIFICATION.ELIGIBLE] || 0) >= 10); assert.ok((plan.classificationCounts[PREVIEW37_PERSONAL_CLASSIFICATION.AMBIGUOUS] || 0) >= 3); assert.ok((plan.classificationCounts[PREVIEW37_PERSONAL_CLASSIFICATION.MOCK] || 0) >= 3);
  assert.equal(plan.items.some(row => ['weather', 'health', 'file'].includes(row.sourceType)), false);
});

test('P23 Preview37 personal migration commits eligible Notes/Gallery/Search/Wallet/free Shop/Calendar/Maps with exact scope/privacy and zero Preview writes', async () => {
  const c = await setupMigration(); const before = JSON.stringify(c.source()); const knowledgeBefore = await c.database.transaction(['knowledgeGrants'], 'readonly', tx => tx.store('knowledgeGrants').count()); const plan = await c.migration.dryRun(); const result = await c.migration.commit(plan); assert.equal(result.validation.passed, true); const identity = await identityFor(c, plan); const state = await counts(c, identity);
  assert.equal(state.notes.length, 1); assert.equal(state.notes[0].text, 'blue door'); assert.equal(state.gallery.length, 1); assert.equal(state.gallery[0].assetRef, 'asset:door:1'); assert.equal(state.search.length, 1); assert.equal(state.search[0].provider, 'local-phone-world'); assert.equal(state.wallet.length, 1); assert.equal(state.wallet[0].amount, 25); assert.equal(state.shopItems.length, 1); assert.equal(state.shopOrders.length, 1); assert.equal(state.shopOrders[0].unitPrice, 0); assert.equal(state.shopOrders[0].walletEntryId, null); assert.equal(state.calendar.length, 2); assert.equal(state.locations.length, 2); assert.equal(state.weather.length, 0); assert.equal(state.health.length, 0);
  const alice = personBySource(identity, 'member-1'); assert.equal((await c.phoneWorld.listNotes({ scope: state.scope, deviceId: alice.deviceId })).length, 0); assert.equal((await c.phoneWorld.listCalendar({ scope: state.scope, deviceId: alice.deviceId })).length, 1); assert.equal((await c.phoneWorld.listVisibleLocations({ scope: state.scope, viewerAccountId: alice.accountId })).some(row => row.label === 'Station'), true);
  const grants = await c.database.transaction(['knowledgeGrants'], 'readonly', tx => tx.store('knowledgeGrants').getAll()); const noteEventIds = new Set((await c.engine.listEvents(state.scope)).filter(event => event.eventType === 'notes.note-state.v1').map(event => event.id)); assert.equal(grants.some(grant => noteEventIds.has(grant.sourceDisclosureEventId)), false); assert.equal(c.previewWrites, 0); assert.equal(JSON.stringify(c.source()), before);
});

test('P23 Preview37 personal migration retry is idempotent and partial failure resumes without duplicate Events/records', async () => {
  const c = await setupMigration(); const plan = await c.migration.dryRun(); await assert.rejects(() => c.migration.commit(plan, { failAfterItems: 3 }), /Injected Preview migration failure/); const eventsAfterFailure = await c.engine.listEvents((await identityFor(c, plan)).identity); assert.ok(eventsAfterFailure.length > 0);
  const resumed = await c.migration.commit(plan); assert.equal(resumed.validation.passed, true); const identity = await identityFor(c, plan); const beforeReplay = await counts(c, identity); const eventCount = (await c.engine.listEvents(beforeReplay.scope)).length; const replay = await c.migration.commit(plan); assert.equal(replay.replayed, true); const afterReplay = await counts(c, identity); assert.deepEqual(Object.fromEntries(Object.entries(beforeReplay).filter(([key]) => !['scope', 'user'].includes(key)).map(([key, rows]) => [key, rows.length])), Object.fromEntries(Object.entries(afterReplay).filter(([key]) => !['scope', 'user'].includes(key)).map(([key, rows]) => [key, rows.length]))); assert.equal((await c.engine.listEvents(beforeReplay.scope)).length, eventCount); assert.equal(c.previewWrites, 0);
});

test('P23 Preview37 source fingerprint change fails old-plan commit and changed migrated row becomes conflict rather than duplicate import', async () => {
  const c = await setupMigration(); const plan = await c.migration.dryRun(); const changed = c.source(); changed.cards['card-personal'].stories['story-personal'].branches['branch-personal'].phones.user.notes[0].text = 'changed source'; c.setSource(changed); await assert.rejects(() => c.migration.commit(plan), /source changed after dry run/i);
  c.setSource(personalSource()); const stablePlan = await c.migration.dryRun(); await c.migration.commit(stablePlan); const changedAgain = c.source(); changedAgain.cards['card-personal'].stories['story-personal'].branches['branch-personal'].phones.user.notes[0].text = 'changed after canonical import'; c.setSource(changedAgain); const newPlan = await c.migration.dryRun(); const note = newPlan.items.find(row => row.sourceType === 'note' && row.sourceRecordId.endsWith(':note-1')); assert.equal(note.state, 'conflict'); assert.equal(note.reasonCode, 'preview-source-changed-after-canonical-import'); assert.equal(c.previewWrites, 0);
});

test('P23 Preview37 quarantine persists ambiguous/mock classifications and never fabricates paid Wallet linkage', async () => {
  const c = await setupMigration(); const plan = await c.migration.dryRun(); await c.migration.commit(plan); const rows = await c.database.transaction(['previewMigrationQuarantine'], 'readonly', tx => tx.store('previewMigrationQuarantine').getAll());
  assert.ok(rows.some(row => row.classification === PREVIEW37_PERSONAL_CLASSIFICATION.AMBIGUOUS)); assert.ok(rows.some(row => row.classification === PREVIEW37_PERSONAL_CLASSIFICATION.MOCK)); assert.ok(rows.some(row => /order-paid/.test(row.sourceRecordId))); const identity = await identityFor(c, plan); const state = await counts(c, identity); assert.equal(state.wallet.some(row => row.amount === -10), false); assert.equal(state.shopOrders.some(row => Number(row.unitPrice) > 0), false);
});

test('P23 Preview37 completed v1 migration upgrades to v2 personal apps without duplicating prior Message/Call canon', async () => {
  const c = await setupMigration(upgradeSource()); const initialPlan = await c.migration.dryRun(); const oldPlan = legacyV1Plan(initialPlan); const oldResult = await c.migration.commit(oldPlan); assert.equal(oldResult.validation.passed, true);
  await c.database.transaction(['previewMigrationBatches'], 'readwrite', async tx => { const store = tx.store('previewMigrationBatches'); const row = await store.get(oldPlan.batchId); await store.put({ ...row, migrationVersion: 1 }); });
  const oldIdentity = await identityFor(c, oldPlan); const scope = { storyId: oldIdentity.identity.storyId, branchId: oldIdentity.identity.branchId }; const beforeEvents = await c.engine.listEvents(scope); const beforeOldCanon = beforeEvents.filter(event => event.eventType.startsWith('messaging.') || event.eventType.startsWith('calls.')).map(event => `${event.eventType}:${event.id}`).sort(); assert.ok(beforeOldCanon.some(value => value.startsWith('messaging.message-sent.v1:'))); assert.ok(beforeOldCanon.some(value => value.startsWith('calls.session-initiated.v1:')));
  const v2Plan = await c.migration.dryRun(); assert.match(v2Plan.batchId, /^preview37-migration:v2:/); assert.notEqual(v2Plan.batchId, oldPlan.batchId); assert.ok(v2Plan.items.some(item => item.sourceType === 'message' && item.state === 'already-migrated')); assert.ok(v2Plan.items.some(item => item.sourceType === 'call' && item.state === 'already-migrated')); assert.ok(v2Plan.items.some(item => item.sourceType === 'note' && item.state === 'ready'));
  const v2Result = await c.migration.commit(v2Plan); assert.equal(v2Result.validation.passed, true); const afterEvents = await c.engine.listEvents(scope); const afterOldCanon = afterEvents.filter(event => event.eventType.startsWith('messaging.') || event.eventType.startsWith('calls.')).map(event => `${event.eventType}:${event.id}`).sort(); assert.deepEqual(afterOldCanon, beforeOldCanon);
  const identity = await identityFor(c, v2Plan); const state = await counts(c, identity); assert.equal(state.notes.length, 1); assert.equal(state.gallery.length, 1); const oldBatch = await c.manifest.getBatch(oldPlan.batchId); const v2Batch = await c.manifest.getBatch(v2Plan.batchId); assert.equal(oldBatch.status, 'completed'); assert.equal(oldBatch.migrationVersion, 1); assert.equal(v2Batch.status, 'completed'); assert.equal(v2Batch.migrationVersion, 2);
  const replay = await c.migration.commit(v2Plan); assert.equal(replay.replayed, true); const replayCanon = (await c.engine.listEvents(scope)).filter(event => event.eventType.startsWith('messaging.') || event.eventType.startsWith('calls.')).map(event => `${event.eventType}:${event.id}`).sort(); assert.deepEqual(replayCanon, beforeOldCanon); assert.equal(c.previewWrites, 0);
});

test('P23 Preview37 Wallet migration preserves snapshot semantics without double-counting earlier transactions', async () => {
  const c = await setupMigration(sequencedWalletSource()); const plan = await c.migration.dryRun(); const walletItems = plan.items.filter(item => item.sourceType === 'wallet'); assert.equal(walletItems.length, 3); assert.equal(walletItems.every(item => item.state === 'ready'), true); await c.migration.commit(plan);
  const identity = await identityFor(c, plan); const state = await counts(c, identity); const commerce = new CommerceAppService({ database: c.database, phoneWorldService: c.phoneWorld }); const wallet = await commerce.walletState({ scope: state.scope, deviceId: state.user.deviceId, accountId: state.user.accountId });
  assert.equal(wallet.entries.length, 3); assert.equal(wallet.knownBalances.USD.amount, 90); const byLabel = new Map(wallet.entries.map(row => [row.label, row])); assert.ok(byLabel.get('Earlier purchase').sourceEventSequence < byLabel.get('Known balance snapshot').sourceEventSequence); assert.ok(byLabel.get('Later purchase').sourceEventSequence > byLabel.get('Known balance snapshot').sourceEventSequence); assert.equal(c.previewWrites, 0);
});

test('P23 Preview37 Wallet mixed snapshot/history without ordering semantics quarantines instead of inventing current funds', async () => {
  const c = await setupMigration(unsequencedWalletSource()); const plan = await c.migration.dryRun(); const walletItems = plan.items.filter(item => item.sourceType === 'wallet'); assert.equal(walletItems.length, 2); assert.equal(walletItems.every(item => item.state === 'ambiguous' && item.reasonCode === 'wallet-order-semantics-unproven'), true); await c.migration.commit(plan); const identity = await identityFor(c, plan); const state = await counts(c, identity); assert.equal(state.wallet.length, 0); const commerce = new CommerceAppService({ database: c.database, phoneWorldService: c.phoneWorld }); const wallet = await commerce.walletState({ scope: state.scope, deviceId: state.user.deviceId, accountId: state.user.accountId }); assert.deepEqual(wallet.knownBalances, {}); assert.equal(c.previewWrites, 0);
});

test('P23 completed replay guard: normal READY to ALREADY_MIGRATED replay passes', async () => {
  const c = await setupMigration(); const initial = await c.migration.dryRun(); await c.migration.commit(initial); const replayPlan = await c.migration.dryRun();
  const initialById = new Map(initial.items.map(item => [item.sourceRecordId, item])); assert.ok(replayPlan.items.some(item => initialById.get(item.sourceRecordId)?.state === 'ready' && item.state === 'already-migrated'));
  const replay = await c.migration.commit(replayPlan); assert.equal(replay.replayed, true);
});

test('P23 completed replay guard: unchanged already-migrated item passes', async () => {
  const c = await setupMigration(upgradeSource()); const initial = await c.migration.dryRun(); const oldPlan = legacyV1Plan(initial); await c.migration.commit(oldPlan);
  await c.database.transaction(['previewMigrationBatches'], 'readwrite', async tx => { const store = tx.store('previewMigrationBatches'); const row = await store.get(oldPlan.batchId); await store.put({ ...row, migrationVersion: 1 }); });
  const v2Plan = await c.migration.dryRun(); const already = v2Plan.items.find(item => item.state === 'already-migrated'); assert.ok(already); await c.migration.commit(v2Plan); const replayPlan = await c.migration.dryRun(); const same = replayPlan.items.find(item => item.sourceRecordId === already.sourceRecordId); assert.equal(same?.state, 'already-migrated');
  const replay = await c.migration.commit(replayPlan); assert.equal(replay.replayed, true);
});

test('P23 completed replay guard: changed classification rejects', async () => {
  const c = await setupMigration(); const initial = await c.migration.dryRun(); await c.migration.commit(initial); const tampered = patchPlanItem(initial, item => item.classification === PREVIEW37_PERSONAL_CLASSIFICATION.ELIGIBLE, { classification: PREVIEW37_PERSONAL_CLASSIFICATION.AMBIGUOUS });
  await assert.rejects(() => c.migration.commit(tampered), /Completed Preview migration classification\/source identity changed/);
});

test('P23 completed replay guard: changed non-replay state rejects', async () => {
  const c = await setupMigration(); const initial = await c.migration.dryRun(); await c.migration.commit(initial); const tampered = patchPlanItem(initial, item => item.state === 'ready', { state: 'conflict' });
  await assert.rejects(() => c.migration.commit(tampered), /Completed Preview migration state\/reason changed incompatibly/);
});

test('P23 completed replay guard: changed reason rejects', async () => {
  const c = await setupMigration(); const initial = await c.migration.dryRun(); await c.migration.commit(initial); const tampered = patchPlanItem(initial, item => item.state === 'ready', { reasonCode: 'tampered-reason' });
  await assert.rejects(() => c.migration.commit(tampered), /Completed Preview migration state\/reason changed incompatibly/);
});

test('P23 completed replay guard: missing prior plan item rejects', async () => {
  const c = await setupMigration(); const initial = await c.migration.dryRun(); await c.migration.commit(initial); const tampered = structuredClone(initial); tampered.items = tampered.items.slice(0, -1);
  await assert.rejects(() => c.migration.commit(tampered), /Completed Preview migration plan shape changed/);
});

test('P23 completed replay guard: newly introduced plan item rejects', async () => {
  const c = await setupMigration(); const initial = await c.migration.dryRun(); await c.migration.commit(initial); const tampered = structuredClone(initial); const last = tampered.items.length - 1; tampered.items[last] = { ...tampered.items[last], sourceRecordId: `${tampered.items[last].sourceRecordId}:new` };
  await assert.rejects(() => c.migration.commit(tampered), /Completed Preview migration plan gained an unrecognized source record/);
});

test('P23 completed replay guard: same-source same-version classification-sensitive incompatible plan rejects', async () => {
  const c = await setupMigration(); const initial = await c.migration.dryRun(); await c.migration.commit(initial); const tampered = patchPlanItem(initial, item => item.classification === PREVIEW37_PERSONAL_CLASSIFICATION.ELIGIBLE, { classification: PREVIEW37_PERSONAL_CLASSIFICATION.MOCK }); tampered.planFingerprint = await classificationSensitiveFingerprint(tampered); assert.equal(tampered.sourceFingerprint, initial.sourceFingerprint); assert.equal(tampered.batchId, initial.batchId); assert.notEqual(tampered.planFingerprint, initial.planFingerprint);
  await assert.rejects(() => c.migration.commit(tampered), /Completed Preview migration classification\/source identity changed/);
});

test('P23 completed replay guard: compatible replay remains idempotent', async () => {
  const c = await setupMigration(); const initial = await c.migration.dryRun(); await c.migration.commit(initial); const identity = await identityFor(c, initial); const before = await counts(c, identity); const eventCount = (await c.engine.listEvents(before.scope)).length; const replayPlan = await c.migration.dryRun(); const replay = await c.migration.commit(replayPlan); assert.equal(replay.replayed, true); const after = await counts(c, identity);
  assert.deepEqual(Object.fromEntries(Object.entries(before).filter(([key]) => !['scope', 'user'].includes(key)).map(([key, rows]) => [key, rows.length])), Object.fromEntries(Object.entries(after).filter(([key]) => !['scope', 'user'].includes(key)).map(([key, rows]) => [key, rows.length]))); assert.equal((await c.engine.listEvents(before.scope)).length, eventCount); assert.equal(c.previewWrites, 0);
});

test('P23 Preview Calendar migration preserves Story Clock, exact audience, and retry cardinality', async () => {
  const c = await setupMigration(); const plan = await c.migration.dryRun(); await c.migration.commit(plan); const identity = await identityFor(c, plan); const state = await counts(c, identity); const alice = personBySource(identity, 'member-1');
  const clock = await c.chronology.readClock(state.scope); assert.equal(clock.timelineElapsedMs, 0);
  const pendingBefore = await c.chronology.listPending(state.scope); assert.equal(pendingBefore.length, 2);
  const inviteItem = plan.items.find(item => item.sourceType === 'calendar-personal' && item.sourceRecordId.endsWith(':calendar-invite')); const inviteRow = await c.manifest.getItem(plan.batchId, inviteItem.sourceRecordId); const pending = await c.chronology.getPending(state.scope, inviteRow.canonical.pendingId);
  assert.deepEqual(new Set(pending.relevantInstanceIds), new Set([state.user.instanceId, alice.instanceId])); assert.equal(state.calendar.length, 2); assert.equal((await c.phoneWorld.listCalendar({ scope: state.scope, deviceId: alice.deviceId })).length, 1);
  const replayPlan = await c.migration.dryRun(); const replay = await c.migration.commit(replayPlan); assert.equal(replay.replayed, true); assert.equal((await c.chronology.listPending(state.scope)).length, pendingBefore.length); assert.equal((await c.phoneWorld.listCalendar({ scope: state.scope, deviceId: state.user.deviceId })).length, 2); assert.equal((await c.phoneWorld.listCalendar({ scope: state.scope, deviceId: alice.deviceId })).length, 1); assert.equal((await c.chronology.readClock(state.scope)).timelineElapsedMs, 0);
});

test('P23 Preview source fingerprint is exactly immutable and quarantine reporting is exact by family and reason', async () => {
  const c = await setupMigration(); const beforeFingerprint = await previewDigest(c.source()); const plan = await c.migration.dryRun(); assert.deepEqual(plan.classificationCounts, { ELIGIBLE_CANONICAL_PERSONAL_DATA: 10, MOCK_GENERATED_EXCLUDE: 3, AMBIGUOUS_QUARANTINE: 4 }); await c.migration.commit(plan); const afterFingerprint = await previewDigest(c.source()); assert.equal(afterFingerprint, beforeFingerprint); assert.equal(c.previewWrites, 0);
  const rows = (await c.database.transaction(['previewMigrationQuarantine'], 'readonly', tx => tx.store('previewMigrationQuarantine').getAll())).filter(row => row.batchId === plan.batchId); assert.equal(rows.length, 7);
  const familyCounts = rows.reduce((out, row) => ({ ...out, [row.sourceType]: (out[row.sourceType] || 0) + 1 }), {}); const reasonCounts = rows.reduce((out, row) => ({ ...out, [row.reasonCode]: (out[row.reasonCode] || 0) + 1 }), {});
  assert.deepEqual(familyCounts, { note: 1, gallery: 1, 'search-history': 1, wallet: 1, 'shop-order': 1, 'calendar-personal': 1, 'location-personal': 1 }); assert.deepEqual(reasonCounts, { 'mock-generated-exclude': 3, 'legacy-semantics-ambiguous': 3, 'legacy-provenance-unproven': 1 });
  const source = c.source(); const phone = source.cards['card-personal'].stories['story-personal'].branches['branch-personal'].phones.user; assert.deepEqual({ weather: phone.weather.length, health: phone.health.length, files: phone.files.length }, { weather: 1, health: 1, files: 1 }); assert.equal(plan.items.some(row => ['weather', 'health', 'file'].includes(row.sourceType)), false);
});

test('P23 malformed Preview personal records quarantine deterministically with no invented destination state', async () => {
  const c = await setupMigration(malformedPersonalSource()); const plan = await c.migration.dryRun(); const noteItems = plan.items.filter(item => item.sourceType === 'note'); assert.equal(noteItems.length, 4); assert.deepEqual(noteItems.map(item => item.reasonCode), ['malformed-legacy-record', 'malformed-legacy-record', 'malformed-legacy-record', 'legacy-record-missing-stable-id']); await c.migration.commit(plan); const identity = await identityFor(c, plan); const state = await counts(c, identity); assert.equal(state.notes.length, 0);
  const rows = (await c.database.transaction(['previewMigrationQuarantine'], 'readonly', tx => tx.store('previewMigrationQuarantine').getAll())).filter(row => row.batchId === plan.batchId && row.sourceType === 'note'); assert.equal(rows.length, 4); assert.deepEqual(rows.reduce((out, row) => ({ ...out, [row.reasonCode]: (out[row.reasonCode] || 0) + 1 }), {}), { 'malformed-legacy-record': 3, 'legacy-record-missing-stable-id': 1 }); assert.equal(c.previewWrites, 0);
});
