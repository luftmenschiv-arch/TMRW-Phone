import { assertIdentityId, newIdentityId } from './id.mjs';
import { normalizedStrings, requireText } from './identity-record.mjs';

export function planActorMerge({ sourceActorIds, targetActorId, reason }) {
  const sources = normalizedStrings(sourceActorIds).map(id => assertIdentityId('actor', id));
  const target = assertIdentityId('actor', targetActorId);
  if (sources.length < 2 || !sources.includes(target)) throw new TypeError('Merge planning requires at least two Actors and must include the target Actor');
  return Object.freeze({
    planId: newIdentityId('identity-batch'),
    operation: 'merge-actors',
    sourceActorIds: Object.freeze(sources),
    targetActorId: target,
    reason: requireText(reason, 'reason'),
    automatic: false,
    requiresDirectorConfirmation: true,
  });
}

export function planActorSplit({ sourceActorId, proposedStableSourceIds, reason }) {
  const proposed = normalizedStrings(proposedStableSourceIds);
  if (proposed.length < 2) throw new TypeError('Split planning requires at least two proposed stable source identities');
  return Object.freeze({
    planId: newIdentityId('identity-batch'),
    operation: 'split-actor',
    sourceActorId: assertIdentityId('actor', sourceActorId),
    proposedStableSourceIds: Object.freeze(proposed),
    reason: requireText(reason, 'reason'),
    automatic: false,
    requiresDirectorConfirmation: true,
  });
}
