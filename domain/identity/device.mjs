import { assertIdentityId } from './id.mjs';
import { freezeRecord, identityRecord, requireText } from './identity-record.mjs';

export function createDevice({ id, storyId, branchId, ownerInstanceId, deviceKey, kind = 'phone', label, isPrimary = true, createdAt, updatedAt, manifestId, existingManifestIds = [] }) {
  return freezeRecord({
    ...identityRecord({ entityType: 'device', id: assertIdentityId('device', id), createdAt, updatedAt, manifestId, existingManifestIds }),
    storyId: assertIdentityId('story', storyId),
    branchId: assertIdentityId('branch', branchId),
    ownerInstanceId: assertIdentityId('character-instance', ownerInstanceId),
    deviceKey: requireText(deviceKey, 'deviceKey'),
    kind: requireText(kind, 'kind'),
    label: requireText(label, 'label'),
    isPrimary: Boolean(isPrimary),
  });
}
