import { defineProjector } from '../projections/projection-runner.mjs';
import { V3EventValidationError } from '../../storage/errors.mjs';
import { PHONE_WORLD_EVENT_TYPES, PHONE_WORLD_KIND_BY_EVENT_TYPE, normalizePhoneWorldRecordPayload, normalizeShopCheckoutPayload } from './phone-world-event-types.mjs';
import { PHONE_WORLD_KIND, phoneWorldHeadId } from './phone-world-records.mjs';

export const PHONE_WORLD_PROJECTOR_ID = 'tmrw-phone-world-utilities-v1';
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;

export const PHONE_WORLD_STORE_BY_KIND = Object.freeze({
  [PHONE_WORLD_KIND.GALLERY]: 'phoneGalleryItems',
  [PHONE_WORLD_KIND.FILE]: 'phoneFiles',
  [PHONE_WORLD_KIND.NOTE]: 'phoneNotes',
  [PHONE_WORLD_KIND.SEARCH]: 'phoneSearchEntries',
  [PHONE_WORLD_KIND.LOCATION]: 'phoneLocations',
  [PHONE_WORLD_KIND.CALENDAR]: 'phoneCalendarItems',
  [PHONE_WORLD_KIND.WALLET]: 'phoneWalletEntries',
  [PHONE_WORLD_KIND.SHOP_ITEM]: 'phoneShopItems',
  [PHONE_WORLD_KIND.SHOP_ORDER]: 'phoneShopOrders',
  [PHONE_WORLD_KIND.WEATHER]: 'phoneWeatherEntries',
  [PHONE_WORLD_KIND.HEALTH]: 'phoneHealthEntries',
});

const PROJECTED_STORES = Object.freeze([...new Set(Object.values(PHONE_WORLD_STORE_BY_KIND))]);

function stateRow(kind, record, event, checkout = null) {
  return { kind: `phone-world-${kind}`, projectionKey: `${kind}:${record.recordId}:${event.id}`, groupKey: `${kind}:${record.recordId}`, data: checkout ? { kind, record, checkout } : { kind, record } };
}

function project(event) {
  if (event.eventType === PHONE_WORLD_EVENT_TYPES.SHOP_CHECKOUT) {
    const checkout = normalizeShopCheckoutPayload(event.payload);
    const marker = Object.freeze({ expectedCatalogSequence: checkout.expectedCatalogSequence });
    return [
      stateRow(PHONE_WORLD_KIND.SHOP_ORDER, checkout.order, event, marker),
      ...(checkout.walletDebit ? [stateRow(PHONE_WORLD_KIND.WALLET, checkout.walletDebit, event, marker)] : []),
    ];
  }
  if (!PHONE_WORLD_KIND_BY_EVENT_TYPE[event.eventType]) return [];
  const { kind, record } = normalizePhoneWorldRecordPayload(event.eventType, event.payload);
  return [stateRow(kind, record, event)];
}

async function rows(repositories, scope, groupKey) {
  return repositories.projections.listByIndexRange('by_scope_projector_group_sequence', {
    lower: [scope.storyId, scope.branchId, PHONE_WORLD_PROJECTOR_ID, groupKey, 0],
    upper: [scope.storyId, scope.branchId, PHONE_WORLD_PROJECTOR_ID, groupKey, MAX_SEQUENCE],
  });
}

const newest = source => [...source].sort((a, b) => a.sourceEventSequence - b.sourceEventSequence || a.id.localeCompare(b.id)).at(-1) || null;

async function materialize(repositories, scope, groupKey, updatedAt) {
  const sourceRows = await rows(repositories, scope, groupKey);
  const row = newest(sourceRows);
  const kind = row?.data?.kind || String(groupKey).split(':', 1)[0];
  const storeName = PHONE_WORLD_STORE_BY_KIND[kind];
  if (!storeName) return { sourceRowsRead: sourceRows.length, rowsWritten: 0 };
  const recordId = row?.data?.record?.recordId || String(groupKey).slice(kind.length + 1);
  const id = phoneWorldHeadId(scope, kind, recordId);
  if (!row || row.data.record.active === false) await repositories[storeName].delete(id);
  else await repositories[storeName].put(Object.freeze({
    id,
    storyId: scope.storyId,
    branchId: scope.branchId,
    ...row.data.record,
    sourceEventId: row.sourceEventId,
    sourceEventRevision: row.sourceEventRevision,
    sourceEventSequence: row.sourceEventSequence,
    reverseSequence: MAX_SEQUENCE - row.sourceEventSequence,
    updatedAt,
    phase: 23,
  }));
  return { sourceRowsRead: sourceRows.length, rowsWritten: row && row.data.record.active !== false ? 1 : 0 };
}

