import { V3ChronologyError } from '../../storage/errors.mjs';
import { TIME_ADVANCE_BASIS, TIME_ADVANCE_CONFIDENCE } from './time-advance.mjs';

export const MESSAGE_SESSION_DURATION_POLICY_V1 = Object.freeze({
  id: 'message-session-v1',
  maximumMs: 10 * 60_000,
  estimate({ turnCount, contentCharacters }) {
    if (!Number.isInteger(turnCount) || turnCount < 0) throw new V3ChronologyError('turnCount must be a non-negative integer');
    if (!Number.isInteger(contentCharacters) || contentCharacters < 0) throw new V3ChronologyError('contentCharacters must be a non-negative integer');
    if (turnCount === 0) return 0;
    const conversationalSeconds = (turnCount * 3) + Math.ceil(contentCharacters / 24);
    return Math.min(this.maximumMs, Math.max(1_000, conversationalSeconds * 1_000));
  },
});

export function estimateActivitySessionDuration(session, policy = MESSAGE_SESSION_DURATION_POLICY_V1) {
  if (session?.interactionType !== 'message') return null;
  const durationMs = policy.estimate({ turnCount: session.turnCount, contentCharacters: session.contentCharacters });
  return Object.freeze({
    durationMs,
    basis: TIME_ADVANCE_BASIS.MESSAGE_SESSION_ESTIMATE,
    confidence: TIME_ADVANCE_CONFIDENCE.ESTIMATED,
    sourceActivityId: session.id,
    policyVersion: policy.id,
    explanation: `One bounded estimate for ${session.turnCount} message turns; no per-message duration rule.`,
  });
}
