import { canonicalJson, sha256Hex } from '../events/idempotency.mjs';
import { requireText } from '../identity/identity-record.mjs';

export async function deriveKnowledgeId(kind, scope, stableKey) {
  const normalizedKind = requireText(kind, 'knowledge ID kind');
  const seed = canonicalJson(['tmrw-phone-v3-knowledge-v1', normalizedKind, requireText(scope?.storyId, 'scope.storyId'), requireText(scope?.branchId, 'scope.branchId'), requireText(stableKey, 'stableKey')]);
  return `${normalizedKind}_${(await sha256Hex(seed)).slice(0, 32)}`;
}

export function scopedKnowledgeHeadId(kind, scope, id) {
  return `${kind}:${requireText(scope?.storyId, 'scope.storyId')}:${requireText(scope?.branchId, 'scope.branchId')}:${requireText(id, `${kind} id`)}`;
}
