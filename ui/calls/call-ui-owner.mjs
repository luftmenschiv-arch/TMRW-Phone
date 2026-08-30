export const CALL_UI_OWNER = Object.freeze({ PRODUCTION_TEXT: 'tmrw-phase18-text' });

export function resolveCallUiOwner({ perspective, playerActorId, playerInstanceId }) {
  if (!perspective) return Object.freeze({ available: false, canAct: false, inspectionOnly: true, reason: 'missing-perspective', uiOwner: CALL_UI_OWNER.PRODUCTION_TEXT });
  const archived = perspective.lifecycleState === 'archived';
  const playerIsHolder = perspective.currentHolderActorId === playerActorId && perspective.currentHolderInstanceId === playerInstanceId;
  const explicitActualActor = perspective.actualAuthorActorId === playerActorId && perspective.actualAuthorInstanceId === playerInstanceId;
  const playerOwnsDevice = perspective.deviceOwnerActorId === playerActorId && perspective.deviceOwnerInstanceId === playerInstanceId;
  const playerOwnsAccount = perspective.accountOwnerActorId === playerActorId && perspective.accountOwnerInstanceId === playerInstanceId;
  const canAct = !archived && Boolean(perspective.accountId) && (playerIsHolder || explicitActualActor || (playerOwnsDevice && playerOwnsAccount));
  const reason = archived ? 'device-archived' : !perspective.accountId ? 'no-account-session' : canAct ? (playerIsHolder ? 'canonical-current-holder' : explicitActualActor ? 'canonical-actual-author' : 'canonical-player-owned-phone') : 'inspection-only';
  return Object.freeze({
    available: !archived && Boolean(perspective.accountId),
    canAct,
    inspectionOnly: !canAct,
    reason,
    uiOwner: CALL_UI_OWNER.PRODUCTION_TEXT,
    deviceId: perspective.deviceId,
    accountId: perspective.accountId,
    actualActorId: canAct ? playerActorId : null,
    actualInstanceId: canAct ? playerInstanceId : null,
    deviceOwnerActorId: perspective.deviceOwnerActorId,
    deviceOwnerInstanceId: perspective.deviceOwnerInstanceId,
    currentHolderActorId: perspective.currentHolderActorId,
    currentHolderInstanceId: perspective.currentHolderInstanceId,
    accountOwnerActorId: perspective.accountOwnerActorId,
    accountOwnerInstanceId: perspective.accountOwnerInstanceId,
  });
}
