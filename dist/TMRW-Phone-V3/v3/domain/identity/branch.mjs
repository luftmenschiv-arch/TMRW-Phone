import { assertIdentityId } from './id.mjs';
import { freezeRecord, identityRecord, optionalText, requireText } from './identity-record.mjs';

export function createBranch({ id, storyId, sourceAuthority, sourceRouteId, label, parentBranchId = null, createdAt, updatedAt, manifestId, existingManifestIds = [] }) {
  const branchId = assertIdentityId('branch', id);
  const parent = parentBranchId === null ? null : assertIdentityId('branch', parentBranchId);
  if (parent === branchId) throw new TypeError('A Branch cannot be its own parent');
  return freezeRecord({
    ...identityRecord({ entityType: 'branch', id: branchId, createdAt, updatedAt, manifestId, existingManifestIds }),
    storyId: assertIdentityId('story', storyId),
    branchId,
    sourceAuthority: requireText(sourceAuthority, 'sourceAuthority'),
    sourceRouteId: requireText(sourceRouteId, 'sourceRouteId'),
    label: requireText(label, 'label'),
    parentBranchId: optionalText(parent, 'parentBranchId'),
  });
}
