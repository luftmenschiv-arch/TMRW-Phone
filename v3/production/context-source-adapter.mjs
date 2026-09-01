import { createSillyTavernScopeCandidate, resolveMappedSillyTavernScope } from '../platform/sillytavern/scope-resolver.mjs';
import { V3UnitOfWork } from '../storage/unit-of-work.mjs';

function requireContext(context) {
  if (!context || typeof context !== 'object') throw new TypeError('Real SillyTavern getContext() data is required');
  return context;
}

function requireSourceIdentity(sourceIdentity) {
  if (!sourceIdentity || typeof sourceIdentity !== 'object') {
    throw new Error('Production scope resolution requires explicit stable source identifiers; display names, chat filenames, Character indexes, avatars, and current/main fallbacks are forbidden');
  }
  return sourceIdentity;
}

function oneMapping(rows, label) {
  if (rows.length === 1) return rows[0];
  if (rows.length === 0) throw new Error(`Production identity unresolved: missing ${label} mapping`);
  throw new Error(`Production identity unresolved: ambiguous ${label} mapping`);
}

export function createProductionSillyTavernScopeCandidate({ context, sourceIdentity }) {
  requireContext(context);
  const source = requireSourceIdentity(sourceIdentity);
  return createSillyTavernScopeCandidate({
    characterCardSourceId: source.characterCardSourceId,
    storySourceId: source.storySourceId,
    routeSourceId: source.routeSourceId,
  });
}

export class ProductionSillyTavernContextAdapter {
  #getContext;
  #sourceIdentityResolver;
  #unitOfWork;

  constructor({ getContext, sourceIdentityResolver, database }) {
    if (typeof getContext !== 'function') throw new TypeError('ProductionSillyTavernContextAdapter requires real SillyTavern getContext');
    if (typeof sourceIdentityResolver !== 'function') {
      throw new TypeError('ProductionSillyTavernContextAdapter requires an explicit stable sourceIdentityResolver');
    }
    if (!database) throw new TypeError('ProductionSillyTavernContextAdapter requires the existing v3 database facade');
    this.#getContext = getContext;
    this.#sourceIdentityResolver = sourceIdentityResolver;
    this.#unitOfWork = new V3UnitOfWork(database);
  }

  async resolveScope(context = this.#getContext()) {
    requireContext(context);
    const sourceIdentity = await this.#sourceIdentityResolver(context);
    const candidate = createProductionSillyTavernScopeCandidate({ context, sourceIdentity });
    const mappings = await this.#unitOfWork.readonly({ stores: ['identityMappings'] }, repositories => repositories.identityMappings.listByIndex('by_mapping_status', 'active'));

    const cards = mappings.filter(row => row.sourceAuthority === candidate.sourceAuthority && row.sourceType === 'character-card' && row.sourceId === candidate.characterCardSourceId);
    const card = oneMapping(cards, 'Character Card');
    const scopedStorySourceId = `card-story:${JSON.stringify([candidate.characterCardSourceId, candidate.storySourceId])}`;
    const scopedStories = mappings.filter(row => row.sourceAuthority === candidate.sourceAuthority && row.sourceType === 'story' && row.sourceId === scopedStorySourceId && row.parentCanonicalId === card.canonicalId);
    const legacyStories = mappings.filter(row => row.sourceAuthority === candidate.sourceAuthority && row.sourceType === 'story' && row.sourceId === candidate.storySourceId && row.parentCanonicalId === card.canonicalId);
    const story = oneMapping(scopedStories.length ? scopedStories : legacyStories, 'Story');
    const scopedBranchSourceId = `card-story-branch:${JSON.stringify([candidate.characterCardSourceId, candidate.storySourceId, candidate.routeSourceId])}`;
    const scopedBranches = mappings.filter(row => row.sourceAuthority === candidate.sourceAuthority && row.sourceType === 'branch' && row.sourceId === scopedBranchSourceId && row.storyId === story.canonicalId);
    const legacyBranches = mappings.filter(row => row.sourceAuthority === candidate.sourceAuthority && row.sourceType === 'branch' && row.sourceId === candidate.routeSourceId && row.storyId === story.canonicalId);
    const branch = oneMapping(scopedBranches.length ? scopedBranches : legacyBranches, 'Branch');

    const resolvedCandidate = Object.freeze({ ...candidate, storySourceId: story.sourceId, routeSourceId: branch.sourceId });
    const resolved = resolveMappedSillyTavernScope({ candidate: resolvedCandidate, mappings: [card, story, branch] });
    if (resolved.status !== 'resolved') throw new Error(`Production identity unresolved: ${resolved.reason || 'exact Story/Branch mapping failed'}`);

    const scope = Object.freeze({ storyId: resolved.storyId, branchId: resolved.branchId });
    const canonical = await this.#unitOfWork.readonly({ stores: ['stories', 'branches'], scope }, async repositories => ({
      story: await repositories.stories.get(scope.storyId),
      branch: await repositories.branches.get(scope.branchId),
    }));
    if (!canonical.story || canonical.story.characterCardId !== resolved.characterCardId) {
      throw new Error('Production identity unresolved: mapped Story does not match the mapped Character Card');
    }
    if (!canonical.branch || canonical.branch.storyId !== scope.storyId) {
      throw new Error('Production identity unresolved: mapped Branch does not belong to the mapped Story');
    }
    return scope;
  }
}
