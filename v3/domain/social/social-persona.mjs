import { requireText } from '../identity/identity-record.mjs';

const boundedText = (value, field, max = 120) => { const text = String(value ?? '').trim(); if (text.length > max) throw new TypeError(`${field} exceeds ${max} characters`); return text; };
export function normalizeSocialPersona(input) {
  const postingFrequency = input?.postingFrequency == null ? null : Number(input.postingFrequency);
  if (postingFrequency != null && (!Number.isFinite(postingFrequency) || postingFrequency < 0 || postingFrequency > 1)) throw new TypeError('postingFrequency must be null or 0–1');
  const sourceLevel = input?.sourceLevel || 'story-instance'; if (!['actor-base', 'story-instance'].includes(sourceLevel)) throw new TypeError('Unsupported Social Persona sourceLevel');
  return Object.freeze({
    personaId: requireText(input?.personaId, 'personaId'), actorId: requireText(input?.actorId, 'actorId'),
    instanceId: sourceLevel === 'actor-base' ? null : requireText(input?.instanceId, 'instanceId'),
    accountId: sourceLevel === 'actor-base' ? null : requireText(input?.accountId, 'accountId'),
    postingFrequency,
    displayName: boundedText(input?.displayName, 'displayName', 80),
    bio: boundedText(input?.bio, 'bio', 500),
    note: boundedText(input?.note, 'note', 160),
    avatarUrl: boundedText(input?.avatarUrl, 'avatarUrl', 2_800_000),
    hiddenPostIds: Object.freeze([...new Set((input?.hiddenPostIds || []).map(String).filter(Boolean))].slice(0, 500)),
    captionStyle: boundedText(input?.captionStyle, 'captionStyle'), emojiStyle: boundedText(input?.emojiStyle, 'emojiStyle'),
    typicalTopics: Object.freeze([...(input?.typicalTopics || [])].map((value, index) => boundedText(value, `typicalTopics[${index}]`, 60))),
    visibilityPreference: input?.visibilityPreference || 'public', lurks: Boolean(input?.lurks), sourceLevel,
  });
}
