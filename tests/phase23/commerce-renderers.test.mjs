import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWallet } from '../../ui/wallet.mjs';
import { renderShop } from '../../ui/shop.mjs';
import { setupPhase17 } from '../phase17/notification-fixtures.mjs';

function find(node, predicate) { if (predicate(node)) return node; for (const child of node.children || []) { const hit = find(child, predicate); if (hit) return hit; } return null; }
function allText(node, out = []) { if (node.textContent) out.push(String(node.textContent)); for (const child of node.children || []) allText(child, out); return out.join(' '); }

test('C2-5 Wallet renderer distinguishes unknown balance from canonical zero and preserves currencies separately', async () => {
  const c = await setupPhase17({ castSize: 1, manifestId: 'p23-wallet-render-balance' });
  let root = renderWallet({ document: c.document, view: { entries: [], knownBalances: {} } });
  assert.match(allText(root), /Balance unknown/); assert.doesNotMatch(allText(root), /0 USD/);
  root = renderWallet({ document: c.document, view: { entries: [], knownBalances: { USD: { currency: 'USD', amount: 0, sourceKind: 'story-canon' }, JPY: { currency: 'JPY', amount: 2500, sourceKind: 'story-canon' } } } });
  assert.match(allText(root), /0 USD/); assert.match(allText(root), /2500 JPY/); assert.doesNotMatch(allText(root), /2500 USD|2500 .*total/i);
});

test('C2-5 Wallet renderer shows canonical transactions, provenance, and linked Shop Order without fake finance controls', async () => {
  const c = await setupPhase17({ castSize: 1, manifestId: 'p23-wallet-render-history' });
  const row = { recordId: 'wallet-tx-1', entryKind: 'transaction', label: 'Shop purchase: Tea', amount: -25, currency: 'USD', sourceKind: 'shop-order', relatedOrderId: 'order-1', updatedAt: '2026-08-31T05:00:00.000Z' };
  let selected = null; let root = renderWallet({ document: c.document, view: { entries: [row], knownBalances: { USD: { currency: 'USD', amount: 75, sourceKind: 'story-canon' } } }, onSelect: id => { selected = id; } });
  const button = find(root, node => node.dataset?.walletRecordId === row.recordId); assert.ok(button); button.click(); assert.equal(selected, row.recordId);
  root = renderWallet({ document: c.document, view: { entries: [row], knownBalances: { USD: { currency: 'USD', amount: 75, sourceKind: 'story-canon' } } }, selectedRecordId: row.recordId });
  assert.match(allText(root), /Shop purchase: Tea/); assert.match(allText(root), /-25 USD/); assert.match(allText(root), /shop-order/); assert.match(allText(root), /Linked Shop Order: order-1/);
  assert.doesNotMatch(allText(root), /Add Money|Top Up|Transfer|Withdraw|Send Money/);
});

test('C2-5 Shop renderer distinguishes free, unknown, insufficient and sufficient funds before confirmation', async () => {
  const c = await setupPhase17({ castSize: 1, manifestId: 'p23-shop-render-funds' });
  const item = { recordId: 'tea', name: 'Tea', description: 'Canonical tea', price: 10, currency: 'USD', sourceKind: 'story-canon', sourceEventSequence: 12 };
  const free = { ...item, recordId: 'sample', name: 'Sample', price: 0 };
  let root = renderShop({ document: c.document, view: { items: [item], orders: [] }, walletView: { knownBalances: {} }, selectedRecordId: item.recordId, confirmationRecordId: item.recordId });
  assert.match(allText(root), /UNKNOWN FUNDS/); assert.equal(find(root, node => node.dataset?.shopAction === 'confirm-checkout').disabled, true);
  root = renderShop({ document: c.document, view: { items: [item], orders: [] }, walletView: { knownBalances: { USD: { currency: 'USD', amount: 5 } } }, selectedRecordId: item.recordId, confirmationRecordId: item.recordId });
  assert.match(allText(root), /INSUFFICIENT KNOWN FUNDS/); assert.equal(find(root, node => node.dataset?.shopAction === 'confirm-checkout').disabled, true);
  root = renderShop({ document: c.document, view: { items: [item], orders: [] }, walletView: { knownBalances: { USD: { currency: 'USD', amount: 10 } } }, selectedRecordId: item.recordId, confirmationRecordId: item.recordId });
  assert.match(allText(root), /SUFFICIENT KNOWN FUNDS/); assert.equal(find(root, node => node.dataset?.shopAction === 'confirm-checkout').disabled, false);
  root = renderShop({ document: c.document, view: { items: [free], orders: [] }, walletView: { knownBalances: {} }, selectedRecordId: free.recordId, confirmationRecordId: free.recordId });
  assert.match(allText(root), /FREE ITEM/); assert.equal(find(root, node => node.dataset?.shopAction === 'confirm-checkout').disabled, false);
});

test('C2-5 Shop renderer has truthful empty/stale/success states and never invents delivery or merchandise', async () => {
  const c = await setupPhase17({ castSize: 1, manifestId: 'p23-shop-render-truth' });
  let root = renderShop({ document: c.document, view: { items: [], orders: [] }, walletView: { knownBalances: {} } });
  assert.match(allText(root), /No canonical Shop catalog/); assert.match(allText(root), /does not generate fallback merchandise/);
  const item = { recordId: 'book', name: 'Book', description: 'Explicit story item', price: 20, currency: 'USD', sourceKind: 'story-canon', sourceEventSequence: 4 };
  root = renderShop({ document: c.document, view: { items: [item], orders: [] }, walletView: { knownBalances: { USD: { currency: 'USD', amount: 50 } } }, selectedRecordId: item.recordId, staleRecordId: item.recordId });
  assert.match(allText(root), /ITEM CHANGED/); assert.ok(find(root, node => node.dataset?.shopAction === 'refresh-item'));
  root = renderShop({ document: c.document, view: { items: [item], orders: [{ recordId: 'order-1', shopItemId: 'book', quantity: 1, unitPrice: 20, currency: 'USD', status: 'ordered' }] }, walletView: { knownBalances: { USD: { currency: 'USD', amount: 30 } } }, selectedRecordId: item.recordId, checkoutResult: { order: { recordId: 'order-1', shopItemId: 'book', status: 'ordered' }, walletDebit: { amount: -20, currency: 'USD' } } });
  assert.match(allText(root), /Order created/); assert.match(allText(root), /Linked Wallet debit: -20 USD/); assert.doesNotMatch(allText(root), /Delivered|Shipped|Owned forever|Added to inventory/);
});
