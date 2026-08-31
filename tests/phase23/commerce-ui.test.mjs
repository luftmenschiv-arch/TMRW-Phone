import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { CanonicalEventEngine } from '../../domain/events/event-transaction.mjs';
import { createPhase23EventTypeRegistry } from '../../domain/utilities/phone-world-event-types.mjs';
import { createPhoneWorldProjector } from '../../domain/utilities/phone-world-projector.mjs';
import { PhoneWorldService } from '../../domain/utilities/phone-world-service.mjs';
import { CommerceAppService } from '../../application/commerce-app-service.mjs';
import { PhoneShellViewModels } from '../../ui/view-models.mjs';
import { TmrwPhoneShell } from '../../ui/shell.mjs';
import { homeViewModel } from '../../ui/home.mjs';
import { setupPhase17, phase17Projectors } from '../phase17/notification-fixtures.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(predicate) { for (let index = 0; index < 160; index += 1) { if (await predicate()) return; await settle(); } throw new Error('Commerce UI did not settle'); }
function find(node, predicate) { if (predicate(node)) return node; for (const child of node.children || []) { const hit = find(child, predicate); if (hit) return hit; } return null; }
function allText(node, out = []) { if (node.textContent) out.push(String(node.textContent)); for (const child of node.children || []) allText(child, out); return out.join(' '); }
const source = recordId => ({ authority: 'p23-commerce-ui', kind: 'test', recordId, version: '1' });
function owned(c, person, recordId, key, extra = {}) { return { scope: c.scope, deviceId: person.deviceId, ownerActorId: person.actorId, ownerInstanceId: person.instanceId, ownerAccountId: person.accountId, recordId, source: source(key), producer: 'p23-commerce-ui', idempotencyKey: key, ...extra }; }

async function setupCommerceUi(manifestId = 'p23-commerce-ui', { commerceOverride = null } = {}) {
  const c = await setupPhase17({ castSize: 2, manifestId });
  const engine = new CanonicalEventEngine({ database: c.database, eventTypes: createPhase23EventTypeRegistry(), projectors: [...phase17Projectors(), createPhoneWorldProjector()], now: () => '2026-08-31T06:00:00.000Z' });
  await engine.catchUp(c.scope);
  const phoneWorld = new PhoneWorldService({ database: c.database, eventEngine: engine });
  const commerce = new CommerceAppService({ database: c.database, phoneWorldService: phoneWorld });
  const commerceService = commerceOverride ? commerceOverride(commerce) : commerce;
  const viewModels = new PhoneShellViewModels({ database: c.database, phoneStateService: c.phones, contactService: c.contacts, settingsService: c.settings, messageService: c.messages, callService: c.calls, socialService: c.social, insungramService: c.insungram, liveService: c.live, notificationService: c.notifications, phoneWorldService: phoneWorld, commerceService });
  return { ...c, engine, phoneWorld, commerce, viewModels };
}
function shellFor(c) { return new TmrwPhoneShell({ document: c.document, viewModels: c.viewModels, controller: c.controller, messageService: c.messages, callService: c.calls, callCoordinator: c.viewModels.callCoordinator, socialService: c.social, notificationService: c.notifications, scope: c.scope, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, selectedDeviceId: c.user.deviceId }); }
async function open(shell, route) { const button = find(shell.root, node => node.dataset?.route === route); assert.ok(button, `missing ${route}`); button.click(); await settle(); return shell.root.children[3].children[0]; }

async function seedBalance(c, amount = 100, currency = 'USD', key = `balance-${currency}`) { return c.phoneWorld.recordWalletEntry(owned(c, c.user, key, key, { entryKind: 'balance', label: `${currency} story balance`, amount, currency, sourceKind: 'story-canon' })); }
async function seedItem(c, { recordId = 'item-tea', name = 'Tea', description = 'Explicit canonical catalog item', price = 10, currency = 'USD', key = recordId } = {}) { return c.phoneWorld.setShopItem(owned(c, c.user, recordId, key, { name, description, price, currency, available: true, sourceKind: 'story-canon' })); }

