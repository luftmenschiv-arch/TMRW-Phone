import { assertIdentityId } from './id.mjs';
import { freezeRecord, identityRecord, normalizedStrings, optionalText } from './identity-record.mjs';

export function createCharacterInstance({ id, actorId, storyId, branchId, displayNameOverride = null, aliases = [], createdAt, updatedAt, manifestId, existingManifestIds = [] }) {
  return freezeRecord({
    ...identityRecord({ entityType: 'character-instance', id: assertIdentityId('character-instance', id), createdAt, updatedAt, manifestId, existingManifestIds }),
    actorId: assertIdentityId('actor', actorId),
    storyId: assertIdentityId('story', storyId),
    branchId: assertIdentityId('branch', branchId),
    displayNameOverride: optionalText(displayNameOverride, 'displayNameOverride'),
    aliases: normalizedStrings(aliases),
  });
}
