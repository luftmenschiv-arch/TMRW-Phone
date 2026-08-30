import { createPhase16EventTypeRegistry } from '../live/live-event-types.mjs';

// Notifications are projections and local UI state, never canonical Event types.
export function createPhase17EventTypeRegistry(additional = []) { return createPhase16EventTypeRegistry(additional); }

