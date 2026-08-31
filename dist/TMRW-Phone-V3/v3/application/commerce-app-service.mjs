import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';
import { canonicalJson, sha256Hex } from '../domain/events/idempotency.mjs';

async function stableRecordId(prefix, scope, deviceId, key) { return `${prefix}_${(await sha256Hex(canonicalJson([prefix, scope.storyId, scope.branchId, deviceId, String(key || '')]))).slice(0, 32)}`; }

export class CommerceAppService {
  #unitOfWork; #phoneWorld;
  constructor({ database, phoneWorldService }) { if (!database || !phoneWorldService) throw new TypeError('CommerceAppService requires database and PhoneWorldService'); this.#unitOfWork = new V3UnitOfWork(database); this.#phoneWorld = phoneWorldService; }

  async #binding(scope, deviceId, expectedAccountId = null) {
    return this.#unitOfWork.readonly({ stores: ['devices', 'instances', 'accounts'], scope }, async repositories => {
      const device = await repositories.devices.get(String(deviceId || '')); if (!device) throw new Error('Unknown scoped commerce Device');
      const instance = await repositories.instances.get(device.ownerInstanceId); if (!instance) throw new Error('Commerce Device owner is unavailable');
      const accounts = await repositories.accounts.listByIndex('by_owner_scope', [scope.storyId, scope.branchId, instance.id]);
      const account = accounts.find(row => row.isPrimary && row.deviceIds.includes(device.id)) || accounts.find(row => row.deviceIds.includes(device.id)) || null;
      if (!account) throw new Error('Commerce Device has no scoped Account');
      if (expectedAccountId && expectedAccountId !== account.id) throw new Error('Commerce Account does not match the selected Device');
      return Object.freeze({ device, instance, account });
    });
  }

  async walletState({ scope: inputScope, deviceId, accountId = null }) {
    const scope = requireEventScope(inputScope); await this.#binding(scope, deviceId, accountId);
    const entries = (await this.#phoneWorld.listWallet({ scope, deviceId, limit: 200 })).filter(row => row.active !== false);
    const balances = new Map();
    for (const row of entries.filter(item => item.entryKind === 'balance').sort((a, b) => (b.sourceEventSequence || 0) - (a.sourceEventSequence || 0))) if (!balances.has(row.currency)) balances.set(row.currency, row);
    const knownBalances = {};
    for (const [currency, snapshot] of balances) {
      const delta = entries.filter(row => row.entryKind === 'transaction' && row.currency === currency && (row.sourceEventSequence || 0) > (snapshot.sourceEventSequence || 0)).reduce((sum, row) => sum + Number(row.amount || 0), 0);
      knownBalances[currency] = Object.freeze({ currency, amount: Number(snapshot.amount) + delta, snapshotRecordId: snapshot.recordId, snapshotSequence: snapshot.sourceEventSequence, sourceKind: snapshot.sourceKind || null, updatedAt: snapshot.updatedAt || null });
    }
    return Object.freeze({ entries: Object.freeze(entries), knownBalances: Object.freeze(knownBalances) });
  }

  async shopState({ scope: inputScope, deviceId, accountId = null }) {
    const scope = requireEventScope(inputScope); await this.#binding(scope, deviceId, accountId);
    const [items, orders] = await Promise.all([this.#phoneWorld.listShopItems({ scope, deviceId, limit: 200 }), this.#phoneWorld.listShopOrders({ scope, deviceId, limit: 200 })]);
    return Object.freeze({ items: Object.freeze(items.filter(row => row.active !== false && row.available !== false)), orders: Object.freeze(orders.filter(row => row.active !== false)) });
  }

  async checkout(input) {
    const scope = requireEventScope(input.scope); const binding = await this.#binding(scope, input.deviceId, input.ownerAccountId || null);
    const item = await this.#phoneWorld.getShopItem({ scope, recordId: input.shopItemId });
    if (!item || item.active === false || item.available === false) throw new Error('Shop item is unavailable');
    if (item.deviceId !== binding.device.id || item.ownerAccountId !== binding.account.id) throw new Error('Shop item belongs to another Device');
    if (input.expectedCatalogSequence !== undefined && input.expectedCatalogSequence !== null && Number(input.expectedCatalogSequence) !== item.sourceEventSequence) throw new Error('Shop item changed after it was selected; reopen item details before checkout');
    const quantity = Math.max(1, Math.min(99, Math.trunc(Number(input.quantity) || 1))); const total = Number(item.price) * quantity;
    const orderRecordId = await stableRecordId('shop-order', scope, binding.device.id, input.idempotencyKey);
    const walletEntryId = total > 0 ? await stableRecordId('wallet-shop-debit', scope, binding.device.id, input.idempotencyKey) : null;
    const committed = await this.#phoneWorld.checkoutShopOrder({ ...input, scope, deviceId: binding.device.id, ownerAccountId: binding.account.id, shopItemId: item.recordId, quantity, orderRecordId, walletEntryId, source: input.source, producer: input.producer || 'phase23-commerce-app', idempotencyKey: input.idempotencyKey });
    return Object.freeze({ item: await this.#phoneWorld.getShopItem({ scope, recordId: item.recordId }), order: committed.event.payload.order, orderEvent: committed.event, walletDebit: committed.event.payload.walletDebit, replayed: committed.replayed });
  }
}
