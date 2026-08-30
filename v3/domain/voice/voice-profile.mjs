import { assertIdentityId } from '../identity/id.mjs';
import { optionalText, requireText } from '../identity/identity-record.mjs';

export const VOICE_LANGUAGE = Object.freeze({ AUTO: 'auto', ENGLISH: 'en', JAPANESE: 'ja' });
export const VOICE_DEFAULT_DELIVERY = Object.freeze({ NATURAL: 'natural', SOFT: 'soft', EXPRESSIVE: 'expressive' });

const LANGUAGES = new Set(Object.values(VOICE_LANGUAGE));
const DELIVERIES = new Set(Object.values(VOICE_DEFAULT_DELIVERY));
const TRAIT_FIELDS = Object.freeze(['presentation', 'apparentAge', 'pitch', 'depth', 'warmth', 'softness', 'roughness', 'breathiness', 'pace', 'energy', 'expressiveRange', 'speakingStyle']);

export function normalizeVoiceLanguage(value = VOICE_LANGUAGE.AUTO) {
  const language = requireText(value, 'voice language').toLowerCase();
  if (!LANGUAGES.has(language)) throw new TypeError(`Unsupported voice language: ${language}`);
  return language;
}

export function normalizeVoiceDelivery(value = VOICE_DEFAULT_DELIVERY.NATURAL) {
  const delivery = requireText(value, 'voice default delivery').toLowerCase();
  if (!DELIVERIES.has(delivery)) throw new TypeError(`Unsupported voice default delivery: ${delivery}`);
  return delivery;
}

export function normalizeVoiceTraits(input = {}, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('voice traits must be an object');
  const output = {};
  for (const field of TRAIT_FIELDS) {
    if (!(field in input)) {
      if (!partial) output[field] = null;
      continue;
    }
    output[field] = optionalText(input[field], `voice traits.${field}`);
  }
  return Object.freeze(output);
}

function normalizeProvenance(input = {}) {
  return Object.freeze({
    authority: requireText(input.authority || 'tmrw-phase19-user', 'voice provenance.authority'),
    recordId: requireText(input.recordId || 'voice-profile', 'voice provenance.recordId'),
    version: requireText(input.version || '1', 'voice provenance.version'),
  });
}

export function normalizeActorVoiceProfile(input) {
  const actorId = assertIdentityId('actor', input?.actorId);
  return Object.freeze({
    id: input?.id ? requireText(input.id, 'voice profile id') : `voice-actor-profile:${actorId}`,
    actorId,
    profileName: optionalText(input?.profileName, 'voice profileName'),
    language: normalizeVoiceLanguage(input?.language || VOICE_LANGUAGE.AUTO),
    defaultDelivery: normalizeVoiceDelivery(input?.defaultDelivery || VOICE_DEFAULT_DELIVERY.NATURAL),
    traits: normalizeVoiceTraits(input?.traits || {}),
    lockedByUser: Boolean(input?.lockedByUser),
    provenance: normalizeProvenance(input?.provenance),
    createdAt: input?.createdAt || null,
    updatedAt: input?.updatedAt || null,
    phase: 19,
  });
}

export function normalizeInstanceVoiceOverride(input) {
  const instanceId = assertIdentityId('character-instance', input?.instanceId);
  const actorId = assertIdentityId('actor', input?.actorId);
  const fields = input?.fields && typeof input.fields === 'object' && !Array.isArray(input.fields) ? input.fields : {};
  const normalizedFields = {};
  if ('profileName' in fields) normalizedFields.profileName = optionalText(fields.profileName, 'voice override profileName');
  if ('language' in fields && fields.language != null) normalizedFields.language = normalizeVoiceLanguage(fields.language);
  if ('defaultDelivery' in fields && fields.defaultDelivery != null) normalizedFields.defaultDelivery = normalizeVoiceDelivery(fields.defaultDelivery);
  if ('traits' in fields) normalizedFields.traits = normalizeVoiceTraits(fields.traits || {}, { partial: true });
  return Object.freeze({
    id: requireText(input?.id, 'voice instance override id'),
    storyId: requireText(input?.storyId, 'voice override storyId'),
    branchId: requireText(input?.branchId, 'voice override branchId'),
    instanceId,
    actorId,
    enabled: Boolean(input?.enabled),
    fields: Object.freeze(normalizedFields),
    lockedByUser: Boolean(input?.lockedByUser),
    provenance: normalizeProvenance(input?.provenance),
    createdAt: input?.createdAt || null,
    updatedAt: input?.updatedAt || null,
    phase: 19,
  });
}

export function neutralActorVoiceProfile(actorId) {
  return normalizeActorVoiceProfile({ actorId, profileName: null, language: VOICE_LANGUAGE.AUTO, defaultDelivery: VOICE_DEFAULT_DELIVERY.NATURAL, traits: {}, lockedByUser: false, provenance: { authority: 'tmrw-phase19-neutral', recordId: `neutral:${actorId}`, version: '1' } });
}

export function resolveVoiceProfile({ actorId, instanceId, baseProfile = null, instanceOverride = null }) {
  const actor = assertIdentityId('actor', actorId);
  const instance = assertIdentityId('character-instance', instanceId);
  const base = baseProfile ? normalizeActorVoiceProfile(baseProfile) : neutralActorVoiceProfile(actor);
  if (base.actorId !== actor) throw new TypeError('Base Voice Profile Actor identity mismatch');
  const override = instanceOverride ? normalizeInstanceVoiceOverride(instanceOverride) : null;
  if (override && (override.actorId !== actor || override.instanceId !== instance)) throw new TypeError('Voice Profile override identity mismatch');
  const fields = override?.enabled ? override.fields : {};
  const traits = Object.freeze({ ...base.traits, ...(fields.traits || {}) });
  return Object.freeze({
    actorId: actor,
    instanceId: instance,
    profileName: Object.prototype.hasOwnProperty.call(fields, 'profileName') ? fields.profileName : base.profileName,
    language: fields.language || base.language,
    defaultDelivery: fields.defaultDelivery || base.defaultDelivery,
    traits,
    baseLockedByUser: base.lockedByUser,
    overrideEnabled: Boolean(override?.enabled),
    overrideLockedByUser: Boolean(override?.lockedByUser),
    baseProfileId: baseProfile ? base.id : null,
    overrideId: override?.id || null,
    providerNeutral: true,
    phase: 19,
  });
}
