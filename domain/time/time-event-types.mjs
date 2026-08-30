import { CanonicalEventTypeRegistry, CORE_EVENT_TYPES, defineEventType } from '../events/event-types.mjs';
import { normalizeClockAnchor } from './clock-anchor.mjs';
import { CLOCK_RECONCILIATION_OUTCOME } from './clock-reconciliation.mjs';
import { normalizePendingCreate, normalizePendingTransition } from './pending-world-event.mjs';
import { normalizeTimeAdvance } from './time-advance.mjs';
import { createActivitySession } from './activity-session.mjs';

export const TIME_EVENT_TYPES = Object.freeze({
  CLOCK_ANCHOR: 'time.clock-anchor.v1',
  CLOCK_RECONCILIATION: 'time.clock-reconciliation.v1',
  TIME_ADVANCE: 'time.advance.v1',
  BRANCH_FORK: 'time.branch-fork.v1',
  PENDING_CREATED: 'time.pending-created.v1',
  PENDING_TRANSITION: 'time.pending-transition.v1',
  ACTIVITY_SESSION_OPENED: 'time.activity-session-opened.v1',
  ACTIVITY_SESSION_CLOSED: 'time.activity-session-closed.v1',
});

const definitions = Object.freeze([
  defineEventType({ id: TIME_EVENT_TYPES.CLOCK_ANCHOR, validatePayload: payload => Boolean(normalizeClockAnchor(payload.anchor) && Object.hasOwn(payload, 'priorChronologyEventId')) }),
  defineEventType({ id: TIME_EVENT_TYPES.CLOCK_RECONCILIATION, validatePayload: payload => {
    normalizeClockAnchor(payload.anchor);
    return Object.values(CLOCK_RECONCILIATION_OUTCOME).includes(payload.outcome) && typeof payload.reason === 'string' && Object.hasOwn(payload, 'priorChronologyEventId');
  } }),
  defineEventType({ id: TIME_EVENT_TYPES.TIME_ADVANCE, validatePayload: payload => Boolean(normalizeTimeAdvance(payload.advance) && Object.hasOwn(payload, 'priorChronologyEventId')) }),
  defineEventType({ id: TIME_EVENT_TYPES.BRANCH_FORK, validatePayload: payload => Boolean(payload && typeof payload.parentStoryId === 'string' && typeof payload.parentBranchId === 'string' && payload.clockSnapshot && Array.isArray(payload.pendingSnapshots) && Object.hasOwn(payload, 'priorChronologyEventId')) }),
  defineEventType({ id: TIME_EVENT_TYPES.PENDING_CREATED, validatePayload: payload => Boolean(normalizePendingCreate(payload.pending)) }),
  defineEventType({ id: TIME_EVENT_TYPES.PENDING_TRANSITION, validatePayload: payload => Boolean(normalizePendingTransition(payload.transition)) }),
  defineEventType({ id: TIME_EVENT_TYPES.ACTIVITY_SESSION_OPENED, validatePayload: payload => {
    const normalized = createActivitySession(payload.session);
    return payload?.session?.status === normalized.status && payload.session.id === normalized.id && payload.session.storyId === normalized.storyId && payload.session.branchId === normalized.branchId;
  } }),
  defineEventType({ id: TIME_EVENT_TYPES.ACTIVITY_SESSION_CLOSED, validatePayload: payload => Boolean(payload?.session?.status === 'closed' && normalizeTimeAdvance(payload.durationEvidence) && Object.hasOwn(payload, 'priorChronologyEventId')) }),
]);

export function createPhase4EventTypeRegistry(additional = []) {
  return new CanonicalEventTypeRegistry([...CORE_EVENT_TYPES, ...definitions, ...additional]);
}

export function isClockEventType(eventType) {
  return [TIME_EVENT_TYPES.CLOCK_ANCHOR, TIME_EVENT_TYPES.CLOCK_RECONCILIATION, TIME_EVENT_TYPES.TIME_ADVANCE, TIME_EVENT_TYPES.BRANCH_FORK, TIME_EVENT_TYPES.ACTIVITY_SESSION_CLOSED].includes(eventType);
}

// A domain Event may atomically carry measured duration evidence. The owning
// domain remains canonical; this is intentionally not a second time Event.
export function isClockEvidenceEvent(event) {
  return isClockEventType(event?.eventType) || Boolean(event?.payload?.storyClockAdvance);
}
