import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { requireEventScope } from '../events/event-validator.mjs';
import { canonicalJson } from '../events/idempotency.mjs';
import { prepareDisclosureBundle } from '../knowledge/knowledge-service.mjs';
import { AUDIENCE_KIND } from '../knowledge/audience-policy.mjs';
import { EVIDENCE_BASIS } from '../knowledge/disclosure-observation.mjs';
import { EVIDENCE_FRAGMENT_KIND } from '../knowledge/evidence-fragment.mjs';
import { MESSAGING_EVENT_TYPES } from './messaging-event-types.mjs';
import { membershipHeadId, normalizeMembershipSnapshot } from './membership.mjs';
import { messageHeadId, normalizeMessage } from './message.mjs';
import { MESSAGE_CONTENT_KIND, REACTION_ACTION, draftHeadId, normalizeDraft, normalizeReaction, normalizeStickerOwnership, normalizeUnsend, reactionHeadId, stickerOwnershipHeadId } from './message-extras.mjs';
import { THREAD_KIND, normalizeThread, threadHeadId } from './thread.mjs';

const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;
const digest = async value => {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};
const stableId = async (kind, scope, value) => `${kind}:${(await digest({ kind, scope, value })).slice(0, 40)}`;

function uniqueReferences(references) {
  const seen = new Set();
  return Object.freeze(references.filter(Boolean).filter(row => {
    const key = `${row.entityType}:${row.id}:${row.role}`;
    if (seen.has(key)) return false; seen.add(key); return true;
  }));
}

function sourceRecordKey(source, field) {
  if (!source?.authority || !source?.recordId) throw new TypeError(`${field} requires stable source.authority and source.recordId`);
  return `${source.authority}:${source.recordId}`;
}

