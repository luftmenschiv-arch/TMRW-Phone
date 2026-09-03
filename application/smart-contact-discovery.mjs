import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { normalizePhoneNumber } from '../domain/contacts/phone-number.mjs';
import { NUMBER_DISCOVERY_KIND } from '../domain/contacts/discovery-provenance.mjs';
import { PHONE_NUMBER_DISCOVERY } from '../ui/experience-presets.mjs';

const PHONE_TOKEN = /(?<!\d)(?:\+?\d[\d\s().-]{1,24}\d)(?!\d)/g;
const SELF_CUE = /(?:\bmy\s+(?:phone\s+)?number\b|\bcall\s+me\s+(?:at\s+)?|\btext\s+me\s+(?:at\s+)?|เบอร์(?:โทรศัพท์)?(?:ของ)?(?:ฉัน|ผม|เรา)|(?:ฉัน|ผม|เรา)(?:มี)?เบอร์(?:โทรศัพท์)?|โทร(?:หา)?(?:ฉัน|ผม|เรา)(?:ได้)?(?:ที่|เบอร์)?|ติดต่อ(?:ฉัน|ผม|เรา)(?:ได้)?(?:ที่|เบอร์)?)/i;
const EVIDENCE_WINDOW = 96;

function explicitSelfNumber(text) {
  const value = String(text || '');
  if (!SELF_CUE.test(value)) return null;
  const candidates = [];
  for (const match of value.matchAll(PHONE_TOKEN)) {
    let normalized;
    try { normalized = normalizePhoneNumber(match[0]); } catch { continue; }
    const start = Math.max(0, match.index - EVIDENCE_WINDOW);
    const end = Math.min(value.length, match.index + match[0].length + EVIDENCE_WINDOW);
    if (!SELF_CUE.test(value.slice(start, end))) continue;
    candidates.push(normalized);
  }
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : null;
}

export function couldContainSmartPhoneEvidence(text) {
  return SELF_CUE.test(String(text || ''));
}

export function extractSmartPhoneEvidence(source) {
  if (!source || source.origin !== 'main-rp' || source.mode !== 'normal' || source.role !== 'assistant') return null;
  if (!source.actorBinding?.actorId || !source.actorBinding?.instanceId) return null;
  const text = String(source.text || '');
  if (!SELF_CUE.test(text)) return null;
  const number = explicitSelfNumber(text);
  return Object.freeze({
    number,
    targetActorId: source.actorBinding.actorId,
    targetInstanceId: source.actorBinding.instanceId,
    sourceRecordId: String(source.sourceMessageId || ''),
    relationshipEvidence: true,
  });
}

export class SmartContactDiscoveryCoordinator {
  #database; #unitOfWork; #contacts; #settings; #resolvePlayerIdentity; #now;
  constructor({ database, contactService, settingsService, resolvePlayerIdentity, now = () => new Date().toISOString() }) {
    if (!database || !contactService?.discoverNumber || !contactService?.linkContact) throw new TypeError('SmartContactDiscoveryCoordinator requires existing ContactService and v3 database');
    if (!settingsService?.get) throw new TypeError('SmartContactDiscoveryCoordinator requires existing phone settings');
    if (typeof resolvePlayerIdentity !== 'function') throw new TypeError('SmartContactDiscoveryCoordinator requires canonical player identity resolution');
    this.#database = database; this.#unitOfWork = new V3UnitOfWork(database); this.#contacts = contactService; this.#settings = settingsService; this.#resolvePlayerIdentity = resolvePlayerIdentity; this.#now = now;
  }

  couldContainEvidence(text) { return couldContainSmartPhoneEvidence(text); }

  async #label(scope, actorId, instanceId) {
    return this.#unitOfWork.readonly({ stores: ['actors', 'instances'], scope }, async repositories => {
      const [actor, instance] = await Promise.all([repositories.actors.get(actorId), repositories.instances.get(instanceId)]);
      if (!actor || !instance || instance.actorId !== actor.id) throw new Error('Smart Contact evidence target identity is not canonical in this Story/Branch');
      return String(instance.displayNameOverride || actor.displayName || '').trim() || 'Contact';
    });
  }

  async evaluate({ scope, source }) {
    const player = await this.#resolvePlayerIdentity({ scope });
    const settings = await this.#settings.get({ scope, playerInstanceId: player.instanceId });
    if (settings.phoneNumberDiscovery !== PHONE_NUMBER_DISCOVERY.SMART) return Object.freeze({ evaluated: false, discovered: false, reason: `mode-${settings.phoneNumberDiscovery}` });
    const evidence = extractSmartPhoneEvidence(source);
    if (!evidence) return Object.freeze({ evaluated: true, discovered: false, eligible: false, reason: 'insufficient-explicit-evidence' });
    if (evidence.targetInstanceId === player.instanceId || evidence.targetActorId === player.actorId) return Object.freeze({ evaluated: true, discovered: false, eligible: false, reason: 'player-self-number-not-contact' });
    if (!evidence.number) return Object.freeze({ evaluated: true, discovered: false, eligible: true, reason: 'eligible-number-value-unavailable', evidence });

    const existing = await this.#contacts.listContacts({ scope, ownerAccountId: player.accountId });
    const byNumber = existing.find(row => normalizePhoneNumber(row.number) === evidence.number) || null;
    if (byNumber?.targetInstanceId === evidence.targetInstanceId && byNumber?.targetActorId === evidence.targetActorId) return Object.freeze({ evaluated: true, discovered: true, replayed: true, contact: byNumber, evidence });
    if (byNumber?.targetInstanceId && byNumber.targetInstanceId !== evidence.targetInstanceId) return Object.freeze({ evaluated: true, discovered: false, reason: 'number-owner-conflict', evidence });

    await this.#contacts.discoverNumber({
      scope,
      ownerAccountId: player.accountId,
      number: evidence.number,
      provenance: {
        kind: NUMBER_DISCOVERY_KIND.STORY_EVENT,
        sourceRecordId: evidence.sourceRecordId,
        assertedAt: this.#now(),
        note: 'Smart discovery from explicit visible Main RP phone-number evidence',
        playerOnlyAvailability: true,
      },
    });
    const label = await this.#label(scope, evidence.targetActorId, evidence.targetInstanceId);
    await this.#contacts.linkContact({ scope, ownerAccountId: player.accountId, number: evidence.number, targetActorId: evidence.targetActorId, targetInstanceId: evidence.targetInstanceId, savedName: label });
    const contacts = await this.#contacts.listContacts({ scope, ownerAccountId: player.accountId });
    const contact = contacts.find(row => normalizePhoneNumber(row.number) === evidence.number && row.targetInstanceId === evidence.targetInstanceId) || null;
    if (!contact) throw new Error('Smart Contact discovery did not materialize the proven player-visible Contact');
    return Object.freeze({ evaluated: true, discovered: true, replayed: false, contact, evidence });
  }
}
