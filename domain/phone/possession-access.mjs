export function canonicalDeviceAccess(state, actorId) {
  const allowed = state.deviceOwnerActorId === actorId || state.currentHolderActorId === actorId || state.canonicalAccess.actorIds.includes(actorId);
  return Object.freeze({ allowed, lockState: state.lockState, source: allowed ? 'canonical-device-state' : 'none' });
}