export class MessageService {
  #unitOfWork; #events; #metrics = Object.freeze({ operation: 'none' });
  constructor({ database, eventEngine }) {
    if (!database || !eventEngine) throw new TypeError('MessageService requires the isolated v3 database and canonical Event engine');
    this.#unitOfWork = new V3UnitOfWork(database); this.#events = eventEngine;
  }
  get lastOperationMetrics() { return structuredClone(this.#metrics); }

  async #eventForProjectionGroup(scope, groupKey) {
    const rows = await this.#unitOfWork.readonly({ stores: ['projections'], scope }, repositories => repositories.projections.listByIndexRange('by_scope_projector_group_sequence', { lower: [scope.storyId, scope.branchId, 'tmrw-messaging-v1', groupKey, 0], upper: [scope.storyId, scope.branchId, 'tmrw-messaging-v1', groupKey, MAX_SEQUENCE] }));
    const row = rows.sort((a, b) => a.sourceEventSequence - b.sourceEventSequence || a.id.localeCompare(b.id)).at(-1);
    return row ? this.#events.getEvent(scope, row.sourceEventId) : null;
  }

  async #membersForAccounts(scope, accountIds) {
    return this.#unitOfWork.readonly({ stores: ['accounts', 'instances', 'actors'], scope }, async repositories => {
      const members = [];
      for (const accountId of [...new Set(accountIds)].sort()) {
        const account = await repositories.accounts.get(accountId); if (!account) throw new Error(`Unknown scoped Account: ${accountId}`);
        const instance = await repositories.instances.get(account.ownerInstanceId); const actor = instance && await repositories.actors.get(instance.actorId);
        if (!instance || !actor || instance.actorId !== actor.id) throw new Error('Account owner identity chain is incomplete');
        members.push(Object.freeze({ accountId: account.id, actorId: actor.id, instanceId: instance.id }));
      }
      return Object.freeze(members);
    });
  }

  async createThread({ scope: inputScope, kind, participantAccountIds, threadKey = null, sourceMode = 'live', source, producer = 'message-service', idempotencyKey = null }) {
    const scope = requireEventScope(inputScope); const members = await this.#membersForAccounts(scope, participantAccountIds);
    const normalizedKind = String(kind);
    const stableKey = threadKey || (normalizedKind === THREAD_KIND.DM ? `dm:${members.map(member => member.accountId).sort().join(':')}` : sourceRecordKey(source, 'group Thread'));
    const threadId = await stableId('thread', scope, { kind: normalizedKind, stableKey, accounts: members.map(member => member.accountId).sort() });
    const existing = await this.#unitOfWork.readonly({ stores: ['threads'], scope }, repositories => repositories.threads.get(threadHeadId(scope, threadId)));
    if (existing) {
      const requestedAccounts = members.map(member => member.accountId).sort();
      if (existing.kind !== normalizedKind || canonicalJson(existing.participantAccountIds) !== canonicalJson(requestedAccounts)) throw new Error('Stable Thread identity conflicts with different canonical participants');
      this.#metrics = Object.freeze({ operation: 'thread-replay', directReads: 1, eventHistoryScans: 0 });
      return Object.freeze({ thread: existing, replayed: true });
    }
    const thread = normalizeThread({ threadId, kind: normalizedKind, participantAccountIds: members.map(member => member.accountId), participantActorIds: members.map(member => member.actorId), participantInstanceIds: members.map(member => member.instanceId), sourceMode });
    const snapshotId = await stableId('membership', scope, { threadId, stableKey: `${stableKey}:initial`, members });
    const initialMembership = normalizeMembershipSnapshot({ snapshotId, threadId, members });
    const references = uniqueReferences(members.flatMap(member => [
      { entityType: 'account', id: member.accountId, role: 'thread-participant-account' },
      { entityType: 'actor', id: member.actorId, role: 'thread-participant-actor' },
      { entityType: 'character-instance', id: member.instanceId, role: 'thread-participant-instance' },
    ]));
    const result = await this.#events.append({ scope, eventType: MESSAGING_EVENT_TYPES.THREAD_CREATED, payload: { thread, initialMembership }, references, source, producer, idempotencyKey: idempotencyKey || `thread:${threadId}` });
    this.#metrics = Object.freeze({ operation: 'create-thread', ...this.#events.lastOperationMetrics });
    const head = await this.#unitOfWork.readonly({ stores: ['threads'], scope }, repositories => repositories.threads.get(threadHeadId(scope, threadId)));
    return Object.freeze({ thread: head, event: result.event, replayed: result.replayed });
  }

  async createMembershipSnapshot({ scope: inputScope, threadId, memberAccountIds, source, producer = 'message-service', idempotencyKey = null }) {
    const scope = requireEventScope(inputScope); const thread = await this.getThread({ scope, threadId });
    if (!thread) throw new Error('Unknown scoped Thread'); if (thread.kind !== THREAD_KIND.GROUP) throw new Error('Membership changes are only available for canonical group Threads');
    const members = await this.#membersForAccounts(scope, memberAccountIds);
    const snapshotId = await stableId('membership', scope, { threadId, source: sourceRecordKey(source, 'membership snapshot'), members });
    const snapshot = normalizeMembershipSnapshot({ snapshotId, threadId, members });
    const references = uniqueReferences(members.flatMap(member => [
      { entityType: 'account', id: member.accountId, role: 'membership-account' }, { entityType: 'actor', id: member.actorId, role: 'membership-actor' }, { entityType: 'character-instance', id: member.instanceId, role: 'membership-instance' },
    ]));
    const result = await this.#events.append({ scope, eventType: MESSAGING_EVENT_TYPES.MEMBERSHIP_SNAPSHOT, payload: { snapshot }, references, source, producer, idempotencyKey: idempotencyKey || `membership:${snapshotId}` });
    this.#metrics = Object.freeze({ operation: 'membership-snapshot', ...this.#events.lastOperationMetrics });
    return Object.freeze({ snapshot: await this.getMembershipSnapshot({ scope, snapshotId }), event: result.event, replayed: result.replayed });
  }

  async sendMessage({ scope: inputScope, threadId, membershipSnapshotId = null, senderAccountId, actualAuthorActorId, actualAuthorInstanceId, deviceId, text = '', contentKind = MESSAGE_CONTENT_KIND.TEXT, sticker = null, sourceMode = 'live', handoff = null, aiJobCommit = null, causeEventIds = [], source, producer = 'message-service', idempotencyKey = null }) {
    const scope = requireEventScope(inputScope); const thread = await this.getThread({ scope, threadId }); if (!thread) throw new Error('Unknown scoped Thread');
    const snapshot = membershipSnapshotId ? await this.getMembershipSnapshot({ scope, snapshotId: membershipSnapshotId }) : await this.getLatestMembershipSnapshot({ scope, threadId });
    if (!snapshot || snapshot.threadId !== threadId) throw new Error('A scoped membership snapshot is required before sending a Message');
    const members = snapshot.members; const sender = members.find(member => member.accountId === senderAccountId); if (!sender) throw new Error('Sender Account is outside the membership snapshot');
    const chains = await this.#unitOfWork.readonly({ stores: ['actors', 'instances', 'devices'], scope }, async repositories => ({ actor: await repositories.actors.get(actualAuthorActorId), instance: await repositories.instances.get(actualAuthorInstanceId), device: await repositories.devices.get(deviceId) }));
    if (!chains.actor || !chains.instance || chains.instance.actorId !== chains.actor.id || !chains.device) throw new Error('Actual Author or Device identity is invalid in this Story/Branch');
    const messageId = await stableId('message', scope, { source: sourceRecordKey(source, 'Message'), senderAccountId });
    const message = normalizeMessage({ messageId, threadId, membershipSnapshotId: snapshot.snapshotId, senderAccountId, actualAuthorActorId, actualAuthorInstanceId, deviceId, text, contentKind, sticker, sourceMode });
    const audienceKind = thread.kind === THREAD_KIND.DM ? AUDIENCE_KIND.PRIVATE_EXPLICIT : AUDIENCE_KIND.GROUP_SNAPSHOT;
    const bundle = await prepareDisclosureBundle({ scope, stableKey: `message:${messageId}`, bundle: {
      claim: { claimType: message.contentKind === MESSAGE_CONTENT_KIND.STICKER ? 'messaging.sticker-content.v1' : 'messaging.message-content.v1', subject: { kind: 'event', id: messageId }, safeSummary: message.contentKind === MESSAGE_CONTENT_KIND.STICKER ? `[Sticker: ${message.sticker.label || message.sticker.stickerAssetId}]` : message.text, certainty: 'confirmed', currentness: 'current' },
      audience: { kind: audienceKind, actorIds: members.map(member => member.actorId), instanceIds: members.map(member => member.instanceId), membershipSnapshotId: thread.kind === THREAD_KIND.GROUP ? snapshot.snapshotId : null },
      fragments: [{ key: 'body', kind: EVIDENCE_FRAGMENT_KIND.MESSAGE_TEXT, safeText: message.contentKind === MESSAGE_CONTENT_KIND.STICKER ? `[Sticker: ${message.sticker.label || message.sticker.stickerAssetId}]` : message.text, sourceField: message.contentKind === MESSAGE_CONTENT_KIND.STICKER ? 'sticker' : 'text' }],
      observations: members.map(member => ({ fragmentKeys: ['body'], targetActorId: member.actorId, targetInstanceId: member.instanceId, confidence: 'confirmed', evidence: { basis: member.accountId === senderAccountId ? EVIDENCE_BASIS.DIRECT_PARTICIPANT : (thread.kind === THREAD_KIND.GROUP ? EVIDENCE_BASIS.GROUP_MEMBER : EVIDENCE_BASIS.EXPLICIT_RECIPIENT), sourceEventId: null, sourceActorId: chains.actor.id, sourceDeviceId: chains.device.id, sourceAccountId: senderAccountId, provenanceAuthority: source.authority, provenanceRecordId: `${source.recordId}:knowledge:${member.accountId}` } })),
    } });
    const references = uniqueReferences([
      { entityType: 'account', id: senderAccountId, role: 'sender-account' }, { entityType: 'actor', id: chains.actor.id, role: 'actual-author-actor' }, { entityType: 'character-instance', id: chains.instance.id, role: 'actual-author-instance' }, { entityType: 'device', id: chains.device.id, role: 'used-device' },
      ...members.flatMap(member => [{ entityType: 'account', id: member.accountId, role: 'message-audience-account' }, { entityType: 'actor', id: member.actorId, role: 'message-audience-actor' }, { entityType: 'character-instance', id: member.instanceId, role: 'message-audience-instance' }]),
    ]);
    const result = await this.#events.append({ scope, eventType: MESSAGING_EVENT_TYPES.MESSAGE_SENT, payload: { message, recipientAccountIds: members.map(member => member.accountId), knowledgeDisclosures: [bundle], ...(handoff ? { handoff: structuredClone(handoff) } : {}), ...(aiJobCommit ? { aiJobCommit: structuredClone(aiJobCommit) } : {}) }, references, causes: [...new Set([...(causeEventIds || []), aiJobCommit?.sourceEventId].filter(Boolean))], source, producer, idempotencyKey: idempotencyKey || `message:${messageId}` });
    this.#metrics = Object.freeze({ operation: 'send-message', ...this.#events.lastOperationMetrics });
    return Object.freeze({ message: await this.getMessage({ scope, messageId }), event: result.event, replayed: result.replayed });
  }

  async saveDraft({ scope: inputScope, threadId, ownerAccountId, actualAuthorActorId, actualAuthorInstanceId, deviceId, text, source, producer = 'message-service', idempotencyKey }) {
    const scope = requireEventScope(inputScope); const thread = await this.getThread({ scope, threadId }); if (!thread) throw new Error('Unknown scoped Thread');
    const snapshot = await this.getLatestMembershipSnapshot({ scope, threadId }); if (!snapshot?.members.some(member => member.accountId === ownerAccountId)) throw new Error('Draft owner is outside the Thread membership');
    const draftId = await stableId('draft', scope, { threadId, ownerAccountId }); const draft = normalizeDraft({ draftId, threadId, ownerAccountId, actualAuthorActorId, actualAuthorInstanceId, deviceId, text: String(text || '') });
    const chain = await this.#unitOfWork.readonly({ stores: ['accounts', 'actors', 'instances', 'devices'], scope }, async repositories => ({ account: await repositories.accounts.get(ownerAccountId), actor: await repositories.actors.get(actualAuthorActorId), instance: await repositories.instances.get(actualAuthorInstanceId), device: await repositories.devices.get(deviceId) }));
    if (!chain.account || !chain.actor || !chain.instance || chain.instance.actorId !== chain.actor.id || !chain.device) throw new Error('Draft identity chain is invalid');
    const existing = await this.#eventForProjectionGroup(scope, `draft:${draftId}`);
    const payload = { draft }; let result;
    if (existing && canonicalJson(existing.payload) === canonicalJson(payload)) result = { event: existing, replayed: true };
    else if (existing) { result = await this.#events.revise({ scope, eventId: existing.id, expectedRevision: existing.revision, payload, producer, idempotencyKey, reason: 'Draft state update' }); }
    else result = await this.#events.append({ scope, eventType: MESSAGING_EVENT_TYPES.DRAFT_STATE, payload, references: uniqueReferences([{ entityType: 'account', id: ownerAccountId, role: 'draft-owner-account' }, { entityType: 'actor', id: actualAuthorActorId, role: 'draft-author-actor' }, { entityType: 'character-instance', id: actualAuthorInstanceId, role: 'draft-author-instance' }, { entityType: 'device', id: deviceId, role: 'draft-device' }]), source, producer, idempotencyKey });
    return Object.freeze({ draft: await this.getDraft({ scope, ownerAccountId, threadId }), event: result.event, replayed: result.replayed });
  }

  async unsendMessage({ scope: inputScope, messageId, accountId, actorId, instanceId, deviceId, source, producer = 'message-service', idempotencyKey, reason = 'unsent' }) {
    const scope = requireEventScope(inputScope); const head = await this.getMessage({ scope, messageId }); if (!head) throw new Error('Unknown scoped Message'); if (head.senderAccountId !== accountId) throw new Error('Only the apparent sender Account may unsend this Message');
    const snapshot = await this.getMembershipSnapshot({ scope, snapshotId: head.membershipSnapshotId }); if (!snapshot) throw new Error('Message membership snapshot is missing');
    const unsend = normalizeUnsend({ messageId, threadId: head.threadId, actorId, instanceId, accountId, deviceId, recipientAccountIds: snapshot.members.map(member => member.accountId), reason });
    const result = await this.#events.append({ scope, eventType: MESSAGING_EVENT_TYPES.MESSAGE_UNSENT, payload: { unsend }, references: uniqueReferences([{ entityType: 'account', id: accountId, role: 'unsend-account' }, { entityType: 'actor', id: actorId, role: 'unsend-actor' }, { entityType: 'character-instance', id: instanceId, role: 'unsend-instance' }, { entityType: 'device', id: deviceId, role: 'unsend-device' }]), causes: [head.sourceEventId], source, producer, idempotencyKey });
    return Object.freeze({ message: await this.getMessage({ scope, messageId }), event: result.event, replayed: result.replayed });
  }

  async setReaction({ scope: inputScope, messageId, reactorAccountId, actualActorId, actualInstanceId, deviceId, value = null, source, producer = 'message-service', idempotencyKey }) {
    const scope = requireEventScope(inputScope); const message = await this.getMessage({ scope, messageId }); if (!message) throw new Error('Unknown scoped Message'); const snapshot = await this.getMembershipSnapshot({ scope, snapshotId: message.membershipSnapshotId }); if (!snapshot?.members.some(member => member.accountId === reactorAccountId)) throw new Error('Reaction Actor is outside the Message audience');
    const reactionId = await stableId('reaction', scope, { messageId, reactorAccountId }); const reaction = normalizeReaction({ reactionId, messageId, threadId: message.threadId, reactorAccountId, actualActorId, actualInstanceId, deviceId, action: value == null ? REACTION_ACTION.REMOVE : REACTION_ACTION.SET, value }); const existing = await this.#eventForProjectionGroup(scope, `reaction:${reactionId}`); let result;
    if (existing && canonicalJson(existing.payload) === canonicalJson({ reaction })) result = { event: existing, replayed: true };
    else if (existing) { result = await this.#events.revise({ scope, eventId: existing.id, expectedRevision: existing.revision, payload: { reaction }, producer, idempotencyKey, reason: 'Reaction state change' }); }
    else result = await this.#events.append({ scope, eventType: MESSAGING_EVENT_TYPES.REACTION_STATE, payload: { reaction }, references: uniqueReferences([{ entityType: 'account', id: reactorAccountId, role: 'reaction-account' }, { entityType: 'actor', id: actualActorId, role: 'reaction-actor' }, { entityType: 'character-instance', id: actualInstanceId, role: 'reaction-instance' }, { entityType: 'device', id: deviceId, role: 'reaction-device' }]), causes: [message.sourceEventId], source, producer, idempotencyKey });
    return Object.freeze({ reaction: await this.getReaction({ scope, reactionId }), event: result.event, replayed: result.replayed });
  }

  async setStickerOwnership({ scope: inputScope, stickerAssetId, ownerAccountId, ownerActorId, ownerInstanceId, active = true, source, producer = 'message-service', idempotencyKey }) {
    const scope = requireEventScope(inputScope); const ownershipId = await stableId('sticker-ownership', scope, { stickerAssetId, ownerAccountId }); const ownership = normalizeStickerOwnership({ ownershipId, stickerAssetId, ownerAccountId, ownerActorId, ownerInstanceId, active }); const existing = await this.#eventForProjectionGroup(scope, `sticker-ownership:${ownershipId}`); let result;
    if (existing && canonicalJson(existing.payload) === canonicalJson({ ownership })) result = { event: existing, replayed: true };
    else if (existing) { result = await this.#events.revise({ scope, eventId: existing.id, expectedRevision: existing.revision, payload: { ownership }, producer, idempotencyKey, reason: 'Sticker ownership change' }); }
    else result = await this.#events.append({ scope, eventType: MESSAGING_EVENT_TYPES.STICKER_OWNERSHIP_STATE, payload: { ownership }, references: uniqueReferences([{ entityType: 'account', id: ownerAccountId, role: 'sticker-owner-account' }, { entityType: 'actor', id: ownerActorId, role: 'sticker-owner-actor' }, { entityType: 'character-instance', id: ownerInstanceId, role: 'sticker-owner-instance' }]), source, producer, idempotencyKey });
    return Object.freeze({ ownership: await this.getStickerOwnership({ scope, ownershipId }), event: result.event, replayed: result.replayed });
  }

  async sendSticker(input) {
    const scope = requireEventScope(input.scope); const stickerAssetId = input.stickerAssetId || input.sticker?.stickerAssetId; const label = input.label ?? input.sticker?.label ?? ''; const assetRef = input.assetRef ?? input.sticker?.assetRef ?? null; const ownershipId = await stableId('sticker-ownership', scope, { stickerAssetId, ownerAccountId: input.senderAccountId }); const ownership = await this.getStickerOwnership({ scope, ownershipId }); if (!ownership?.active) throw new Error('Sender Account does not own this Sticker asset');
    return this.sendMessage({ ...input, scope, text: '', contentKind: MESSAGE_CONTENT_KIND.STICKER, sticker: { stickerAssetId, label, assetRef } });
  }

  async reviseMessage({ scope: inputScope, messageId, text, handoff, producer = 'message-service', idempotencyKey, reason = 'Main RP source revision' }) {
    const scope = requireEventScope(inputScope); const head = await this.getMessage({ scope, messageId }); if (!head) throw new Error('Unknown scoped Message'); const event = await this.#events.getEvent(scope, head.sourceEventId); if (!event || event.status !== 'active') throw new Error('Canonical Message Event is not active');
    const snapshot = await this.getMembershipSnapshot({ scope, snapshotId: head.membershipSnapshotId }); const thread = await this.getThread({ scope, threadId: head.threadId }); if (!snapshot || !thread) throw new Error('Message revision dependencies are incomplete');
    const chains = await this.#unitOfWork.readonly({ stores: ['actors', 'instances', 'devices'], scope }, async repositories => ({ actor: await repositories.actors.get(head.actualAuthorActorId), instance: await repositories.instances.get(head.actualAuthorInstanceId), device: await repositories.devices.get(head.deviceId) })); if (!chains.actor || !chains.instance || !chains.device) throw new Error('Message revision identity chain is incomplete');
    const message = normalizeMessage({ ...head, text }); const members = snapshot.members; const bundle = await prepareDisclosureBundle({ scope, stableKey: `message:${messageId}`, bundle: { claim: { claimType: 'messaging.message-content.v1', subject: { kind: 'event', id: messageId }, safeSummary: message.text, certainty: 'confirmed', currentness: 'current' }, audience: { kind: thread.kind === THREAD_KIND.DM ? AUDIENCE_KIND.PRIVATE_EXPLICIT : AUDIENCE_KIND.GROUP_SNAPSHOT, actorIds: members.map(member => member.actorId), instanceIds: members.map(member => member.instanceId), membershipSnapshotId: thread.kind === THREAD_KIND.GROUP ? snapshot.snapshotId : null }, fragments: [{ key: 'body', kind: EVIDENCE_FRAGMENT_KIND.MESSAGE_TEXT, safeText: message.text, sourceField: 'text' }], observations: members.map(member => ({ fragmentKeys: ['body'], targetActorId: member.actorId, targetInstanceId: member.instanceId, confidence: 'confirmed', evidence: { basis: member.accountId === message.senderAccountId ? EVIDENCE_BASIS.DIRECT_PARTICIPANT : (thread.kind === THREAD_KIND.GROUP ? EVIDENCE_BASIS.GROUP_MEMBER : EVIDENCE_BASIS.EXPLICIT_RECIPIENT), sourceEventId: null, sourceActorId: chains.actor.id, sourceDeviceId: chains.device.id, sourceAccountId: message.senderAccountId, provenanceAuthority: event.provenance.authority, provenanceRecordId: `${event.provenance.recordId}:knowledge:${member.accountId}` } })) } });
    const payload = { ...event.payload, message, recipientAccountIds: members.map(member => member.accountId), knowledgeDisclosures: [bundle], handoff: structuredClone(handoff) }; const result = await this.#events.revise({ scope, eventId: event.id, expectedRevision: event.revision, payload, producer, idempotencyKey, reason }); this.#metrics = Object.freeze({ operation: 'revise-message', ...this.#events.lastOperationMetrics }); return Object.freeze({ message: await this.getMessage({ scope, messageId }), event: result.event, replayed: result.replayed });
  }

  async getThread({ scope: inputScope, threadId }) { const scope = requireEventScope(inputScope); return this.#unitOfWork.readonly({ stores: ['threads'], scope }, repositories => repositories.threads.get(threadHeadId(scope, threadId))); }
  async getMessage({ scope: inputScope, messageId }) { const scope = requireEventScope(inputScope); return this.#unitOfWork.readonly({ stores: ['messages'], scope }, repositories => repositories.messages.get(messageHeadId(scope, messageId))); }
  async getDraft({ scope: inputScope, ownerAccountId, threadId }) { const scope = requireEventScope(inputScope); return this.#unitOfWork.readonly({ stores: ['messageDrafts'], scope }, repositories => repositories.messageDrafts.getByIndex('by_scope_account_thread', [scope.storyId, scope.branchId, ownerAccountId, threadId])); }
  async getReaction({ scope: inputScope, reactionId }) { const scope = requireEventScope(inputScope); return this.#unitOfWork.readonly({ stores: ['messageReactions'], scope }, repositories => repositories.messageReactions.get(reactionHeadId(scope, reactionId))); }
  async listReactions({ scope: inputScope, messageId }) { const scope = requireEventScope(inputScope); return Object.freeze(await this.#unitOfWork.readonly({ stores: ['messageReactions'], scope }, repositories => repositories.messageReactions.listByIndex('by_scope_message', [scope.storyId, scope.branchId, messageId]))); }
  async getStickerOwnership({ scope: inputScope, ownershipId }) { const scope = requireEventScope(inputScope); return this.#unitOfWork.readonly({ stores: ['stickerOwnerships'], scope }, repositories => repositories.stickerOwnerships.get(stickerOwnershipHeadId(scope, ownershipId))); }
  async getMembershipSnapshot({ scope: inputScope, snapshotId }) { const scope = requireEventScope(inputScope); return this.#unitOfWork.readonly({ stores: ['threadMembershipSnapshots'], scope }, repositories => repositories.threadMembershipSnapshots.get(membershipHeadId(scope, snapshotId))); }
  async getLatestMembershipSnapshot({ scope: inputScope, threadId }) {
    const scope = requireEventScope(inputScope);
    const rows = await this.#unitOfWork.readonly({ stores: ['threadMembershipSnapshots'], scope }, repositories => repositories.threadMembershipSnapshots.listByIndexRange('by_scope_thread_sequence', { lower: [scope.storyId, scope.branchId, threadId, 0], upper: [scope.storyId, scope.branchId, threadId, MAX_SEQUENCE] }));
    return rows.sort((left, right) => left.sourceEventSequence - right.sourceEventSequence || left.snapshotId.localeCompare(right.snapshotId)).at(-1) || null;
  }
  async listThreads({ scope: inputScope, viewerAccountId, limit = 50 }) {
    const scope = requireEventScope(inputScope); if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new TypeError('Thread list limit must be between 1 and 200');
    const result = await this.#unitOfWork.readonly({ stores: ['threadParticipants', 'threads'], scope }, async repositories => {
      const participants = await repositories.threadParticipants.listByIndex('by_scope_account', [scope.storyId, scope.branchId, viewerAccountId]);
      const threads = await Promise.all(participants.map(row => repositories.threads.get(threadHeadId(scope, row.threadId))));
      return threads.filter(Boolean).sort((left, right) => right.sourceEventSequence - left.sourceEventSequence || left.threadId.localeCompare(right.threadId)).slice(0, limit);
    });
    this.#metrics = Object.freeze({ operation: 'list-threads', directThreadParticipantIndexRows: result.length, eventHistoryScans: 0 }); return Object.freeze(result);
  }
  async listMessages({ scope: inputScope, viewerAccountId, threadId, limit = 50 }) {
    const scope = requireEventScope(inputScope); if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new TypeError('Message page limit must be between 1 and 200');
    const messages = await this.#unitOfWork.readonly({ stores: ['threadParticipants', 'messages', 'messageRecipients'], scope }, async repositories => {
      const participant = await repositories.threadParticipants.getByIndex('by_scope_thread_account', [scope.storyId, scope.branchId, threadId, viewerAccountId]);
      if (!participant) return [];
      const recipients = await repositories.messageRecipients.listByIndexRange('by_scope_thread_account_reverse_sequence', { lower: [scope.storyId, scope.branchId, threadId, viewerAccountId, 0], upper: [scope.storyId, scope.branchId, threadId, viewerAccountId, MAX_SEQUENCE] }, { limit });
      return Promise.all(recipients.map(row => repositories.messages.get(messageHeadId(scope, row.messageId))));
    });
    const active = messages.filter(row => row && row.visibility !== 'unsent'); this.#metrics = Object.freeze({ operation: 'list-messages', directMessageIndexRows: active.length, eventHistoryScans: 0 }); return Object.freeze([...active].sort((left, right) => left.sourceEventSequence - right.sourceEventSequence || left.messageId.localeCompare(right.messageId)));
  }
}
