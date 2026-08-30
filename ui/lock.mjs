export function lockViewModel({ perspective, authorization, phoneWorld = null }) {
  const accessible = Boolean(authorization.granted); const locked = perspective.lockState === 'locked';
  const recent = !accessible ? [] : (phoneWorld?.recent || []).slice(0, 3).map(item => Object.freeze(locked
    ? { notificationId: item.notificationId, title: 'Notification', preview: null, contentHidden: true }
    : { notificationId: item.notificationId, title: item.display.title, preview: item.display.preview, contentHidden: item.previewPolicy === 'hidden-content' }));
  return Object.freeze({ deviceId: perspective.deviceId, lockState: perspective.lockState, accessible, accessBasis: authorization.basis, choices: authorization.choices || [], notificationIndicator: accessible ? Number(phoneWorld?.unreadTotal || 0) : 0, recentNotifications: Object.freeze(recent) });
}
