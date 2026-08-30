import { requireText } from '../identity/identity-record.mjs';
import { V3EventValidationError } from '../../storage/errors.mjs';

export function normalizeCauseEventIds(causes = []) {
  if (!Array.isArray(causes)) throw new V3EventValidationError('causes must be an array of canonical Event IDs');
  return Object.freeze([...new Set(causes.map((id, index) => requireText(id, `causes[${index}]`)))]);
}

export function createCausalEdge({ scope, causeEventId, effectEventId, relation = 'caused-by', createdAt }) {
  const cause = requireText(causeEventId, 'causeEventId');
  const effect = requireText(effectEventId, 'effectEventId');
  const normalizedRelation = requireText(relation, 'relation');
  if (cause === effect) throw new V3EventValidationError('A canonical Event cannot cause itself');
  return Object.freeze({
    id: `causal:${scope.storyId}:${scope.branchId}:${cause}:${effect}:${normalizedRelation}`,
    storyId: scope.storyId,
    branchId: scope.branchId,
    causeEventId: cause,
    effectEventId: effect,
    relation: normalizedRelation,
    createdAt,
    phase: 3,
  });
}

export async function validateAndCreateCausalEdges({ repositories, scope, causeEventIds, effectEventId, createdAt }) {
  const edges = [];
  for (const causeEventId of causeEventIds) {
    const cause = await repositories.events.get(causeEventId);
    if (!cause) throw new V3EventValidationError(`Unknown or cross-scope causal Event: ${causeEventId}`);
    edges.push(createCausalEdge({ scope, causeEventId, effectEventId, createdAt }));
  }
  return edges;
}

export async function planCausalRetraction({ repositories, scope, rootEventId }) {
  const selected = new Set([rootEventId]);
  const queue = [rootEventId];
  while (queue.length) {
    const causeEventId = queue.shift();
    const outgoing = await repositories.eventCausalEdges.listByIndex('by_scope_cause', [scope.storyId, scope.branchId, causeEventId]);
    const effects = [...new Set(outgoing.map(edge => edge.effectEventId))].sort();
    for (const effectEventId of effects) {
      if (selected.has(effectEventId)) continue;
      const effect = await repositories.events.get(effectEventId);
      if (!effect || effect.status === 'retracted') continue;
      const incoming = await repositories.eventCausalEdges.listByIndex('by_scope_effect', [scope.storyId, scope.branchId, effectEventId]);
      let allSupportRetracted = true;
      for (const edge of incoming) {
        const source = await repositories.events.get(edge.causeEventId);
        if (source?.status !== 'retracted' && !selected.has(edge.causeEventId)) {
          allSupportRetracted = false;
          break;
        }
      }
      if (allSupportRetracted) {
        selected.add(effectEventId);
        queue.push(effectEventId);
      }
    }
  }
  return [...selected];
}
