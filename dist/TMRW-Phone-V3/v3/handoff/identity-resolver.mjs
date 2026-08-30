import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';
import { HANDOFF_ACTION_KIND, HANDOFF_PROPOSAL_STATUS } from './proposal.mjs';

function required(value, field) { const text = String(value || '').trim(); if (!text) throw new TypeError(`Handoff identity is unresolved: ${field}`); return text; }

export class HandoffIdentityResolver {
  #unitOfWork;
  constructor({ database }) { if (!database) throw new TypeError('HandoffIdentityResolver requires isolated v3 storage'); this.#unitOfWork = new V3UnitOfWork(database); }
  async resolve(scopeInput, proposal) {
    const scope = requireEventScope(scopeInput); if (proposal.status !== HANDOFF_PROPOSAL_STATUS.READY) throw new TypeError('Only a ready handoff proposal can resolve canonically'); const candidate = proposal.candidate;
    const normalized = (() => {
      if ([HANDOFF_ACTION_KIND.DM_SEND, HANDOFF_ACTION_KIND.GROUP_SEND].includes(proposal.actionKind)) { const sender = candidate.sender || {}; const recipient = candidate.recipient || {}; return { threadId: candidate.threadId || null, threadKey: candidate.threadKey || null, senderAccountId: required(candidate.senderAccountId || sender.accountId, 'senderAccountId'), recipientAccountIds: [...new Set(candidate.recipientAccountIds || [recipient.accountId].filter(Boolean))], actualAuthorActorId: required(candidate.actualAuthorActorId || sender.actorId, 'actualAuthorActorId'), actualAuthorInstanceId: required(candidate.actualAuthorInstanceId || sender.instanceId, 'actualAuthorInstanceId'), deviceId: required(candidate.deviceId || sender.deviceId, 'deviceId'), text: required(candidate.text, 'message.text') }; }
      if (proposal.actionKind === HANDOFF_ACTION_KIND.CALL_INITIATE) { const caller = candidate.caller || {}; const called = candidate.called || {}; return { callingAccountId: required(candidate.callingAccountId || caller.accountId, 'callingAccountId'), calledAccountId: required(candidate.calledAccountId || called.accountId, 'calledAccountId'), actualActorId: required(candidate.actualActorId || caller.actorId, 'actualActorId'), actualInstanceId: required(candidate.actualInstanceId || caller.instanceId, 'actualInstanceId'), deviceId: required(candidate.deviceId || caller.deviceId, 'deviceId') }; }
      if (proposal.actionKind === HANDOFF_ACTION_KIND.CALL_TRANSITION) return { callSessionId: required(candidate.callSessionId, 'callSessionId'), action: required(candidate.action, 'call.action'), actualActorId: required(candidate.actualActorId, 'actualActorId'), actualInstanceId: required(candidate.actualInstanceId, 'actualInstanceId'), deviceId: required(candidate.deviceId, 'deviceId'), measuredDurationMs: candidate.measuredDurationMs ?? null };
      if (proposal.actionKind === HANDOFF_ACTION_KIND.CALL_TRANSCRIPT) return { callSessionId: required(candidate.callSessionId, 'callSessionId'), speakerAccountId: required(candidate.speakerAccountId, 'speakerAccountId'), actualAuthorActorId: required(candidate.actualAuthorActorId, 'actualAuthorActorId'), actualAuthorInstanceId: required(candidate.actualAuthorInstanceId, 'actualAuthorInstanceId'), deviceId: required(candidate.deviceId, 'deviceId'), text: required(candidate.text, 'transcript.text') };
      return Object.freeze({ evidence: structuredClone(candidate) });
    })();
    const ids = { actorIds: new Set(), instanceIds: new Set(), accountIds: new Set(), deviceIds: new Set() };
    for (const [key, value] of Object.entries(normalized)) { if (!value) continue; if (key.endsWith('ActorId')) ids.actorIds.add(value); else if (key.endsWith('InstanceId')) ids.instanceIds.add(value); else if (key.endsWith('AccountId')) ids.accountIds.add(value); else if (key.endsWith('AccountIds')) for (const id of value) ids.accountIds.add(id); else if (key === 'deviceId') ids.deviceIds.add(value); }
    await this.#unitOfWork.readonly({ stores: ['actors', 'instances', 'accounts', 'devices'], scope }, async repositories => { for (const id of ids.actorIds) if (!await repositories.actors.get(id)) throw new TypeError(`Unknown scoped Actor: ${id}`); for (const id of ids.instanceIds) if (!await repositories.instances.get(id)) throw new TypeError(`Unknown scoped Character Instance: ${id}`); for (const id of ids.accountIds) if (!await repositories.accounts.get(id)) throw new TypeError(`Unknown scoped Account: ${id}`); for (const id of ids.deviceIds) if (!await repositories.devices.get(id)) throw new TypeError(`Unknown scoped Device: ${id}`); });
    return Object.freeze(normalized);
  }
}
