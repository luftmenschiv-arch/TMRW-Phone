import { PHONE_APP_REGISTRY } from '../domain/phone/app-registry.mjs';
export function homeViewModel({ developerMode = false, messagingEnabled = false, callsEnabled = false, socialEnabled = false, liveEnabled = false, notificationsEnabled = false, badges = {} }) {
  return Object.freeze(PHONE_APP_REGISTRY
    .filter(app => app.id !== 'launcher' && (developerMode || app.kind !== 'developer') && (app.kind !== 'phase8' || messagingEnabled) && (app.kind !== 'phase9' || callsEnabled) && (app.kind !== 'phase15' || socialEnabled) && (app.kind !== 'phase16' || liveEnabled) && (app.kind !== 'phase17' || notificationsEnabled))
    .map(app => Object.freeze({ id: app.id, label: app.id[0].toUpperCase() + app.id.slice(1), badge: Number(badges[app.id] || 0), available: true })));
}
