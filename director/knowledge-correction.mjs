import { requireEventScope } from '../domain/events/event-validator.mjs';
import { prepareDisclosureBundle } from '../domain/knowledge/knowledge-service.mjs';
import { DIRECTOR_EVENT_TYPES } from './event-types.mjs';

export class DirectorKnowledgeCorrection {
  #events; #undo;
  constructor({ eventEngine, undoCanon }) { if (!eventEngine || !undoCanon) throw new TypeError('DirectorKnowledgeCorrection requires canonical Events and Undo Canon'); this.#events = eventEngine; this.#undo = undoCanon; }
  async grant({ scope: inputScope, bundle, reason, directorActorId = null, idempotencyKey }) {
    const scope = requireEventScope(inputScope); const disclosure = await prepareDisclosureBundle({ scope, bundle, stableKey: `director:${idempotencyKey}` });
    const references = [];
    for (const observation of disclosure.observations) { references.push({ entityType: 'actor', id: observation.targetActorId, role: 'knowledge-target-actor' }, { entityType: 'character-instance', id: observation.targetInstanceId, role: 'knowledge-target-instance' }); }
    if (directorActorId) references.push({ entityType: 'actor', id: directorActorId, role: 'director-actor' });
    return this.#events.append({ scope, eventType: DIRECTOR_EVENT_TYPES.KNOWLEDGE_CORRECTION, payload: { reason, knowledgeDisclosures: [disclosure] }, references, causes: [], source: { authority: 'tmrw-director', kind: 'knowledge-correction', recordId: `director:${idempotencyKey}`, version: '1' }, producer: 'tmrw-director', idempotencyKey });
  }
  async revokeSource({ scope, sourceEventId, reason, directorActorId = null, idempotencyKey }) { const preview = await this.#undo.preview({ scope, targetEventId: sourceEventId }); return this.#undo.undo({ scope, preview, reason, directorActorId, idempotencyKey }); }
}
