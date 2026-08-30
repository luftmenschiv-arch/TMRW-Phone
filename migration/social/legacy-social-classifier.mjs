import { requireText } from '../../domain/identity/identity-record.mjs';

export const LEGACY_SOCIAL_CLASSIFICATION = Object.freeze({
  READY: 'ready',
  SYNTHETIC: 'known-synthetic',
  QUARANTINED: 'quarantined',
  UNSUPPORTED: 'unsupported',
});

const supportedKinds = new Set(['post', 'comment']);

export function classifyLegacySocialRecord(record) {
  const sourceId = requireText(record?.sourceId, 'sourceId');
  const provenance = Object.freeze({ sourceFamily: 'preview37-social', sourceId, fingerprint: record.fingerprint || null });
  if (record.synthetic === true || record.recovery === true) return Object.freeze({ classification: LEGACY_SOCIAL_CLASSIFICATION.SYNTHETIC, provenance, reason: 'known synthetic/recovery content is not imported as genuine canon' });
  if (!supportedKinds.has(record.kind)) return Object.freeze({ classification: LEGACY_SOCIAL_CLASSIFICATION.UNSUPPORTED, provenance, reason: 'unsupported legacy social shape' });
  const missing = ['storyId', 'branchId', 'actorId', 'instanceId', 'accountId'].filter(key => !record[key]);
  if (missing.length || record.ambiguous === true) return Object.freeze({ classification: LEGACY_SOCIAL_CLASSIFICATION.QUARANTINED, provenance, reason: missing.length ? `missing canonical scope: ${missing.join(',')}` : 'ambiguous canonical identity' });
  return Object.freeze({ classification: LEGACY_SOCIAL_CLASSIFICATION.READY, provenance, canonicalScope: Object.freeze({ storyId: record.storyId, branchId: record.branchId, actorId: record.actorId, instanceId: record.instanceId, accountId: record.accountId }) });
}

export function classifyLegacySocialBatch(records, { limit = 500 } = {}) {
  if (!Array.isArray(records)) throw new TypeError('Legacy social records must be an array');
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new TypeError('Legacy social classification limit must be 1-500');
  const items = records.slice(0, limit).map(classifyLegacySocialRecord);
  return Object.freeze({ items: Object.freeze(items), truncated: records.length > limit, canonicalWrites: 0, knowledgeWrites: 0 });
}
