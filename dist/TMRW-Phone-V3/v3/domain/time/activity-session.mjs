import { V3ChronologyError } from '../../storage/errors.mjs';
import { requireEventScope } from '../events/event-validator.mjs';
import { requireText } from '../identity/identity-record.mjs';
import { estimateActivitySessionDuration } from './duration-policy.mjs';

const BOUNDARIES = Object.freeze(new Set(['thread-switch', 'phone-close', 'call-start', 'main-rp-handoff', 'explicit-time-change']));

export function createActivitySession({ id, scope, storyId = null, branchId = null, interactionType = 'message', startedOrdinal, turnCount = 0, contentCharacters = 0 }) {
  const normalizedScope = requireEventScope(scope || { storyId, branchId });
  if (!Number.isInteger(startedOrdinal) || startedOrdinal < 0) throw new V3ChronologyError('startedOrdinal must be a non-negative integer');
  if (!Number.isInteger(turnCount) || turnCount < 0 || !Number.isInteger(contentCharacters) || contentCharacters < 0) throw new V3ChronologyError('Activity counters must be non-negative integers');
  return Object.freeze({
    id: requireText(id, 'activitySession.id'),
    ...normalizedScope,
    interactionType: requireText(interactionType, 'activitySession.interactionType'),
    startedOrdinal,
    turnCount,
    contentCharacters,
    status: 'open',
    phase: 4,
  });
}

export function closeActivitySession(session, { boundary, closedOrdinal, policy } = {}) {
  if (session?.status !== 'open') throw new V3ChronologyError('Only an open Activity Session can close');
  if (!BOUNDARIES.has(boundary)) throw new V3ChronologyError(`Unsupported event-driven Activity Session boundary: ${boundary}`);
  if (!Number.isInteger(closedOrdinal) || closedOrdinal < session.startedOrdinal) throw new V3ChronologyError('closedOrdinal must not precede the session');
  return Object.freeze({
    session: Object.freeze({ ...session, status: 'closed', boundary, closedOrdinal }),
    durationEvidence: estimateActivitySessionDuration(session, policy),
  });
}

export const ACTIVITY_SESSION_BOUNDARIES = BOUNDARIES;
