import { requireText } from '../identity/identity-record.mjs';

export const PHONE_WORLD_KIND = Object.freeze({
  GALLERY: 'gallery',
  FILE: 'file',
  NOTE: 'note',
  SEARCH: 'search',
  LOCATION: 'location',
  CALENDAR: 'calendar',
  WALLET: 'wallet',
  SHOP_ITEM: 'shop-item',
  SHOP_ORDER: 'shop-order',
  WEATHER: 'weather',
  HEALTH: 'health',
});

export const PHONE_WORLD_KINDS = Object.freeze(new Set(Object.values(PHONE_WORLD_KIND)));

const text = (value, max = 512) => String(value ?? '').trim().slice(0, max);
const optionalText = (value, max = 512) => text(value, max) || null;
const stringArray = (value, field) => Object.freeze([...new Set((Array.isArray(value) ? value : []).map((entry, index) => requireText(entry, `${field}[${index}]`)))].sort());
const finite = (value, field, { min = -Number.MAX_VALUE, max = Number.MAX_VALUE } = {}) => { const number = Number(value); if (!Number.isFinite(number) || number < min || number > max) throw new TypeError(`${field} must be a finite number`); return number; };

function base(input, kind) {
  if (!PHONE_WORLD_KINDS.has(kind)) throw new TypeError(`Unsupported phone-world kind: ${kind}`);
  return {
    kind,
    recordId: requireText(input?.recordId, `${kind}.recordId`),
    deviceId: requireText(input?.deviceId, `${kind}.deviceId`),
    ownerActorId: requireText(input?.ownerActorId, `${kind}.ownerActorId`),
    ownerInstanceId: requireText(input?.ownerInstanceId, `${kind}.ownerInstanceId`),
    ownerAccountId: input?.ownerAccountId ? requireText(input.ownerAccountId, `${kind}.ownerAccountId`) : null,
    active: input?.active !== false,
    sourceKind: optionalText(input?.sourceKind, 80) || 'explicit-user',
  };
}

