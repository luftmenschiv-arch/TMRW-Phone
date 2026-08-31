import { PHONE_APP_REGISTRY } from '../domain/phone/app-registry.mjs';
export function homeViewModel({ developerMode = false, messagingEnabled = false, callsEnabled = false, socialEnabled = false, liveEnabled = false, notificationsEnabled = false, phoneWorldEnabled = false, calendarEnabled = false, commerceEnabled = false, badges = {} }) {
  return Object.freeze(PHONE_APP_REGISTRY
    .filter(app => app.id !== 'launcher' && app.exposed !== false && (app.kind !== 'phase23-current' || phoneWorldEnabled) && (app.id !== 'calendar' || calendarEnabled) && (!['wallet', 'shop'].includes(app.id) || commerceEnabled) && (developerMode || app.kind !== 'developer') && (app.kind !== 'phase8' || messagingEnabled) && (app.kind !== 'phase9' || callsEnabled) && (app.kind !== 'phase15' || socialEnabled) && (app.kind !== 'phase16' || liveEnabled) && (app.kind !== 'phase17' || notificationsEnabled))
    .map(app => Object.freeze({ id: app.id, label: app.label || (app.id[0].toUpperCase() + app.id.slice(1)), title: app.title || app.id[0].toUpperCase() + app.id.slice(1), badge: Number(badges[app.id] || 0), available: true, disposition: app.disposition || 'functional', reason: app.reason || null })));
}
