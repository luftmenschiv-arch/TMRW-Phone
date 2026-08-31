import { MIGRATION_ITEM_STATE, PREVIEW37_PERSONAL_CLASSIFICATION } from './constants.mjs';
import { boundedPreviewText, previewDigest } from './digest.mjs';
import { normalizePendingDue } from '../../domain/time/pending-world-event.mjs';

const objectEntries = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
const stable = value => String(value ?? '').trim();
const list = value => Array.isArray(value) ? value : [];
const MOCK_RE = /(?:^|[\s:_-])(mock|sample|demo|fixture|generated|random|fallback|placeholder|preview-default)(?:$|[\s:_-])/i;
const EXPLICIT_RE = /(?:^|[\s:_-])(manual|user|user-authored|explicit|canon|canonical|story|provider|imported)(?:$|[\s:_-])/i;

function legacyId(raw) { return stable(raw?.id || raw?.recordId || raw?.noteId || raw?.photoId || raw?.assetId || raw?.searchId || raw?.entryId || raw?.itemId || raw?.orderId || raw?.eventId || raw?.locationId); }
function evidence(raw) { return [raw?.source, raw?.sourceKind, raw?.origin, raw?.createdBy, raw?.provider, raw?.provenance?.source, raw?.provenance?.authority].map(stable).filter(Boolean).join(' '); }
function mockLike(raw) { return raw?.mock === true || raw?.generated === true || raw?.sample === true || raw?.fixture === true || MOCK_RE.test(evidence(raw)); }
function explicitLike(raw) { return raw?.userAuthored === true || raw?.explicit === true || raw?.canonical === true || raw?.providerBacked === true || EXPLICIT_RE.test(evidence(raw)); }
function timestamp(raw) { return stable(raw?.updatedAt || raw?.createdAt || raw?.timestamp || raw?.time || raw?.clock) || null; }
function sourceRecordId(scope, family, ownerSourceId, id, index) { return `scope:${scope.sourceScopeKey}:${family}:${ownerSourceId}:${id || `unsafe-${index}`}`; }
function safeFinite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function currencyText(value) { if (typeof value !== 'string') return ''; const currency = value.trim(); return currency && currency.length <= 24 && !/[\u0000-\u001f\u007f]/.test(currency) ? currency : ''; }
function cleanStringArray(value) { return [...new Set(list(value).map(stable).filter(Boolean))]; }
function fingerprintableLegacyValue(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) return Object.freeze({ legacyNonFiniteNumber: String(value) });
  if (Array.isArray(value)) return value.map(fingerprintableLegacyValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, fingerprintableLegacyValue(child)]));
  return value;
}