test('C2-5 Wallet shell shows loading, genuine unknown/empty state, and real Back', async () => {
  let release;
  const c = await setupCommerceUi('p23-wallet-loading', { commerceOverride: commerce => ({
    walletState: input => new Promise((resolve, reject) => { release = () => commerce.walletState(input).then(resolve, reject); }),
    shopState: input => commerce.shopState(input), checkout: input => commerce.checkout(input),
  }) });
  const shell = shellFor(c); await shell.mount(c.target); const button = find(shell.root, node => node.dataset?.route === 'wallet'); assert.ok(button); button.click();
  await waitFor(() => Boolean(find(shell.root, node => node.attributes?.get?.('role') === 'status' && /Loading Wallet/.test(node.textContent))));
  release(); await waitFor(() => /Balance unknown/.test(allText(shell.root)));
  const panel = shell.root.children[3].children[0]; assert.match(allText(panel), /No canonical Wallet transactions/); assert.doesNotMatch(allText(panel), /0 USD/);
  const back = find(panel, node => node.dataset?.navAction === 'back'); assert.ok(back); back.click(); await settle(); assert.equal(shell.root.children[2].hidden, false);
});

test('C2-5 Wallet shell renders known zero/nonzero multi-currency balances without summing unlike currencies', async () => {
  const c = await setupCommerceUi('p23-wallet-currencies'); await seedBalance(c, 0, 'USD', 'balance-usd-zero'); await seedBalance(c, 2500, 'JPY', 'balance-jpy');
  const shell = shellFor(c); await shell.mount(c.target); const panel = await open(shell, 'wallet'); const text = allText(panel);
  assert.match(text, /0 USD/); assert.match(text, /2500 JPY/); assert.doesNotMatch(text, /2500 USD|2500 .*total/i); assert.match(text, /story-canon/);
});

test('C2-5 Wallet shell shows canonical transaction provenance and linked paid Shop Order detail', async () => {
  const c = await setupCommerceUi('p23-wallet-linked'); await seedBalance(c, 100); await seedItem(c, { price: 25 });
  const result = await c.commerce.checkout(owned(c, c.user, null, 'checkout-linked', { shopItemId: 'item-tea', quantity: 1 }));
  const shell = shellFor(c); await shell.mount(c.target); let panel = await open(shell, 'wallet'); const row = find(panel, node => node.dataset?.walletRecordId === result.walletDebit.recordId); assert.ok(row); row.click(); await settle(); panel = shell.root.children[3].children[0];
  const text = allText(panel); assert.match(text, /-25 USD/); assert.match(text, /shop-order/); assert.match(text, new RegExp(`Linked Shop Order: ${result.order.recordId}`));
});

test('C2-5 Wallet access/load failure is recoverable and device switch clears selected private transaction', async () => {
  const c = await setupCommerceUi('p23-wallet-device'); await seedBalance(c, 100); await c.phoneWorld.recordWalletEntry(owned(c, c.user, 'private-tx', 'private-tx', { entryKind: 'transaction', label: 'Private debit', amount: -5, currency: 'USD', sourceKind: 'story-canon' }));
  const shell = shellFor(c); await shell.mount(c.target); let panel = await open(shell, 'wallet'); find(panel, node => node.dataset?.walletRecordId === 'private-tx').click(); await settle(); assert.ok(find(shell.root, node => node.dataset?.walletDetailsId === 'private-tx'));
  await shell.selectDevice(c.alice.deviceId); panel = shell.root.children[3].children[0]; assert.match(allText(panel), /unavailable until access|access/i); assert.doesNotMatch(allText(panel), /Private debit|100 USD/);
  await shell.selectDevice(c.user.deviceId); panel = shell.root.children[3].children[0]; assert.equal(find(panel, node => node.dataset?.walletDetailsId), null);

  const broken = await setupCommerceUi('p23-wallet-error', { commerceOverride: commerce => ({ walletState: async () => { throw new Error('Injected commerce read failure'); }, shopState: input => commerce.shopState(input), checkout: input => commerce.checkout(input) }) });
  const brokenShell = shellFor(broken); await brokenShell.mount(broken.target); const errorPanel = await open(brokenShell, 'wallet'); assert.match(allText(errorPanel), /Wallet error: Injected commerce read failure/); assert.equal(find(errorPanel, node => node.attributes?.get?.('role') === 'status'), null);
});

