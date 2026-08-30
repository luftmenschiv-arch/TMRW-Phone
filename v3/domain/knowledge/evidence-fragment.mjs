import { V3KnowledgeError } from '../../storage/errors.mjs';
import { requireText } from '../identity/identity-record.mjs';
import { requestDigest } from '../events/idempotency.mjs';

export const EVIDENCE_FRAGMENT_KIND = Object.freeze({
  CLAIM_SUMMARY: 'claim-summary',
  MESSAGE_TEXT: 'message-text',
  SCREENSHOT_REGION: 'screenshot-region',
  TRANSCRIPT_SEGMENT: 'transcript-segment',
  EVENT_FIELD: 'event-field',
  DEVICE_ITEM: 'device-item',
  PENDING_AWARENESS: 'pending-awareness',
});

const kinds = new Set(Object.values(EVIDENCE_FRAGMENT_KIND));

export function normalizeEvidenceFragment(input) {
  const fragmentId = requireText(input?.fragmentId, 'fragment.fragmentId');
  const claimId = requireText(input?.claimId, 'fragment.claimId');
  const kind = requireText(input?.kind, 'fragment.kind');
  if (!kinds.has(kind)) throw new V3KnowledgeError(`Unsupported fragment.kind: ${kind}`);
  const safeText = requireText(input?.safeText, 'fragment.safeText');
  if (safeText.length > 4000) throw new V3KnowledgeError('fragment.safeText exceeds 4000 characters');
  const contentDigest = requireText(input?.contentDigest, 'fragment.contentDigest');
  return Object.freeze({
    fragmentId,
    claimId,
    kind,
    safeText,
    contentDigest,
    sourceField: input?.sourceField == null ? null : requireText(input.sourceField, 'fragment.sourceField'),
    sourceEventId: input?.sourceEventId == null ? null : requireText(input.sourceEventId, 'fragment.sourceEventId'),
  });
}

export async function prepareEvidenceFragment(input) {
  const contentDigest = input?.contentDigest || await requestDigest({ kind: input?.kind, safeText: input?.safeText, sourceField: input?.sourceField ?? null });
  return normalizeEvidenceFragment({ ...input, contentDigest });
}
