import { ACTOR_CONTROL, createControlAuthority } from './control-authority.mjs';
import { assertIdentityId } from './id.mjs';
import { freezeRecord, identityRecord, normalizedStrings, requireText } from './identity-record.mjs';

export function createActor({ id, sourceAuthority, sourceActorId, displayName, aliases = [], control = ACTOR_CONTROL.AI, controlKey, createdAt, updatedAt, manifestId, existingManifestIds = [] }) {
  const authority = createControlAuthority({ kind: control, controlKey });
  return freezeRecord({
    ...identityRecord({ entityType: 'actor', id: assertIdentityId('actor', id), createdAt, updatedAt, manifestId, existingManifestIds }),
    sourceAuthority: requireText(sourceAuthority, 'sourceAuthority'),
    sourceActorId: requireText(sourceActorId, 'sourceActorId'),
    displayName: requireText(displayName, 'displayName'),
    aliases: normalizedStrings(aliases),
    control: authority.kind,
    controlKey: authority.controlKey,
  });
}
