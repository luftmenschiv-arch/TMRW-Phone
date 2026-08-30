import { defineEventType } from '../events/event-types.mjs';
import { createPhase6EventTypeRegistry } from '../phone/phone-event-types.mjs';
import { normalizeKnowledgeDisclosurePayload } from '../knowledge/knowledge-event-types.mjs';
import { normalizeMembershipSnapshot } from './membership.mjs';
import { normalizeMessage } from './message.mjs';
import { normalizeDraft, normalizeReaction, normalizeStickerOwnership, normalizeUnsend } from './message-extras.mjs';
import { normalizeThread } from './thread.mjs';

export const MESSAGING_EVENT_TYPES = Object.freeze({
  THREAD_CREATED: 'messaging.thread-created.v1',
  MEMBERSHIP_SNAPSHOT: 'messaging.membership-snapshot.v1',
  MESSAGE_SENT: 'messaging.message-sent.v1',
  DRAFT_STATE: 'messaging.draft-state.v1',
  MESSAGE_UNSENT: 'messaging.message-unsent.v1',
  REACTION_STATE: 'messaging.reaction-state.v1',
  STICKER_OWNERSHIP_STATE: 'messaging.sticker-ownership-state.v1',
});

export function normalizeThreadCreatedPayload(input) {
  const thread = normalizeThread(input?.thread);
  const initialMembership = normalizeMembershipSnapshot(input?.initialMembership);
  if (initialMembership.threadId !== thread.threadId) throw new TypeError('Initial membership snapshot must belong to its Thread');
  const accountIds = initialMembership.members.map(member => member.accountId).sort();
  if (JSON.stringify(accountIds) !== JSON.stringify([...thread.participantAccountIds].sort())) throw new TypeError('Initial membership must match Thread participants');
  return Object.freeze({ thread, initialMembership });
}

export function normalizeDraftStatePayload(input) { return Object.freeze({ draft: normalizeDraft(input?.draft) }); }
export function normalizeMessageUnsentPayload(input) { return Object.freeze({ unsend: normalizeUnsend(input?.unsend) }); }
export function normalizeReactionStatePayload(input) { return Object.freeze({ reaction: normalizeReaction(input?.reaction) }); }
export function normalizeStickerOwnershipPayload(input) { return Object.freeze({ ownership: normalizeStickerOwnership(input?.ownership) }); }

export function normalizeMembershipSnapshotPayload(input) {
  return Object.freeze({ snapshot: normalizeMembershipSnapshot(input?.snapshot) });
}

export function normalizeMessageSentPayload(input) {
  const message = normalizeMessage(input?.message);
  const recipientAccountIds = Object.freeze([...new Set((input?.recipientAccountIds || []).map((value, index) => String(value || '').trim() ? String(value).trim() : (() => { throw new TypeError(`recipientAccountIds[${index}] is required`); })()))].sort());
  if (recipientAccountIds.length < 2) throw new TypeError('A Message requires two or more recipient account identities');
  return Object.freeze({
    message,
    recipientAccountIds,
    knowledgeDisclosures: normalizeKnowledgeDisclosurePayload({ disclosures: input?.knowledgeDisclosures }).disclosures,
  });
}

const definitions = Object.freeze([
  defineEventType({ id: MESSAGING_EVENT_TYPES.THREAD_CREATED, description: 'Canonical DM or group Thread with an immutable initial membership snapshot.', validatePayload: payload => Boolean(normalizeThreadCreatedPayload(payload)) }),
  defineEventType({ id: MESSAGING_EVENT_TYPES.MEMBERSHIP_SNAPSHOT, description: 'Canonical group membership snapshot used to scope later Messages.', validatePayload: payload => Boolean(normalizeMembershipSnapshotPayload(payload)) }),
  defineEventType({ id: MESSAGING_EVENT_TYPES.MESSAGE_SENT, description: 'Canonical text Message with participant-scoped disclosure evidence.', validatePayload: payload => Boolean(normalizeMessageSentPayload(payload)) }),
  defineEventType({ id: MESSAGING_EVENT_TYPES.DRAFT_STATE, description: 'Canonical private draft state; it grants no recipient Knowledge.', validatePayload: payload => Boolean(normalizeDraftStatePayload(payload)) }),
  defineEventType({ id: MESSAGING_EVENT_TYPES.MESSAGE_UNSENT, description: 'Ordinary unsend visibility event that preserves prior witness evidence.', validatePayload: payload => Boolean(normalizeMessageUnsentPayload(payload)) }),
  defineEventType({ id: MESSAGING_EVENT_TYPES.REACTION_STATE, description: 'Revisioned add/change/remove state for one Message reaction.', validatePayload: payload => Boolean(normalizeReactionStatePayload(payload)) }),
  defineEventType({ id: MESSAGING_EVENT_TYPES.STICKER_OWNERSHIP_STATE, description: 'Actor/Instance/Account-scoped base Sticker ownership state.', validatePayload: payload => Boolean(normalizeStickerOwnershipPayload(payload)) }),
]);

export function createPhase8EventTypeRegistry(additional = []) {
  return createPhase6EventTypeRegistry([...definitions, ...additional]);
}
