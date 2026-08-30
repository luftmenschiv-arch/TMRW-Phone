import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';
import { requireText } from '../domain/identity/identity-record.mjs';
import { requestDigest } from '../domain/events/idempotency.mjs';
import { prepareDisclosureBundle } from '../domain/knowledge/knowledge-service.mjs';
import { DIRECTOR_EVENT_TYPES } from './event-types.mjs';

export class PromoteToCanonService {
  #unit; #events;
  constructor({ database, eventEngine }) { if (!database || !eventEngine) throw new TypeError('PromoteToCanonService requires storage and Events'); this.#unit = new V3UnitOfWork(database); this.#events = eventEngine; }

  async propose({ scope: inputScope, overrideId, facts, knowledgeBundles = [], reason, requestedByActorId = null, idempotencyKey, ownerAwareness = false, ownerAwarenessEvidence = null }) {
    const scope = requireEventScope(inputScope); if (!Array.isArray(facts) || facts.length === 0) throw new TypeError('Promote to Canon requires explicit facts');
    if (ownerAwareness && !ownerAwarenessEvidence) throw new Error('Promote to Canon cannot claim owner awareness without explicit evidence');
    const override = await this.#unit.readonly({ stores: ['phonePlayerAccessOverrides'], scope }, repositories => repositories.phonePlayerAccessOverrides.get(requireText(overrideId, 'overrideId'))); if (!override?.enabled || !override.playerOnly) throw new Error('Promote to Canon requires an active player-only override');
    const proposalId = `director-promotion:${(await requestDigest({ scope, overrideId, facts, reason, idempotencyKey })).slice(0, 32)}`;
    const knowledgeDisclosures = [];
    for (const [index, bundle] of knowledgeBundles.entries()) knowledgeDisclosures.push(await prepareDisclosureBundle({ scope, bundle, stableKey: `${proposalId}:knowledge:${index}` }));
    const row = Object.freeze({ id: proposalId, proposalId, storyId: scope.storyId, branchId: scope.branchId, overrideId, facts: structuredClone(facts), knowledgeDisclosures, consequencePreview: Object.freeze({ canonicalFactsToCreate: facts.length, knowledgeGrantsToCreate: knowledgeDisclosures.reduce((sum, item) => sum + item.observations.length, 0), ownerAwarenessToCreate: ownerAwareness ? 1 : 0 }), ownerAwareness, ownerAwarenessEvidence: ownerAwarenessEvidence ? structuredClone(ownerAwarenessEvidence) : null, reason: requireText(reason, 'reason'), requestedByActorId, status: 'proposed', canonicalEventId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), playerOnlySource: true, phase: 14 });
    return this.#unit.readwrite({ stores: ['directorPromotionProposals'], scope }, async repositories => { const existing = await repositories.directorPromotionProposals.get(proposalId); if (existing) return existing; await repositories.directorPromotionProposals.put(row); return row; });
  }

  async cancel({ scope: inputScope, proposalId, reason = 'cancelled-by-user' }) {
    const scope = requireEventScope(inputScope); return this.#unit.readwrite({ stores: ['directorPromotionProposals'], scope }, async repositories => { const current = await repositories.directorPromotionProposals.get(proposalId); if (!current || current.status !== 'proposed') throw new Error('Only a pending Promote-to-Canon proposal can be cancelled'); const next = Object.freeze({ ...current, status: 'cancelled', cancellationReason: String(reason).slice(0, 256), updatedAt: new Date().toISOString() }); await repositories.directorPromotionProposals.put(next); return next; });
  }

  async confirm({ scope: inputScope, proposalId, directorActorId = null, idempotencyKey }) {
    const scope = requireEventScope(inputScope); const proposal = await this.#unit.readonly({ stores: ['directorPromotionProposals'], scope }, repositories => repositories.directorPromotionProposals.get(requireText(proposalId, 'proposalId'))); if (!proposal) throw new Error('Unknown Promote-to-Canon proposal');
    if (proposal.status === 'cancelled') throw new Error('Cancelled promotion cannot be confirmed');
    if (proposal.status === 'confirmed') return Object.freeze({ event: await this.#events.getEvent(scope, proposal.canonicalEventId), replayed: true });
    const references = [];
    for (const disclosure of proposal.knowledgeDisclosures) for (const observation of disclosure.observations) references.push({ entityType: 'actor', id: observation.targetActorId, role: 'knowledge-target-actor' }, { entityType: 'character-instance', id: observation.targetInstanceId, role: 'knowledge-target-instance' });
    if (directorActorId) references.push({ entityType: 'actor', id: directorActorId, role: 'director-actor' });
    const unique = references.filter((row, index) => references.findIndex(other => JSON.stringify(other) === JSON.stringify(row)) === index);
    return this.#events.append({ scope, eventType: DIRECTOR_EVENT_TYPES.PROMOTE_TO_CANON, payload: { proposalId: proposal.proposalId, overrideId: proposal.overrideId, facts: proposal.facts, reason: proposal.reason, ownerAwareness: proposal.ownerAwareness, ownerAwarenessEvidence: proposal.ownerAwarenessEvidence, knowledgeDisclosures: proposal.knowledgeDisclosures }, references: unique, causes: [], source: { authority: 'tmrw-director', kind: 'promote-to-canon', recordId: `director:${idempotencyKey}`, version: '1' }, producer: 'tmrw-director', idempotencyKey });
  }
}
