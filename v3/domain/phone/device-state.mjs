import { requireText } from '../identity/identity-record.mjs';

export const PHONE_LOCK_STATE = Object.freeze({ LOCKED: 'locked', UNLOCKED: 'unlocked', TEMPORARILY_UNLOCKED: 'temporarily-unlocked' });
export const PHONE_LIFECYCLE_STATE = Object.freeze({ REGISTERED: 'registered', ACTIVE: 'active', ARCHIVED: 'archived' });

const lockStates = new Set(Object.values(PHONE_LOCK_STATE));
const lifecycleStates = new Set(Object.values(PHONE_LIFECYCLE_STATE));

export function phoneStateId(scope, deviceId) {
  return `phone-state:${requireText(scope?.storyId, 'scope.storyId')}:${requireText(scope?.branchId, 'scope.branchId')}:${requireText(deviceId, 'deviceId')}`;
}

export function normalizePhoneState(input) {
  const state = {
    deviceId: requireText(input?.deviceId, 'phoneState.deviceId'),
    deviceOwnerActorId: requireText(input?.deviceOwnerActorId, 'phoneState.deviceOwnerActorId'),
    deviceOwnerInstanceId: requireText(input?.deviceOwnerInstanceId, 'phoneState.deviceOwnerInstanceId'),
    currentHolderActorId: requireText(input?.currentHolderActorId || input?.deviceOwnerActorId, 'phoneState.currentHolderActorId'),
    currentHolderInstanceId: requireText(input?.currentHolderInstanceId || input?.deviceOwnerInstanceId, 'phoneState.currentHolderInstanceId'),
    lockState: input?.lockState || PHONE_LOCK_STATE.LOCKED,
    lifecycleState: input?.lifecycleState || PHONE_LIFECYCLE_STATE.REGISTERED,
    canonicalAccess: Object.freeze({ mode: input?.canonicalAccess?.mode || 'owner-only', actorIds: Object.freeze([...(input?.canonicalAccess?.actorIds || [])].map((value, index) => requireText(value, `phoneState.canonicalAccess.actorIds[${index}]`)).sort()) }),
    appPreferences: Object.freeze(structuredClone(input?.appPreferences || {})),
    unreadSummary: Object.freeze(structuredClone(input?.unreadSummary || { total: 0, byApp: {} })),
  };
  if (!lockStates.has(state.lockState)) throw new TypeError(`Unsupported phone lock state: ${state.lockState}`);
  if (!lifecycleStates.has(state.lifecycleState)) throw new TypeError(`Unsupported phone lifecycle state: ${state.lifecycleState}`);
  return Object.freeze(state);
}

export function initialPhoneState({ deviceId, ownerActorId, ownerInstanceId }) {
  return normalizePhoneState({ deviceId, deviceOwnerActorId: ownerActorId, deviceOwnerInstanceId: ownerInstanceId });
}
