import test from 'node:test';
import assert from 'node:assert/strict';
import { PHONE_WORLD_EVENT_TYPES } from '../../domain/utilities/phone-world-event-types.mjs';
import { setupPhoneWorldFoundation, ownedInput, utilitySource } from './phone-world-foundation-fixtures.mjs';

const action = (context, person, recordId, key, extra = {}) => ({
  scope: context.scope, ...ownedInput(person), recordId, source: utilitySource(key), idempotencyKey: key, ...extra,
});

test('P23 foundation Gallery and Files project explicit scoped asset/file state; Gallery removal is device-local and undo-safe', async () => {
  const c = await setupPhoneWorldFoundation({ manifestId: 'p23-gallery-files' });
  const added = await c.phoneWorld.saveGalleryAsset(action(c, c.user, 'gallery-1', 'gallery-add', { label: 'Story photo', assetRef: 'asset:canonical:1', provenance: { takenByActorId: c.user.actorId, source: 'story-explicit' } }));
  assert.equal(added.event.eventType, PHONE_WORLD_EVENT_TYPES.GALLERY_ITEM_STATE);
  assert.equal((await c.phoneWorld.listGallery({ scope: c.scope, deviceId: c.user.deviceId })).length, 1);
  assert.equal((await c.phoneWorld.listGallery({ scope: c.scope, deviceId: c.alice.deviceId })).length, 0);
  const removed = await c.phoneWorld.removeGalleryAsset(action(c, c.user, 'gallery-1', 'gallery-remove'));
  assert.equal((await c.phoneWorld.listGallery({ scope: c.scope, deviceId: c.user.deviceId })).length, 0);
  await c.utilityEngine.retract({ scope: c.scope, eventId: removed.event.id, expectedRevision: removed.event.revision, reason: 'restore device gallery membership', producer: 'phase23-test', idempotencyKey: 'undo-gallery-remove' });
  assert.equal((await c.phoneWorld.listGallery({ scope: c.scope, deviceId: c.user.deviceId }))[0].assetRef, 'asset:canonical:1');

  await c.phoneWorld.saveFile(action(c, c.user, 'file-text-1', 'file-text', { name: 'note.txt', fileKind: 'text', contentText: 'explicit file content', folder: 'Documents' }));
  await c.phoneWorld.saveFile(action(c, c.user, 'file-asset-1', 'file-asset', { name: 'photo.ref', fileKind: 'asset-ref', assetRef: 'asset:canonical:1', folder: 'Images' }));
  const files = await c.phoneWorld.listFiles({ scope: c.scope, deviceId: c.user.deviceId });
  assert.equal(files.length, 2); assert.ok(files.some(row => row.contentText === 'explicit file content')); assert.ok(files.some(row => row.assetRef === 'asset:canonical:1'));
  assert.equal((await c.phoneWorld.listFiles({ scope: c.scope, deviceId: c.alice.deviceId })).length, 0);
});

test('P23 foundation Notes edit/delete projection is deterministic and retracting delete restores prior note; Search history is explicit only', async () => {
  const c = await setupPhoneWorldFoundation({ manifestId: 'p23-notes-search' });
  await c.phoneWorld.saveNote(action(c, c.user, 'note-1', 'note-create', { title: 'Plan', text: 'first' }));
  await c.phoneWorld.saveNote(action(c, c.user, 'note-1', 'note-edit', { title: 'Plan', text: 'edited', pinned: true }));
  let notes = await c.phoneWorld.listNotes({ scope: c.scope, deviceId: c.user.deviceId }); assert.equal(notes.length, 1); assert.equal(notes[0].text, 'edited'); assert.equal(notes[0].pinned, true);
  const deleted = await c.phoneWorld.deleteNote(action(c, c.user, 'note-1', 'note-delete'));
  assert.equal((await c.phoneWorld.listNotes({ scope: c.scope, deviceId: c.user.deviceId })).length, 0);
  await c.utilityEngine.retract({ scope: c.scope, eventId: deleted.event.id, expectedRevision: deleted.event.revision, reason: 'undo note delete', producer: 'phase23-test', idempotencyKey: 'undo-note-delete' });
  notes = await c.phoneWorld.listNotes({ scope: c.scope, deviceId: c.user.deviceId }); assert.equal(notes.length, 1); assert.equal(notes[0].text, 'edited');

  assert.equal((await c.phoneWorld.listSearch({ scope: c.scope, deviceId: c.user.deviceId })).length, 0);
  await c.phoneWorld.recordSearch(action(c, c.user, 'search-1', 'search-record', { query: 'canonical character name', provider: 'local-phone-world', resultRef: 'actor:known' }));
  assert.equal((await c.phoneWorld.listSearch({ scope: c.scope, deviceId: c.user.deviceId }))[0].query, 'canonical character name');
  await c.phoneWorld.clearSearchEntry(action(c, c.user, 'search-1', 'search-clear'));
  assert.equal((await c.phoneWorld.listSearch({ scope: c.scope, deviceId: c.user.deviceId })).length, 0);
});