async function knownWalletBalance(repositories, scope, deviceId, currency) {
  const entries = await repositories.phoneWalletEntries.listByIndex('by_scope_device', [scope.storyId, scope.branchId, deviceId]);
  const snapshots = entries.filter(row => row.entryKind === 'balance' && row.currency === currency).sort((a, b) => (b.sourceEventSequence || 0) - (a.sourceEventSequence || 0));
  const snapshot = snapshots[0] || null;
  if (!snapshot) return null;
  const delta = entries.filter(row => row.entryKind === 'transaction' && row.currency === currency && (row.sourceEventSequence || 0) > (snapshot.sourceEventSequence || 0)).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return Number(snapshot.amount) + delta;
}

async function validateAtomicCheckout(repositories, scope, currentRows) {
  const checkoutRows = currentRows.filter(row => row.data?.checkout);
  if (checkoutRows.length === 0) return;
  const orderRow = checkoutRows.find(row => row.data.kind === PHONE_WORLD_KIND.SHOP_ORDER);
  const debitRow = checkoutRows.find(row => row.data.kind === PHONE_WORLD_KIND.WALLET) || null;
  if (!orderRow) throw new V3EventValidationError('Atomic Shop checkout is missing its Order projection');
  const order = orderRow.data.record;
  const expectedCatalogSequence = orderRow.data.checkout.expectedCatalogSequence;
  const item = await repositories.phoneShopItems.get(phoneWorldHeadId(scope, PHONE_WORLD_KIND.SHOP_ITEM, order.shopItemId));
  if (!item || item.active === false || item.available === false) throw new V3EventValidationError('Shop item is unavailable at checkout commit');
  if (item.deviceId !== order.deviceId || item.ownerAccountId !== order.ownerAccountId) throw new V3EventValidationError('Shop item ownership changed before checkout commit');
  if (item.sourceEventSequence !== expectedCatalogSequence) throw new V3EventValidationError('Shop item changed after it was selected; reopen item details before checkout');
  if (item.price !== order.unitPrice || item.currency !== order.currency) throw new V3EventValidationError('Shop canonical price/currency changed before checkout commit');
  const total = item.price * order.quantity;
  if (total === 0) {
    if (debitRow || order.walletEntryId) throw new V3EventValidationError('Free Shop checkout must not create a Wallet debit');
    return;
  }
  if (!debitRow) throw new V3EventValidationError('Paid Shop checkout is missing its linked Wallet debit');
  const debit = debitRow.data.record;
  if (debit.recordId !== order.walletEntryId || debit.relatedOrderId !== order.recordId || debit.currency !== item.currency || debit.amount !== -total) throw new V3EventValidationError('Shop Order and Wallet debit linkage is inconsistent');
  if (debit.deviceId !== order.deviceId || debit.ownerAccountId !== order.ownerAccountId) throw new V3EventValidationError('Shop Wallet debit ownership does not match the Order');
  const available = await knownWalletBalance(repositories, scope, order.deviceId, item.currency);
  if (available === null) throw new V3EventValidationError(`Wallet balance is unavailable for ${item.currency}; checkout cannot fabricate funds`);
  if (available < total) throw new V3EventValidationError(`Insufficient explicit Wallet balance for ${item.currency}`);
}

async function applyAggregate({ repositories, scope, previousRows, currentRows, updatedAt }) {
  await validateAtomicCheckout(repositories, scope, currentRows);
  let sourceRowsRead = 0; let rowsWritten = 0;
  for (const key of new Set([...previousRows, ...currentRows].map(row => row.groupKey).filter(Boolean))) {
    const result = await materialize(repositories, scope, key, updatedAt); sourceRowsRead += result.sourceRowsRead; rowsWritten += result.rowsWritten;
  }
  return { sourceRowsRead, rowsWritten, eventHistoryScans: 0 };
}

async function rebuildAggregate({ repositories, scope, updatedAt }) {
  for (const storeName of PROJECTED_STORES) for (const row of await repositories[storeName].list()) await repositories[storeName].delete(row.id);
  const sourceRows = await repositories.projections.listByIndex('by_scope_projector', [scope.storyId, scope.branchId, PHONE_WORLD_PROJECTOR_ID]);
  let sourceRowsRead = 0; let rowsWritten = 0;
  for (const key of new Set(sourceRows.map(row => row.groupKey).filter(Boolean))) {
    const result = await materialize(repositories, scope, key, updatedAt); sourceRowsRead += result.sourceRowsRead; rowsWritten += result.rowsWritten;
  }
  return { sourceRowsRead, rowsWritten };
}

export function createPhoneWorldProjector() { return defineProjector({ id: PHONE_WORLD_PROJECTOR_ID, version: 1, stores: PROJECTED_STORES, project, applyAggregate, rebuildAggregate }); }
