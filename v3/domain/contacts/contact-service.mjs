import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { requireEventScope } from '../events/event-validator.mjs';
import { requireText } from '../identity/identity-record.mjs';
import { contactLinkId, normalizeSavedName } from './contact-link.mjs';
import { contactPointId } from './contact-point.mjs';
import { normalizeDiscoveryProvenance } from './discovery-provenance.mjs';
import { normalizePhoneNumber, phoneNumberId } from './phone-number.mjs';

export class ContactService {
  #unitOfWork;
  constructor({ database }) { if (!database) throw new TypeError('ContactService requires the isolated v3 database'); this.#unitOfWork = new V3UnitOfWork(database); }
  async #account(scope, accountId) { return this.#unitOfWork.readonly({ stores: ['accounts'], scope }, async repositories => { const account = await repositories.accounts.get(requireText(accountId, 'ownerAccountId')); if (!account) throw new Error('Unknown scoped Contact owner Account'); return account; }); }
  async #identity(scope, actorId, instanceId) { return this.#unitOfWork.readonly({ stores: ['actors', 'instances'], scope }, async repositories => { const [actor, instance] = await Promise.all([repositories.actors.get(requireText(actorId, 'targetActorId')), repositories.instances.get(requireText(instanceId, 'targetInstanceId'))]); if (!actor || !instance || instance.actorId !== actor.id) throw new Error('Contact link Actor/Character Instance is invalid for this Story/Branch'); return { actor, instance }; }); }
  async discoverNumber({ scope: inputScope, ownerAccountId, number, provenance = {}, displayNumber = null }) {
    const scope = requireEventScope(inputScope); const account = await this.#account(scope, ownerAccountId); const normalizedNumber = normalizePhoneNumber(number); const id = phoneNumberId(scope, account.id, normalizedNumber); const pointId = contactPointId(scope, account.id, id); const discovery = normalizeDiscoveryProvenance(provenance);
    return this.#unitOfWork.readwrite({ stores: ['phoneNumbers', 'contactPoints'], scope }, async repositories => {
      const existing = await repositories.phoneNumbers.get(id); const now = new Date().toISOString();
      const phoneNumber = Object.freeze({ id, storyId: scope.storyId, branchId: scope.branchId, viewerAccountId: account.id, viewerDeviceIds: [...account.deviceIds], number: normalizedNumber, displayNumber: displayNumber || normalizedNumber, ownerActorId: existing?.ownerActorId || null, ownerInstanceId: existing?.ownerInstanceId || null, identificationStatus: existing?.identificationStatus || 'unidentified', discovery: existing?.discovery || discovery, playerOnlyAvailability: true, createsCanonicalKnowledge: false, createsOwnerAwareness: false, createdAt: existing?.createdAt || now, updatedAt: now, phase: 7 });
      const point = Object.freeze({ id: pointId, storyId: scope.storyId, branchId: scope.branchId, ownerAccountId: account.id, phoneNumberId: id, kind: 'phone', createdAt: existing?.createdAt || now, updatedAt: now, phase: 7 });
      await repositories.phoneNumbers.put(phoneNumber); await repositories.contactPoints.put(point); return Object.freeze({ phoneNumber, contactPoint: point, replayed: Boolean(existing) });
    });
  }
  async linkContact({ scope: inputScope, ownerAccountId, number, targetActorId, targetInstanceId, savedName }) {
    const scope = requireEventScope(inputScope); const account = await this.#account(scope, ownerAccountId); const normalizedNumber = normalizePhoneNumber(number); const numberId = phoneNumberId(scope, account.id, normalizedNumber); const identity = await this.#identity(scope, targetActorId, targetInstanceId);
    return this.#unitOfWork.readwrite({ stores: ['phoneNumbers', 'contactPoints', 'contactLinks'], scope }, async repositories => {
      const phoneNumber = await repositories.phoneNumbers.get(numberId); if (!phoneNumber) throw new Error('A number must be discovered before it can be linked as a Contact'); const now = new Date().toISOString(); const linkId = contactLinkId(scope, account.id, numberId);
      const linkedNumber = Object.freeze({ ...phoneNumber, ownerActorId: identity.actor.id, ownerInstanceId: identity.instance.id, identificationStatus: 'identified', updatedAt: now });
      const link = Object.freeze({ id: linkId, storyId: scope.storyId, branchId: scope.branchId, ownerAccountId: account.id, phoneNumberId: numberId, targetActorId: identity.actor.id, targetInstanceId: identity.instance.id, savedName: normalizeSavedName(savedName), lockedByUser: false, playerOnlyAvailability: true, createsCanonicalKnowledge: false, createsOwnerAwareness: false, createdAt: (await repositories.contactLinks.get(linkId))?.createdAt || now, updatedAt: now, phase: 7 });
      await repositories.phoneNumbers.put(linkedNumber); await repositories.contactPoints.put(Object.freeze({ id: contactPointId(scope, account.id, numberId), storyId: scope.storyId, branchId: scope.branchId, ownerAccountId: account.id, phoneNumberId: numberId, kind: 'phone', createdAt: now, updatedAt: now, phase: 7 })); await repositories.contactLinks.put(link); return Object.freeze({ phoneNumber: linkedNumber, contactLink: link });
    });
  }
  async listContacts({ scope: inputScope, ownerAccountId, limit = 100 }) {
    const scope = requireEventScope(inputScope); const account = await this.#account(scope, ownerAccountId); if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new TypeError('Contact limit must be 1–500');
    return this.#unitOfWork.readonly({ stores: ['contactPoints', 'phoneNumbers', 'contactLinks'], scope }, async repositories => {
      const points = await repositories.contactPoints.listByIndex('by_scope_account', [scope.storyId, scope.branchId, account.id]); const rows = [];
      for (const point of points.slice(0, limit)) { const number = await repositories.phoneNumbers.get(point.phoneNumberId); if (!number) continue; const link = await repositories.contactLinks.get(contactLinkId(scope, account.id, point.phoneNumberId)); rows.push(Object.freeze({ contactPointId: point.id, phoneNumberId: number.id, number: number.displayNumber, identificationStatus: number.identificationStatus, targetActorId: link?.targetActorId || null, targetInstanceId: link?.targetInstanceId || null, savedName: link?.savedName || null, provenanceKind: number.discovery.kind, playerOnlyAvailability: true })); }
      return Object.freeze(rows.sort((left, right) => (left.savedName || left.number).localeCompare(right.savedName || right.number)));
    });
  }
}
