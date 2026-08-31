import { defineEventType } from '../events/event-types.mjs';
import { createPhase17EventTypeRegistry } from '../notifications/notification-event-types.mjs';
import { PHONE_WORLD_KIND, normalizePhoneWorldRecord } from './phone-world-records.mjs';

export const PHONE_WORLD_EVENT_TYPES = Object.freeze({
  GALLERY_ITEM_STATE: 'gallery.item-state.v1',
  FILE_ITEM_STATE: 'files.item-state.v1',
  NOTE_STATE: 'notes.note-state.v1',
  SEARCH_ENTRY_STATE: 'search.entry-state.v1',
  LOCATION_STATE: 'maps.location-state.v1',
  CALENDAR_ITEM_STATE: 'calendar.item-state.v1',
  WALLET_ENTRY_STATE: 'wallet.entry-state.v1',
  SHOP_ITEM_STATE: 'shop.item-state.v1',
  SHOP_ORDER_STATE: 'shop.order-state.v1',
  SHOP_CHECKOUT: 'shop.checkout.v1',
  WEATHER_OBSERVATION_STATE: 'weather.observation-state.v1',
  HEALTH_OBSERVATION_STATE: 'health.observation-state.v1',
});

export const PHONE_WORLD_EVENT_TYPE_BY_KIND = Object.freeze({
  [PHONE_WORLD_KIND.GALLERY]: PHONE_WORLD_EVENT_TYPES.GALLERY_ITEM_STATE,
  [PHONE_WORLD_KIND.FILE]: PHONE_WORLD_EVENT_TYPES.FILE_ITEM_STATE,
  [PHONE_WORLD_KIND.NOTE]: PHONE_WORLD_EVENT_TYPES.NOTE_STATE,
  [PHONE_WORLD_KIND.SEARCH]: PHONE_WORLD_EVENT_TYPES.SEARCH_ENTRY_STATE,
  [PHONE_WORLD_KIND.LOCATION]: PHONE_WORLD_EVENT_TYPES.LOCATION_STATE,
  [PHONE_WORLD_KIND.CALENDAR]: PHONE_WORLD_EVENT_TYPES.CALENDAR_ITEM_STATE,
  [PHONE_WORLD_KIND.WALLET]: PHONE_WORLD_EVENT_TYPES.WALLET_ENTRY_STATE,
  [PHONE_WORLD_KIND.SHOP_ITEM]: PHONE_WORLD_EVENT_TYPES.SHOP_ITEM_STATE,
  [PHONE_WORLD_KIND.SHOP_ORDER]: PHONE_WORLD_EVENT_TYPES.SHOP_ORDER_STATE,
  [PHONE_WORLD_KIND.WEATHER]: PHONE_WORLD_EVENT_TYPES.WEATHER_OBSERVATION_STATE,
  [PHONE_WORLD_KIND.HEALTH]: PHONE_WORLD_EVENT_TYPES.HEALTH_OBSERVATION_STATE,
});

export const PHONE_WORLD_KIND_BY_EVENT_TYPE = Object.freeze(Object.fromEntries(
  Object.entries(PHONE_WORLD_EVENT_TYPE_BY_KIND).map(([kind, eventType]) => [eventType, kind]),
));

export function normalizePhoneWorldRecordPayload(eventType, input) {
  const kind = PHONE_WORLD_KIND_BY_EVENT_TYPE[eventType];
  if (!kind) throw new TypeError(`Unsupported phone-world Event type: ${eventType}`);
  return Object.freeze({ kind, record: normalizePhoneWorldRecord(kind, input?.record) });
}

export function normalizeShopCheckoutPayload(input) {
  const order = normalizePhoneWorldRecord(PHONE_WORLD_KIND.SHOP_ORDER, input?.order);
  const walletDebit = input?.walletDebit == null ? null : normalizePhoneWorldRecord(PHONE_WORLD_KIND.WALLET, input.walletDebit);
  const expectedCatalogSequence = Number(input?.expectedCatalogSequence);
  if (!Number.isSafeInteger(expectedCatalogSequence) || expectedCatalogSequence < 1) throw new TypeError('shop.checkout expectedCatalogSequence must be a positive integer');
  const total = order.unitPrice * order.quantity;
  if (total > 0) {
    if (!walletDebit) throw new TypeError('Paid shop.checkout requires a Wallet debit');
    if (walletDebit.entryKind !== 'transaction') throw new TypeError('shop.checkout Wallet debit must be a transaction');
    if (walletDebit.recordId !== order.walletEntryId) throw new TypeError('shop.checkout Wallet debit ID must match Order walletEntryId');
    if (walletDebit.relatedOrderId !== order.recordId) throw new TypeError('shop.checkout Wallet debit must link the Order');
    if (walletDebit.currency !== order.currency) throw new TypeError('shop.checkout Wallet debit currency must match the Order');
    if (walletDebit.amount !== -total) throw new TypeError('shop.checkout Wallet debit amount must match canonical total');
  } else if (walletDebit !== null || order.walletEntryId !== null) throw new TypeError('Free shop.checkout must not create a Wallet debit');
  if (walletDebit && (walletDebit.deviceId !== order.deviceId || walletDebit.ownerAccountId !== order.ownerAccountId)) throw new TypeError('shop.checkout Wallet debit ownership must match the Order');
  return Object.freeze({ order, walletDebit, expectedCatalogSequence });
}

const stateDefinitions = Object.freeze(Object.entries(PHONE_WORLD_KIND_BY_EVENT_TYPE).map(([eventType]) =>
  defineEventType({ id: eventType, validatePayload: payload => Boolean(normalizePhoneWorldRecordPayload(eventType, payload)) })
));
const checkoutDefinition = defineEventType({ id: PHONE_WORLD_EVENT_TYPES.SHOP_CHECKOUT, validatePayload: payload => Boolean(normalizeShopCheckoutPayload(payload)) });

export function createPhase23EventTypeRegistry(additional = []) { return createPhase17EventTypeRegistry([...stateDefinitions, checkoutDefinition, ...additional]); }
