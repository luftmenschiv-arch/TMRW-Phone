import { isPlayerControlled } from '../identity/control-authority.mjs';

export function createPhonePerspective({ state, ownerActor, ownerInstance, accountSession = null }) {
  if (!state || !ownerActor || !ownerInstance) throw new TypeError('A phone perspective requires state and resolved ownership identities');
  const myPhone = isPlayerControlled(ownerActor);
  return Object.freeze({
    kind: myPhone ? 'my-phone' : 'their-phone',
    writable: myPhone,
    deviceId: state.deviceId,
    deviceOwnerActorId: state.deviceOwnerActorId,
    deviceOwnerInstanceId: state.deviceOwnerInstanceId,
    currentHolderActorId: state.currentHolderActorId,
    currentHolderInstanceId: state.currentHolderInstanceId,
    accountId: accountSession?.accountId || null,
    accountOwnerActorId: accountSession?.accountOwnerActorId || null,
    accountOwnerInstanceId: accountSession?.accountOwnerInstanceId || null,
    actualAuthorActorId: accountSession?.actualAuthorActorId || null,
    actualAuthorInstanceId: accountSession?.actualAuthorInstanceId || null,
    lockState: state.lockState,
    lifecycleState: state.lifecycleState,
  });
}
