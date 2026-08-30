import { requireText } from '../identity/identity-record.mjs';

export const NUMBER_DISCOVERY_KIND = Object.freeze({ MANUAL: 'manual', NOTE: 'note', CONTACT_SHARE: 'contact-share', CARD_DOCUMENT: 'card-document', INCOMING_CALL: 'incoming-call', STORY_EVENT: 'story-event' });
const kinds = new Set(Object.values(NUMBER_DISCOVERY_KIND));

export function normalizeDiscoveryProvenance(input = {}) {
  const kind = input.kind || NUMBER_DISCOVERY_KIND.MANUAL;
  if (!kinds.has(kind)) throw new TypeError(`Unsupported number discovery kind: ${kind}`);
  return Object.freeze({ kind, sourceRecordId: input.sourceRecordId == null ? null : requireText(input.sourceRecordId, 'discovery.sourceRecordId'), note: input.note == null ? null : requireText(input.note, 'discovery.note'), assertedAt: input.assertedAt || new Date().toISOString(), playerOnlyAvailability: input.playerOnlyAvailability !== false, createsCanonicalKnowledge: false, createsOwnerAwareness: false });
}
