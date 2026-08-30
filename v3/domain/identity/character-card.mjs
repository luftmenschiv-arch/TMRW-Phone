import { assertIdentityId } from './id.mjs';
import { freezeRecord, identityRecord, normalizedStrings, requireText } from './identity-record.mjs';

export function createCharacterCard({ id, sourceAuthority, sourceCardId, displayName, aliases = [], createdAt, updatedAt, manifestId, existingManifestIds = [] }) {
  return freezeRecord({
    ...identityRecord({ entityType: 'character-card', id: assertIdentityId('character-card', id), createdAt, updatedAt, manifestId, existingManifestIds }),
    sourceAuthority: requireText(sourceAuthority, 'sourceAuthority'),
    sourceCardId: requireText(sourceCardId, 'sourceCardId'),
    displayName: requireText(displayName, 'displayName'),
    aliases: normalizedStrings(aliases),
  });
}

export function createCharacterCardMembership({ id, cardId, actorId, status = 'active', createdAt, updatedAt, manifestId, existingManifestIds = [] }) {
  if (!['active', 'removed'].includes(status)) throw new TypeError('Membership status must be active or removed');
  return freezeRecord({
    id: assertIdentityId('card-membership', id),
    entityType: 'card-membership',
    cardId: assertIdentityId('character-card', cardId),
    actorId: assertIdentityId('actor', actorId),
    status,
    createdAt: requireText(createdAt, 'createdAt'),
    updatedAt: requireText(updatedAt, 'updatedAt'),
    manifestIds: normalizedStrings([...existingManifestIds, manifestId]),
  });
}
