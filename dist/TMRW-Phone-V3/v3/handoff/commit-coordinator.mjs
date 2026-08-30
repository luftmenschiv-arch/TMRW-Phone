import { requireEventScope } from '../domain/events/event-validator.mjs';
import { THREAD_KIND } from '../domain/messaging/thread.mjs';
import { mainRpCanonicalSource, normalizeMainRpSource } from '../platform/sillytavern/message-events.mjs';
import { extractDeterministicHandoffProposals } from './deterministic-extractor.mjs';
import { HandoffIdentityResolver } from './identity-resolver.mjs';
import { HandoffProposalRepository } from './proposal-repository.mjs';
import { HandoffQueryRepository } from './handoff-query-repository.mjs';
import { HANDOFF_ACTION_KIND, HANDOFF_PROPOSAL_STATUS, handoffMetadata } from './proposal.mjs';

const CANONICAL_KINDS = new Set([HANDOFF_ACTION_KIND.DM_SEND, HANDOFF_ACTION_KIND.GROUP_SEND, HANDOFF_ACTION_KIND.CALL_INITIATE, HANDOFF_ACTION_KIND.CALL_TRANSITION, HANDOFF_ACTION_KIND.CALL_TRANSCRIPT]);

export class HandoffCommitCoordinator {
  #events; #messages; #calls; #proposals; #queries; #resolver; #metrics = Object.freeze({ operation: 'none' });
  constructor({ database, eventEngine, messageService, callService }) {
    if (!database || !eventEngine || !messageService || !callService) throw new TypeError('HandoffCommitCoordinator requires v3 storage and canonical Phase 8/9 domain services');
    this.#events = eventEngine; this.#messages = messageService; this.#calls = callService; this.#proposals = new HandoffProposalRepository({ database }); this.#queries = new HandoffQueryRepository({ database }); this.#resolver = new HandoffIdentityResolver({ database });
  }
  get lastOperationMetrics() { return structuredClone(this.#metrics); }

  async processSource({ scope: inputScope, source: sourceInput, autoCommitClear = true }) {
    const scope = requireEventScope(inputScope); const source = normalizeMainRpSource(sourceInput);
    const extracted = await extractDeterministicHandoffProposals({ scope, source }); const results = [];
    if (source.origin === 'main-rp' && source.mode === 'normal' && ['revision', 'swipe', 'replace', 'retracted'].includes(source.changeKind)) {
      const retained = new Set(extracted.map(proposal => proposal.actionKey)); const links = await this.#queries.listLinksForSource(scope, source);
      for (const link of links.filter(row => !retained.has(row.actionKey))) { const event = await this.#events.getEvent(scope, link.canonicalEventId); if (event?.status === 'active') await this.#events.retract({ scope, eventId: event.id, expectedRevision: event.revision, producer: 'main-rp-phone-handoff', idempotencyKey: `handoff-source-reconcile:${source.sourceAuthority}:${source.sourceMessageId}:${source.sourceVersionId}:${link.actionKey}`, reason: `Main RP ${source.changeKind} removed canonical phone action`, cascade: event.eventType === 'calls.session-initiated.v1' }); }
    }
    for (const proposal of extracted) {
      const stored = await this.#proposals.save(scope, proposal);
      if (stored.status === HANDOFF_PROPOSAL_STATUS.ACCEPTED) {
        const link = await this.#queries.getLink(scope, stored); const event = link && await this.#events.getEvent(scope, link.canonicalEventId);
        if (!link || !event || event.status !== 'active') throw new Error('Accepted handoff proposal lacks active canonical linkage');
        results.push(Object.freeze({ proposal: stored, committed: true, event, replayed: true, revised: false })); continue;
      }
      if (stored.status !== HANDOFF_PROPOSAL_STATUS.READY || !autoCommitClear) { results.push(Object.freeze({ proposal: stored, committed: false })); continue; }
      if (!CANONICAL_KINDS.has(stored.actionKind)) { const deferred = await this.#proposals.updateStatus(scope, stored.proposalId, HANDOFF_PROPOSAL_STATUS.UNSUPPORTED, 'Canonical target domain is intentionally deferred beyond Phase 10.'); results.push(Object.freeze({ proposal: deferred, committed: false })); continue; }
      results.push(await this.commitProposal({ scope, proposal: stored }));
    }
    this.#metrics = Object.freeze({ operation: 'process-main-rp-source', sourceItemsExamined: 1, proposalsExamined: extracted.length, canonicalActionsCommitted: results.filter(row => row.committed).length, eventHistoryScans: 0, storiesScanned: 0, branchesScanned: 0, activeTimers: 0, activePollers: 0 });
    return Object.freeze({ source, proposals: Object.freeze(results) });
  }

  async commitProposal({ scope: inputScope, proposal }) {
    const scope = requireEventScope(inputScope); const existingLink = await this.#queries.getLink(scope, proposal); const resolved = await this.#resolver.resolve(scope, proposal); const metadata = handoffMetadata(proposal); const source = mainRpCanonicalSource({ ...proposal, text: '', role: 'user', mode: 'normal', origin: 'main-rp', actorBinding: null, mentionBindings: {}, explicitPhoneActions: [] }, proposal.actionKey);
    const producer = 'main-rp-phone-handoff'; const key = `handoff:${proposal.sourceAuthority}:${proposal.sourceMessageId}:${proposal.actionKey}`;
    if (existingLink) {
      const current = await this.#events.getEvent(scope, existingLink.canonicalEventId);
      if (!current || current.status !== 'active') throw new Error('Handoff link points to inactive canonical state');
      if (existingLink.sourceVersionId === proposal.sourceVersionId && existingLink.sourceContentDigest === proposal.sourceContentDigest) return Object.freeze({ proposal, committed: true, event: current, replayed: true, revised: false });
      if (![HANDOFF_ACTION_KIND.DM_SEND, HANDOFF_ACTION_KIND.GROUP_SEND].includes(proposal.actionKind) || current.eventType !== 'messaging.message-sent.v1') throw new TypeError('Changed Main RP source cannot safely rewrite this canonical action; retract or confirm explicitly');
      const revised = await this.#messages.reviseMessage({ scope, messageId: current.payload.message.messageId, text: resolved.text, handoff: metadata, producer, idempotencyKey: `${key}:revision:${proposal.sourceVersionId}` });
      return Object.freeze({ proposal, committed: true, ...revised, revised: true });
    }
    let result; const appendKey = proposal.changeKind === 'new' ? key : `${key}:reactivated:${proposal.sourceVersionId}`; const appendSource = proposal.changeKind === 'new' ? source : { ...source, recordId: `${source.recordId}:reactivated:${proposal.sourceVersionId}` };
    if ([HANDOFF_ACTION_KIND.DM_SEND, HANDOFF_ACTION_KIND.GROUP_SEND].includes(proposal.actionKind)) {
      const kind = proposal.actionKind === HANDOFF_ACTION_KIND.DM_SEND ? THREAD_KIND.DM : THREAD_KIND.GROUP; let threadId = resolved.threadId;
      if (!threadId) {
        const accounts = [...new Set([resolved.senderAccountId, ...resolved.recipientAccountIds])];
        if (kind === THREAD_KIND.GROUP && !resolved.threadKey) throw new TypeError('A Main RP group action requires an existing canonical threadId or stable group threadKey');
        const stableThreadKey = kind === THREAD_KIND.DM ? null : resolved.threadKey; const threadIdentityKey = kind === THREAD_KIND.DM ? accounts.sort().join(':') : stableThreadKey;
        const created = await this.#messages.createThread({ scope, kind, participantAccountIds: accounts, threadKey: stableThreadKey, sourceMode: 'live', source: { ...source, recordId: `${source.recordId}:thread` }, producer, idempotencyKey: `handoff:${kind}-thread:${threadIdentityKey}` }); threadId = created.thread.threadId;
      }
      result = await this.#messages.sendMessage({ scope, threadId, senderAccountId: resolved.senderAccountId, actualAuthorActorId: resolved.actualAuthorActorId, actualAuthorInstanceId: resolved.actualAuthorInstanceId, deviceId: resolved.deviceId, text: resolved.text, sourceMode: 'live', handoff: metadata, source: appendSource, producer, idempotencyKey: appendKey });
    } else if (proposal.actionKind === HANDOFF_ACTION_KIND.CALL_INITIATE) {
      result = await this.#calls.initiate({ scope, participantAccountIds: [resolved.callingAccountId, resolved.calledAccountId], ...resolved, sourceMode: 'live', handoff: metadata, source: appendSource, producer, idempotencyKey: appendKey });
    } else if (proposal.actionKind === HANDOFF_ACTION_KIND.CALL_TRANSITION) {
      result = await this.#calls.transition({ scope, ...resolved, handoff: metadata, source: appendSource, producer, idempotencyKey: appendKey });
    } else if (proposal.actionKind === HANDOFF_ACTION_KIND.CALL_TRANSCRIPT) {
      result = await this.#calls.addTranscript({ scope, ...resolved, sourceMode: 'live', handoff: metadata, source: appendSource, producer, idempotencyKey: appendKey });
    } else throw new TypeError(`Unsupported canonical handoff action: ${proposal.actionKind}`);
    return Object.freeze({ proposal, committed: true, ...result, revised: false });
  }

  async retractSource({ scope: inputScope, sourceAuthority, sourceMessageId, reason = 'Main RP source retracted' }) {
    const scope = requireEventScope(inputScope); const links = await this.#queries.listLinksForSource(scope, { sourceAuthority, sourceMessageId }); const results = [];
    for (const link of links) { const event = await this.#events.getEvent(scope, link.canonicalEventId); if (!event || event.status !== 'active') continue; results.push(await this.#events.retract({ scope, eventId: event.id, expectedRevision: event.revision, producer: 'main-rp-phone-handoff', idempotencyKey: `handoff-retract:${sourceAuthority}:${sourceMessageId}:${link.actionKey}:${event.revision}`, reason, cascade: event.eventType === 'calls.session-initiated.v1' })); }
    this.#metrics = Object.freeze({ operation: 'retract-main-rp-source', sourceItemsExamined: 1, directLinkRows: links.length, eventHistoryScans: 0, storiesScanned: 0, branchesScanned: 0 }); return Object.freeze(results);
  }
}