async function item({ scope, family, ownerSourceId, raw, index, classify }) {
  const id = legacyId(raw); const sourceRecord = sourceRecordId(scope, family, ownerSourceId, id, index); const sourceFingerprint = await previewDigest(fingerprintableLegacyValue(raw));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return Object.freeze({ sourceRecordId: sourceRecord, sourceScopeKey: scope.sourceScopeKey, sourceType: family, state: MIGRATION_ITEM_STATE.QUARANTINED, reasonCode: 'malformed-legacy-record', classification: PREVIEW37_PERSONAL_CLASSIFICATION.AMBIGUOUS, sourceFingerprint, data: null });
  if (mockLike(raw)) return Object.freeze({ sourceRecordId: sourceRecord, sourceScopeKey: scope.sourceScopeKey, sourceType: family, state: MIGRATION_ITEM_STATE.UNSUPPORTED, reasonCode: 'mock-generated-exclude', classification: PREVIEW37_PERSONAL_CLASSIFICATION.MOCK, sourceFingerprint, data: null });
  if (!id) return Object.freeze({ sourceRecordId: sourceRecord, sourceScopeKey: scope.sourceScopeKey, sourceType: family, state: MIGRATION_ITEM_STATE.QUARANTINED, reasonCode: 'legacy-record-missing-stable-id', classification: PREVIEW37_PERSONAL_CLASSIFICATION.AMBIGUOUS, sourceFingerprint, data: null });
  if (!explicitLike(raw)) return Object.freeze({ sourceRecordId: sourceRecord, sourceScopeKey: scope.sourceScopeKey, sourceType: family, state: MIGRATION_ITEM_STATE.QUARANTINED, reasonCode: 'legacy-provenance-unproven', classification: PREVIEW37_PERSONAL_CLASSIFICATION.AMBIGUOUS, sourceFingerprint, data: null });
  try {
    const data = classify(raw, id);
    if (!data) return Object.freeze({ sourceRecordId: sourceRecord, sourceScopeKey: scope.sourceScopeKey, sourceType: family, state: MIGRATION_ITEM_STATE.QUARANTINED, reasonCode: 'legacy-semantics-ambiguous', classification: PREVIEW37_PERSONAL_CLASSIFICATION.AMBIGUOUS, sourceFingerprint, data: null });
    return Object.freeze({ sourceRecordId: sourceRecord, sourceScopeKey: scope.sourceScopeKey, sourceType: family, state: MIGRATION_ITEM_STATE.READY, reasonCode: null, classification: PREVIEW37_PERSONAL_CLASSIFICATION.ELIGIBLE, sourceFingerprint, data: Object.freeze({ ownerSourceId, legacyId: id, legacyTimestamp: timestamp(raw), ...data }) });
  } catch (error) {
    return Object.freeze({ sourceRecordId: sourceRecord, sourceScopeKey: scope.sourceScopeKey, sourceType: family, state: MIGRATION_ITEM_STATE.QUARANTINED, reasonCode: `legacy-validation:${String(error?.message || error).slice(0, 180)}`, classification: PREVIEW37_PERSONAL_CLASSIFICATION.AMBIGUOUS, sourceFingerprint, data: null });
  }
}

