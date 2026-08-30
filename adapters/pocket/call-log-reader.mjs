export function pocketCallLogRows(config) { if (!Array.isArray(config?.callLog)) return Object.freeze([]); return Object.freeze(config.callLog.map((call, index) => Object.freeze({ index, call }))); }
