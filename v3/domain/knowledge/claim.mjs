import { V3KnowledgeError } from '../../storage/errors.mjs';
import { requireText } from '../identity/identity-record.mjs';

export const CLAIM_CERTAINTY = Object.freeze({
  CONFIRMED: 'confirmed',
  REPORTED: 'reported',
  UNCERTAIN: 'uncertain',
  DISPUTED: 'disputed',
});

export const CLAIM_CURRENTNESS = Object.freeze({
  CURRENT: 'current',
  HISTORICAL: 'historical',
  UNCERTAIN: 'uncertain',
  INVALIDATED: 'invalidated',
});

const SUBJECT_KINDS = new Set(['event', 'fact', 'actor', 'character-instance', 'device', 'account', 'pending-world-event']);

function member(value, allowed, field) {
  const text = requireText(value, field);
  if (!allowed.has(text)) throw new V3KnowledgeError(`Unsupported ${field}: ${text}`);
  return text;
}

export function normalizeKnowledgeClaim(input) {
  const claimId = requireText(input?.claimId, 'claim.claimId');
  const claimType = requireText(input?.claimType, 'claim.claimType');
  const subjectKind = member(input?.subject?.kind, SUBJECT_KINDS, 'claim.subject.kind');
  const subjectId = requireText(input?.subject?.id, 'claim.subject.id');
  const safeSummary = requireText(input?.safeSummary, 'claim.safeSummary');
  if (safeSummary.length > 1000) throw new V3KnowledgeError('claim.safeSummary exceeds 1000 characters');
  const certainty = member(input?.certainty || CLAIM_CERTAINTY.CONFIRMED, new Set(Object.values(CLAIM_CERTAINTY)), 'claim.certainty');
  const currentness = member(input?.currentness || CLAIM_CURRENTNESS.CURRENT, new Set(Object.values(CLAIM_CURRENTNESS)), 'claim.currentness');
  return Object.freeze({ claimId, claimType, subject: Object.freeze({ kind: subjectKind, id: subjectId }), safeSummary, certainty, currentness });
}
