import { canonicalJson, sha256Hex, deriveCanonicalEventId } from '../../domain/events/idempotency.mjs';
import { PHONE_WORLD_EVENT_TYPES } from '../../domain/utilities/phone-world-event-types.mjs';
import { TIME_EVENT_TYPES } from '../../domain/time/time-event-types.mjs';
import { PREVIEW37_SOURCE_AUTHORITY } from './constants.mjs';

const SOURCE_KIND = 'preview37-copy-migration';
const PRODUCER = 'preview37-migration';
const sourceFor = (item, suffix = null) => Object.freeze({ authority: PREVIEW37_SOURCE_AUTHORITY, kind: SOURCE_KIND, recordId: suffix ? `${item.sourceRecordId}:${suffix}` : item.sourceRecordId, version: item.sourceFingerprint });
const keyFor = (item, suffix) => `preview37:${item.sourceRecordId}:${suffix}`;
const shopItemSourceRecordId = item => `scope:${item.sourceScopeKey}:shop-item:${item.data.ownerSourceId}:${item.data.shopItemLegacyId}`;

async function destinationRecordId(scope, item) {
  const digest = await sha256Hex(canonicalJson(['preview37-personal-record-v1', scope.storyId, scope.branchId, item.sourceType, item.sourceRecordId]));
  return `preview37-${item.sourceType.replace(/[^a-z0-9]+/gi, '-')}-${digest.slice(0, 28)}`;
}

export class Preview37PersonalAppImporter {
  #phoneWorld; #calendar; #manifest;
  constructor({ phoneWorldService, calendarService, manifest }) {
    this.#phoneWorld = phoneWorldService || null; this.#calendar = calendarService || null; this.#manifest = manifest;
  }

