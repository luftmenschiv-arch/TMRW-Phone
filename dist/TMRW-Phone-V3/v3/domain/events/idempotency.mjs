import { requireText } from '../identity/identity-record.mjs';

function canonicalize(value, path = 'value') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain only finite JSON numbers`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key], `${path}.${key}`)]));
  }
  throw new TypeError(`${path} must be JSON-serializable data`);
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function requestDigest(value) {
  return sha256Hex(canonicalJson(value));
}

export async function deriveCanonicalEventId({ scope, source, producer, idempotencyKey }) {
  const locator = source.recordId
    ? ['source-record', source.authority, source.recordId]
    : ['producer-key', requireText(producer, 'producer'), requireText(idempotencyKey, 'idempotencyKey')];
  const seed = canonicalJson(['tmrw-phone-v3-event-v1', scope.storyId, scope.branchId, ...locator]);
  return `event_${(await sha256Hex(seed)).slice(0, 32)}`;
}

export async function deriveIdempotencyRecordId({ scope, producer, idempotencyKey }) {
  const seed = canonicalJson(['tmrw-phone-v3-idempotency-v1', scope.storyId, scope.branchId, requireText(producer, 'producer'), requireText(idempotencyKey, 'idempotencyKey')]);
  return `idempotency_${(await sha256Hex(seed)).slice(0, 32)}`;
}

export function assertIdempotentReplay(existing, { operation, digest }) {
  if (!existing) return null;
  if (existing.operation !== operation || existing.requestDigest !== digest) {
    const error = new Error('An idempotency key was reused for a different canonical Event operation');
    error.code = 'V3_EVENT_IDEMPOTENCY_CONFLICT';
    throw error;
  }
  return structuredClone(existing.result);
}

export function createIdempotencyRecord({ id, scope, producer, idempotencyKey, operation, digest, result, committedAt }) {
  return Object.freeze({
    id,
    storyId: scope.storyId,
    branchId: scope.branchId,
    producer: requireText(producer, 'producer'),
    idempotencyKey: requireText(idempotencyKey, 'idempotencyKey'),
    operation,
    requestDigest: digest,
    result: structuredClone(result),
    committedAt,
    phase: 3,
  });
}
