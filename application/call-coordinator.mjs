import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';
import { CALL_ACTION, CALL_STATE } from '../domain/calls/call-state-machine.mjs';
import { isPlayerControlled } from '../domain/identity/control-authority.mjs';
import { resolveCallUiOwner } from '../ui/calls/call-ui-owner.mjs';
import { callHistoryViewModel } from '../ui/calls/history.mjs';
import { callIslandViewModel } from '../ui/calls/call-island.mjs';

const MAX_CALLS = 50;
const MAX_TRANSCRIPT = 100;
const requireId = (value, field) => { const id = String(value || '').trim(); if (!id) throw new TypeError(field + ' is required'); return id; };

function allowedActions(session, viewerAccountId) {
  if (!session || !session.participantAccountIds.includes(viewerAccountId)) return Object.freeze([]);
  if (session.state === CALL_STATE.RINGING && viewerAccountId === session.calledAccountId) return Object.freeze([CALL_ACTION.ACCEPT, CALL_ACTION.DECLINE]);
  if (session.state === CALL_STATE.RINGING && viewerAccountId === session.callingAccountId) return Object.freeze([CALL_ACTION.CANCEL]);
  if (session.state === CALL_STATE.ACTIVE) return Object.freeze([CALL_ACTION.END]);
  return Object.freeze([]);
}

export class CallCoordinator {
  #unitOfWork; #calls; #phones;
  constructor({ database, callService, phoneStateService }) {
    if (!database || !callService || !phoneStateService) throw new TypeError('CallCoordinator requires v3 storage, canonical Calls, and phone state');
    this.#unitOfWork = new V3UnitOfWork(database); this.#calls = callService; this.#phones = phoneStateService;
  }

