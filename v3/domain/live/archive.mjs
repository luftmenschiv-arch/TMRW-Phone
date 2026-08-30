export const LIVE_ARCHIVE_SEGMENT_SIZE = 50;
export function archiveSegmentNumber(sequence) { if (!Number.isInteger(sequence) || sequence < 1) throw new TypeError('Archive sequence must be positive'); return Math.floor((sequence - 1) / LIVE_ARCHIVE_SEGMENT_SIZE); }
export function liveReplayPolicy(session) { return Object.freeze({ sessionId: session.sessionId, available: session.archiveAvailability === 'available', defaultedToUnavailable: session.archiveAvailability !== 'available' }); }