test('P23 foundation Location enforces owner/audience privacy for Check In, Share Location and temporary Live Location', async () => {
  const c = await setupPhoneWorldFoundation({ castSize: 3, manifestId: 'p23-location' });
  await c.phoneWorld.setLocation(action(c, c.user, 'loc-owner', 'loc-owner', { mode: 'check-in', label: 'Library', audienceAccountIds: [] }));
  assert.equal((await c.phoneWorld.listLocations({ scope: c.scope, deviceId: c.user.deviceId, viewerAccountId: c.user.accountId })).length, 1);
  assert.equal((await c.phoneWorld.listLocations({ scope: c.scope, deviceId: c.user.deviceId, viewerAccountId: c.alice.accountId })).length, 0);

  await c.phoneWorld.setLocation(action(c, c.user, 'loc-share', 'loc-share', { mode: 'shared', label: 'Cafe', audienceAccountIds: [c.alice.accountId] }));
  const aliceVisible = await c.phoneWorld.listLocations({ scope: c.scope, deviceId: c.user.deviceId, viewerAccountId: c.alice.accountId });
  assert.deepEqual(aliceVisible.map(row => row.recordId), ['loc-share']);
  assert.equal((await c.phoneWorld.listLocations({ scope: c.scope, deviceId: c.user.deviceId, viewerAccountId: c.bob.accountId })).length, 0);

  await c.phoneWorld.setLocation(action(c, c.user, 'loc-live', 'loc-live', { mode: 'live', label: 'On the way', audienceAccountIds: [c.alice.accountId], expiresAt: '2026-08-31T04:00:00.000Z' }));
  let live = (await c.phoneWorld.listLocations({ scope: c.scope, deviceId: c.user.deviceId, viewerAccountId: c.alice.accountId })).find(row => row.recordId === 'loc-live');
  assert.equal(live.status, 'active'); assert.equal(live.expiresAt, '2026-08-31T04:00:00.000Z');
  await c.phoneWorld.endLocation(action(c, c.user, 'loc-live', 'loc-live-end'));
  live = (await c.phoneWorld.listLocations({ scope: c.scope, deviceId: c.user.deviceId, viewerAccountId: c.alice.accountId })).find(row => row.recordId === 'loc-live'); assert.equal(live.status, 'ended');

  await assert.rejects(() => c.phoneWorld.setLocation(action(c, c.user, 'loc-invalid', 'loc-invalid', { mode: 'shared', label: 'Secret', audienceAccountIds: [] })), /explicit audience/i);
  await assert.rejects(() => c.phoneWorld.setLocation(action(c, c.user, 'loc-foreign', 'loc-foreign', { mode: 'shared', label: 'Secret', audienceAccountIds: ['account_foreign'] })), /Unknown scoped.*Account/i);
});

test('P23 foundation Calendar, Wallet and Shop use explicit typed state; order price comes from catalog and retry does not duplicate checkout', async () => {
  const c = await setupPhoneWorldFoundation({ manifestId: 'p23-calendar-commerce' });
  await c.phoneWorld.setCalendarItem(action(c, c.user, 'cal-1', 'calendar-create', { itemKind: 'invitation', title: 'Meet Alice', due: { kind: 'absolute', localDate: '2026-09-01', localTime: '18:00:00' }, participantActorIds: [c.user.actorId, c.alice.actorId], participantInstanceIds: [c.user.instanceId, c.alice.instanceId], response: 'pending' }));
  const calendar = await c.phoneWorld.listCalendar({ scope: c.scope, deviceId: c.user.deviceId }); assert.equal(calendar.length, 1); assert.equal(calendar[0].response, 'pending');

  assert.equal((await c.phoneWorld.listWallet({ scope: c.scope, deviceId: c.user.deviceId })).length, 0);
  await c.phoneWorld.recordWalletEntry(action(c, c.user, 'wallet-1', 'wallet-explicit', { entryKind: 'transaction', label: 'Story allowance', amount: 500, currency: 'JPY' }));
  assert.equal((await c.phoneWorld.listWallet({ scope: c.scope, deviceId: c.user.deviceId }))[0].amount, 500);

  await c.phoneWorld.setShopItem(action(c, c.user, 'item-1', 'catalog-item', { name: 'Explicit story item', description: 'Provided by story state', price: 120, currency: 'JPY', available: true }));
  const orderInput = action(c, c.user, 'order-1', 'checkout-1', { shopItemId: 'item-1', quantity: 2, unitPrice: 999999, currency: 'FAKE' });
  const first = await c.phoneWorld.placeShopOrder(orderInput); const retry = await c.phoneWorld.placeShopOrder(orderInput);
  assert.equal(first.event.id, retry.event.id); assert.equal(retry.replayed, true);
  const orders = await c.phoneWorld.listShopOrders({ scope: c.scope, deviceId: c.user.deviceId }); assert.equal(orders.length, 1); assert.equal(orders[0].unitPrice, 120); assert.equal(orders[0].currency, 'JPY'); assert.equal(orders[0].quantity, 2);
});

