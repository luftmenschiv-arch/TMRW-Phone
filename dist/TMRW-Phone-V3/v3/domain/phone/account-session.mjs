import { requireText } from '../identity/identity-record.mjs';

export const ACCOUNT_SESSION_STATE = Object.freeze({ AVAILABLE: 'available', ACTIVE: 'active', INACTIVE: 'inactive' });
const sessionStates = new Set(Object.values(ACCOUNT_SESSION_STATE));

export function accountSessionId(scope, accountId) {
  return `account-session:${requireText(scope?.storyId, 'scope.storyId')}:${requireText(scope?.branchId, 'scope.branchId')}:${requireText(accountId, 'accountId')}`;
}

export function normalizeAccountSession(input) {
  const session = {
    accountId: requireText(input?.accountId, 'accountSession.accountId'),
    accountOwnerActorId: requireText(input?.accountOwnerActorId, 'accountSession.accountOwnerActorId'),
    accountOwnerInstanceId: requireText(input?.accountOwnerInstanceId, 'accountSession.accountOwnerInstanceId'),
    deviceId: requireText(input?.deviceId, 'accountSession.deviceId'),
    actualAuthorActorId: input?.actualAuthorActorId == null ? null : requireText(input.actualAuthorActorId, 'accountSession.actualAuthorActorId'),
    actualAuthorInstanceId: input?.actualAuthorInstanceId == null ? null : requireText(input.actualAuthorInstanceId, 'accountSession.actualAuthorInstanceId'),
    state: input?.state || ACCOUNT_SESSION_STATE.AVAILABLE,
  };
  if (!sessionStates.has(session.state)) throw new TypeError(`Unsupported account session state: ${session.state}`);
  return Object.freeze(session);
}

export function initialAccountSession({ accountId, ownerActorId, ownerInstanceId, deviceId }) {
  return normalizeAccountSession({ accountId, accountOwnerActorId: ownerActorId, accountOwnerInstanceId: ownerInstanceId, deviceId });
}
