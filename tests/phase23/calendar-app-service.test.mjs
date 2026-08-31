import test from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalEventEngine } from '../../domain/events/event-transaction.mjs';
import { StoryChronologyService } from '../../domain/time/chronology-service.mjs';
import { createPhase23EventTypeRegistry } from '../../domain/utilities/phone-world-event-types.mjs';
import { createPhoneWorldProjector } from '../../domain/utilities/phone-world-projector.mjs';
import { PhoneWorldService } from '../../domain/utilities/phone-world-service.mjs';
import { CalendarAppService } from '../../application/calendar-app-service.mjs';
import { setupPhase17, phase17Projectors } from '../phase17/notification-fixtures.mjs';
import { ownedInput, utilitySource } from './phone-world-foundation-fixtures.mjs';

function action(c, person, recordId, key, extra = {}) {
  return { scope: c.scope, ...ownedInput(person), recordId, source: utilitySource(key), producer: 'phase23-calendar-test', idempotencyKey: key, ...extra };
}

async function setupCalendar(manifestId = 'p23-calendar-app') {
  const c = await setupPhase17({ castSize: 3, manifestId });
  const engine = new CanonicalEventEngine({
    database: c.database,
    eventTypes: createPhase23EventTypeRegistry(),
    projectors: [...phase17Projectors(), createPhoneWorldProjector()],
    now: () => '2026-08-31T04:30:00.000Z',
  });
  await engine.catchUp(c.scope);
  const phoneWorld = new PhoneWorldService({ database: c.database, eventEngine: engine });
  const chronology = new StoryChronologyService({ database: c.database, eventEngine: engine });
  const calendar = new CalendarAppService({ database: c.database, phoneWorldService: phoneWorld, chronologyService: chronology });
  return { ...c, engine, utilityEngine: engine, phoneWorld, chronology, calendar };
}

test('C2-4 PendingWorldEvent is shared world state; one recipient decline never cancels another invitation', async () => {
  const c = await setupCalendar('p23-calendar-shared-pending');
  const created = await c.calendar.createInvitation(action(c, c.user, null, 'invite-team', {
    title: 'Team dinner',
    due: { kind: 'absolute', localDate: '2026-09-02', localTime: '19:00' },
    participantInstanceIds: [c.alice.instanceId, c.bob.instanceId],
  }));
  assert.equal(created.invitations.length, 2);
  const pendingId = created.pendingEvent.payload.pending.pendingId;
  let pending = await c.chronology.getPending(c.scope, pendingId);
  assert.equal(pending.lifecycleStatus, 'pending');
  assert.deepEqual(new Set(pending.relevantInstanceIds), new Set([c.user.instanceId, c.alice.instanceId, c.bob.instanceId]));

  const aliceView = await c.calendar.list({ scope: c.scope, deviceId: c.alice.deviceId });
  const bobView = await c.calendar.list({ scope: c.scope, deviceId: c.bob.deviceId });
  assert.equal(aliceView.items.length, 1); assert.equal(aliceView.items[0].response, 'pending');
  assert.equal(bobView.items.length, 1); assert.equal(bobView.items[0].response, 'pending');
  assert.equal(aliceView.items[0].pendingId, pendingId); assert.equal(bobView.items[0].pendingId, pendingId);

  const beforeEvents = (await c.utilityEngine.listEvents(c.scope)).length;
  const declined = await c.calendar.declineInvitation(action(c, c.alice, aliceView.items[0].recordId, 'alice-decline'));
  assert.equal(declined.item.response, 'declined');
  assert.equal(declined.pendingTransition, null);
  pending = await c.chronology.getPending(c.scope, pendingId);
  assert.equal(pending.lifecycleStatus, 'pending');
  const bobAfter = await c.calendar.list({ scope: c.scope, deviceId: c.bob.deviceId });
  assert.equal(bobAfter.items[0].response, 'pending');
  assert.equal(bobAfter.items[0].pending.lifecycleStatus, 'pending');
  const afterFirst = (await c.utilityEngine.listEvents(c.scope)).length;
  await c.calendar.declineInvitation(action(c, c.alice, aliceView.items[0].recordId, 'alice-decline'));
  assert.equal((await c.utilityEngine.listEvents(c.scope)).length, afterFirst);
  assert.ok(afterFirst > beforeEvents);
});