test('C2-5 Shop shell shows loading, truthful empty catalog, and real Back', async () => {
  let release;
  const c = await setupCommerceUi('p23-shop-loading', { commerceOverride: commerce => ({
    walletState: input => commerce.walletState(input), shopState: input => new Promise((resolve, reject) => { release = () => commerce.shopState(input).then(resolve, reject); }), checkout: input => commerce.checkout(input),
  }) });
  const shell = shellFor(c); await shell.mount(c.target); const button = find(shell.root, node => node.dataset?.route === 'shop'); assert.ok(button); button.click();
  await waitFor(() => Boolean(find(shell.root, node => node.attributes?.get?.('role') === 'status' && /Loading Shop/.test(node.textContent)))); release(); await waitFor(() => /No canonical Shop catalog/.test(allText(shell.root)));
  const panel = shell.root.children[3].children[0]; assert.match(allText(panel), /does not generate fallback merchandise/); const back = find(panel, node => node.dataset?.navAction === 'back'); assert.ok(back); back.click(); await settle(); assert.equal(shell.root.children[2].hidden, false);
});

test('C2-5 Shop item detail and explicit confirmation use canonical price/currency and distinguish unknown funds', async () => {
  const c = await setupCommerceUi('p23-shop-detail'); await seedItem(c, { price: 12.5, currency: 'USD' });
  const shell = shellFor(c); await shell.mount(c.target); let panel = await open(shell, 'shop'); const item = find(panel, node => node.dataset?.shopRecordId === 'item-tea'); assert.ok(item); item.click(); await settle(); panel = shell.root.children[3].children[0];
  assert.match(allText(panel), /Canonical price: 12.5 USD/); assert.match(allText(panel), /UNKNOWN FUNDS/); find(panel, node => node.dataset?.shopAction === 'review-checkout').click(); await settle(); panel = shell.root.children[3].children[0];
  const confirm = find(panel, node => node.dataset?.shopAction === 'confirm-checkout'); assert.ok(confirm); assert.equal(confirm.disabled, true); assert.match(allText(panel), /Confirm this order at 12.5 USD/);
});

test('C2-5 free Shop checkout succeeds without fake Wallet debit', async () => {
  const c = await setupCommerceUi('p23-shop-free'); await seedItem(c, { recordId: 'item-free', name: 'Free sample', price: 0, key: 'free-item' });
  const shell = shellFor(c); await shell.mount(c.target); let panel = await open(shell, 'shop'); find(panel, node => node.dataset?.shopRecordId === 'item-free').click(); await settle(); panel = shell.root.children[3].children[0]; find(panel, node => node.dataset?.shopAction === 'review-checkout').click(); await settle(); panel = shell.root.children[3].children[0];
  const confirm = find(panel, node => node.dataset?.shopAction === 'confirm-checkout'); assert.equal(confirm.disabled, false); confirm.click(); await waitFor(() => /Order created/.test(allText(shell.root)));
  assert.match(allText(shell.root), /No Wallet debit was created for this free item/); const wallet = await c.commerce.walletState({ scope: c.scope, deviceId: c.user.deviceId, accountId: c.user.accountId }); assert.equal(wallet.entries.filter(row => row.entryKind === 'transaction').length, 0);
});

