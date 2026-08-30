import { requireText } from '../identity/identity-record.mjs';

const uniqueMemberIds = (members, key, field) => {
  const values = members.map((member, index) => requireText(member?.[key], `${field}[${index}].${key}`));
  if (new Set(values).size !== values.length) throw new TypeError(`${field}.${key} must be unique`);
  return values;
};

export function normalizeMembershipSnapshot(input) {
  const snapshotId = requireText(input?.snapshotId, 'membership.snapshotId');
  const threadId = requireText(input?.threadId, 'membership.threadId');
  if (!Array.isArray(input?.members) || input.members.length < 2) throw new TypeError('membership.members must contain at least two canonical participants');
  const members = input.members.map((member, index) => Object.freeze({
    accountId: requireText(member?.accountId, `membership.members[${index}].accountId`),
    actorId: requireText(member?.actorId, `membership.members[${index}].actorId`),
    instanceId: requireText(member?.instanceId, `membership.members[${index}].instanceId`),
  })).sort((left, right) => left.accountId.localeCompare(right.accountId));
  uniqueMemberIds(members, 'accountId', 'membership.members');
  uniqueMemberIds(members, 'actorId', 'membership.members');
  uniqueMemberIds(members, 'instanceId', 'membership.members');
  return Object.freeze({ snapshotId, threadId, members: Object.freeze(members) });
}

export const membershipHeadId = (scope, snapshotId) => `thread-membership:${scope.storyId}:${scope.branchId}:${requireText(snapshotId, 'snapshotId')}`;
