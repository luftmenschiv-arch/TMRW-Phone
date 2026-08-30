import { assertIdentityId } from './id.mjs';
import { freezeRecord, identityRecord, requireText } from './identity-record.mjs';

export function createStory({ id, characterCardId, sourceAuthority, sourceStoryId, title, createdAt, updatedAt, manifestId, existingManifestIds = [] }) {
  return freezeRecord({
    ...identityRecord({ entityType: 'story', id: assertIdentityId('story', id), createdAt, updatedAt, manifestId, existingManifestIds }),
    characterCardId: assertIdentityId('character-card', characterCardId),
    sourceAuthority: requireText(sourceAuthority, 'sourceAuthority'),
    sourceStoryId: requireText(sourceStoryId, 'sourceStoryId'),
    title: requireText(title, 'title'),
  });
}
