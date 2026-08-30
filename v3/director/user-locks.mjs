import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';
import { requireText } from '../domain/identity/identity-record.mjs';
import { DIRECTOR_EVENT_TYPES } from './event-types.mjs';

export const directorLockId = (scope, targetKind, targetId, field) => `director-lock:${scope.storyId}:${scope.branchId}:${targetKind}:${targetId}:${field}`;

export class DirectorUserLockService {
  #events; #unit;
  constructor({ database, eventEngine }) { if (!database || !eventEngine) throw new TypeError('DirectorUserLockService requires storage and Events'); this.#events = eventEngine; this.#unit = new V3UnitOfWork(database); }
  async set({ scope: inputScope, targetKind, targetId, field, value, locked = true, reason, lockedByActorId = null, idempotencyKey }) {
    const scope = requireEventScope(inputScope); const kind = requireText(targetKind, 'targetKind'); const id = requireText(targetId, 'targetId'); const name = requireText(field, 'field'); const lockId = directorLockId(scope, kind, id, name);
    const references = lockedByActorId ? [{ entityType: 'actor', id: lockedByActorId, role: 'director-actor' }] : [];
    return this.#events.append({ scope, eventType: DIRECTOR_EVENT_TYPES.VALUE_LOCK, payload: { lockId, targetKind: kind, targetId: id, field: name, value, locked, reason: requireText(reason, 'reason'), lockedByActorId }, references, causes: [], source: { authority: 'tmrw-director', kind: 'value-lock', recordId: `director:${idempotencyKey}`, version: '1' }, producer: 'tmrw-director', idempotencyKey });
  }
  async get(scopeInput, targetKind, targetId, field) { const scope = requireEventScope(scopeInput); return this.#unit.readonly({ stores: ['directorUserLocks'], scope }, repositories => repositories.directorUserLocks.get(directorLockId(scope, targetKind, targetId, field))); }
  setPin(input) { return this.set({ ...input, targetKind: 'device', field: 'pin' }); }
  setSavedContactName(input) { return this.set({ ...input, targetKind: 'contact-link', field: 'savedName' }); }
}
