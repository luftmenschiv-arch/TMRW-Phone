import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { requireEventScope } from '../events/event-validator.mjs';
import { requireText } from '../identity/identity-record.mjs';
import { PHONE_EVENT_TYPES } from './phone-event-types.mjs';
import { initialPhoneState, normalizePhoneState, phoneStateId } from './device-state.mjs';
import { initialAccountSession, normalizeAccountSession, accountSessionId } from './account-session.mjs';
import { createPhonePerspective } from './phone-perspective.mjs';

function refs(...records) {
  const seen = new Set();
  return records.filter(Boolean).map(record => ({ entityType: record.entityType, id: record.id, role: 'phone-state-reference' }))
    .filter(reference => { const key = `${reference.entityType}:${reference.id}:${reference.role}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

export class PhoneStateService {
  #database; #unitOfWork; #events;
  constructor({ database, eventEngine }) { if (!database || !eventEngine) throw new TypeError('PhoneStateService requires isolated v3 database and Event engine'); this.#database = database; this.#unitOfWork = new V3UnitOfWork(database); this.#events = eventEngine; }
  async #deviceChain(scope, deviceId) {
    return this.#unitOfWork.readonly({ stores: ['devices', 'instances', 'actors'], scope }, async repositories => {
      const device = await repositories.devices.get(requireText(deviceId, 'deviceId')); if (!device) throw new Error('Unknown scoped Device');
      const instance = await repositories.instances.get(device.ownerInstanceId); const actor = instance && await repositories.actors.get(instance.actorId);
      if (!instance || !actor) throw new Error('Device ownership identity chain is incomplete'); return { device, instance, actor };
    });
  }
  async #accountChain(scope, accountId) {
    return this.#unitOfWork.readonly({ stores: ['accounts', 'devices', 'instances', 'actors'], scope }, async repositories => {
      const account = await repositories.accounts.get(requireText(accountId, 'accountId')); if (!account) throw new Error('Unknown scoped Account');
      const device = await repositories.devices.get(account.deviceIds[0]); const instance = await repositories.instances.get(account.ownerInstanceId); const actor = instance && await repositories.actors.get(instance.actorId);
      if (!device || !instance || !actor) throw new Error('Account ownership identity chain is incomplete'); return { account, device, instance, actor };
    });
  }
  async #actorInstanceChain(scope, actorId, instanceId) {
    return this.#unitOfWork.readonly({ stores: ['actors', 'instances'], scope }, async repositories => {
      const [actor, instance] = await Promise.all([repositories.actors.get(requireText(actorId, 'actorId')), repositories.instances.get(requireText(instanceId, 'instanceId'))]);
      if (!actor || !instance || instance.actorId !== actor.id) throw new Error('Actor/Character Instance reference is not valid in this Story/Branch');
      return { actor, instance };
    });
  }
  async initializeScope(scopeInput, { deviceIds = null, accountIds = null } = {}) {
    const scope = requireEventScope(scopeInput);
    const selectedDeviceIds = Array.isArray(deviceIds) ? new Set(deviceIds.map(id => requireText(id, 'deviceId'))) : null;
    const selectedAccountIds = Array.isArray(accountIds) ? new Set(accountIds.map(id => requireText(id, 'accountId'))) : null;
    const identities = await this.#unitOfWork.readonly({ stores: ['devices', 'accounts', 'instances', 'actors', 'phoneStates', 'accountSessions'], scope }, async repositories => {
      const devices = (await repositories.devices.list()).filter(device => !selectedDeviceIds || selectedDeviceIds.has(device.id));
      const accounts = (await repositories.accounts.list()).filter(account => !selectedAccountIds || selectedAccountIds.has(account.id));
      const initializedDeviceIds = new Set((await repositories.phoneStates.list()).map(state => state.deviceId));
      const initializedAccountIds = new Set((await repositories.accountSessions.list()).map(session => session.accountId));
      const owners = new Map(); for (const device of devices) { const instance = await repositories.instances.get(device.ownerInstanceId); const actor = instance && await repositories.actors.get(instance.actorId); if (!instance || !actor) throw new Error('Device ownership identity chain is incomplete'); owners.set(device.id, { device, instance, actor }); }
      return { devices, accounts, owners, initializedDeviceIds, initializedAccountIds };
    });
    const results = [];
    for (const device of identities.devices) {
      if (identities.initializedDeviceIds.has(device.id)) continue;
      const owner = identities.owners.get(device.id); results.push(await this.#events.append({ scope, eventType: PHONE_EVENT_TYPES.DEVICE_STATE, payload: { state: initialPhoneState({ deviceId: device.id, ownerActorId: owner.actor.id, ownerInstanceId: owner.instance.id }) }, references: refs(device, owner.instance, owner.actor), source: { authority: 'tmrw-v3-phone-lifecycle', kind: 'internal', recordId: `initialize-device:${device.id}` }, producer: 'phone-state-service', idempotencyKey: `initialize-device:${device.id}` }));
    }
    for (const account of identities.accounts) {
      if (identities.initializedAccountIds.has(account.id)) continue;
      const owner = identities.owners.get(account.deviceIds[0]); if (!owner) throw new Error('Account is not associated with a scoped Device');
      results.push(await this.#events.append({ scope, eventType: PHONE_EVENT_TYPES.ACCOUNT_SESSION, payload: { session: initialAccountSession({ accountId: account.id, ownerActorId: owner.actor.id, ownerInstanceId: owner.instance.id, deviceId: owner.device.id }) }, references: refs(account, owner.device, owner.instance, owner.actor), source: { authority: 'tmrw-v3-phone-lifecycle', kind: 'internal', recordId: `initialize-account:${account.id}` }, producer: 'phone-state-service', idempotencyKey: `initialize-account:${account.id}` }));
    }
    return Object.freeze(results);
  }
  async getPhoneState(scopeInput, deviceId) { const scope = requireEventScope(scopeInput); return this.#unitOfWork.readonly({ stores: ['phoneStates'], scope }, repositories => repositories.phoneStates.get(phoneStateId(scope, deviceId))); }
  async getAccountSession(scopeInput, accountId) { const scope = requireEventScope(scopeInput); return this.#unitOfWork.readonly({ stores: ['accountSessions'], scope }, repositories => repositories.accountSessions.get(accountSessionId(scope, accountId))); }
  async updatePhoneState({ scope: scopeInput, deviceId, patch, source, producer, idempotencyKey }) {
    const scope = requireEventScope(scopeInput); const [current, chain] = await Promise.all([this.getPhoneState(scope, deviceId), this.#deviceChain(scope, deviceId)]); if (!current) throw new Error('Phone state must be initialized before update');
    const state = normalizePhoneState({ ...current, ...patch, deviceId: chain.device.id, deviceOwnerActorId: chain.actor.id, deviceOwnerInstanceId: chain.instance.id });
    const holder = await this.#actorInstanceChain(scope, state.currentHolderActorId, state.currentHolderInstanceId);
    return this.#events.append({ scope, eventType: PHONE_EVENT_TYPES.DEVICE_STATE, payload: { state }, references: refs(chain.device, chain.instance, chain.actor, holder.instance, holder.actor), source, producer, idempotencyKey });
  }
  async updateAccountSession({ scope: scopeInput, accountId, patch, source, producer, idempotencyKey }) {
    const scope = requireEventScope(scopeInput); const [current, chain] = await Promise.all([this.getAccountSession(scope, accountId), this.#accountChain(scope, accountId)]); if (!current) throw new Error('Account session must be initialized before update');
    const session = normalizeAccountSession({ ...current, ...patch, accountId: chain.account.id, accountOwnerActorId: chain.actor.id, accountOwnerInstanceId: chain.instance.id, deviceId: chain.device.id });
    const author = session.actualAuthorActorId ? await this.#actorInstanceChain(scope, session.actualAuthorActorId, session.actualAuthorInstanceId) : null;
    return this.#events.append({ scope, eventType: PHONE_EVENT_TYPES.ACCOUNT_SESSION, payload: { session }, references: refs(chain.account, chain.device, chain.instance, chain.actor, author?.instance, author?.actor), source, producer, idempotencyKey });
  }
  async getPerspective(scopeInput, deviceId) {
    const scope = requireEventScope(scopeInput); const [state, chain] = await Promise.all([this.getPhoneState(scope, deviceId), this.#deviceChain(scope, deviceId)]); if (!state) return null;
    const session = await this.#unitOfWork.readonly({ stores: ['accountSessions'], scope }, repositories => repositories.accountSessions.getByIndex('by_scope_device', [scope.storyId, scope.branchId, deviceId]));
    return createPhonePerspective({ state, ownerActor: chain.actor, ownerInstance: chain.instance, accountSession: session });
  }
}