test('P23 foundation Weather and Health are empty until an explicit observation exists and never synthesize measurements', async () => {
  const c = await setupPhoneWorldFoundation({ manifestId: 'p23-weather-health' });
  assert.equal((await c.phoneWorld.listWeather({ scope: c.scope, deviceId: c.user.deviceId })).length, 0); assert.equal((await c.phoneWorld.listHealth({ scope: c.scope, deviceId: c.user.deviceId })).length, 0);
  await c.phoneWorld.recordWeather(action(c, c.user, 'weather-1', 'weather-explicit', { sourceKind: 'story-observation', locationLabel: 'School grounds', condition: 'Rain', temperatureC: 22, observedAt: '2026-08-31T03:00:00.000Z', provider: null }));
  await c.phoneWorld.recordHealth(action(c, c.user, 'health-steps', 'health-explicit', { sourceKind: 'explicit-user', metric: 'steps', value: 3200, unit: 'steps', observedAt: '2026-08-31T03:10:00.000Z', sourceLabel: 'Explicit phone-world state' }));
  const weather = await c.phoneWorld.listWeather({ scope: c.scope, deviceId: c.user.deviceId }); const health = await c.phoneWorld.listHealth({ scope: c.scope, deviceId: c.user.deviceId });
  assert.deepEqual(weather.map(row => [row.condition, row.temperatureC]), [['Rain', 22]]); assert.deepEqual(health.map(row => [row.metric, row.value]), [['steps', 3200]]);
  assert.equal((await c.phoneWorld.listWeather({ scope: c.scope, deviceId: c.alice.deviceId })).length, 0); assert.equal((await c.phoneWorld.listHealth({ scope: c.scope, deviceId: c.alice.deviceId })).length, 0);
});

test('P23 foundation rejects ownership spoofing, cross-Branch writes, malformed payloads, unknown Events, and nested undefined canonical data', async () => {
  const c = await setupPhoneWorldFoundation({ manifestId: 'p23-foundation-failclosed' });
  await assert.rejects(() => c.phoneWorld.saveNote(action(c, c.user, 'spoof', 'spoof', { ownerActorId: c.alice.actorId, ownerInstanceId: c.alice.instanceId, title: 'No', text: 'No' })), /does not match canonical Device ownership/i);
  const wrongScope = { storyId: c.scope.storyId, branchId: 'branch_foreign' };
  await assert.rejects(() => c.phoneWorld.saveNote({ ...action(c, c.user, 'cross-branch', 'cross-branch', { title: 'No', text: 'No' }), scope: wrongScope }), /Unknown scoped phone-world Device/i);
  await assert.rejects(() => c.phoneWorld.recordWeather(action(c, c.user, 'bad-weather', 'bad-weather', { locationLabel: 'Here', temperatureC: 20 })), /weather\.condition/i);
  await assert.rejects(() => c.utilityEngine.append({ scope: c.scope, eventType: 'phone-world.unknown.v1', payload: {}, source: utilitySource('unknown-event'), producer: 'phase23-test', idempotencyKey: 'unknown-event' }), /Unknown|unsupported|registered/i);
  await assert.rejects(() => c.phoneWorld.setCalendarItem(action(c, c.user, 'bad-calendar-json', 'bad-calendar-json', { itemKind: 'reminder', title: 'Strict JSON', due: { kind: 'absolute', localTime: undefined }, participantActorIds: [c.user.actorId], participantInstanceIds: [c.user.instanceId] })), /must be JSON-serializable data/i);
});

test('P23 foundation deterministic replay creates one projection head and generates no random record values', async () => {
  const c = await setupPhoneWorldFoundation({ manifestId: 'p23-foundation-deterministic' });
  const input = { scope: c.scope, ...ownedInput(c.user), title: 'Deterministic', text: 'Same semantic input', source: utilitySource('deterministic-note'), idempotencyKey: 'deterministic-note' };
  const first = await c.phoneWorld.saveNote(input); const second = await c.phoneWorld.saveNote(input);
  assert.equal(first.event.id, second.event.id); assert.equal(second.replayed, true);
  const rows = await c.phoneWorld.listNotes({ scope: c.scope, deviceId: c.user.deviceId }); assert.equal(rows.length, 1); assert.match(rows[0].recordId, /^note_[0-9a-f]{32}$/);
  assert.equal(rows[0].title, 'Deterministic'); assert.equal(rows[0].text, 'Same semantic input');
});