test('C2-5 paid Shop confirmation is one-shot and successful Order links exactly one canonical debit', async () => {
  const c = await setupCommerceUi('p23-shop-paid-one-shot'); await seedBalance(c, 100); await seedItem(c, { price: 20 });
  const shell = shellFor(c); await shell.mount(c.target); let panel = await open(shell, 'shop'); find(panel, node => node.dataset?.shopRecordId === 'item-tea').click(); await settle(); panel = shell.root.children[3].children[0]; find(panel, node => node.dataset?.shopAction === 'review-checkout').click(); await settle(); panel = shell.root.children[3].children[0];
  const confirm = find(panel, node => node.dataset?.shopAction === 'confirm-checkout'); confirm.click(); confirm.click();
  await waitFor(() => /Order created/.test(allText(shell.root))); const orders = await c.phoneWorld.listShopOrders({ scope: c.scope, deviceId: c.user.deviceId }); const wallet = await c.phoneWorld.listWallet({ scope: c.scope, deviceId: c.user.deviceId });
  assert.equal(orders.length, 1); const debits = wallet.filter(row => row.entryKind === 'transaction' && row.relatedOrderId === orders[0].recordId); assert.equal(debits.length, 1); assert.equal(debits[0].amount, -20); assert.match(allText(shell.root), /Linked Wallet debit: -20 USD/);
});

test('C2-5 Shop UI text tampering cannot alter canonical price/currency', async () => {
  const c = await setupCommerceUi('p23-shop-ui-tamper'); await seedBalance(c, 100); await seedItem(c, { price: 15, currency: 'USD' });
  const shell = shellFor(c); await shell.mount(c.target); let panel = await open(shell, 'shop'); const itemButton = find(panel, node => node.dataset?.shopRecordId === 'item-tea'); itemButton.textContent = 'Tea 0.01 FAKE'; itemButton.click(); await settle(); panel = shell.root.children[3].children[0];
  const priceLine = find(panel, node => /Canonical price:/.test(String(node.textContent || ''))); if (priceLine) priceLine.textContent = 'Canonical price: 0.01 FAKE';
  find(panel, node => node.dataset?.shopAction === 'review-checkout').click(); await settle(); panel = shell.root.children[3].children[0]; find(panel, node => node.dataset?.shopAction === 'confirm-checkout').click(); await waitFor(async () => (await c.phoneWorld.listShopOrders({ scope: c.scope, deviceId: c.user.deviceId })).length === 1);
  const order = (await c.phoneWorld.listShopOrders({ scope: c.scope, deviceId: c.user.deviceId }))[0]; assert.equal(order.unitPrice, 15); assert.equal(order.currency, 'USD');
});

test('C2-5 stale Shop item becomes ITEM CHANGED and requires refresh plus a fresh confirmation', async () => {
  const c = await setupCommerceUi('p23-shop-stale-ui'); await seedBalance(c, 100); await seedItem(c, { price: 10 });
  const shell = shellFor(c); await shell.mount(c.target); let panel = await open(shell, 'shop'); find(panel, node => node.dataset?.shopRecordId === 'item-tea').click(); await settle(); panel = shell.root.children[3].children[0]; find(panel, node => node.dataset?.shopAction === 'review-checkout').click(); await settle(); panel = shell.root.children[3].children[0];
  await seedItem(c, { price: 20, key: 'item-tea-updated' }); const confirm = find(panel, node => node.dataset?.shopAction === 'confirm-checkout'); confirm.click(); await waitFor(() => /ITEM CHANGED/.test(allText(shell.root))); assert.equal((await c.phoneWorld.listShopOrders({ scope: c.scope, deviceId: c.user.deviceId })).length, 0);
  panel = shell.root.children[3].children[0]; const refresh = find(panel, node => node.dataset?.shopAction === 'refresh-item'); assert.ok(refresh); refresh.click(); await settle(); panel = shell.root.children[3].children[0]; assert.match(allText(panel), /Canonical price: 20 USD/); assert.equal(find(panel, node => node.dataset?.shopConfirmationId), null);
  find(panel, node => node.dataset?.shopAction === 'review-checkout').click(); await settle(); panel = shell.root.children[3].children[0]; find(panel, node => node.dataset?.shopAction === 'confirm-checkout').click(); await waitFor(async () => (await c.phoneWorld.listShopOrders({ scope: c.scope, deviceId: c.user.deviceId })).length === 1); const order = (await c.phoneWorld.listShopOrders({ scope: c.scope, deviceId: c.user.deviceId }))[0]; assert.equal(order.unitPrice, 20);
});

