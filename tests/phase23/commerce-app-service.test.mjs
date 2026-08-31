import test from 'node:test';
import assert from 'node:assert/strict';
import { CommerceAppService } from '../../application/commerce-app-service.mjs';
import { CanonicalEventEngine } from '../../domain/events/event-transaction.mjs';
import { defineProjector } from '../../domain/projections/projection-runner.mjs';
import { PHONE_WORLD_EVENT_TYPES, createPhase23EventTypeRegistry } from '../../domain/utilities/phone-world-event-types.mjs';
import { createPhoneWorldProjector } from '../../domain/utilities/phone-world-projector.mjs';
import { PhoneWorldService } from '../../domain/utilities/phone-world-service.mjs';
import { setupPhoneWorldFoundation, ownedInput, utilitySource } from './phone-world-foundation-fixtures.mjs';

function action(c, person, recordId, key, extra = {}) { return { scope: c.scope, ...ownedInput(person), recordId, source: utilitySource(key), producer: 'phase23-commerce-test', idempotencyKey: key, ...extra }; }

async function setupCommerce(manifestId = 'p23-commerce') {
  const c = await setupPhoneWorldFoundation({ castSize: 2, manifestId });
  const commerce = new CommerceAppService({ database: c.database, phoneWorldService: c.phoneWorld });
  return { ...c, commerce };
}

test('C2-5 Wallet starts truthfully empty and computes balance only from explicit snapshots plus later transactions', async () => {
  const c = await setupCommerce('p23-wallet-explicit');
  let state = await c.commerce.walletState({ scope: c.scope, deviceId: c.user.deviceId, accountId: c.user.accountId });
  assert.equal(state.entries.length, 0); assert.deepEqual(state.knownBalances, {});
  await c.phoneWorld.recordWalletEntry(action(c, c.user, 'balance-usd', 'balance-usd', { entryKind: 'balance', label: 'Story wallet balance', amount: 100, currency: 'USD', sourceKind: 'story-canon' }));
  await c.phoneWorld.recordWalletEntry(action(c, c.user, 'tx-before-snapshot', 'tx-before-snapshot', { entryKind: 'transaction', label: 'Historical', amount: -999, currency: 'USD', sourceKind: 'story-canon' }));
  await c.phoneWorld.recordWalletEntry(action(c, c.user, 'balance-usd-2', 'balance-usd-2', { entryKind: 'balance', label: 'Authoritative balance update', amount: 80, currency: 'USD', sourceKind: 'story-canon' }));
  await c.phoneWorld.recordWalletEntry(action(c, c.user, 'tx-after', 'tx-after', { entryKind: 'transaction', label: 'Snack', amount: -10, currency: 'USD', sourceKind: 'story-canon' }));
  state = await c.commerce.walletState({ scope: c.scope, deviceId: c.user.deviceId, accountId: c.user.accountId });
  assert.equal(state.knownBalances.USD.amount, 70);
  assert.equal(state.knownBalances.USD.snapshotRecordId, 'balance-usd-2');
});

test('C2-5 paid Shop checkout derives price/currency from catalog, links one Wallet debit, and retry does not duplicate', async () => {
  const c = await setupCommerce('p23-shop-checkout');
  await c.phoneWorld.recordWalletEntry(action(c, c.user, 'balance-usd', 'wallet-balance', { entryKind: 'balance', label: 'Story funds', amount: 100, currency: 'USD', sourceKind: 'story-canon' }));
  await c.phoneWorld.setShopItem(action(c, c.user, 'item-tea', 'catalog-tea', { name: 'Tea', description: 'Explicit catalog item', price: 12.5, currency: 'USD', available: true, sourceKind: 'story-canon' }));
  const input = action(c, c.user, null, 'checkout-tea', { shopItemId: 'item-tea', quantity: 2, unitPrice: 0.01, currency: 'FAKE' });
  const first = await c.commerce.checkout(input);
  assert.equal(first.order.unitPrice, 12.5); assert.equal(first.order.currency, 'USD'); assert.equal(first.order.quantity, 2);
  assert.equal(first.walletDebit.amount, -25); assert.equal(first.walletDebit.currency, 'USD'); assert.equal(first.walletDebit.relatedOrderId, first.order.recordId);
  const orderCount = (await c.phoneWorld.listShopOrders({ scope: c.scope, deviceId: c.user.deviceId })).length;
  const walletCount = (await c.phoneWorld.listWallet({ scope: c.scope, deviceId: c.user.deviceId })).length;
  const second = await c.commerce.checkout(input);
  assert.equal(second.order.recordId, first.order.recordId); assert.equal((await c.phoneWorld.listShopOrders({ scope: c.scope, deviceId: c.user.deviceId })).length, orderCount); assert.equal((await c.phoneWorld.listWallet({ scope: c.scope, deviceId: c.user.deviceId })).length, walletCount);
  const state = await c.commerce.walletState({ scope: c.scope, deviceId: c.user.deviceId, accountId: c.user.accountId }); assert.equal(state.knownBalances.USD.amount, 75);
});

