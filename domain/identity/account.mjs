import { assertIdentityId } from './id.mjs';
import { freezeRecord, identityRecord, normalizedStrings, requireText } from './identity-record.mjs';

export function createAccount({ id, storyId, branchId, ownerInstanceId, accountKey, kind = 'phone', label, deviceIds = [], isPrimary = true, createdAt, updatedAt, manifestId, existingManifestIds = [] }) {
  return freezeRecord({
    ...identityRecord({ entityType: 'account', id: assertIdentityId('account', id), createdAt, updatedAt, manifestId, existingManifestIds }),
    storyId: assertIdentityId('story', storyId),
    branchId: assertIdentityId('branch', branchId),
    ownerInstanceId: assertIdentityId('character-instance', ownerInstanceId),
    accountKey: requireText(accountKey, 'accountKey'),
    kind: requireText(kind, 'kind'),
    label: requireText(label, 'label'),
    deviceIds: normalizedStrings(deviceIds).map(idValue => assertIdentityId('device', idValue)),
    isPrimary: Boolean(isPrimary),
  });
}