test('C2-5 insufficient funds and commerce failure remain truthful/recoverable without false success', async () => {
  const c = await setupCommerceUi('p23-shop-insufficient'); await seedBalance(c, 5); await seedItem(c, { price: 10 });
  const shell = shellFor(c); await shell.mount(c.target); let panel = await open(shell, 'shop'); find(panel, node => node.dataset?.shopRecordId === 'item-tea').click(); await settle(); panel = shell.root.children[3].children[0]; assert.match(allText(panel), /INSUFFICIENT KNOWN FUNDS/); find(panel, node => node.dataset?.shopAction === 'review-checkout').click(); await settle(); panel = shell.root.children[3].children[0]; assert.equal(find(panel, node => node.dataset?.shopAction === 'confirm-checkout').disabled, true); assert.doesNotMatch(allText(panel), /Order created/);

  const broken = await setupCommerceUi('p23-shop-error', { commerceOverride: commerce => ({ walletState: input => commerce.walletState(input), shopState: async () => { throw new Error('Injected Shop load failure'); }, checkout: input => commerce.checkout(input) }) });
  const brokenShell = shellFor(broken); await brokenShell.mount(broken.target); const errorPanel = await open(brokenShell, 'shop'); assert.match(allText(errorPanel), /Shop error: Injected Shop load failure/); assert.doesNotMatch(allText(errorPanel), /Order created/);
});

test('C2-5 Shop device switch clears selection/confirmation/result and unauthorized Their Phone leaks no private commerce state', async () => {
  const c = await setupCommerceUi('p23-shop-device-switch'); await seedBalance(c, 100); await seedItem(c, { price: 10 });
  const shell = shellFor(c); await shell.mount(c.target); let panel = await open(shell, 'shop'); find(panel, node => node.dataset?.shopRecordId === 'item-tea').click(); await settle(); panel = shell.root.children[3].children[0]; find(panel, node => node.dataset?.shopAction === 'review-checkout').click(); await settle(); assert.ok(find(shell.root, node => node.dataset?.shopConfirmationId === 'item-tea'));
  await shell.selectDevice(c.alice.deviceId); panel = shell.root.children[3].children[0]; assert.match(allText(panel), /unavailable until access|access/i); assert.doesNotMatch(allText(panel), /Tea|100 USD|Order created/);
  await shell.selectDevice(c.user.deviceId); panel = shell.root.children[3].children[0]; assert.equal(find(panel, node => node.dataset?.shopDetailsId), null); assert.equal(find(panel, node => node.dataset?.shopConfirmationId), null);
});

test('C2-5 launcher readiness and mobile CSS keep Wallet/Shop hidden without commerce and bounded at narrow width', async () => {
  const withoutCommerce = new Set(homeViewModel({ developerMode: true, phoneWorldEnabled: true, commerceEnabled: false }).map(row => row.id)); const withCommerce = new Set(homeViewModel({ developerMode: true, phoneWorldEnabled: true, commerceEnabled: true }).map(row => row.id));
  assert.equal(withoutCommerce.has('wallet'), false); assert.equal(withoutCommerce.has('shop'), false); assert.equal(withCommerce.has('wallet'), true); assert.equal(withCommerce.has('shop'), true);
  const css = await fs.readFile(new URL('../../ui/styles.css', import.meta.url), 'utf8'); assert.match(css, /tmrw-v3-wallet,.tmrw-v3-shop\{min-width:0/); assert.match(css, /tmrw-v3-shop-catalog\{min-width:0;display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/); assert.match(css, /tmrw-v3-commerce-reference\{[^}]*overflow-wrap:anywhere/); assert.match(css, /tmrw-v3-shop-confirmation button/); assert.match(css, /tmrw-v3-shell button\{min-height:44px/);
});
