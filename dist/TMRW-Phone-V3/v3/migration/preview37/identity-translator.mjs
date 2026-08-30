import { MIGRATION_ITEM_STATE, PREVIEW37_SOURCE_AUTHORITY } from './constants.mjs';
import { previewDigest } from './digest.mjs';
import { mapPreviewScope } from './scope-mapper.mjs';

export async function createIdentityMigrationItem({ batchId, card, scope, userDisplayName = '{{user}}' }) {
  const mapping = mapPreviewScope({ card, scope }); const sourceRecordId = `scope:${scope.sourceScopeKey}`;
  const data = mapping.state === MIGRATION_ITEM_STATE.READY ? Object.freeze({
    manifestId: `${batchId}:identity:${await previewDigest(scope.sourceScopeKey)}`,
    sourceAuthority: PREVIEW37_SOURCE_AUTHORITY,
    card: Object.freeze({ sourceCardId: mapping.cardSourceId, displayName: card.displayName || card.cardKey }),
    story: Object.freeze({ sourceStoryId: mapping.storySourceId, title: scope.storyKey }),
    branch: Object.freeze({ sourceRouteId: mapping.branchSourceId, label: scope.branchKey }),
    user: Object.freeze({ displayName: userDisplayName, aliases: Object.freeze(['Player']) }),
    cast: Object.freeze(card.cast.map(member => Object.freeze({ sourceActorId: `${card.cardKey}:${member.sourceActorId}`, displayName: member.displayName, aliases: Object.freeze([...member.aliases]), sourceMemberId: member.sourceMemberId, sourceInstanceId: member.sourceInstanceId }))),
  }) : null;
  return Object.freeze({ sourceRecordId, sourceScopeKey: scope.sourceScopeKey, sourceType: 'identity-scope', state: mapping.state, reasonCode: mapping.reasonCode, sourceFingerprint: await previewDigest({ card, storyKey: scope.storyKey, branchKey: scope.branchKey }), data, mapping });
}

export function canonicalPeopleFromIdentity(item, identity) {
  if (!item?.data || !identity) throw new TypeError('Committed identity result is required');
  const owners = [{ sourceMemberId: '{{user}}', sourceActorId: 'local-player-v1' }, ...item.data.cast];
  return Object.freeze(owners.map((owner, index) => Object.freeze({
    sourceMemberId: owner.sourceMemberId,
    sourceActorId: owner.sourceActorId,
    actorId: identity.actorIds[index], instanceId: identity.instanceIds[index], deviceId: identity.deviceIds[index], accountId: identity.accountIds[index],
  })));
}

