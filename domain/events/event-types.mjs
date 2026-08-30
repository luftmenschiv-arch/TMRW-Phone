import { requireText } from '../identity/identity-record.mjs';
import { V3EventValidationError } from '../../storage/errors.mjs';

const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+\.v[1-9][0-9]*$/;

export function defineEventType({ id, validatePayload = null, description = '' }) {
  const typeId = requireText(id, 'event type id');
  if (!EVENT_TYPE_PATTERN.test(typeId)) throw new TypeError(`Event type must be namespaced and versioned: ${typeId}`);
  if (validatePayload !== null && typeof validatePayload !== 'function') throw new TypeError('validatePayload must be a function');
  return Object.freeze({ id: typeId, validatePayload, description: String(description || '') });
}

export class CanonicalEventTypeRegistry {
  #types = new Map();

  constructor(definitions = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition) {
    const normalized = defineEventType(definition);
    if (this.#types.has(normalized.id)) throw new Error(`Event type is already registered: ${normalized.id}`);
    this.#types.set(normalized.id, normalized);
    return normalized;
  }

  assertPayload(eventType, payload) {
    const definition = this.#types.get(requireText(eventType, 'eventType'));
    if (!definition) throw new V3EventValidationError(`Unregistered canonical Event type: ${eventType}`);
    const result = definition.validatePayload?.(structuredClone(payload));
    if (result === false) throw new V3EventValidationError(`Payload validation failed for Event type ${eventType}`);
    return definition;
  }

  list() {
    return [...this.#types.values()];
  }
}

export const CORE_EVENT_TYPES = Object.freeze([
  defineEventType({
    id: 'core.occurrence.v1',
    description: 'App-neutral story-world occurrence used by the Phase 3 foundation and fixtures.',
    validatePayload: payload => Boolean(payload && typeof payload === 'object' && !Array.isArray(payload)),
  }),
  defineEventType({
    id: 'core.state-change.v1',
    description: 'App-neutral state transition without Story Clock, Audience, or app behavior.',
    validatePayload: payload => Boolean(payload && typeof payload === 'object' && !Array.isArray(payload) && typeof payload.stateKey === 'string'),
  }),
]);

export function createCoreEventTypeRegistry(additional = []) {
  return new CanonicalEventTypeRegistry([...CORE_EVENT_TYPES, ...additional]);
}