test('C2-4 Accept changes only the acting Calendar copy, is idempotent, and never advances Story Clock', async () => {
  const c = await setupCalendar('p23-calendar-accept');
  const created = await c.calendar.createInvitation(action(c, c.user, null, 'invite-alice', {
    title: 'Study session', due: { kind: 'ordinal', targetOrdinal: 50 }, participantInstanceIds: [c.alice.instanceId],
  }));
  const aliceItem = (await c.calendar.list({ scope: c.scope, deviceId: c.alice.deviceId })).items[0];
  const clockBefore = await c.chronology.readClock(c.scope);
  const accepted = await c.calendar.acceptInvitation(action(c, c.alice, aliceItem.recordId, 'alice-accept'));
  assert.equal(accepted.item.response, 'accepted');
  assert.deepEqual(await c.chronology.readClock(c.scope), clockBefore);
  const pending = await c.chronology.getPending(c.scope, created.pendingEvent.payload.pending.pendingId);
  assert.equal(pending.lifecycleStatus, 'pending');
  const eventCount = (await c.utilityEngine.listEvents(c.scope)).length;
  const replay = await c.calendar.acceptInvitation(action(c, c.alice, aliceItem.recordId, 'alice-accept'));
  assert.equal(replay.replayed, true);
  assert.equal((await c.utilityEngine.listEvents(c.scope)).length, eventCount);
  await assert.rejects(() => c.calendar.acceptInvitation(action(c, c.bob, aliceItem.recordId, 'bob-cannot-accept')), /another Account\/Device/i);
});

test('C2-4 Reminder and Calendar reads are Story Clock projections only: opening/listing never advances time', async () => {
  const c = await setupCalendar('p23-calendar-reminder');
  const clockBeforeCreate = await c.chronology.readClock(c.scope);
  const reminder = await c.calendar.createReminder(action(c, c.user, null, 'reminder-create', {
    title: 'Call Mom', due: { kind: 'relative-offset', targetElapsedMs: 3600000 },
  }));
  assert.equal(reminder.item.itemKind, 'reminder');
  const clockAfterCreate = await c.chronology.readClock(c.scope);
  assert.deepEqual(clockAfterCreate, clockBeforeCreate);
  const beforeRead = structuredClone(clockAfterCreate);
  const first = await c.calendar.list({ scope: c.scope, deviceId: c.user.deviceId });
  const second = await c.calendar.list({ scope: c.scope, deviceId: c.user.deviceId });
  assert.equal(first.items.length, 1); assert.equal(second.items[0].pending.status, 'pending');
  assert.deepEqual(await c.chronology.readClock(c.scope), beforeRead);
});

test('C2-4 Calendar is device/account private and rejects cross-Branch/foreign recipient identity', async () => {
  const c = await setupCalendar('p23-calendar-privacy');
  await c.calendar.createReminder(action(c, c.user, null, 'private-reminder', { title: 'Private', due: { kind: 'ordinal', targetOrdinal: 9 } }));
  assert.equal((await c.calendar.list({ scope: c.scope, deviceId: c.user.deviceId })).items.length, 1);
  assert.equal((await c.calendar.list({ scope: c.scope, deviceId: c.alice.deviceId })).items.length, 0);
  await assert.rejects(() => c.calendar.createInvitation(action(c, c.user, null, 'foreign-invite', { title: 'Bad', due: { kind: 'ordinal', targetOrdinal: 10 }, participantInstanceIds: ['instance_foreign'] })), /Unknown scoped Calendar participant/i);
  const child = await c.kernel.forkBranch({ manifestId: 'p23-calendar-child', parentScope: c.scope, sourceRouteId: 'calendar-child', label: 'Calendar Child' });
  const childScope = { storyId: c.scope.storyId, branchId: child.branchId };
  await assert.rejects(() => c.calendar.list({ scope: childScope, deviceId: c.user.deviceId }), /scope|Unknown scoped|out of scope/i);
  await assert.rejects(() => c.calendar.list({ scope: { storyId: 'story_foreign', branchId: c.scope.branchId }, deviceId: c.user.deviceId }), /scope|Unknown scoped|out of scope/i);
});
