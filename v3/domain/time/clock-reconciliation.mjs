import { clockAuthorityRank, localAnchorScalar, normalizeClockAnchor } from './clock-anchor.mjs';

export const CLOCK_RECONCILIATION_OUTCOME = Object.freeze({
  ACCEPTED: 'accepted',
  ACCEPTED_CORRECTION: 'accepted-correction',
  CONFLICT_PRESERVE: 'conflict-preserve',
  CONFLICT_PAUSE: 'conflict-pause',
});

export function reconcileClockAnchor(currentClock, proposal) {
  const anchor = normalizeClockAnchor(proposal);
  if (!currentClock?.activeAnchorEventId) return Object.freeze({ kind: 'anchor', outcome: CLOCK_RECONCILIATION_OUTCOME.ACCEPTED, anchor, priorAnchorEventId: null, reason: 'first-explicit-anchor', pausesExactTime: false });
  const currentAnchor = {
    localDate: currentClock.displayLocalDate,
    localTime: currentClock.displayLocalTime,
    precision: currentClock.precision,
    authority: currentClock.activeAnchorAuthority,
  };
  const proposedScalar = localAnchorScalar(anchor);
  const currentScalar = localAnchorScalar(currentAnchor);
  const incomingRank = clockAuthorityRank(anchor.authority);
  const activeRank = clockAuthorityRank(currentClock.activeAnchorAuthority);
  const comparable = proposedScalar !== null && currentScalar !== null && Boolean(anchor.localDate) === Boolean(currentAnchor.localDate);
  if (comparable && proposedScalar >= currentScalar) {
    return Object.freeze({ kind: 'anchor', outcome: CLOCK_RECONCILIATION_OUTCOME.ACCEPTED, anchor, priorAnchorEventId: currentClock.activeAnchorEventId, reason: 'compatible-forward-anchor', pausesExactTime: false });
  }
  if (incomingRank > activeRank) {
    return Object.freeze({ kind: 'reconciliation', outcome: CLOCK_RECONCILIATION_OUTCOME.ACCEPTED_CORRECTION, anchor, priorAnchorEventId: currentClock.activeAnchorEventId, reason: comparable ? 'higher-authority-backward-correction' : 'higher-authority-precision-correction', pausesExactTime: false });
  }
  if (incomingRank === activeRank) {
    return Object.freeze({ kind: 'reconciliation', outcome: CLOCK_RECONCILIATION_OUTCOME.CONFLICT_PAUSE, anchor, priorAnchorEventId: currentClock.activeAnchorEventId, reason: comparable ? 'equal-authority-backward-conflict' : 'equal-authority-incomparable-conflict', pausesExactTime: true });
  }
  return Object.freeze({ kind: 'reconciliation', outcome: CLOCK_RECONCILIATION_OUTCOME.CONFLICT_PRESERVE, anchor, priorAnchorEventId: currentClock.activeAnchorEventId, reason: comparable ? 'lower-authority-backward-conflict' : 'lower-authority-incomparable-conflict', pausesExactTime: false });
}