export function normalizePhoneWorldRecord(kind, input) {
  const value = base(input, kind);
  if (kind === PHONE_WORLD_KIND.GALLERY) return Object.freeze({ ...value, label: optionalText(input?.label, 256), assetRef: requireText(input?.assetRef, 'gallery.assetRef'), provenance: Object.freeze({ takenByActorId: optionalText(input?.provenance?.takenByActorId, 160), takenAt: optionalText(input?.provenance?.takenAt, 80), locationLabel: optionalText(input?.provenance?.locationLabel, 256), source: optionalText(input?.provenance?.source, 120) || value.sourceKind }) });
  if (kind === PHONE_WORLD_KIND.FILE) { const fileKind = input?.fileKind == null ? 'text' : String(input.fileKind); if (!['text', 'asset-ref', 'export'].includes(fileKind)) throw new TypeError(`Unsupported file kind: ${fileKind}`); const contentText = fileKind === 'text' ? optionalText(input?.contentText, 20000) : null; const assetRef = fileKind !== 'text' ? requireText(input?.assetRef, 'file.assetRef') : null; return Object.freeze({ ...value, name: requireText(input?.name, 'file.name').slice(0, 256), fileKind, contentText, assetRef, folder: optionalText(input?.folder, 160) || 'root', provenance: Object.freeze({ source: optionalText(input?.provenance?.source, 120) || value.sourceKind, originLabel: optionalText(input?.provenance?.originLabel, 256) }) }); }
  if (kind === PHONE_WORLD_KIND.NOTE) return Object.freeze({ ...value, title: optionalText(input?.title, 256) || 'Untitled note', text: optionalText(input?.text, 20000) || '', pinned: Boolean(input?.pinned) });
  if (kind === PHONE_WORLD_KIND.SEARCH) return Object.freeze({ ...value, query: requireText(input?.query, 'search.query').slice(0, 1000), provider: optionalText(input?.provider, 120), resultRef: optionalText(input?.resultRef, 1200) });
  if (kind === PHONE_WORLD_KIND.LOCATION) { const mode = requireText(input?.mode, 'location.mode'); if (!['check-in', 'shared', 'live'].includes(mode)) throw new TypeError(`Unsupported location mode: ${mode}`); const status = input?.status || 'active'; if (!['active', 'ended'].includes(status)) throw new TypeError(`Unsupported location status: ${status}`); const audienceAccountIds = stringArray(input?.audienceAccountIds, 'location.audienceAccountIds'); if (['shared', 'live'].includes(mode) && audienceAccountIds.length === 0) throw new TypeError(`${mode} location requires an explicit audience`); return Object.freeze({ ...value, mode, status, label: requireText(input?.label, 'location.label').slice(0, 512), audienceAccountIds, expiresAt: mode === 'live' ? optionalText(input?.expiresAt, 80) : null }); }
  if (kind === PHONE_WORLD_KIND.CALENDAR) { const itemKind = input?.itemKind || 'reminder'; if (!['reminder', 'invitation'].includes(itemKind)) throw new TypeError(`Unsupported calendar itemKind: ${itemKind}`); const response = input?.response || (itemKind === 'invitation' ? 'pending' : 'accepted'); if (!['pending', 'accepted', 'declined', 'cancelled'].includes(response)) throw new TypeError(`Unsupported calendar response: ${response}`); return Object.freeze({ ...value, itemKind, title: requireText(input?.title, 'calendar.title').slice(0, 512), due: input?.due ? structuredClone(input.due) : null, pendingId: optionalText(input?.pendingId, 180), participantActorIds: stringArray(input?.participantActorIds, 'calendar.participantActorIds'), participantInstanceIds: stringArray(input?.participantInstanceIds, 'calendar.participantInstanceIds'), response }); }
  if (kind === PHONE_WORLD_KIND.WALLET) { const entryKind = input?.entryKind || 'transaction'; if (!['balance', 'transaction'].includes(entryKind)) throw new TypeError(`Unsupported wallet entryKind: ${entryKind}`); return Object.freeze({ ...value, entryKind, label: requireText(input?.label, 'wallet.label').slice(0, 512), amount: finite(input?.amount, 'wallet.amount'), currency: requireText(input?.currency, 'wallet.currency').slice(0, 24), relatedOrderId: optionalText(input?.relatedOrderId, 180) }); }
  if (kind === PHONE_WORLD_KIND.SHOP_ITEM) return Object.freeze({ ...value, name: requireText(input?.name, 'shopItem.name').slice(0, 512), description: optionalText(input?.description, 2000), price: finite(input?.price, 'shopItem.price', { min: 0 }), currency: requireText(input?.currency, 'shopItem.currency').slice(0, 24), available: input?.available !== false });
  if (kind === PHONE_WORLD_KIND.SHOP_ORDER) { const status = input?.status || 'ordered'; if (!['ordered', 'cancelled', 'fulfilled'].includes(status)) throw new TypeError(`Unsupported shop order status: ${status}`); return Object.freeze({ ...value, shopItemId: requireText(input?.shopItemId, 'shopOrder.shopItemId'), quantity: Math.max(1, Math.trunc(finite(input?.quantity ?? 1, 'shopOrder.quantity', { min: 1, max: 999 }))), unitPrice: finite(input?.unitPrice, 'shopOrder.unitPrice', { min: 0 }), currency: requireText(input?.currency, 'shopOrder.currency').slice(0, 24), status, walletEntryId: optionalText(input?.walletEntryId, 180) }); }
  if (kind === PHONE_WORLD_KIND.WEATHER) return Object.freeze({ ...value, locationLabel: requireText(input?.locationLabel, 'weather.locationLabel').slice(0, 512), condition: requireText(input?.condition, 'weather.condition').slice(0, 256), temperatureC: finite(input?.temperatureC, 'weather.temperatureC', { min: -120, max: 80 }), observedAt: optionalText(input?.observedAt, 80), provider: optionalText(input?.provider, 120) });
  if (kind === PHONE_WORLD_KIND.HEALTH) { const metric = requireText(input?.metric, 'health.metric'); if (!['steps', 'calories', 'exercise-minutes', 'sleep-minutes', 'heart-rate'].includes(metric)) throw new TypeError(`Unsupported health metric: ${metric}`); return Object.freeze({ ...value, metric, value: finite(input?.value, 'health.value', { min: 0 }), unit: requireText(input?.unit, 'health.unit').slice(0, 40), observedAt: optionalText(input?.observedAt, 80), sourceLabel: optionalText(input?.sourceLabel, 160) || 'Story/explicit state' }); }
  throw new TypeError(`Unsupported phone-world kind: ${kind}`);
}

export function phoneWorldHeadId(scope, kind, recordId) { return `phone-world:${scope.storyId}:${scope.branchId}:${kind}:${recordId}`; }
