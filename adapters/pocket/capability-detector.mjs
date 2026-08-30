export function detectPocketCapabilities(snapshot) {
  if (!snapshot?.available) return Object.freeze({ status: 'unavailable', sourceVersion: null, capabilities: Object.freeze({}), issues: Object.freeze([snapshot?.reason || 'Pocket unavailable']) });
  const config = snapshot.config; const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const capabilities = Object.freeze({ contacts: Array.isArray(config.contacts), threads: object(config.threads), groups: Array.isArray(config.groups), callLog: Array.isArray(config.callLog), routeScopedDm: object(config.threads) && Object.keys(config.threads).some(key => key.includes('::')), completedCallHistory: Array.isArray(config.callLog) });
  const issues = Object.freeze(Object.entries(capabilities).filter(([key, value]) => ['contacts', 'threads', 'groups', 'callLog'].includes(key) && !value).map(([key]) => `Unsupported or missing Pocket ${key} collection.`));
  return Object.freeze({ status: issues.length ? 'partial' : 'supported', sourceVersion: snapshot.sourceVersion, capabilities, issues });
}
