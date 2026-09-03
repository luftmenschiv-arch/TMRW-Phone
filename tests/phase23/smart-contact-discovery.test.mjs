import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPhase9 } from '../phase9/call-fixtures.mjs';
import { CallCoordinator } from '../../application/call-coordinator.mjs';
import { SmartContactDiscoveryCoordinator, extractSmartPhoneEvidence } from '../../application/smart-contact-discovery.mjs';
import { PHONE_NUMBER_DISCOVERY } from '../../ui/experience-presets.mjs';
import { createSillyTavernV3RuntimeIntegration } from '../../platform/sillytavern/runtime-integration.mjs';

class FakeEventSource {
  #listeners = new Map();
  on(type, handler) { if (!this.#listeners.has(type)) this.#listeners.set(type, []); this.#listeners.get(type).push(handler); }
  removeListener(type, handler) { const rows = this.#listeners.get(type) || []; this.#listeners.set(type, rows.filter(row => row !== handler)); }
  async emit(type, ...args) { for (const handler of [...(this.#listeners.get(type) || [])]) await handler(...args); }
}
const EVENT_TYPES = Object.freeze({ MESSAGE_SENT: 'sent', MESSAGE_RECEIVED: 'received', MESSAGE_SWIPED: 'swiped', MESSAGE_EDITED: 'edited', MESSAGE_DELETED: 'deleted', IMPERSONATE_READY: 'impersonate' });

function source(person, text, id = 'chat:1') {
  return Object.freeze({
    origin: 'main-rp', mode: 'normal', role: 'assistant', text,
    sourceMessageId: id,
    actorBinding: Object.freeze({ actorId: person.actorId, instanceId: person.instanceId, accountId: person.accountId, deviceId: person.deviceId }),
  });
}

async function setup() {
  const c = await setupPhase9({ castSize: 3, manifestId: 'p23-smart-contact' });
  const smart = new SmartContactDiscoveryCoordinator({
    database: c.database,
    contactService: c.contacts,
    settingsService: c.settings,
    resolvePlayerIdentity: async () => Object.freeze({ actorId: c.user.actorId, instanceId: c.user.instanceId, accountId: c.user.accountId, deviceId: c.user.deviceId }),
    now: () => '2026-09-02T04:00:00.000Z',
  });
  const coordinator = new CallCoordinator({ database: c.database, callService: c.calls, phoneStateService: c.phones });
  return { ...c, smart, coordinator };
}

test('Smart + explicit visible self-number evidence uses ContactService semantics and becomes a Calls dial target', async () => {
  const c = await setup();
  const result = await c.smart.evaluate({ scope: c.scope, source: source(c.alice, 'If you need me, my phone number is +1 555 018 1818.', 'chat:alice-number') });
  assert.equal(result.discovered, true);
  assert.equal(result.replayed, false);
  assert.equal(result.contact.targetActorId, c.alice.actorId);
  assert.equal(result.contact.targetInstanceId, c.alice.instanceId);
  assert.equal(result.contact.provenanceKind, 'story-event');
  assert.equal(result.contact.playerOnlyAvailability, true);
  const contacts = await c.contacts.listContacts({ scope: c.scope, ownerAccountId: c.user.accountId });
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].targetInstanceId, c.alice.instanceId);
  const view = await c.coordinator.view({ scope: c.scope, deviceId: c.user.deviceId, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, contacts });
  assert.deepEqual(view.dialTargets.map(row => row.accountId), [c.alice.accountId]);
});

test('Smart + insufficient evidence does not fabricate a Contact or infer ownership from unrelated digits', async () => {
  const c = await setup();
  const result = await c.smart.evaluate({ scope: c.scope, source: source(c.alice, 'Meet me in room 12345 tomorrow.', 'chat:no-phone-evidence') });
  assert.equal(result.discovered, false);
  assert.equal(result.reason, 'insufficient-explicit-evidence');
  assert.deepEqual(await c.contacts.listContacts({ scope: c.scope, ownerAccountId: c.user.accountId }), []);
});

test('Smart recognizes explicit phone-relationship evidence without fabricating an unavailable number value', async () => {
  const c = await setup();
  const writesBefore = c.database.diagnostics.writeCount;
  const result = await c.smart.evaluate({ scope: c.scope, source: source(c.alice, 'ถ้าตื่นมาแล้วกล้าลบเบอร์ฉันทิ้งอีกรอบ เราคุยกันยาวแน่', 'chat:relationship-without-value') });
  assert.equal(result.evaluated, true);
  assert.equal(result.eligible, true);
  assert.equal(result.discovered, false);
  assert.equal(result.reason, 'eligible-number-value-unavailable');
  assert.equal(result.evidence.number, null);
  assert.equal(c.database.diagnostics.writeCount, writesBefore);
  assert.deepEqual(await c.contacts.listContacts({ scope: c.scope, ownerAccountId: c.user.accountId }), []);
});

test('canonical Character/Account existence alone is never sufficient Smart discovery evidence', async () => {
  const c = await setup();
  assert.ok(c.alice.actorId && c.alice.instanceId && c.alice.accountId && c.alice.deviceId);
  const result = await c.smart.evaluate({ scope: c.scope, source: source(c.alice, 'I am here.', 'chat:identity-only') });
  assert.equal(result.discovered, false);
  assert.deepEqual(await c.contacts.listContacts({ scope: c.scope, ownerAccountId: c.user.accountId }), []);
});

test('repeated Smart evaluation is idempotent and does not rewrite an already-proven Contact', async () => {
  const c = await setup();
  const input = { scope: c.scope, source: source(c.alice, 'เบอร์โทรศัพท์ของฉันคือ 081-234-5678', 'chat:thai-number') };
  const first = await c.smart.evaluate(input);
  assert.equal(first.discovered, true);
  const writesAfterFirst = c.database.diagnostics.writeCount;
  const second = await c.smart.evaluate(input);
  assert.equal(second.discovered, true);
  assert.equal(second.replayed, true);
  assert.equal(c.database.diagnostics.writeCount, writesAfterFirst);
  const contacts = await c.contacts.listContacts({ scope: c.scope, ownerAccountId: c.user.accountId });
  assert.equal(contacts.length, 1);
});

test('Smart player-visible discovery is isolated to My Phone account and does not leak into Their Phone Contacts', async () => {
  const c = await setup();
  await c.smart.evaluate({ scope: c.scope, source: source(c.alice, 'Call me at 555-0182.', 'chat:private-player-evidence') });
  const mine = await c.contacts.listContacts({ scope: c.scope, ownerAccountId: c.user.accountId });
  const theirs = await c.contacts.listContacts({ scope: c.scope, ownerAccountId: c.alice.accountId });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].targetInstanceId, c.alice.instanceId);
  assert.deepEqual(theirs, []);
});

test('a genuinely undiscovered Character remains unavailable to Calls', async () => {
  const c = await setup();
  await c.smart.evaluate({ scope: c.scope, source: source(c.alice, 'See you later.', 'chat:undiscovered') });
  const contacts = await c.contacts.listContacts({ scope: c.scope, ownerAccountId: c.user.accountId });
  const view = await c.coordinator.view({ scope: c.scope, deviceId: c.user.deviceId, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, contacts });
  assert.deepEqual(view.dialTargets, []);
});

test('existing explicit/manual Contact discovery path remains valid and is not replaced by Smart', async () => {
  const c = await setup();
  await c.contacts.discoverNumber({ scope: c.scope, ownerAccountId: c.user.accountId, number: '5550199', provenance: { kind: 'manual', sourceRecordId: 'manual:1' } });
  await c.contacts.linkContact({ scope: c.scope, ownerAccountId: c.user.accountId, number: '5550199', targetActorId: c.bob.actorId, targetInstanceId: c.bob.instanceId, savedName: 'Bob manual' });
  const contacts = await c.contacts.listContacts({ scope: c.scope, ownerAccountId: c.user.accountId });
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].provenanceKind, 'manual');
  assert.equal(contacts[0].targetInstanceId, c.bob.instanceId);
});

test('Smart does not reinterpret On/Off modes as unconditional automatic Character discovery', async () => {
  for (const mode of [PHONE_NUMBER_DISCOVERY.ON, PHONE_NUMBER_DISCOVERY.OFF]) {
    const c = await setup();
    await c.settings.setPhoneNumberDiscovery({ scope: c.scope, playerInstanceId: c.user.instanceId, value: mode });
    const result = await c.smart.evaluate({ scope: c.scope, source: source(c.alice, 'My phone number is 5550188.', `chat:${mode}`) });
    assert.equal(result.discovered, false);
    assert.equal(result.reason, `mode-${mode}`);
    assert.deepEqual(await c.contacts.listContacts({ scope: c.scope, ownerAccountId: c.user.accountId }), []);
  }
});

test('Smart evidence parser preserves relationship evidence but withholds ambiguous number values and non-assistant sources', () => {
  const ambiguous = extractSmartPhoneEvidence(source({ actorId: 'a', instanceId: 'i' }, 'My number is 5550100 or 5550101.', 'chat:ambiguous'));
  assert.equal(ambiguous.relationshipEvidence, true);
  assert.equal(ambiguous.number, null);
  assert.equal(extractSmartPhoneEvidence({ ...source({ actorId: 'a', instanceId: 'i' }, 'My number is 5550100.', 'chat:user'), role: 'user' }), null);
});

test('runtime message lifecycle evaluates new assistant evidence through Smart without a second sync system', async () => {
  const c = await setup();
  const chat = [];
  const eventSource = new FakeEventSource();
  const context = { chatId: 'smart-runtime-new', chat };
  const runtime = createSillyTavernV3RuntimeIntegration({
    eventSource,
    eventTypes: EVENT_TYPES,
    getContext: () => context,
    scopeResolver: async () => c.scope,
    bindingResolver: async ({ message }) => ({ actorBinding: message?.is_user ? c.user : c.alice, mentionBindings: {}, explicitPhoneActions: [] }),
    handoffCoordinator: { processSource: async () => Object.freeze({}), retractSource: async () => Object.freeze([]) },
    phoneContextBuilder: null,
    smartContactDiscovery: c.smart,
    authoringEnabled: () => true,
  });
  assert.equal(runtime.register(), true);
  chat.push({ is_user: false, mes: 'My phone number is 555-0177.' });
  await eventSource.emit(EVENT_TYPES.MESSAGE_RECEIVED, 0, 'normal');
  const contacts = await c.contacts.listContacts({ scope: c.scope, ownerAccountId: c.user.accountId });
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].targetInstanceId, c.alice.instanceId);
  assert.equal(runtime.metrics.smartContactDiscoveries, 1);
  runtime.unregister();
});

