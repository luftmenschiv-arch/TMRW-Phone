import { setupPhase9, phase9Projectors } from '../phase9/call-fixtures.mjs';
import { createHandoffProjector } from '../../handoff/handoff-projector.mjs';
import { HandoffCommitCoordinator } from '../../handoff/commit-coordinator.mjs';
import { PhoneContextInjector } from '../../prompt/phone-context-injector.mjs';

export function phase10Projectors() { return [...phase9Projectors(), createHandoffProjector()]; }
export async function setupPhase10(options = {}) {
  const context = await setupPhase9({ ...options, projectors: options.projectors || phase10Projectors() });
  const handoff = new HandoffCommitCoordinator({ database: context.database, eventEngine: context.engine, messageService: context.messages, callService: context.calls });
  const phoneContext = new PhoneContextInjector({ knowledgeService: context.knowledge });
  return { ...context, handoff, phoneContext };
}

export function binding(person) { return Object.freeze({ actorId: person.actorId, instanceId: person.instanceId, accountId: person.accountId, deviceId: person.deviceId }); }
export function mainRpSource(context, { id = 'rp-1', version = '1', ordinal = 1, role = 'user', text = '', actor = context.user, mentions = {}, actions = [], origin = 'main-rp', mode = 'normal', changeKind = 'new' } = {}) {
  return Object.freeze({ sourceAuthority: 'sillytavern-main-rp', sourceMessageId: id, sourceVersionId: version, sourceOrdinal: ordinal, role, text, origin, mode, changeKind, actorBinding: actor ? binding(actor) : null, mentionBindings: Object.fromEntries(Object.entries(mentions).map(([key, people]) => [key, (Array.isArray(people) ? people : [people]).map(binding)])), explicitPhoneActions: actions });
}
export const explicitDm = (from, to, text, extra = {}) => ({ actionKey: extra.actionKey || 'dm-1', kind: 'dm.send', completed: true, sender: binding(from), recipient: binding(to), text, ...extra });
export const explicitGroup = (from, recipients, text, extra = {}) => ({ actionKey: extra.actionKey || 'group-1', kind: 'group.send', completed: true, threadKey: extra.threadKey || 'fixture-group', sender: binding(from), recipientAccountIds: recipients.map(person => person.accountId), actualAuthorActorId: from.actorId, actualAuthorInstanceId: from.instanceId, deviceId: from.deviceId, text, ...extra });
export const explicitCall = (from, to, extra = {}) => ({ actionKey: extra.actionKey || 'call-1', kind: 'call.initiate', completed: true, caller: binding(from), called: binding(to), ...extra });
