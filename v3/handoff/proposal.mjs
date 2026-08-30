import { canonicalJson } from '../domain/events/idempotency.mjs';
import { requireText } from '../domain/identity/identity-record.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';

export const HANDOFF_ACTION_KIND = Object.freeze({ DM_SEND: 'dm.send', GROUP_SEND: 'group.send', CALL_INITIATE: 'call.initiate', CALL_TRANSITION: 'call.transition', CALL_TRANSCRIPT: 'call.transcript', NUMBER_EVIDENCE: 'contact.number-evidence', CONTACT_CARD: 'contact.card-evidence', CALENDAR_AGREEMENT: 'calendar.agreement-evidence' });
export const HANDOFF_PROPOSAL_STATUS = Object.freeze({ READY: 'ready', NEEDS_CONFIRMATION: 'needs-confirmation', IGNORED: 'ignored', ACCEPTED: 'accepted', RETRACTED: 'retracted', UNSUPPORTED: 'unsupported-canonical-domain' });
const digest = async value => { const bytes = new TextEncoder().encode(canonicalJson(value)); const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''); };

export async function createHandoffProposal({ scope: inputScope, source, actionKey, actionKind, status, candidate, reason = null }) {
  const scope = requireEventScope(inputScope); const key = requireText(actionKey, 'handoff.actionKey'); const kind = requireText(actionKind, 'handoff.actionKind');
  if (!Object.values(HANDOFF_ACTION_KIND).includes(kind)) throw new TypeError(`Unsupported Phase 10 handoff action: ${kind}`);
  if (!Object.values(HANDOFF_PROPOSAL_STATUS).includes(status)) throw new TypeError(`Unsupported handoff proposal status: ${status}`);
  const proposalId = `handoff-proposal:${(await digest({ scope, sourceAuthority: source.sourceAuthority, sourceMessageId: source.sourceMessageId, actionKey: key })).slice(0, 40)}`;
  return Object.freeze({ proposalId, storyId: scope.storyId, branchId: scope.branchId, sourceAuthority: source.sourceAuthority, sourceMessageId: source.sourceMessageId, sourceVersionId: source.sourceVersionId, sourceOrdinal: source.sourceOrdinal, changeKind: source.changeKind, actionKey: key, actionKind: kind, status, candidate: Object.freeze(structuredClone(candidate || {})), reason: reason == null ? null : String(reason), sourceContentDigest: await digest({ text: source.text, version: source.sourceVersionId }), phase: 10 });
}

export function normalizeHandoffMetadata(input) {
  const direction = requireText(input?.direction, 'handoff.direction');
  if (direction !== 'main-rp-to-phone') throw new TypeError(`Unsupported handoff direction: ${direction}`);
  const actionKind = requireText(input?.actionKind, 'handoff.actionKind');
  if (!Object.values(HANDOFF_ACTION_KIND).includes(actionKind)) throw new TypeError(`Unsupported handoff action: ${actionKind}`);
  const sourceOrdinal = Number(input?.sourceOrdinal);
  if (!Number.isSafeInteger(sourceOrdinal) || sourceOrdinal < 0) throw new TypeError('handoff.sourceOrdinal must be a non-negative safe integer');
  return Object.freeze({
    proposalId: requireText(input?.proposalId, 'handoff.proposalId'), direction,
    sourceAuthority: requireText(input?.sourceAuthority, 'handoff.sourceAuthority'),
    sourceMessageId: requireText(input?.sourceMessageId, 'handoff.sourceMessageId'),
    sourceVersionId: requireText(input?.sourceVersionId, 'handoff.sourceVersionId'), sourceOrdinal,
    actionKey: requireText(input?.actionKey, 'handoff.actionKey'), actionKind,
    sourceContentDigest: requireText(input?.sourceContentDigest, 'handoff.sourceContentDigest'),
  });
}

export function handoffMetadata(proposal) { return normalizeHandoffMetadata({ ...proposal, direction: 'main-rp-to-phone' }); }
