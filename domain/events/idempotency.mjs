import { requireText } from '../identity/identity-record.mjs';

function inspectRejectedNonJsonValue(value, path) {
  let tag = '[object Unknown]';
  let constructorName = 'unknown';
  let iterable = false;
  let plain = false;
  try { tag = Object.prototype.toString.call(value); } catch {}
  try { constructorName = String(value?.constructor?.name || 'unknown'); } catch {}
  try { iterable = value != null && typeof value[Symbol.iterator] === 'function'; } catch {}
  if (value !== null && typeof value === 'object') {
    try {
      const prototype = Object.getPrototypeOf(value);
      plain = prototype === Object.prototype || prototype === null;
    } catch {}
  }
  return Object.freeze({
    path: String(path),
    tag,
    constructor: constructorName,
    array: Array.isArray(value),
    typeof: typeof value,
    iterable,
    plain,
  });
}

function rejectedNonJsonValueError(value, path) {
  const error = new TypeError(`${path} must be JSON-serializable data`);
  error.code = 'TMRW_NON_JSON_VALUE';
  Object.defineProperty(error, 'tmrwNonJsonDiagnostic', {
    value: inspectRejectedNonJsonValue(value, path),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return error;
}

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
  throw rejectedNonJsonValueError(value, path);
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