test('C2-5 paid checkout refuses to fabricate funds; free explicit catalog item can order without Wallet balance', async () => {
  const c = await setupCommerce('p23-shop-no-funds');
  await c.phoneWorld.setShopItem(action(c, c.user, 'item-paid', 'catalog-paid', { name: 'Paid item', price: 5, currency: 'USD', available: true, sourceKind: 'story-canon' }));
  await assert.rejects(() => c.commerce.checkout(action(c, c.user, null, 'checkout-no-funds', { shopItemId: 'item-paid', quantity: 1 })), /cannot fabricate funds/i);
  assert.equal((await c.phoneWorld.listShopOrders({ scope: c.scope, deviceId: c.user.deviceId })).length, 0);
  await c.phoneWorld.setShopItem(action(c, c.user, 'item-free', 'catalog-free', { name: 'Free sample', price: 0, currency: 'USD', available: true, sourceKind: 'story-canon' }));
  const free = await c.commerce.checkout(action(c, c.user, null, 'checkout-free', { shopItemId: 'item-free', quantity: 1 }));
  assert.equal(free.order.unitPrice, 0); assert.equal(free.walletDebit, null);
});

test('C2-5 Wallet/Shop reads are device-private and checkout rejects another Device catalog', async () => {
  const c = await setupCommerce('p23-commerce-privacy');
  await c.phoneWorld.setShopItem(action(c, c.user, 'user-item', 'user-item', { name: 'User item', price: 1, currency: 'USD', available: true, sourceKind: 'story-canon' }));
  assert.equal((await c.commerce.shopState({ scope: c.scope, deviceId: c.user.deviceId, accountId: c.user.accountId })).items.length, 1);
  assert.equal((await c.commerce.shopState({ scope: c.scope, deviceId: c.alice.deviceId, accountId: c.alice.accountId })).items.length, 0);
  await assert.rejects(() => c.commerce.checkout(action(c, c.alice, null, 'alice-user-item', { shopItemId: 'user-item', quantity: 1 })), /another Device/i);
  await assert.rejects(() => c.commerce.walletState({ scope: { storyId: c.scope.storyId, branchId: 'branch_foreign' }, deviceId: c.user.deviceId, accountId: c.user.accountId }), /scope|Unknown scoped/i);
});

test('C2-5 distinct paid checkout intents serialize against canonical Wallet funds and cannot overspend', async () => {
  const c = await setupCommerce('p23-commerce-concurrent-funds');
  await c.phoneWorld.recordWalletEntry(action(c, c.user, 'balance-usd', 'concurrent-balance', { entryKind: 'balance', label: 'Available story funds', amount: 100, currency: 'USD', sourceKind: 'story-canon' }));
  await c.phoneWorld.setShopItem(action(c, c.user, 'item-expensive', 'concurrent-item', { name: 'Expensive item', price: 80, currency: 'USD', available: true, sourceKind: 'story-canon' }));
  const item = await c.phoneWorld.getShopItem({ scope: c.scope, recordId: 'item-expensive' });
  const [a, b] = await Promise.allSettled([
    c.commerce.checkout(action(c, c.user, null, 'checkout-intent-a', { shopItemId: item.recordId, quantity: 1, expectedCatalogSequence: item.sourceEventSequence })),
    c.commerce.checkout(action(c, c.user, null, 'checkout-intent-b', { shopItemId: item.recordId, quantity: 1, expectedCatalogSequence: item.sourceEventSequence })),
  ]);
  assert.equal([a, b].filter(row => row.status === 'fulfilled').length, 1);
  assert.equal([a, b].filter(row => row.status === 'rejected').length, 1);
  assert.match(String([a, b].find(row => row.status === 'rejected').reason), /Insufficient explicit Wallet balance/i);
  const orders = await c.phoneWorld.listShopOrders({ scope: c.scope, deviceId: c.user.deviceId });
  const wallet = await c.commerce.walletState({ scope: c.scope, deviceId: c.user.deviceId, accountId: c.user.accountId });
  assert.equal(orders.length, 1); assert.equal(wallet.entries.filter(row => row.entryKind === 'transaction' && row.relatedOrderId).length, 1); assert.equal(wallet.knownBalances.USD.amount, 20);
});

