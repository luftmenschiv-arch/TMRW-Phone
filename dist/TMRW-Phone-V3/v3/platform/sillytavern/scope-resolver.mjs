import { requireText } from '../../domain/identity/identity-record.mjs';

export function createSillyTavernScopeCandidate({ characterCardSourceId, storySourceId, routeSourceId }) {
  return Object.freeze({
    sourceAuthority: 'sillytavern',
    characterCardSourceId: requireText(characterCardSourceId, 'characterCardSourceId'),
    storySourceId: requireText(storySourceId, 'storySourceId'),
    routeSourceId: requireText(routeSourceId, 'routeSourceId'),
  });
}

export function resolveMappedSillyTavernScope({ candidate, mappings }) {
  if (!Array.isArray(mappings)) throw new TypeError('mappings must be an array');
  const card = mappings.find(row => row.status === 'active' && row.sourceAuthority === candidate.sourceAuthority && row.sourceType === 'character-card' && row.sourceId === candidate.characterCardSourceId);
  const story = mappings.find(row => row.status === 'active' && row.sourceAuthority === candidate.sourceAuthority && row.sourceType === 'story' && row.sourceId === candidate.storySourceId);
  const branch = mappings.find(row => row.status === 'active' && row.sourceAuthority === candidate.sourceAuthority && row.sourceType === 'branch' && row.sourceId === candidate.routeSourceId && row.storyId === story?.canonicalId);
  if (!card || !story || !branch || story.parentCanonicalId !== card.canonicalId) return Object.freeze({ status: 'unresolved', reason: 'Explicit Character Card, Story, and Branch mappings are required; no current/main fallback is allowed.' });
  return Object.freeze({ status: 'resolved', characterCardId: card.canonicalId, storyId: story.canonicalId, branchId: branch.canonicalId });
}
