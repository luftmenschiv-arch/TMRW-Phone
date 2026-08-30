import { assertIdentityId } from './id.mjs';
import { freezeRecord, identityRecord, optionalText, requireText } from './identity-record.mjs';

const GLOBAL_CANONICAL_TYPES = new Set(['character-card', 'actor', 'story']);
const SCOPED_CANONICAL_TYPES = new Set(['character-instance', 'branch', 'device', 'account']);

export function identityScopeKey(storyId = null, branchId = null) {
  if (storyId === null && branchId === null) return '*';
  return `${assertIdentityId('story', storyId)}::${assertIdentityId('branch', branchId)}`;
}

export function createIdentityMapping({ id, sourceAuthority, sourceType, sourceId, canonicalType, canonicalId, parentCanonicalId = null, storyId = null, branchId = null, confidence = 'stable-source-id', status = 'active', reason = null, createdAt, updatedAt, manifestId, existingManifestIds = [] }) {
  if (!GLOBAL_CANONICAL_TYPES.has(canonicalType) && !SCOPED_CANONICAL_TYPES.has(canonicalType)) throw new TypeError(`Unsupported canonical identity type: ${String(canonicalType)}`);
  if (!['active', 'quarantined', 'retired'].includes(status)) throw new TypeError(`Unsupported identity mapping status: ${String(status)}`);
  if (SCOPED_CANONICAL_TYPES.has(canonicalType) && (!storyId || !branchId)) throw new TypeError(`${canonicalType} mappings require explicit Story and Branch scope`);
  if (GLOBAL_CANONICAL_TYPES.has(canonicalType) && (storyId || branchId)) throw new TypeError(`${canonicalType} mappings must be global`);
  return freezeRecord({
    ...identityRecord({ entityType: 'identity-mapping', id: assertIdentityId('identity-mapping', id), createdAt, updatedAt, manifestId, existingManifestIds }),
    sourceAuthority: requireText(sourceAuthority, 'sourceAuthority'),
    sourceType: requireText(sourceType, 'sourceType'),
    sourceId: requireText(sourceId, 'sourceId'),
    canonicalType,
    canonicalId: requireText(canonicalId, 'canonicalId'),
    parentCanonicalId: optionalText(parentCanonicalId, 'parentCanonicalId'),
    storyId,
    branchId,
    scopeKey: identityScopeKey(storyId, branchId),
    confidence: requireText(confidence, 'confidence'),
    status,
    reason: optionalText(reason, 'reason'),
  });
}

export function classifyLegacyIdentityCandidate(candidate) {
  const sourceAuthority = requireText(candidate?.sourceAuthority, 'sourceAuthority');
  const sourceType = requireText(candidate?.sourceType, 'sourceType');
  const stableSourceId = optionalText(candidate?.stableSourceId, 'stableSourceId');
  if (stableSourceId) return Object.freeze({ sourceAuthority, sourceType, sourceId: stableSourceId, disposition: 'eligible', confidence: 'stable-source-id', reason: null });
  const name = optionalText(candidate?.displayName || candidate?.alias, 'displayName');
  return Object.freeze({ sourceAuthority, sourceType, sourceId: name || 'unknown', disposition: 'quarantine', confidence: 'unproven', reason: 'No stable source identifier; names, aliases, avatars, and array positions are not canonical v3 identity keys.' });
}

export function createLegacyIdentityDryRun(candidates) {
  if (!Array.isArray(candidates)) throw new TypeError('Legacy identity candidates must be an array');
  const rows = candidates.map(classifyLegacyIdentityCandidate);
  return Object.freeze({
    mode: 'read-only-dry-run',
    legacyWrites: 0,
    eligible: Object.freeze(rows.filter(row => row.disposition === 'eligible')),
    quarantined: Object.freeze(rows.filter(row => row.disposition === 'quarantine')),
  });
}