test('C2-5 checkout projector failure rolls back Order+Debit+Event atomically and retry converges once', async () => {
  const failing = defineProjector({ id: 'p23-commerce-atomic-failure', version: 1, stores: [], project: event => { if (event.eventType === PHONE_WORLD_EVENT_TYPES.SHOP_CHECKOUT) throw new Error('injected checkout projection failure'); return []; } });
  const c = await setupPhoneWorldFoundation({ castSize: 2, manifestId: 'p23-commerce-atomic-recovery', additionalProjectors: [failing] });
  const brokenCommerce = new CommerceAppService({ database: c.database, phoneWorldService: c.phoneWorld });
  await c.phoneWorld.recordWalletEntry(action(c, c.user, 'balance-usd', 'atomic-balance', { entryKind: 'balance', label: 'Story funds', amount: 100, currency: 'USD', sourceKind: 'story-canon' }));
  await c.phoneWorld.setShopItem(action(c, c.user, 'item-atomic', 'atomic-item', { name: 'Atomic item', price: 25, currency: 'USD', available: true, sourceKind: 'story-canon' }));
  const item = await c.phoneWorld.getShopItem({ scope: c.scope, recordId: 'item-atomic' });
  const input = action(c, c.user, null, 'atomic-checkout', { shopItemId: item.recordId, quantity: 1, expectedCatalogSequence: item.sourceEventSequence });
  await assert.rejects(() => brokenCommerce.checkout(input), /injected checkout projection failure/);
  assert.equal((await c.phoneWorld.listShopOrders({ scope: c.scope, deviceId: c.user.deviceId })).length, 0);
  assert.equal((await c.phoneWorld.listWallet({ scope: c.scope, deviceId: c.user.deviceId })).filter(row => row.relatedOrderId).length, 0);
  assert.equal((await c.utilityEngine.listEvents(c.scope)).filter(event => event.eventType === PHONE_WORLD_EVENT_TYPES.SHOP_CHECKOUT).length, 0);

  const healthyEngine = new CanonicalEventEngine({ database: c.database, eventTypes: createPhase23EventTypeRegistry(), projectors: [createPhoneWorldProjector()], now: () => '2026-08-31T03:31:00.000Z' });
  await healthyEngine.catchUp(c.scope);
  const healthyPhoneWorld = new PhoneWorldService({ database: c.database, eventEngine: healthyEngine });
  const healthyCommerce = new CommerceAppService({ database: c.database, phoneWorldService: healthyPhoneWorld });
  const recovered = await healthyCommerce.checkout(input);
  assert.equal(recovered.order.status, 'ordered'); assert.equal(recovered.walletDebit.relatedOrderId, recovered.order.recordId);
  const retried = await healthyCommerce.checkout(input); assert.equal(retried.replayed, true);
  assert.equal((await healthyPhoneWorld.listShopOrders({ scope: c.scope, deviceId: c.user.deviceId })).length, 1);
  assert.equal((await healthyPhoneWorld.listWallet({ scope: c.scope, deviceId: c.user.deviceId })).filter(row => row.relatedOrderId === recovered.order.recordId).length, 1);
});

test('C2-5 checkout rejects stale rendered catalog sequence instead of silently ordering changed price', async () => {
  const c = await setupCommerce('p23-commerce-stale-catalog');
  await c.phoneWorld.recordWalletEntry(action(c, c.user, 'balance-usd', 'stale-balance', { entryKind: 'balance', label: 'Story funds', amount: 100, currency: 'USD', sourceKind: 'story-canon' }));
  await c.phoneWorld.setShopItem(action(c, c.user, 'item-stale', 'stale-item-v1', { name: 'Changing item', price: 10, currency: 'USD', available: true, sourceKind: 'story-canon' }));
  const rendered = await c.phoneWorld.getShopItem({ scope: c.scope, recordId: 'item-stale' });
  await c.phoneWorld.setShopItem(action(c, c.user, 'item-stale', 'stale-item-v2', { name: 'Changing item', price: 12, currency: 'USD', available: true, sourceKind: 'story-canon' }));
  await assert.rejects(() => c.commerce.checkout(action(c, c.user, null, 'stale-checkout', { shopItemId: 'item-stale', quantity: 1, expectedCatalogSequence: rendered.sourceEventSequence, unitPrice: 0.01, currency: 'FAKE' })), /changed after it was selected/i);
  assert.equal((await c.phoneWorld.listShopOrders({ scope: c.scope, deviceId: c.user.deviceId })).length, 0);
});