test('bounded current-chat reconciliation discovers pre-existing evidence idempotently', async () => {
  const c = await setup();
  const chat = [
    { is_user: false, mes: 'Nothing relevant here.' },
    { is_user: false, mes: 'โทรหาฉันได้ถ้ามีปัญหา' },
    { is_user: false, mes: 'เบอร์ของฉันคือ 089 111 2233' },
    { is_user: true, mes: 'โอเค' },
  ];
  const runtime = createSillyTavernV3RuntimeIntegration({
    eventSource: new FakeEventSource(), eventTypes: EVENT_TYPES, getContext: () => ({ chatId: 'smart-runtime-history', chat }), scopeResolver: async () => c.scope,
    bindingResolver: async ({ message }) => ({ actorBinding: message?.is_user ? c.user : c.alice, mentionBindings: {}, explicitPhoneActions: [] }),
    handoffCoordinator: { processSource: async () => Object.freeze({}), retractSource: async () => Object.freeze([]) }, phoneContextBuilder: null, smartContactDiscovery: c.smart, authoringEnabled: () => true,
  });
  const first = await runtime.reconcileSmartContactDiscovery({ maxMessages: 100 });
  assert.equal(first.candidates, 2);
  assert.equal(first.eligibleWithoutValue, 1);
  assert.equal(first.discovered, 1);
  const writes = c.database.diagnostics.writeCount;
  const second = await runtime.reconcileSmartContactDiscovery({ maxMessages: 100 });
  assert.equal(second.replayed, 1);
  assert.equal(c.database.diagnostics.writeCount, writes);
  assert.equal((await c.contacts.listContacts({ scope: c.scope, ownerAccountId: c.user.accountId })).length, 1);
});