  async #identityMap(scope, sessions, contacts = [], directTargets = []) {
    const accountIds = [...new Set(sessions.flatMap(session => session.participantAccountIds))];
    const contactByInstance = new Map(contacts.filter(row => row.targetInstanceId).map(row => [row.targetInstanceId, row]));
    const directByInstance = new Map(directTargets.filter(row => row.instanceId).map(row => [row.instanceId, row]));
    return this.#unitOfWork.readonly({ stores: ['accounts', 'instances', 'actors'], scope }, async repositories => {
      const output = new Map();
      for (const accountId of accountIds) {
        const account = await repositories.accounts.get(accountId); const instance = account && await repositories.instances.get(account.ownerInstanceId); const actor = instance && await repositories.actors.get(instance.actorId);
        if (!account || !instance || !actor) continue;
        const contact = contactByInstance.get(instance.id);
        const direct = directByInstance.get(instance.id);
        output.set(accountId, Object.freeze({ accountId, actorId: actor.id, instanceId: instance.id, displayName: direct?.label || instance.displayNameOverride || actor.displayName, savedName: contact?.savedName || null, number: contact?.number || null, aliases: Object.freeze([...new Set([...(actor.aliases || []), ...(instance.aliases || [])])]) }));
      }
      return output;
    });
  }

  async #accountForInstance(scope, instanceId) {
    return this.#unitOfWork.readonly({ stores: ['accounts'], scope }, async repositories => {
      const accounts = await repositories.accounts.listByIndex('by_owner_scope', [scope.storyId, scope.branchId, requireId(instanceId, 'targetInstanceId')]);
      const phoneAccounts = accounts.filter(account => account.kind === 'phone'); const candidates = phoneAccounts.length ? phoneAccounts : accounts; const primary = candidates.filter(account => account.isPrimary);
      if (primary.length === 1) return primary[0]; if (candidates.length === 1) return candidates[0]; if (candidates.length === 0) return null;
      throw new Error('Contact target resolves to multiple scoped Accounts; explicit Account mapping is required');
    });
  }

  async #account(scope, accountId) {
    return this.#unitOfWork.readonly({ stores: ['accounts'], scope }, repositories => repositories.accounts.get(requireId(accountId, 'accountId')));
  }

  async #autoAnswerEndpoint(scope, accountId) {
    return this.#unitOfWork.readonly({ stores: ['accounts', 'instances', 'actors', 'devices'], scope }, async repositories => {
      const account = await repositories.accounts.get(requireId(accountId, 'accountId'));
      const instance = account && await repositories.instances.get(account.ownerInstanceId);
      const actor = instance && await repositories.actors.get(instance.actorId);
      if (!account || !instance || !actor || isPlayerControlled(actor)) throw new Error('Instant auto-answer requires one canonical non-player Character endpoint');
      const devices = await repositories.devices.listByIndex('by_owner_scope', [scope.storyId, scope.branchId, instance.id]);
      const accountDeviceIds = new Set(account.deviceIds || []);
      const eligible = devices.filter(device => device.kind === 'phone' && (!accountDeviceIds.size || accountDeviceIds.has(device.id)));
      const device = eligible.find(row => row.isPrimary) || (eligible.length === 1 ? eligible[0] : null);
      if (!device) throw new Error('Instant auto-answer requires one canonical Character phone Device');
      return Object.freeze({ account, instance, actor, device });
    });
  }

  async #actionContext(scope, deviceId, playerActorId, playerInstanceId) {
    const perspective = await this.#phones.getPerspective(scope, deviceId); if (!perspective) throw new Error('Call UI requires a scoped phone perspective');
    const owner = resolveCallUiOwner({ perspective, playerActorId, playerInstanceId });
    return { perspective, owner };
  }

  async view({ scope: inputScope, deviceId, playerActorId, playerInstanceId, selectedCallSessionId = null, contacts = [], directTargets = [], historyLimit = MAX_CALLS, transcriptLimit = MAX_TRANSCRIPT }) {
    const scope = requireEventScope(inputScope); const { perspective, owner } = await this.#actionContext(scope, deviceId, playerActorId, playerInstanceId);
    if (!perspective.accountId) return Object.freeze({ sessions: Object.freeze([]), history: Object.freeze([]), transcript: Object.freeze([]), selectedCallSessionId: null, island: Object.freeze({ kind: 'empty', title: 'No account on this device', callSessionId: null, actions: Object.freeze([]) }), dialTargets: Object.freeze([]), owner, metrics: Object.freeze({ eventHistoryScans: 0, callsLoaded: 0, transcriptLoaded: 0, timers: 0, pollers: 0 }) });
    const limit = Math.max(1, Math.min(MAX_CALLS, Number(historyLimit) || MAX_CALLS));
    const sessions = await this.#calls.listCalls({ scope, viewerAccountId: perspective.accountId, limit });
    const identities = await this.#identityMap(scope, sessions, contacts, directTargets);
    const history = callHistoryViewModel({ sessions, viewerAccountId: perspective.accountId, identities });
    const requested = selectedCallSessionId ? sessions.find(row => row.callSessionId === selectedCallSessionId) : null;
    const selected = sessions.find(row => row.state === CALL_STATE.ACTIVE) || sessions.find(row => row.state === CALL_STATE.RINGING) || requested || null;
    const transcriptLimitBounded = Math.max(1, Math.min(MAX_TRANSCRIPT, Number(transcriptLimit) || MAX_TRANSCRIPT));
    const transcript = selected ? await this.#calls.listTranscript({ scope, viewerAccountId: perspective.accountId, callSessionId: selected.callSessionId, limit: transcriptLimitBounded }) : Object.freeze([]);
    const island = callIslandViewModel({ sessions, history, transcript, viewerAccountId: perspective.accountId, selectedCallSessionId: selected?.callSessionId || null, canAct: owner.canAct });
    const dialTargets = [];
    for (const contact of contacts) {
      if (!contact.targetInstanceId) continue;
      const account = await this.#accountForInstance(scope, contact.targetInstanceId); if (!account || account.id === perspective.accountId || dialTargets.some(row => row.accountId === account.id)) continue;
      dialTargets.push(Object.freeze({ accountId: account.id, actorId: contact.targetActorId, instanceId: contact.targetInstanceId, label: contact.savedName || contact.number || 'Contact', number: contact.number || null, aliases: Object.freeze([]) }));
    }
    for (const target of directTargets) {
      if (!target?.accountId || target.accountId === perspective.accountId || dialTargets.some(row => row.accountId === target.accountId)) continue;
      dialTargets.push(Object.freeze({ accountId: target.accountId, actorId: target.actorId, instanceId: target.instanceId, label: target.label || 'Contact', number: target.number || null, aliases: Object.freeze(target.aliases || []), availability: target.availability || null, autoAnswerEligible: target.autoAnswerEligible === true }));
    }
    return Object.freeze({ sessions, history, transcript, selectedCallSessionId: selected?.callSessionId || null, island, dialTargets: Object.freeze(dialTargets), owner, metrics: Object.freeze({ eventHistoryScans: 0, callsLoaded: sessions.length, transcriptLoaded: transcript.length, timers: 0, pollers: 0, maxHistory: MAX_CALLS, maxTranscript: MAX_TRANSCRIPT }) });
  }

  async startOutgoing({ scope: inputScope, deviceId, playerActorId, playerInstanceId, targetAccountId, autoAcceptTarget = false, source, idempotencyKey }) {
    const scope = requireEventScope(inputScope); const { perspective, owner } = await this.#actionContext(scope, deviceId, playerActorId, playerInstanceId);
    if (!owner.canAct || !perspective.accountId) throw new Error('Current phone perspective is inspection-only for Call actions');
    const target = await this.#account(scope, targetAccountId); if (!target) throw new Error('Call target Account is not in this Story/Branch'); if (target.id === perspective.accountId) throw new Error('A Call requires a distinct target Account');
    const current = await this.#calls.listCalls({ scope, viewerAccountId: perspective.accountId, limit: 10 }); const open = current.find(session => [CALL_STATE.RINGING, CALL_STATE.ACTIVE].includes(session.state));
    let initiated;
    if (open) {
      const sameEndpoints = open.participantAccountIds.includes(target.id);
      if (!sameEndpoints) throw new Error('Another Call is already ringing or active on this Account');
      initiated = Object.freeze({ session: open, event: null, replayed: true, reusedOpenSession: true });
    } else {
      initiated = await this.#calls.initiate({ scope, participantAccountIds: [perspective.accountId, target.id], callingAccountId: perspective.accountId, calledAccountId: target.id, actualActorId: owner.actualActorId, actualInstanceId: owner.actualInstanceId, deviceId: perspective.deviceId, source, producer: 'phase18-call-coordinator', idempotencyKey });
    }
    if (!autoAcceptTarget || initiated.session.state === CALL_STATE.ACTIVE) return Object.freeze({ ...initiated, autoAccepted: initiated.session.state === CALL_STATE.ACTIVE });
    if (initiated.session.state !== CALL_STATE.RINGING || initiated.session.calledAccountId !== target.id) throw new Error('Instant auto-answer requires the exact ringing called endpoint');
    const acceptIdempotencyKey = requireId(idempotencyKey, 'idempotencyKey');
    const sourceRecordId = requireId(source?.recordId, 'source.recordId');
    const endpoint = await this.#autoAnswerEndpoint(scope, target.id);
    const accepted = await this.#calls.transition({
      scope,
      callSessionId: initiated.session.callSessionId,
      action: CALL_ACTION.ACCEPT,
      actualActorId: endpoint.actor.id,
      actualInstanceId: endpoint.instance.id,
      deviceId: endpoint.device.id,
      source: { ...source, recordId: `${sourceRecordId}:instant-auto-answer` },
      producer: 'phase18-call-coordinator',
      idempotencyKey: `${acceptIdempotencyKey}:instant-auto-answer`,
      sourceEventId: initiated.event?.id || null,
    });
    return Object.freeze({ ...initiated, session: accepted.session, autoAccepted: true, acceptanceEvent: accepted.event });
  }

  async transition({ scope: inputScope, deviceId, playerActorId, playerInstanceId, callSessionId, action, measuredDurationMs = null, source, idempotencyKey }) {
    const scope = requireEventScope(inputScope); const { perspective, owner } = await this.#actionContext(scope, deviceId, playerActorId, playerInstanceId);
    if (!owner.canAct || !perspective.accountId) throw new Error('Current phone perspective is inspection-only for Call actions');
    const session = await this.#calls.getSession({ scope, callSessionId: requireId(callSessionId, 'callSessionId') }); if (!session || !session.participantAccountIds.includes(perspective.accountId)) throw new Error('Call Session is not visible in this phone perspective');
    if (!allowedActions(session, perspective.accountId).includes(action)) throw new TypeError('Call action is stale or invalid for this endpoint/state');
    let duration = null;
    if (action === CALL_ACTION.END) { duration = Number(measuredDurationMs); if (!Number.isSafeInteger(duration) || duration < 0) throw new TypeError('Ending a Call requires explicit canonical measuredDurationMs'); }
    return this.#calls.transition({ scope, callSessionId: session.callSessionId, action, actualActorId: owner.actualActorId, actualInstanceId: owner.actualInstanceId, deviceId: perspective.deviceId, measuredDurationMs: duration, source, producer: 'phase18-call-coordinator', idempotencyKey });
  }

  async sendText({ scope: inputScope, deviceId, playerActorId, playerInstanceId, callSessionId, text, source, idempotencyKey }) {
    const scope = requireEventScope(inputScope); const { perspective, owner } = await this.#actionContext(scope, deviceId, playerActorId, playerInstanceId);
    if (!owner.canAct || !perspective.accountId) throw new Error('Current phone perspective is inspection-only for Call actions');
    const session = await this.#calls.getSession({ scope, callSessionId: requireId(callSessionId, 'callSessionId') }); if (!session || session.state !== CALL_STATE.ACTIVE || !session.participantAccountIds.includes(perspective.accountId)) throw new Error('Text Call input requires an active visible Call Session');
    return this.#calls.addTranscript({ scope, callSessionId: session.callSessionId, speakerAccountId: perspective.accountId, actualAuthorActorId: owner.actualActorId, actualAuthorInstanceId: owner.actualInstanceId, deviceId: perspective.deviceId, text, source, producer: 'phase18-call-coordinator', idempotencyKey });
  }
}
