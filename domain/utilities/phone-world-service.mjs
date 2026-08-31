import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { requireEventScope } from '../events/event-validator.mjs';
import { canonicalJson, sha256Hex } from '../events/idempotency.mjs';
import { PHONE_WORLD_EVENT_TYPES, PHONE_WORLD_EVENT_TYPE_BY_KIND } from './phone-world-event-types.mjs';
import { PHONE_WORLD_KIND, normalizePhoneWorldRecord, phoneWorldHeadId } from './phone-world-records.mjs';
import { PHONE_WORLD_STORE_BY_KIND } from './phone-world-projector.mjs';

const MAX = Number.MAX_SAFE_INTEGER;

async function deriveRecordId(scope, kind, deviceId, source, idempotencyKey) {
  const seed = canonicalJson(['tmrw-phone-world-record-v1', scope.storyId, scope.branchId, kind, deviceId, source?.authority || '', source?.recordId || '', idempotencyKey || '']);
  return `${kind.replace(/[^a-z0-9]+/g, '-')}_${(await sha256Hex(seed)).slice(0, 32)}`;
}

export class PhoneWorldService {
  #unitOfWork; #events;
  constructor({ database, eventEngine }) { if (!database || !eventEngine) throw new TypeError('PhoneWorldService requires database and canonical Event engine'); this.#unitOfWork = new V3UnitOfWork(database); this.#events = eventEngine; }

  async #assertDeviceOwner(scope, input) {
    const deviceId = String(input?.deviceId || '').trim();
    if (!deviceId) throw new TypeError('phone-world deviceId is required');
    return this.#unitOfWork.readonly({ stores: ['devices', 'instances', 'actors', 'accounts'], scope }, async repositories => {
      const device = await repositories.devices.get(deviceId);
      if (!device) throw new Error('Unknown scoped phone-world Device');
      const instance = await repositories.instances.get(device.ownerInstanceId);
      const actor = instance && await repositories.actors.get(instance.actorId);
      if (!instance || !actor) throw new Error('Phone-world Device ownership identity chain is incomplete');
      if (input.ownerInstanceId && input.ownerInstanceId !== instance.id) throw new Error('Phone-world ownerInstanceId does not match canonical Device ownership');
      if (input.ownerActorId && input.ownerActorId !== actor.id) throw new Error('Phone-world ownerActorId does not match canonical Device ownership');
      let account = null;
      if (input.ownerAccountId) {
        account = await repositories.accounts.get(input.ownerAccountId);
        if (!account || account.ownerInstanceId !== instance.id || !account.deviceIds.includes(device.id)) throw new Error('Phone-world ownerAccountId does not belong to the canonical Device owner');
      } else {
        const accounts = await repositories.accounts.listByIndex('by_owner_scope', [scope.storyId, scope.branchId, instance.id]);
        account = accounts.find(row => row.isPrimary && row.deviceIds.includes(device.id)) || accounts.find(row => row.deviceIds.includes(device.id)) || null;
        if (!account) throw new Error('Phone-world Device owner has no scoped Account for this Device');
      }
      return Object.freeze({ device, instance, actor, account });
    });
  }

  async #head(kind, scope, recordId) {
    const storeName = PHONE_WORLD_STORE_BY_KIND[kind];
    return this.#unitOfWork.readonly({ stores: [storeName], scope }, repositories => repositories[storeName].get(phoneWorldHeadId(scope, kind, recordId)));
  }

  async #assertAudienceAccounts(scope, accountIds) {
    if (!accountIds?.length) return Object.freeze([]);
    return this.#unitOfWork.readonly({ stores: ['accounts'], scope }, async repositories => {
      const rows = [];
      for (const accountId of accountIds) {
        const account = await repositories.accounts.get(accountId);
        if (!account) throw new Error(`Unknown scoped phone-world audience Account: ${accountId}`);
        rows.push(account);
      }
      return Object.freeze(rows);
    });
  }

  async #append(kind, input, { source, producer = 'phone-world-service', idempotencyKey, causes = [] } = {}) {
    const scope = requireEventScope(input.scope);
    const owner = await this.#assertDeviceOwner(scope, input);
    const deviceId = owner.device.id;
    const recordId = input.recordId || await deriveRecordId(scope, kind, deviceId, source, idempotencyKey);
    const record = normalizePhoneWorldRecord(kind, { ...input, recordId, deviceId, ownerActorId: owner.actor.id, ownerInstanceId: owner.instance.id, ownerAccountId: input.ownerAccountId || owner.account?.id || null });
    const audienceAccounts = kind === PHONE_WORLD_KIND.LOCATION ? await this.#assertAudienceAccounts(scope, record.audienceAccountIds) : Object.freeze([]);
    const references = [
      { entityType: 'device', id: owner.device.id, role: 'phone-world-device' },
      { entityType: 'character-instance', id: owner.instance.id, role: 'phone-world-owner-instance' },
      { entityType: 'actor', id: owner.actor.id, role: 'phone-world-owner-actor' },
      ...(owner.account ? [{ entityType: 'account', id: owner.account.id, role: 'phone-world-owner-account' }] : []),
      ...audienceAccounts.map(account => ({ entityType: 'account', id: account.id, role: 'phone-world-audience-account' })),
    ];
    return this.#events.append({ scope, eventType: PHONE_WORLD_EVENT_TYPE_BY_KIND[kind], payload: { record }, references, source, producer, idempotencyKey, causes });
  }

  async #transition(kind, input, patch) {
    const scope = requireEventScope(input.scope);
    const recordId = String(input.recordId || '').trim();
    if (!recordId) throw new TypeError(`${kind}.recordId is required`);
    const current = await this.#head(kind, scope, recordId);
    if (!current) throw new Error(`Unknown scoped ${kind} record`);
    return this.#append(kind, { ...current, ...input, ...patch, scope, recordId, deviceId: current.deviceId, ownerActorId: current.ownerActorId, ownerInstanceId: current.ownerInstanceId, ownerAccountId: current.ownerAccountId }, input);
  }

  async #list(kind, scopeInput, deviceId, limit = 100) {
    const scope = requireEventScope(scopeInput); const storeName = PHONE_WORLD_STORE_BY_KIND[kind]; const bounded = Math.max(1, Math.min(200, Number(limit) || 100));
    return this.#unitOfWork.readonly({ stores: [storeName], scope }, async repositories => {
      const rows = await repositories[storeName].listByIndex('by_scope_device', [scope.storyId, scope.branchId, String(deviceId)]);
      return Object.freeze(rows.sort((a, b) => (a.reverseSequence ?? MAX) - (b.reverseSequence ?? MAX) || a.id.localeCompare(b.id)).slice(0, bounded).map(Object.freeze));
    });
  }

  saveGalleryAsset(input) { return this.#append(PHONE_WORLD_KIND.GALLERY, input, input); }
  removeGalleryAsset(input) { return this.#transition(PHONE_WORLD_KIND.GALLERY, input, { active: false }); }
  listGallery({ scope, deviceId, limit }) { return this.#list(PHONE_WORLD_KIND.GALLERY, scope, deviceId, limit); }

  saveFile(input) { return this.#append(PHONE_WORLD_KIND.FILE, input, input); }
  removeFile(input) { return this.#transition(PHONE_WORLD_KIND.FILE, input, { active: false }); }
  listFiles({ scope, deviceId, limit }) { return this.#list(PHONE_WORLD_KIND.FILE, scope, deviceId, limit); }

  saveNote(input) { return this.#append(PHONE_WORLD_KIND.NOTE, input, input); }
  deleteNote(input) { return this.#transition(PHONE_WORLD_KIND.NOTE, input, { active: false }); }
  listNotes({ scope, deviceId, limit }) { return this.#list(PHONE_WORLD_KIND.NOTE, scope, deviceId, limit); }

  recordSearch(input) { return this.#append(PHONE_WORLD_KIND.SEARCH, input, input); }
  clearSearchEntry(input) { return this.#transition(PHONE_WORLD_KIND.SEARCH, input, { active: false }); }
  listSearch({ scope, deviceId, limit }) { return this.#list(PHONE_WORLD_KIND.SEARCH, scope, deviceId, limit); }

  setLocation(input) { return this.#append(PHONE_WORLD_KIND.LOCATION, input, input); }
  endLocation(input) { return this.#transition(PHONE_WORLD_KIND.LOCATION, input, { status: 'ended' }); }
  async listLocations({ scope, deviceId, viewerAccountId, limit }) { const viewer = String(viewerAccountId || '').trim(); if (!viewer) throw new TypeError('viewerAccountId is required to read location state'); const rows = await this.#list(PHONE_WORLD_KIND.LOCATION, scope, deviceId, limit); return Object.freeze(rows.filter(row => row.ownerAccountId === viewer || row.audienceAccountIds.includes(viewer))); }
  async listVisibleLocations({ scope: inputScope, viewerAccountId, limit = 100 }) { const scope = requireEventScope(inputScope); const viewer = String(viewerAccountId || '').trim(); if (!viewer) throw new TypeError('viewerAccountId is required to read visible location state'); await this.#assertAudienceAccounts(scope, [viewer]); const bounded = Math.max(1, Math.min(200, Number(limit) || 100)); return this.#unitOfWork.readonly({ stores: ['phoneLocations'], scope }, async repositories => { const rows = await repositories.phoneLocations.list(); return Object.freeze(rows.filter(row => row.ownerAccountId === viewer || row.audienceAccountIds.includes(viewer)).sort((a, b) => (a.reverseSequence ?? MAX) - (b.reverseSequence ?? MAX) || a.id.localeCompare(b.id)).slice(0, bounded).map(Object.freeze)); }); }

  setCalendarItem(input) { return this.#append(PHONE_WORLD_KIND.CALENDAR, input, input); }
  updateCalendarResponse(input) { return this.#transition(PHONE_WORLD_KIND.CALENDAR, input, { response: input.response }); }
  getCalendarItem({ scope: inputScope, recordId }) { const scope = requireEventScope(inputScope); return this.#head(PHONE_WORLD_KIND.CALENDAR, scope, String(recordId || '').trim()); }
  listCalendar({ scope, deviceId, limit }) { return this.#list(PHONE_WORLD_KIND.CALENDAR, scope, deviceId, limit); }

  recordWalletEntry(input) { return this.#append(PHONE_WORLD_KIND.WALLET, input, input); }
  listWallet({ scope, deviceId, limit }) { return this.#list(PHONE_WORLD_KIND.WALLET, scope, deviceId, limit); }

  setShopItem(input) { return this.#append(PHONE_WORLD_KIND.SHOP_ITEM, input, input); }
  removeShopItem(input) { return this.#transition(PHONE_WORLD_KIND.SHOP_ITEM, input, { active: false }); }
  getShopItem({ scope, recordId }) { return this.#head(PHONE_WORLD_KIND.SHOP_ITEM, requireEventScope(scope), recordId); }
  listShopItems({ scope, deviceId, limit }) { return this.#list(PHONE_WORLD_KIND.SHOP_ITEM, scope, deviceId, limit); }
  async placeShopOrder(input) {
    const scope = requireEventScope(input.scope); const shopItemId = String(input.shopItemId || '').trim(); if (!shopItemId) throw new TypeError('shopItemId is required');
    const item = await this.#head(PHONE_WORLD_KIND.SHOP_ITEM, scope, shopItemId); if (!item || item.active === false || item.available === false) throw new Error('Shop item is unavailable');
    if (item.deviceId !== input.deviceId) throw new Error('Shop item belongs to a different Device');
    return this.#append(PHONE_WORLD_KIND.SHOP_ORDER, { ...input, shopItemId, unitPrice: item.price, currency: item.currency, status: 'ordered' }, input);
  }
  async checkoutShopOrder(input) {
    const scope = requireEventScope(input.scope); const shopItemId = String(input.shopItemId || '').trim(); if (!shopItemId) throw new TypeError('shopItemId is required');
    const owner = await this.#assertDeviceOwner(scope, input); const item = await this.#head(PHONE_WORLD_KIND.SHOP_ITEM, scope, shopItemId);
    if (!item || item.active === false || item.available === false) throw new Error('Shop item is unavailable');
    if (item.deviceId !== owner.device.id || item.ownerAccountId !== owner.account.id) throw new Error('Shop item belongs to another Device');
    const quantity = Math.max(1, Math.min(99, Math.trunc(Number(input.quantity) || 1))); const total = Number(item.price) * quantity;
    const order = normalizePhoneWorldRecord(PHONE_WORLD_KIND.SHOP_ORDER, { ...input, recordId: input.orderRecordId, deviceId: owner.device.id, ownerActorId: owner.actor.id, ownerInstanceId: owner.instance.id, ownerAccountId: owner.account.id, shopItemId: item.recordId, quantity, unitPrice: item.price, currency: item.currency, status: 'ordered', walletEntryId: total > 0 ? input.walletEntryId : null, sourceKind: 'explicit-user' });
    const walletDebit = total > 0 ? normalizePhoneWorldRecord(PHONE_WORLD_KIND.WALLET, { ...input, recordId: input.walletEntryId, deviceId: owner.device.id, ownerActorId: owner.actor.id, ownerInstanceId: owner.instance.id, ownerAccountId: owner.account.id, entryKind: 'transaction', label: `Shop purchase: ${item.name}`, amount: -total, currency: item.currency, relatedOrderId: order.recordId, sourceKind: 'shop-order' }) : null;
    const references = [
      { entityType: 'device', id: owner.device.id, role: 'phone-world-device' },
      { entityType: 'character-instance', id: owner.instance.id, role: 'phone-world-owner-instance' },
      { entityType: 'actor', id: owner.actor.id, role: 'phone-world-owner-actor' },
      { entityType: 'account', id: owner.account.id, role: 'phone-world-owner-account' },
    ];
    return this.#events.append({ scope, eventType: PHONE_WORLD_EVENT_TYPES.SHOP_CHECKOUT, payload: { order, walletDebit, expectedCatalogSequence: item.sourceEventSequence }, references, source: input.source, producer: input.producer || 'phone-world-service', idempotencyKey: input.idempotencyKey, causes: item.sourceEventId ? [item.sourceEventId] : [] });
  }
  updateShopOrderStatus(input) { const status = String(input.status || '').trim(); if (!['cancelled', 'fulfilled'].includes(status)) throw new TypeError('Shop order status must be cancelled or fulfilled'); return this.#transition(PHONE_WORLD_KIND.SHOP_ORDER, input, { status }); }
  listShopOrders({ scope, deviceId, limit }) { return this.#list(PHONE_WORLD_KIND.SHOP_ORDER, scope, deviceId, limit); }

  recordWeather(input) { return this.#append(PHONE_WORLD_KIND.WEATHER, input, input); }
  listWeather({ scope, deviceId, limit }) { return this.#list(PHONE_WORLD_KIND.WEATHER, scope, deviceId, limit); }

  recordHealth(input) { return this.#append(PHONE_WORLD_KIND.HEALTH, input, input); }
  listHealth({ scope, deviceId, limit }) { return this.#list(PHONE_WORLD_KIND.HEALTH, scope, deviceId, limit); }
}
