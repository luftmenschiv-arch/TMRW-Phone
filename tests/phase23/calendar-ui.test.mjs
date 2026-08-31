import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { CanonicalEventEngine } from '../../domain/events/event-transaction.mjs';
import { StoryChronologyService } from '../../domain/time/chronology-service.mjs';
import { createPhase23EventTypeRegistry } from '../../domain/utilities/phone-world-event-types.mjs';
import { createPhoneWorldProjector } from '../../domain/utilities/phone-world-projector.mjs';
import { PhoneWorldService } from '../../domain/utilities/phone-world-service.mjs';
import { CalendarAppService } from '../../application/calendar-app-service.mjs';
import { PhoneShellViewModels } from '../../ui/view-models.mjs';
import { TmrwPhoneShell } from '../../ui/shell.mjs';
import { setupPhase17, phase17Projectors } from '../phase17/notification-fixtures.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(predicate) { for (let index = 0; index < 120; index += 1) { if (await predicate()) return; await settle(); } throw new Error('Calendar UI did not settle'); }
function find(node, predicate) { if (predicate(node)) return node; for (const child of node.children || []) { const hit = find(child, predicate); if (hit) return hit; } return null; }
function allText(node, out = []) { if (node.textContent) out.push(String(node.textContent)); for (const child of node.children || []) allText(child, out); return out.join(' '); }

async function setupCalendarUi(manifestId = 'p23-calendar-ui', { calendarOverride = null } = {}) {
  const c = await setupPhase17({ castSize: 3, manifestId });
  const engine = new CanonicalEventEngine({ database: c.database, eventTypes: createPhase23EventTypeRegistry(), projectors: [...phase17Projectors(), createPhoneWorldProjector()], now: () => '2026-08-31T05:00:00.000Z' });
  await engine.catchUp(c.scope);
  const phoneWorld = new PhoneWorldService({ database: c.database, eventEngine: engine });
  const chronology = new StoryChronologyService({ database: c.database, eventEngine: engine });
  const calendar = new CalendarAppService({ database: c.database, phoneWorldService: phoneWorld, chronologyService: chronology });
  const calendarService = calendarOverride ? calendarOverride(calendar) : calendar;
  const viewModels = new PhoneShellViewModels({ database: c.database, phoneStateService: c.phones, contactService: c.contacts, settingsService: c.settings, messageService: c.messages, callService: c.calls, socialService: c.social, insungramService: c.insungram, liveService: c.live, notificationService: c.notifications, phoneWorldService: phoneWorld, calendarService });
  return { ...c, engine, phoneWorld, chronology, calendar, viewModels };
}

function shellFor(c, selectedDeviceId = c.user.deviceId) { return new TmrwPhoneShell({ document: c.document, viewModels: c.viewModels, controller: c.controller, messageService: c.messages, callService: c.calls, callCoordinator: c.viewModels.callCoordinator, socialService: c.social, notificationService: c.notifications, scope: c.scope, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, selectedDeviceId }); }
async function open(shell, route) { const button = find(shell.root, node => node.dataset?.route === route); assert.ok(button, `missing ${route}`); button.click(); await settle(); return shell.root.children[3].children[0]; }

async function addContact(c, person, number, label) {
  await c.contacts.discoverNumber({ scope: c.scope, ownerAccountId: c.user.accountId, number, provenance: { kind: 'note', sourceRecordId: `calendar-contact-${person.instanceId}` } });
  await c.contacts.linkContact({ scope: c.scope, ownerAccountId: c.user.accountId, number, targetActorId: person.actorId, targetInstanceId: person.instanceId, savedName: label });
}

test('C2-4 Calendar route shows observable loading, then truthful empty state and real Back', async () => {
  let release;
  const c = await setupCalendarUi('p23-calendar-loading', { calendarOverride: calendar => ({
    list: input => new Promise((resolve, reject) => { release = () => calendar.list(input).then(resolve, reject); }),
    createReminder: input => calendar.createReminder(input), createInvitation: input => calendar.createInvitation(input), acceptInvitation: input => calendar.acceptInvitation(input), declineInvitation: input => calendar.declineInvitation(input),
  }) });
  const shell = shellFor(c); await shell.mount(c.target);
  const button = find(shell.root, node => node.dataset?.route === 'calendar'); assert.ok(button); button.click();
  await waitFor(() => Boolean(find(shell.root, node => node.attributes?.get?.('role') === 'status' && /Loading Calendar/.test(node.textContent))));
  release(); await waitFor(() => /No calendar items/.test(allText(shell.root)));
  const panel = shell.root.children[3].children[0];
  assert.match(allText(panel), /Opening this app never advances story time/);
  const back = find(panel, node => node.dataset?.navAction === 'back'); assert.ok(back); back.click(); await settle();
  assert.equal(shell.root.children[2].hidden, false);
});

test('C2-4 Cancel create form performs zero canonical writes; Reminder create is one-shot and uses Story time', async () => {
  const c = await setupCalendarUi('p23-calendar-create-reminder');
  const shell = shellFor(c); await shell.mount(c.target); let panel = await open(shell, 'calendar');
  const beforeEvents = (await c.engine.listEvents(c.scope)).length;
  find(panel, node => node.dataset?.calendarAction === 'new-reminder').click(); await settle(); panel = shell.root.children[3].children[0];
  find(panel, node => node.dataset?.calendarAction === 'cancel-create').click(); await settle();
  assert.equal((await c.engine.listEvents(c.scope)).length, beforeEvents);

  panel = shell.root.children[3].children[0]; find(panel, node => node.dataset?.calendarAction === 'new-reminder').click(); await settle(); panel = shell.root.children[3].children[0];
  const title = find(panel, node => node.attributes?.get?.('aria-label') === 'Calendar title'); const time = find(panel, node => node.attributes?.get?.('aria-label') === 'Story time');
  title.value = 'Pack bag'; time.value = '18:30';
  const submit = find(panel, node => node.dataset?.calendarAction === 'submit-create'); submit.click(); submit.click();
  await waitFor(async () => (await c.calendar.list({ scope: c.scope, deviceId: c.user.deviceId })).items.length === 1);
  const view = await c.calendar.list({ scope: c.scope, deviceId: c.user.deviceId });
  assert.equal(view.items.length, 1); assert.equal(view.items[0].itemKind, 'reminder'); assert.equal(view.items[0].due.localTime, '18:30:00');
});

