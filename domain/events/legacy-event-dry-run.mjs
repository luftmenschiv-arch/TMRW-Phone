import { createEventProvenance } from './provenance.mjs';
import { assertEventJson, normalizeEventReferences, requireEventScope } from './event-validator.mjs';
import { normalizeCauseEventIds } from './causality.mjs';
import { requireText } from '../identity/identity-record.mjs';

function issue(error) {
  return Object.freeze({ code: error?.code || 'V3_LEGACY_EVENT_VALIDATION', message: String(error?.message || error) });
}

/**
 * Creates a pure legacy-to-Event candidate translator. It has no repository,
 * persistence, migration, or Preview access and therefore cannot write data.
 */
export function createLegacyEventDryRunTranslator({ eventTypes, now = () => new Date().toISOString() }) {
  if (!eventTypes || typeof eventTypes.assertPayload !== 'function') throw new TypeError('An Event type registry is required');

  return Object.freeze({
    translate(input) {
      try {
        const scope = requireEventScope(input?.scope);
        const eventType = requireText(input?.eventType, 'eventType');
        const payload = assertEventJson(input?.payload, 'payload');
        const references = normalizeEventReferences(input?.references);
        const causes = normalizeCauseEventIds(input?.causes);
        const producer = requireText(input?.producer, 'producer');
        const idempotencyKey = requireText(input?.idempotencyKey, 'idempotencyKey');
        const translatedAt = now();
        const provenance = createEventProvenance(input?.source, translatedAt);
        eventTypes.assertPayload(eventType, payload);
        if (!provenance.recordId) throw new TypeError('Legacy dry-run candidates require a stable source.recordId');

        return Object.freeze({
          status: 'candidate',
          candidate: Object.freeze({
            scope,
            eventType,
            payload,
            references,
            causes,
            producer,
            idempotencyKey,
            source: Object.freeze({
              authority: provenance.authority,
              kind: provenance.kind,
              recordId: provenance.recordId,
              version: provenance.sourceVersion,
              occurredAt: provenance.sourceOccurredAt,
            }),
          }),
          validationErrors: Object.freeze([]),
          writesPerformed: 0,
          translatedAt,
        });
      } catch (error) {
        return Object.freeze({
          status: 'quarantined',
          candidate: null,
          validationErrors: Object.freeze([issue(error)]),
          writesPerformed: 0,
          translatedAt: now(),
        });
      }
    },
  });
}
