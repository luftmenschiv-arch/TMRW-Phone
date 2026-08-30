import { V3KnowledgeError } from '../../storage/errors.mjs';
import { requireText } from '../identity/identity-record.mjs';

export const AUDIENCE_KIND = Object.freeze({
  PRIVATE_EXPLICIT: 'private-explicit',
  GROUP_SNAPSHOT: 'group-snapshot',
  OWNER_PRIVATE: 'owner-private',
  PUBLIC_STORY: 'public-story',
  SYSTEM_DIRECTOR: 'system-director',
});

const kinds = new Set(Object.values(AUDIENCE_KIND));
const uniqueText = (values, field) => Object.freeze([...new Set((values || []).map((value, index) => requireText(value, `${field}[${index}]`)))].sort());

export function normalizeAudiencePolicy(input) {
  const policyId = requireText(input?.policyId, 'audience.policyId');
  const kind = requireText(input?.kind, 'audience.kind');
  if (!kinds.has(kind)) throw new V3KnowledgeError(`Unsupported audience.kind: ${kind}`);
  const policy = {
    policyId,
    kind,
    actorIds: uniqueText(input?.actorIds, 'audience.actorIds'),
    instanceIds: uniqueText(input?.instanceIds, 'audience.instanceIds'),
    deviceIds: uniqueText(input?.deviceIds, 'audience.deviceIds'),
    accountIds: uniqueText(input?.accountIds, 'audience.accountIds'),
    membershipSnapshotId: input?.membershipSnapshotId == null ? null : requireText(input.membershipSnapshotId, 'audience.membershipSnapshotId'),
  };
  if ([AUDIENCE_KIND.PRIVATE_EXPLICIT, AUDIENCE_KIND.GROUP_SNAPSHOT, AUDIENCE_KIND.OWNER_PRIVATE].includes(kind)
      && policy.actorIds.length + policy.instanceIds.length === 0) {
    throw new V3KnowledgeError(`${kind} audience requires explicit Actor or Character Instance identities`);
  }
  if (kind === AUDIENCE_KIND.GROUP_SNAPSHOT && !policy.membershipSnapshotId) throw new V3KnowledgeError('Group audience requires a stable membership snapshot ID');
  return Object.freeze(policy);
}

export function audiencePermitsActor(policyInput, { actorId, instanceId, consumerKind = 'actor-model' }) {
  const policy = normalizeAudiencePolicy(policyInput);
  const actor = requireText(actorId, 'consumer.actorId');
  const instance = requireText(instanceId, 'consumer.instanceId');
  if (policy.kind === AUDIENCE_KIND.SYSTEM_DIRECTOR) return consumerKind === 'director-tool' || consumerKind === 'system';
  if (policy.kind === AUDIENCE_KIND.PUBLIC_STORY) return true;
  return policy.actorIds.includes(actor) || policy.instanceIds.includes(instance);
}

export function playerAccessOverrideDecision({ enabled, action = 'inspect' } = {}) {
  return Object.freeze({
    action: requireText(action, 'player access action'),
    playerMayInspect: Boolean(enabled),
    createsCanonicalKnowledge: false,
    createsOwnerAwareness: false,
    promotesToCanon: false,
    requiredPromotionBoundary: 'future-explicit-canonical-event',
  });
}