function noteData(raw) {
  const title = boundedPreviewText(raw.title || raw.name, 256); const text = boundedPreviewText(raw.text ?? raw.body ?? raw.content, 20_000);
  if (!title && !text) return null;
  return { title: title || 'Untitled note', text, pinned: raw.pinned === true, sourceKind: 'preview37-personal' };
}
function galleryData(raw) {
  const assetRef = stable(raw.assetRef || raw.assetId); if (!assetRef) return null;
  return { label: boundedPreviewText(raw.label || raw.title || raw.name, 256) || null, assetRef, sourceKind: 'preview37-personal', provenance: Object.freeze({ takenBySourceId: stable(raw.provenance?.takenByActorId || raw.takenByActorId) || null, takenAt: stable(raw.provenance?.takenAt || raw.takenAt || raw.createdAt) || null, locationLabel: boundedPreviewText(raw.provenance?.locationLabel || raw.locationLabel, 256) || null, source: stable(raw.provenance?.source || raw.source || raw.sourceKind) || 'preview37-personal' }) };
}
function searchData(raw) {
  const query = boundedPreviewText(raw.query || raw.q || raw.term, 1000); if (!query || raw.suggestion === true || raw.discover === true || raw.trending === true) return null;
  return { query, provider: 'local-phone-world', resultRef: stable(raw.resultRef || raw.openedResultRef) || null, sourceKind: 'preview37-personal' };
}
function walletData(raw) {
  const entryKind = stable(raw.entryKind || raw.type); if (!['balance', 'transaction'].includes(entryKind)) return null;
  const amount = safeFinite(raw.amount); const currency = currencyText(raw.currency); const label = boundedPreviewText(raw.label || raw.description, 512);
  const sequenceRaw = raw.sequence ?? raw.ordinal ?? null; const legacySequence = sequenceRaw == null ? null : Number(sequenceRaw);
  if (amount === null || !currency || !label || stable(raw.relatedOrderId)) return null;
  if (legacySequence !== null && (!Number.isSafeInteger(legacySequence) || legacySequence < 0)) return null;
  return { entryKind, amount, currency, label, relatedOrderLegacyId: null, legacySequence, sourceKind: 'preview37-personal' };
}
function shopItemData(raw) {
  const type = stable(raw.recordType || raw.kind || raw.type); if (!['catalog-item', 'shop-item'].includes(type)) return null;
  const price = safeFinite(raw.price); const currency = stable(raw.currency); const name = boundedPreviewText(raw.name || raw.title, 512);
  if (price === null || price < 0 || !currency || !name) return null;
  return { name, description: boundedPreviewText(raw.description, 2000) || null, price, currency, available: raw.available !== false, sourceKind: 'preview37-personal' };
}
function shopOrderData(raw) {
  const type = stable(raw.recordType || raw.kind || raw.type); if (type !== 'order') return null;
  const shopItemLegacyId = stable(raw.shopItemId || raw.itemId); const unitPrice = safeFinite(raw.unitPrice ?? raw.price); const currency = stable(raw.currency); const quantity = Number(raw.quantity ?? 1); const status = stable(raw.status || 'ordered');
  if (!shopItemLegacyId || unitPrice === null || unitPrice < 0 || !currency || !Number.isSafeInteger(quantity) || quantity < 1 || status !== 'ordered') return null;
  if (unitPrice > 0) return null;
  return { shopItemLegacyId, quantity, unitPrice, currency, status, sourceKind: 'preview37-personal' };
}
function calendarData(raw) {
  const itemKind = stable(raw.itemKind || raw.type); if (!['reminder', 'invitation'].includes(itemKind)) return null;
  const title = boundedPreviewText(raw.title || raw.summary, 512); if (!title) return null;
  const due = normalizePendingDue(raw.due); if (!due) return null;
  const participantSourceIds = cleanStringArray(raw.participantIds || raw.participantSourceIds || raw.memberIds);
  if (itemKind === 'invitation' && (participantSourceIds.length === 0 || (raw.organizer !== true && raw.createdByOwner !== true))) return null;
  return { itemKind, title, due, participantSourceIds, sourceKind: 'preview37-personal' };
}
function locationData(raw) {
  const mode = stable(raw.mode || raw.type); if (!['check-in', 'shared', 'live'].includes(mode)) return null;
  const label = boundedPreviewText(raw.label || raw.locationLabel || raw.name, 512); if (!label) return null;
  const audienceSourceIds = cleanStringArray(raw.audienceIds || raw.audienceSourceIds || raw.recipientIds);
  if (mode !== 'check-in' && audienceSourceIds.length === 0) return null;
  const expiresAt = mode === 'live' ? stable(raw.expiresAt) : null; if (mode === 'live' && !expiresAt) return null;
  return { mode, label, audienceSourceIds, expiresAt, status: stable(raw.status || 'active') === 'ended' ? 'ended' : 'active', sourceKind: 'preview37-personal' };
}

