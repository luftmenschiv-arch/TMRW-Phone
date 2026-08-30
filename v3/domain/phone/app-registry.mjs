export const PHONE_APP_REGISTRY = Object.freeze([
  Object.freeze({ id: 'launcher', kind: 'system', eager: false }),
  Object.freeze({ id: 'contacts', kind: 'phase7', eager: false }),
  Object.freeze({ id: 'messages', kind: 'phase8', eager: false }),
  Object.freeze({ id: 'calls', kind: 'phase9', eager: false }),
  Object.freeze({ id: 'feed', kind: 'phase15', eager: false }),
  Object.freeze({ id: 'insungram', kind: 'phase15', eager: false }),
  Object.freeze({ id: 'live', kind: 'phase16', eager: false }),
  Object.freeze({ id: 'notifications', kind: 'phase17', eager: false }),
  Object.freeze({ id: 'guide', kind: 'phase7', eager: false }),
  Object.freeze({ id: 'settings', kind: 'system', eager: false }),
  Object.freeze({ id: 'diagnostics', kind: 'developer', eager: false }),
]);

export function getPhoneApp(appId) { return PHONE_APP_REGISTRY.find(app => app.id === appId) || null; }