test('C2-4 Invitation form uses identified Contacts, creates recipient-private copies, and submit is one-shot', async () => {
  const c = await setupCalendarUi('p23-calendar-create-invite'); await addContact(c, c.alice, '5551001', 'Alice'); await addContact(c, c.bob, '5551002', 'Bob');
  const shell = shellFor(c); await shell.mount(c.target); let panel = await open(shell, 'calendar');
  find(panel, node => node.dataset?.calendarAction === 'new-invitation').click(); await settle(); panel = shell.root.children[3].children[0];
  const recipients = [c.alice, c.bob].map(person => find(panel, node => node.dataset?.calendarRecipientInstanceId === person.instanceId)); recipients.forEach(button => { assert.ok(button); button.click(); });
  const title = find(panel, node => node.attributes?.get?.('aria-label') === 'Calendar title'); const time = find(panel, node => node.attributes?.get?.('aria-label') === 'Story time'); title.value = 'Dinner'; time.value = '19:00';
  const submit = find(panel, node => node.dataset?.calendarAction === 'submit-create'); submit.click(); submit.click();
  await waitFor(async () => (await c.calendar.list({ scope: c.scope, deviceId: c.alice.deviceId })).items.length === 1 && (await c.calendar.list({ scope: c.scope, deviceId: c.bob.deviceId })).items.length === 1);
  const owner = await c.calendar.list({ scope: c.scope, deviceId: c.user.deviceId }); const alice = await c.calendar.list({ scope: c.scope, deviceId: c.alice.deviceId }); const bob = await c.calendar.list({ scope: c.scope, deviceId: c.bob.deviceId });
  assert.equal(owner.items.length, 1); assert.equal(owner.items[0].response, 'accepted'); assert.equal(alice.items[0].response, 'pending'); assert.equal(bob.items[0].response, 'pending');
  assert.equal(owner.items[0].pendingId, alice.items[0].pendingId); assert.equal(alice.items[0].pendingId, bob.items[0].pendingId);
});

test('C2-4 device switch clears transient Calendar form and unauthorized Their Phone reveals no calendar content', async () => {
  const c = await setupCalendarUi('p23-calendar-device-switch'); await c.calendar.createReminder({ scope: c.scope, deviceId: c.user.deviceId, ownerActorId: c.user.actorId, ownerInstanceId: c.user.instanceId, ownerAccountId: c.user.accountId, title: 'Private reminder', due: { kind: 'ordinal', targetOrdinal: 20 }, source: { authority: 'calendar-ui-test', kind: 'test', recordId: 'private-reminder', version: '1' }, producer: 'calendar-ui-test', idempotencyKey: 'private-reminder' });
  const shell = shellFor(c); await shell.mount(c.target); let panel = await open(shell, 'calendar'); find(panel, node => node.dataset?.calendarAction === 'new-reminder').click(); await settle();
  assert.ok(find(shell.root, node => node.dataset?.calendarForm === 'reminder'));
  await shell.selectDevice(c.alice.deviceId); panel = shell.root.children[3].children[0]; assert.match(allText(panel), /Calendar is unavailable until access to this phone is granted|access/i); assert.doesNotMatch(allText(panel), /Private reminder/);
  await shell.selectDevice(c.user.deviceId); panel = shell.root.children[3].children[0]; assert.equal(find(panel, node => node.dataset?.calendarForm), null); assert.match(allText(panel), /Private reminder/);
});

test('C2-4 Calendar service failure becomes recoverable error UI without permanent spinner', async () => {
  const c = await setupCalendarUi('p23-calendar-error', { calendarOverride: calendar => ({
    list: async () => { throw new Error('Injected Calendar read failure'); },
    createReminder: input => calendar.createReminder(input), createInvitation: input => calendar.createInvitation(input), acceptInvitation: input => calendar.acceptInvitation(input), declineInvitation: input => calendar.declineInvitation(input),
  }) });
  const shell = shellFor(c); await shell.mount(c.target); const panel = await open(shell, 'calendar');
  assert.match(allText(panel), /Calendar error: Injected Calendar read failure/);
  assert.equal(find(panel, node => node.attributes?.get?.('role') === 'status'), null);
  assert.ok(find(panel, node => node.dataset?.navAction === 'back'));
});

test('C2-4 Calendar CSS is mobile-bounded, wraps actions, and uses standard 44px touch controls', async () => {
  const css = await fs.readFile(new URL('../../ui/styles.css', import.meta.url), 'utf8');
  assert.match(css, /tmrw-v3-calendar\{min-width:0/); assert.match(css, /tmrw-v3-calendar-form input\{width:100%;min-width:0;min-height:44px/); assert.match(css, /tmrw-v3-calendar-create-actions.*flex-wrap:wrap/); assert.match(css, /tmrw-v3-calendar button\{white-space:normal/); assert.match(css, /tmrw-v3-shell button\{min-height:44px/);
});
