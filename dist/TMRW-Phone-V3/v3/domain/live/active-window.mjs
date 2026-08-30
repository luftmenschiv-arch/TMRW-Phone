export const LIVE_ACTIVE_WINDOW_LIMIT = 100;
export function boundedLiveWindow(rows, limit = LIVE_ACTIVE_WINDOW_LIMIT) { if (!Number.isInteger(limit) || limit < 1 || limit > LIVE_ACTIVE_WINDOW_LIMIT) throw new TypeError(`Live active window limit must be 1-${LIVE_ACTIVE_WINDOW_LIMIT}`); return Object.freeze(rows.slice(0, limit)); }