export async function createPersonalAppMigrationItems({ scope, memberIds }) {
  const items = [];
  for (const [ownerSourceIdRaw, phone] of objectEntries(scope?.phones)) {
    const ownerSourceId = stable(ownerSourceIdRaw);
    const ownerKnown = memberIds.has(ownerSourceId);
    const families = [
      ['note', list(phone?.notes), noteData],
      ['gallery', list(phone?.gallery), galleryData],
      ['search-history', list(phone?.search), searchData],
      ['calendar-personal', list(phone?.calendar), calendarData],
      ['location-personal', list(phone?.maps), locationData],
    ];
    for (const [family, rows, classify] of families) for (const [index, raw] of rows.entries()) {
      let created = await item({ scope, family, ownerSourceId, raw, index, classify });
      if (ownerKnown && created.state === MIGRATION_ITEM_STATE.READY && family === 'calendar-personal' && created.data.participantSourceIds.some(id => !memberIds.has(id))) created = Object.freeze({ ...created, state: MIGRATION_ITEM_STATE.AMBIGUOUS, reasonCode: 'calendar-participant-unmapped', classification: PREVIEW37_PERSONAL_CLASSIFICATION.AMBIGUOUS, data: null });
      if (ownerKnown && created.state === MIGRATION_ITEM_STATE.READY && family === 'location-personal' && created.data.audienceSourceIds.some(id => !memberIds.has(id))) created = Object.freeze({ ...created, state: MIGRATION_ITEM_STATE.AMBIGUOUS, reasonCode: 'location-audience-unmapped', classification: PREVIEW37_PERSONAL_CLASSIFICATION.AMBIGUOUS, data: null });
      items.push(ownerKnown ? created : Object.freeze({ ...created, state: MIGRATION_ITEM_STATE.AMBIGUOUS, reasonCode: 'personal-app-phone-owner-unmapped', classification: PREVIEW37_PERSONAL_CLASSIFICATION.AMBIGUOUS, data: null }));
    }
    const walletItems = [];
    for (const [index, raw] of list(phone?.wallet).entries()) {
      const created = await item({ scope, family: 'wallet', ownerSourceId, raw, index, classify: walletData });
      walletItems.push(ownerKnown ? created : Object.freeze({ ...created, state: MIGRATION_ITEM_STATE.AMBIGUOUS, reasonCode: 'personal-app-phone-owner-unmapped', classification: PREVIEW37_PERSONAL_CLASSIFICATION.AMBIGUOUS, data: null }));
    }
    if (ownerKnown) {
      const byCurrency = new Map();
      for (const row of walletItems.filter(value => value.state === MIGRATION_ITEM_STATE.READY)) {
        if (!byCurrency.has(row.data.currency)) byCurrency.set(row.data.currency, []);
        byCurrency.get(row.data.currency).push(row);
      }
      for (const rows of byCurrency.values()) {
        const balances = rows.filter(row => row.data.entryKind === 'balance'); const transactions = rows.filter(row => row.data.entryKind === 'transaction');
        const orderRequired = balances.length > 1 || (balances.length > 0 && transactions.length > 0);
        if (!orderRequired) continue;
        const sequences = rows.map(row => row.data.legacySequence); const proven = sequences.every(value => Number.isSafeInteger(value) && value >= 0) && new Set(sequences).size === sequences.length;
        if (!proven) for (const row of rows) {
          const index = walletItems.indexOf(row);
          walletItems[index] = Object.freeze({ ...row, state: MIGRATION_ITEM_STATE.AMBIGUOUS, reasonCode: 'wallet-order-semantics-unproven', classification: PREVIEW37_PERSONAL_CLASSIFICATION.AMBIGUOUS, data: null });
        }
      }
    }
    items.push(...walletItems);

    const shopRows = list(phone?.shop); const catalogByLegacyId = new Map();
    for (const raw of shopRows) if (!mockLike(raw) && explicitLike(raw)) { const id = legacyId(raw); const normalized = shopItemData(raw); if (id && normalized) catalogByLegacyId.set(id, normalized); }
    for (const [index, raw] of shopRows.entries()) {
      const type = stable(raw?.recordType || raw?.kind || raw?.type);
      const family = type === 'order' ? 'shop-order' : ['catalog-item', 'shop-item'].includes(type) ? 'shop-item' : 'shop';
      const classify = family === 'shop-order' ? shopOrderData : family === 'shop-item' ? shopItemData : () => null;
      let created = await item({ scope, family, ownerSourceId, raw, index, classify });
      if (ownerKnown && created.state === MIGRATION_ITEM_STATE.READY && family === 'shop-order') {
        const linked = catalogByLegacyId.get(created.data.shopItemLegacyId);
        if (!linked || linked.price !== 0 || linked.currency !== created.data.currency) created = Object.freeze({ ...created, state: MIGRATION_ITEM_STATE.AMBIGUOUS, reasonCode: 'shop-order-catalog-link-unproven', classification: PREVIEW37_PERSONAL_CLASSIFICATION.AMBIGUOUS, data: null });
      }
      items.push(ownerKnown ? created : Object.freeze({ ...created, state: MIGRATION_ITEM_STATE.AMBIGUOUS, reasonCode: 'personal-app-phone-owner-unmapped', classification: PREVIEW37_PERSONAL_CLASSIFICATION.AMBIGUOUS, data: null }));
    }
  }
  return Object.freeze(items);
}
