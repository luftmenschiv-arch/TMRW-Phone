import { V3ChronologyError } from '../../storage/errors.mjs';
import { optionalText, requireText } from '../identity/identity-record.mjs';

export const TIME_ADVANCE_BASIS = Object.freeze({
  EXPLICIT_RELATIVE: 'explicit-relative',
  CALL_MEASURED: 'call-measured',
  MESSAGE_SESSION_ESTIMATE: 'message-session-estimate',
  DIRECTOR: 'director',
});

export const TIME_ADVANCE_CONFIDENCE = Object.freeze({
  EXPLICIT: 'explicit',
  MEASURED: 'measured',
  ESTIMATED: 'estimated',
});

export const TIME_ADVANCE_RANK = Object.freeze({
  [TIME_ADVANCE_BASIS.DIRECTOR]: 600,
  [TIME_ADVANCE_BASIS.EXPLICIT_RELATIVE]: 500,
  [TIME_ADVANCE_BASIS.CALL_MEASURED]: 400,
  [TIME_ADVANCE_BASIS.MESSAGE_SESSION_ESTIMATE]: 100,
});

export function normalizeTimeAdvance(input) {
  const durationMs = Number(input?.durationMs);
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) throw new V3ChronologyError('Time Advance durationMs must be a non-negative safe integer');
  const basis = requireText(input?.basis, 'advance.basis');
  if (!TIME_ADVANCE_RANK[basis]) throw new V3ChronologyError(`Unsupported Time Advance basis: ${basis}`);
  const confidence = requireText(input?.confidence, 'advance.confidence');
  if (!Object.values(TIME_ADVANCE_CONFIDENCE).includes(confidence)) throw new V3ChronologyError(`Unsupported Time Advance confidence: ${confidence}`);
  const sourceActivityId = requireText(input?.sourceActivityId, 'advance.sourceActivityId');
  return Object.freeze({
    durationMs,
    basis,
    confidence,
    sourceActivityId,
    policyVersion: optionalText(input?.policyVersion, 'advance.policyVersion'),
    explanation: optionalText(input?.explanation, 'advance.explanation'),
  });
}

export function timeAdvanceRank(advance) {
  return TIME_ADVANCE_RANK[advance?.basis] || 0;
}
