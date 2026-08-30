const ENTITY_TYPES = new Set([
  'character-card',
  'actor',
  'character-instance',
  'story',
  'branch',
  'device',
  'account',
  'identity-mapping',
  'identity-batch',
]);

export function requireText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string`);
  return value.trim();
}

export function optionalText(value, field) {
  if (value === null || value === undefined || value === '') return null;
  return requireText(value, field);
}

export function normalizedStrings(values = []) {
  if (!Array.isArray(values)) throw new TypeError('Expected an array of strings');
  return [...new Set(values.map(value => requireText(value, 'array item')))];
}

export function requireTimestamp(value, field) {
  const text = requireText(value, field);
  if (Number.isNaN(Date.parse(text))) throw new TypeError(`${field} must be an ISO timestamp`);
  return text;
}

export function manifestIds(manifestId, existing = []) {
  return normalizedStrings([...existing, requireText(manifestId, 'manifestId')]);
}

export function identityRecord({ entityType, id, createdAt, updatedAt, manifestId, existingManifestIds = [] }) {
  if (!ENTITY_TYPES.has(entityType)) throw new TypeError(`Unsupported identity entity type: ${String(entityType)}`);
  return {
    entityType,
    id: requireText(id, 'id'),
    createdAt: requireTimestamp(createdAt, 'createdAt'),
    updatedAt: requireTimestamp(updatedAt, 'updatedAt'),
    manifestIds: manifestIds(manifestId, existingManifestIds),
  };
}

export function freezeRecord(record) {
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) Object.freeze(value);
  }
  return Object.freeze(record);
}
