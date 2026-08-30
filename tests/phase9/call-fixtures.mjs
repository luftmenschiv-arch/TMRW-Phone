import { MemoryV3Database } from '../../storage/memory-v3-database.mjs';
import { V3IdentityKernel } from '../../domain/identity/identity-kernel.mjs';
import { CanonicalEventEngine } from '../../domain/events/event-transaction.mjs';
import { createClockProjector } from '../../domain/time/clock-projector.mjs';
import { createPendingProjector } from '../../domain/time/pending-projector.mjs';
import { createActivitySessionProjector } from '../../domain/time/activity-session-projector.mjs';
import { createKnowledgeGrantProjector } from '../../domain/knowledge/grant-projector.mjs';
import { createPhoneProjector } from '../../domain/phone/phone-projector.mjs';
import { createMessagingProjector } from '../../domain/messaging/messaging-projector.mjs';
import { createCallHistoryProjector } from '../../domain/calls/call-projector.mjs';
import { createPhase9EventTypeRegistry } from '../../domain/calls/call-event-types.mjs';
import { PhoneStateService } from '../../domain/phone/phone-state.mjs';
import { PlayerAccessOverrideRepository } from '../../domain/phone/player-access-override.mjs';
import { PhoneController } from '../../application/phone-controller.mjs';
import { KnowledgeService } from '../../domain/knowledge/knowledge-service.mjs';
import { ContactService } from '../../domain/contacts/contact-service.mjs';
import { MessageService } from '../../domain/messaging/message-service.mjs';
import { CallService } from '../../domain/calls/call-service.mjs';
import { BetaSettingsService } from '../../ui/settings-beta.mjs';
import { PhoneShellViewModels } from '../../ui/view-models.mjs';
import { FakeDocument, FakeNode } from '../phase7/fake-dom.mjs';
import { identitySeed } from '../phase2/identity-fixtures.mjs';
import { createAiJobProjector } from '../../application/ai-jobs/ai-job-projector.mjs';

export const callSource = (recordId, authority = 'phase9-fixture') => ({ authority, kind: 'test', recordId, version: '1' });
export function phase9Projectors() { return [createClockProjector(), createPendingProjector(), createActivitySessionProjector(), createKnowledgeGrantProjector(), createPhoneProjector(), createMessagingProjector(), createCallHistoryProjector(), createAiJobProjector()]; }
export async function setupPhase9({ castSize = 4, manifestId = 'phase9-base', registry = MemoryV3Database.createRegistry(), database = null, projectors = null, eventTypes = null } = {}) {
  const isolatedDatabase = database || new MemoryV3Database({ registry }); if (!database) await isolatedDatabase.open();
  const kernel = new V3IdentityKernel({ database: isolatedDatabase, now: () => '2026-08-13T09:00:00.000Z' }); const identity = await kernel.seedIdentityGraph(identitySeed({ castSize, manifestId, storySourceId: `${manifestId}-story`, branchSourceId: `${manifestId}-branch` })); const scope = { storyId: identity.storyId, branchId: identity.branchId }; let tick = 0; const now = () => new Date(Date.parse('2026-08-13T09:00:00.000Z') + (++tick * 1000)).toISOString();
  const engine = new CanonicalEventEngine({ database: isolatedDatabase, eventTypes: eventTypes || createPhase9EventTypeRegistry(), projectors: projectors || phase9Projectors(), now }); const phones = new PhoneStateService({ database: isolatedDatabase, eventEngine: engine }); await phones.initializeScope(scope);
  const people = identity.actorIds.map((actorId, index) => ({ actorId, instanceId: identity.instanceIds[index], deviceId: identity.deviceIds[index], accountId: identity.accountIds[index] })); const overrides = new PlayerAccessOverrideRepository({ database: isolatedDatabase }); const controller = new PhoneController({ phoneStateService: phones, playerAccessOverrides: overrides }); const calls = new CallService({ database: isolatedDatabase, eventEngine: engine }); const messages = new MessageService({ database: isolatedDatabase, eventEngine: engine }); const knowledge = new KnowledgeService({ database: isolatedDatabase, eventEngine: engine }); const contacts = new ContactService({ database: isolatedDatabase }); const settings = new BetaSettingsService({ database: isolatedDatabase }); const viewModels = new PhoneShellViewModels({ database: isolatedDatabase, phoneStateService: phones, contactService: contacts, settingsService: settings, messageService: messages, callService: calls });
  return { registry, database: isolatedDatabase, kernel, identity, scope, engine, phones, overrides, controller, calls, messages, knowledge, contacts, settings, viewModels, people, user: people[0], alice: people[1], bob: people[2], charlie: people[3], document: new FakeDocument(), target: new FakeNode('div') };
}
export async function startCall(context, { caller = context.user, called = context.alice, actual = caller, device = caller, key = 'call', sourceMode = 'live' } = {}) { return context.calls.initiate({ scope: context.scope, participantAccountIds: [caller.accountId, called.accountId], callingAccountId: caller.accountId, calledAccountId: called.accountId, actualActorId: actual.actorId, actualInstanceId: actual.instanceId, deviceId: device.deviceId, sourceMode, source: callSource(`call:${key}`), idempotencyKey: `call:${key}` }); }
export async function transitionCall(context, sessionId, action, { actor = context.alice, device = actor, key = action, durationMs = null } = {}) { return context.calls.transition({ scope: context.scope, callSessionId: sessionId, action, actualActorId: actor.actorId, actualInstanceId: actor.instanceId, deviceId: device.deviceId, measuredDurationMs: durationMs, source: callSource(`transition:${key}`), idempotencyKey: `transition:${key}` }); }
export async function addCallText(context, sessionId, { speaker = context.user, actual = speaker, device = speaker, text = 'hello call', key = 'text', sourceMode = 'live' } = {}) { return context.calls.addTranscript({ scope: context.scope, callSessionId: sessionId, speakerAccountId: speaker.accountId, actualAuthorActorId: actual.actorId, actualAuthorInstanceId: actual.instanceId, deviceId: device.deviceId, text, sourceMode, source: callSource(`text:${key}`), idempotencyKey: `text:${key}` }); }
