import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';
import { DIRECTOR_EVENT_TYPES } from './event-types.mjs';

const targetStore = Object.freeze({ actor: 'actors', 'character-instance': 'instances', device: 'devices', account: 'accounts', story: 'stories', branch: 'branches' });

export class DirectorMappingEditor {
  #events; #unit;
  constructor({ database, eventEngine }) { if (!database || !eventEngine) throw new TypeError('DirectorMappingEditor requires storage and Events'); this.#events = eventEngine; this.#unit = new V3UnitOfWork(database); }
  async correct({ scope: inputScope, mapping, reason, directorActorId = null, idempotencyKey }) {
    const scope = requireEventScope(inputScope); const store = targetStore[mapping?.canonicalType]; if (!store) throw new Error('Unsupported Director mapping target type');
    const target = await this.#unit.readonly({ stores: [store], scope }, repositories => repositories[store].get(mapping.canonicalId)); if (!target) throw new Error('Director mapping target does not exist in the explicit scope');
    if (target.storyId && (target.storyId !== scope.storyId || target.branchId !== scope.branchId)) throw new Error('Director mapping target is outside the explicit scope');
    const current = await this.#unit.readonly({ stores: ['identityMappings'], scope }, repositories => repositories.identityMappings.get(mapping.id));
    const corrected = Object.freeze({ ...structuredClone(mapping), storyId: ['character-instance', 'device', 'account', 'branch'].includes(mapping.canonicalType) ? scope.storyId : null, branchId: ['character-instance', 'device', 'account', 'branch'].includes(mapping.canonicalType) ? scope.branchId : null, scopeKey: ['character-instance', 'device', 'account', 'branch'].includes(mapping.canonicalType) ? `${scope.storyId}::${scope.branchId}` : '*', status: 'active', confidence: 'director-confirmed', reason, phase: 14 });
    const entityType = ['actor', 'character-instance', 'device', 'account'].includes(mapping.canonicalType) ? mapping.canonicalType : null;
    const references = entityType ? [{ entityType, id: mapping.canonicalId, role: 'mapping-target' }] : [];
    if (directorActorId) references.push({ entityType: 'actor', id: directorActorId, role: 'director-actor' });
    return this.#events.append({ scope, eventType: DIRECTOR_EVENT_TYPES.MAPPING_CORRECTION, payload: { mapping: corrected, reason, priorMappingId: current?.id || null }, references, causes: [], source: { authority: 'tmrw-director', kind: 'mapping-correction', recordId: `director:${idempotencyKey}`, version: '1' }, producer: 'tmrw-director', idempotencyKey });
  }
}
