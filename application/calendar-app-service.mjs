import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';

const sourceWithSuffix = (source, suffix) => Object.freeze({ authority: source?.authority || 'tmrw-v3-calendar', kind: source?.kind || 'phone-world', recordId: `${source?.recordId || 'calendar'}:${suffix}`, version: source?.version || '1' });
const keyWithSuffix = (key, suffix) => `${String(key || 'calendar')}:${suffix}`;
const unique = values => [...new Set(values.filter(Boolean).map(String))];

export class CalendarAppService {
  #unitOfWork; #phoneWorld; #chronology;
  constructor({ database, phoneWorldService, chronologyService }) {
    if (!database || !phoneWorldService || !chronologyService) throw new TypeError('CalendarAppService requires database, PhoneWorldService and StoryChronologyService');
    this.#unitOfWork = new V3UnitOfWork(database); this.#phoneWorld = phoneWorldService; this.#chronology = chronologyService;
  }

  async #bindingForDevice(scope, deviceId, expected = {}) {
    return this.#unitOfWork.readonly({ stores: ['devices', 'instances', 'actors', 'accounts'], scope }, async repositories => {
      const device = await repositories.devices.get(String(deviceId || ''));
      if (!device) throw new Error('Unknown scoped Calendar Device');
      const instance = await repositories.instances.get(device.ownerInstanceId);
      const actor = instance && await repositories.actors.get(instance.actorId);
      if (!instance || !actor) throw new Error('Calendar Device ownership identity chain is incomplete');
      const accounts = await repositories.accounts.listByIndex('by_owner_scope', [scope.storyId, scope.branchId, instance.id]);
      const account = accounts.find(row => row.isPrimary && row.deviceIds.includes(device.id)) || accounts.find(row => row.deviceIds.includes(device.id)) || null;
      if (!account) throw new Error('Calendar Device owner has no scoped Account for this Device');
      if (expected.ownerActorId && expected.ownerActorId !== actor.id) throw new Error('Calendar ownerActorId does not match canonical Device ownership');
      if (expected.ownerInstanceId && expected.ownerInstanceId !== instance.id) throw new Error('Calendar ownerInstanceId does not match canonical Device ownership');
      if (expected.ownerAccountId && expected.ownerAccountId !== account.id) throw new Error('Calendar ownerAccountId does not match canonical Device ownership');
      return Object.freeze({ device, instance, actor, account });
    });
  }

  async #bindingForInstance(scope, instanceId) {
    return this.#unitOfWork.readonly({ stores: ['instances', 'actors', 'devices', 'accounts'], scope }, async repositories => {
      const instance = await repositories.instances.get(String(instanceId || ''));
      const actor = instance && await repositories.actors.get(instance.actorId);
      if (!instance || !actor) throw new Error(`Unknown scoped Calendar participant Character Instance: ${instanceId}`);
      const devices = (await repositories.devices.listByIndex('by_owner_scope', [scope.storyId, scope.branchId, instance.id])).slice().sort((a, b) => a.id.localeCompare(b.id));
      const accounts = (await repositories.accounts.listByIndex('by_owner_scope', [scope.storyId, scope.branchId, instance.id])).slice().sort((a, b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)) || a.id.localeCompare(b.id));
      for (const account of accounts) {
        const device = devices.find(row => account.deviceIds.includes(row.id));
        if (device) return Object.freeze({ device, instance, actor, account });
      }
      throw new Error(`Calendar participant has no scoped Account/Device binding: ${instanceId}`);
    });
  }

  async #assertItemOwner(scope, input, item) {
    const acting = await this.#bindingForDevice(scope, input.deviceId, input);
    if (item.deviceId !== acting.device.id || item.ownerAccountId !== acting.account.id || item.ownerInstanceId !== acting.instance.id || item.ownerActorId !== acting.actor.id) {
      throw new Error('Calendar invitation belongs to another Account/Device');
    }
    return acting;
  }

  async list({ scope: inputScope, deviceId }) {
    const scope = requireEventScope(inputScope);
    await this.#bindingForDevice(scope, deviceId);
    const [items, pending, clock] = await Promise.all([
      this.#phoneWorld.listCalendar({ scope, deviceId, limit: 200 }),
      this.#chronology.listPending(scope),
      this.#chronology.readClock(scope),
    ]);
    const pendingById = new Map(pending.map(row => [row.pendingId, row]));
    return Object.freeze({
      clock,
      items: Object.freeze(items.map(item => Object.freeze({ ...item, pending: item.pendingId ? (pendingById.get(item.pendingId) || null) : null }))),
    });
  }

  async createReminder(input) {
    const scope = requireEventScope(input.scope); const source = input.source; const producer = input.producer || 'phase23-calendar-app'; const key = input.idempotencyKey;
    const owner = await this.#bindingForDevice(scope, input.deviceId, input);
    const pendingResult = await this.#chronology.createPending({
      scope,
      pending: { category: 'calendar-reminder', summary: input.title, relevantActorIds: [owner.actor.id], relevantInstanceIds: [owner.instance.id], due: input.due },
      source: sourceWithSuffix(source, 'pending'), producer, idempotencyKey: keyWithSuffix(key, 'pending'),
    });
    const result = await this.#phoneWorld.setCalendarItem({ ...input, scope, deviceId: owner.device.id, ownerActorId: owner.actor.id, ownerInstanceId: owner.instance.id, ownerAccountId: owner.account.id, itemKind: 'reminder', response: 'accepted', due: pendingResult.event.payload.pending.due, pendingId: pendingResult.event.payload.pending.pendingId, participantActorIds: [owner.actor.id], participantInstanceIds: [owner.instance.id], causes: [pendingResult.event.id], source: sourceWithSuffix(source, 'item'), producer, idempotencyKey: keyWithSuffix(key, 'item') });
    return Object.freeze({ item: result.event.payload.record, event: result.event, pendingEvent: pendingResult.event, replayed: Boolean(result.replayed && pendingResult.replayed) });
  }

  async createInvitation(input) {
    const scope = requireEventScope(input.scope); const source = input.source; const producer = input.producer || 'phase23-calendar-app'; const key = input.idempotencyKey;
    const owner = await this.#bindingForDevice(scope, input.deviceId, input);
    const recipientInstanceIds = unique(input.participantInstanceIds || []).filter(id => id !== owner.instance.id);
    if (recipientInstanceIds.length === 0) throw new TypeError('Calendar invitation requires at least one recipient');
    const recipients = [];
    for (const instanceId of recipientInstanceIds) recipients.push(await this.#bindingForInstance(scope, instanceId));
    const all = [owner, ...recipients];
    const actorIds = unique(all.map(row => row.actor.id));
    const instanceIds = unique(all.map(row => row.instance.id));
    const pendingResult = await this.#chronology.createPending({
      scope,
      pending: { category: 'calendar-invitation', summary: input.title, relevantActorIds: actorIds, relevantInstanceIds: instanceIds, due: input.due },
      source: sourceWithSuffix(source, 'pending'), producer, idempotencyKey: keyWithSuffix(key, 'pending'),
    });
    const pendingId = pendingResult.event.payload.pending.pendingId;
    const copies = [];
    for (const binding of all) {
      const organizer = binding.account.id === owner.account.id;
      const suffix = `item:${binding.account.id}`;
      const itemResult = await this.#phoneWorld.setCalendarItem({
        ...input,
        scope,
        recordId: `calendar-invitation:${pendingId}:${binding.account.id}`,
        deviceId: binding.device.id,
        ownerActorId: binding.actor.id,
        ownerInstanceId: binding.instance.id,
        ownerAccountId: binding.account.id,
        itemKind: 'invitation',
        response: organizer ? 'accepted' : 'pending',
        due: pendingResult.event.payload.pending.due,
        pendingId,
        participantActorIds: actorIds,
        participantInstanceIds: instanceIds,
        causes: [pendingResult.event.id],
        source: sourceWithSuffix(source, suffix),
        producer,
        idempotencyKey: keyWithSuffix(key, suffix),
      });
      copies.push(Object.freeze({ item: itemResult.event.payload.record, event: itemResult.event, replayed: Boolean(itemResult.replayed) }));
    }
    return Object.freeze({ pendingEvent: pendingResult.event, organizer: copies[0], invitations: Object.freeze(copies.slice(1)), replayed: Boolean(pendingResult.replayed && copies.every(row => row.replayed)) });
  }

  async acceptInvitation(input) {
    const scope = requireEventScope(input.scope); const item = await this.#phoneWorld.getCalendarItem({ scope, recordId: input.recordId });
    if (!item || item.itemKind !== 'invitation') throw new Error('Calendar invitation does not exist in this Story/Branch');
    await this.#assertItemOwner(scope, input, item);
    if (item.response === 'accepted') return Object.freeze({ item, replayed: true });
    if (item.response !== 'pending') throw new Error('Calendar invitation is no longer pending');
    const source = input.source; const producer = input.producer || 'phase23-calendar-app'; const key = input.idempotencyKey;
    const result = await this.#phoneWorld.updateCalendarResponse({ ...input, scope, response: 'accepted', source: sourceWithSuffix(source, 'item-accept'), producer, idempotencyKey: keyWithSuffix(key, 'item-accept') });
    return Object.freeze({ item: result.event.payload.record, event: result.event, replayed: result.replayed });
  }

  async declineInvitation(input) {
    const scope = requireEventScope(input.scope); const item = await this.#phoneWorld.getCalendarItem({ scope, recordId: input.recordId });
    if (!item || item.itemKind !== 'invitation') throw new Error('Calendar invitation does not exist in this Story/Branch');
    await this.#assertItemOwner(scope, input, item);
    if (item.response === 'declined') return Object.freeze({ item, replayed: true });
    if (item.response !== 'pending') throw new Error('Calendar invitation is no longer pending');
    const source = input.source; const producer = input.producer || 'phase23-calendar-app'; const key = input.idempotencyKey;
    const result = await this.#phoneWorld.updateCalendarResponse({ ...input, scope, response: 'declined', source: sourceWithSuffix(source, 'item-decline'), producer, idempotencyKey: keyWithSuffix(key, 'item-decline') });
    return Object.freeze({ item: result.event.payload.record, event: result.event, pendingTransition: null, replayed: result.replayed });
  }
}