  async #register({ plan, item, scope, suffix, canonicalType }) {
    const source = sourceFor(item, suffix); const key = keyFor(item, suffix); const canonicalEventId = await deriveCanonicalEventId({ scope, source, producer: PRODUCER, idempotencyKey: key });
    await this.#manifest.recordImport({ batchId: plan.batchId, sourceRecordId: item.sourceRecordId, sourceFingerprint: item.sourceFingerprint, sourceScopeKey: item.sourceScopeKey, operationKey: key, canonicalEventId, canonicalType });
    return Object.freeze({ source, key, canonicalEventId });
  }

  async #stage(expected, event) {
    if (!event?.id) throw new Error('Personal-app migration operation did not return a canonical Event');
    if (event.id !== expected.canonicalEventId) throw new Error('Personal-app migration canonical Event ID differs from the registered deterministic import');
    await this.#manifest.stageImport(event.id);
    return event.id;
  }

  async importItem({ plan, item, scope, bySource }) {
    if (!this.#phoneWorld) throw new Error('Personal-app migration requires PhoneWorldService during transition commit');
    const owner = bySource.get(item.data.ownerSourceId); if (!owner) throw new Error(`Personal-app owner mapping is missing: ${item.data.ownerSourceId}`);
    const recordId = await destinationRecordId(scope, item);
    const common = { scope, recordId, deviceId: owner.deviceId, ownerActorId: owner.actorId, ownerInstanceId: owner.instanceId, ownerAccountId: owner.accountId, sourceKind: 'preview37-personal' };
    let result; let eventIds = []; let canonical;

    if (item.sourceType === 'note') {
      const expected = await this.#register({ plan, item, scope, suffix: 'note', canonicalType: PHONE_WORLD_EVENT_TYPES.NOTE_STATE });
      result = await this.#phoneWorld.saveNote({ ...common, title: item.data.title, text: item.data.text, pinned: item.data.pinned, source: expected.source, producer: PRODUCER, idempotencyKey: expected.key });
      eventIds = [await this.#stage(expected, result.event)]; canonical = { record: result.event.payload.record };
    } else if (item.sourceType === 'gallery') {
      const expected = await this.#register({ plan, item, scope, suffix: 'gallery', canonicalType: PHONE_WORLD_EVENT_TYPES.GALLERY_ITEM_STATE });
      const takenByActorId = item.data.provenance?.takenBySourceId ? (bySource.get(item.data.provenance.takenBySourceId)?.actorId || null) : null;
      result = await this.#phoneWorld.saveGalleryAsset({ ...common, label: item.data.label, assetRef: item.data.assetRef, provenance: { takenByActorId, takenAt: item.data.provenance?.takenAt || null, locationLabel: item.data.provenance?.locationLabel || null, source: item.data.provenance?.source || 'preview37-personal' }, source: expected.source, producer: PRODUCER, idempotencyKey: expected.key });
      eventIds = [await this.#stage(expected, result.event)]; canonical = { record: result.event.payload.record };
    } else if (item.sourceType === 'search-history') {
      const expected = await this.#register({ plan, item, scope, suffix: 'search', canonicalType: PHONE_WORLD_EVENT_TYPES.SEARCH_ENTRY_STATE });
      result = await this.#phoneWorld.recordSearch({ ...common, query: item.data.query, provider: 'local-phone-world', resultRef: item.data.resultRef, source: expected.source, producer: PRODUCER, idempotencyKey: expected.key });
      eventIds = [await this.#stage(expected, result.event)]; canonical = { record: result.event.payload.record };
    } else if (item.sourceType === 'wallet') {
      const expected = await this.#register({ plan, item, scope, suffix: 'wallet', canonicalType: PHONE_WORLD_EVENT_TYPES.WALLET_ENTRY_STATE });
      result = await this.#phoneWorld.recordWalletEntry({ ...common, entryKind: item.data.entryKind, label: item.data.label, amount: item.data.amount, currency: item.data.currency, relatedOrderId: null, source: expected.source, producer: PRODUCER, idempotencyKey: expected.key });
      eventIds = [await this.#stage(expected, result.event)]; canonical = { record: result.event.payload.record };
    } else if (item.sourceType === 'shop-item') {
      const expected = await this.#register({ plan, item, scope, suffix: 'shop-item', canonicalType: PHONE_WORLD_EVENT_TYPES.SHOP_ITEM_STATE });
      result = await this.#phoneWorld.setShopItem({ ...common, name: item.data.name, description: item.data.description, price: item.data.price, currency: item.data.currency, available: item.data.available, source: expected.source, producer: PRODUCER, idempotencyKey: expected.key });
      eventIds = [await this.#stage(expected, result.event)]; canonical = { record: result.event.payload.record };
    } else if (item.sourceType === 'shop-order') {
      const catalogItem = await this.#manifest.getItem(plan.batchId, shopItemSourceRecordId(item)); const shopItem = catalogItem?.canonical?.record;
      if (!shopItem || Number(shopItem.price) !== 0 || shopItem.currency !== item.data.currency) throw new Error('Legacy free Shop order requires its committed explicit free catalog item');
      const expected = await this.#register({ plan, item, scope, suffix: 'shop-order', canonicalType: PHONE_WORLD_EVENT_TYPES.SHOP_ORDER_STATE });
      result = await this.#phoneWorld.placeShopOrder({ ...common, shopItemId: shopItem.recordId, quantity: item.data.quantity, status: item.data.status, walletEntryId: null, source: expected.source, producer: PRODUCER, idempotencyKey: expected.key });
      eventIds = [await this.#stage(expected, result.event)]; canonical = { record: result.event.payload.record, catalogRecordId: shopItem.recordId };
    } else if (item.sourceType === 'location-personal') {
      const audienceAccountIds = item.data.audienceSourceIds.map(id => bySource.get(id)?.accountId);
      if (audienceAccountIds.some(id => !id)) throw new Error('Legacy Location audience mapping is incomplete');
      const expected = await this.#register({ plan, item, scope, suffix: 'location', canonicalType: PHONE_WORLD_EVENT_TYPES.LOCATION_STATE });
      result = await this.#phoneWorld.setLocation({ ...common, mode: item.data.mode, status: item.data.status, label: item.data.label, audienceAccountIds, expiresAt: item.data.expiresAt, source: expected.source, producer: PRODUCER, idempotencyKey: expected.key });
      eventIds = [await this.#stage(expected, result.event)]; canonical = { record: result.event.payload.record };
    } else if (item.sourceType === 'calendar-personal') {
      if (!this.#calendar) throw new Error('Personal Calendar migration requires CalendarAppService during transition commit');
      if (item.data.itemKind === 'reminder') {
        const pendingExpected = await this.#register({ plan, item, scope, suffix: 'calendar:pending', canonicalType: TIME_EVENT_TYPES.PENDING_CREATED });
        const itemExpected = await this.#register({ plan, item, scope, suffix: 'calendar:item', canonicalType: PHONE_WORLD_EVENT_TYPES.CALENDAR_ITEM_STATE });
        const calendarSource = sourceFor(item, 'calendar'); const calendarKey = keyFor(item, 'calendar');
        const created = await this.#calendar.createReminder({ ...common, title: item.data.title, due: item.data.due, source: calendarSource, producer: PRODUCER, idempotencyKey: calendarKey });
        eventIds = [await this.#stage(pendingExpected, created.pendingEvent), await this.#stage(itemExpected, created.event)]; canonical = { record: created.item, pendingId: created.item.pendingId };
      } else {
        const participants = item.data.participantSourceIds.map(id => bySource.get(id)); if (participants.some(row => !row)) throw new Error('Legacy Calendar participant mapping is incomplete');
        const recipientInstances = [...new Set(participants.map(row => row.instanceId).filter(id => id !== owner.instanceId))]; if (recipientInstances.length === 0) throw new Error('Legacy Calendar invitation has no mapped recipient');
        const pendingExpected = await this.#register({ plan, item, scope, suffix: 'calendar:pending', canonicalType: TIME_EVENT_TYPES.PENDING_CREATED });
        const expectedItems = [];
        for (const person of [owner, ...participants.filter(row => row.instanceId !== owner.instanceId)]) expectedItems.push(await this.#register({ plan, item, scope, suffix: `calendar:item:${person.accountId}`, canonicalType: PHONE_WORLD_EVENT_TYPES.CALENDAR_ITEM_STATE }));
        const calendarSource = sourceFor(item, 'calendar'); const calendarKey = keyFor(item, 'calendar');
        const created = await this.#calendar.createInvitation({ ...common, title: item.data.title, due: item.data.due, participantInstanceIds: recipientInstances, source: calendarSource, producer: PRODUCER, idempotencyKey: calendarKey });
        eventIds.push(await this.#stage(pendingExpected, created.pendingEvent)); const copies = [created.organizer, ...created.invitations];
        for (let index = 0; index < copies.length; index += 1) eventIds.push(await this.#stage(expectedItems[index], copies[index].event));
        canonical = { record: created.organizer.item, invitationRecords: created.invitations.map(row => row.item), pendingId: created.pendingEvent.payload.pending.pendingId };
      }
    } else throw new Error(`Unsupported ready personal-app migration item: ${item.sourceType}`);

    await this.#manifest.commitItem(plan.batchId, item.sourceRecordId, { ...canonical, eventIds, classification: item.classification, legacyTimestamp: item.data.legacyTimestamp || null });
    return Object.freeze({ eventIds: Object.freeze(eventIds), canonicalOperations: eventIds.length });
  }
}
