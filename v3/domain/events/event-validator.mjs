import { V3EventValidationError } from '../../storage/errors.mjs';
import { canonicalJson } from './idempotency.mjs';
import { requireText } from '../identity/identity-record.mjs';

const REFERENCE_STORES = Object.freeze({
  actor: 'actors',
  'character-instance': 'instances',
  device: 'devices',
  account: 'accounts',
});

export function requireEventScope(scope) {
  return Object.freeze({
    storyId: requireText(scope?.storyId, 'scope.storyId'),
    branchId: requireText(scope?.branchId, 'scope.branchId'),
  });
}

export function normalizeEventReferences(references = []) {
  if (!Array.isArray(references)) throw new V3EventValidationError('Event references must be an array');
  const seen = new Set();
  return Object.freeze(references.map((reference, index) => {
    const entityType = requireText(reference?.entityType, `references[${index}].entityType`);
    if (!REFERENCE_STORES[entityType]) throw new V3EventValidationError(`Unsupported Event reference type: ${entityType}`);
    const id = requireText(reference.id, `references[${index}].id`);
    const role = requireText(reference.role, `references[${index}].role`);
    const key = `${entityType}:${id}:${role}`;
    if (seen.has(key)) throw new V3EventValidationError(`Duplicate Event reference: ${key}`);
    seen.add(key);
    return Object.freeze({ entityType, id, role });
  }));
}

export function assertEventJson(value, field) {
  try {
    canonicalJson(value);
  } catch (error) {
    throw new V3EventValidationError(`${field} is not valid canonical JSON: ${error.message}`);
  }
  return structuredClone(value);
}

export async function assertScopeAndReferences({ repositories, scope, references }) {
  const story = await repositories.stories.get(scope.storyId);
  const branch = await repositories.branches.get(scope.branchId);
  if (!story || !branch || branch.storyId !== story.id) throw new V3EventValidationError('Canonical Event Story/Branch scope does not exist');
  const records = new Map();
  for (const reference of references) {
    const storeName = REFERENCE_STORES[reference.entityType];
    const record = await repositories[storeName].get(reference.id);
    if (!record) throw new V3EventValidationError(`Unknown or cross-scope Event reference: ${reference.entityType}/${reference.id}`);
    records.set(`${reference.entityType}:${reference.id}`, record);
  }
  for (const reference of references.filter(row => row.entityType === 'character-instance')) {
    const instance = records.get(`character-instance:${reference.id}`);
    if (instance.storyId !== scope.storyId || instance.branchId !== scope.branchId) throw new V3EventValidationError('Character Instance reference is outside the Event scope');
  }
  for (const reference of references.filter(row => row.entityType === 'device' || row.entityType === 'account')) {
    const record = records.get(`${reference.entityType}:${reference.id}`);
    if (record.storyId !== scope.storyId || record.branchId !== scope.branchId) throw new V3EventValidationError(`${reference.entityType} reference is outside the Event scope`);
  }
  return { story, branch, records };
}
