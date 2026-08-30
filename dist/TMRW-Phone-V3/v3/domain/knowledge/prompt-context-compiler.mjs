import { V3KnowledgeError } from '../../storage/errors.mjs';
import { requireText } from '../identity/identity-record.mjs';
import { buildSafeKnowledgeSummary } from './safe-summary.mjs';
import { SAFE_PROMPT_READ_STORES, VisibilityRepository } from './visibility-repository.mjs';

const ALLOWED_PURPOSES = new Set(['model-prompt', 'model-generation', 'diagnostic-safe']);

export class SafePromptContextCompiler {
  #visibility;

  constructor(database) {
    this.#visibility = new VisibilityRepository(database);
  }

  async compile({ scope, actorId, instanceId, purpose = 'model-prompt', limit = 50, maxCharacters = 8000, claimTypes = null }) {
    const normalizedPurpose = requireText(purpose, 'purpose');
    if (!ALLOWED_PURPOSES.has(normalizedPurpose)) throw new V3KnowledgeError(`Unsupported safe prompt purpose: ${normalizedPurpose}`);
    const authorized = await this.#visibility.queryAuthorizedKnowledge({ scope, actorId, instanceId, purpose: normalizedPurpose, limit, claimTypes });
    const summary = buildSafeKnowledgeSummary(authorized.items, { maxCharacters });
    return Object.freeze({
      storyId: authorized.scope.storyId,
      branchId: authorized.scope.branchId,
      actorId: authorized.actorId,
      instanceId: authorized.instanceId,
      purpose: normalizedPurpose,
      authorizationRevision: authorized.authorizationRevision,
      text: summary.text,
      items: Object.freeze(authorized.items.filter(item => summary.includedGrantIds.includes(item.grantId))),
      audit: Object.freeze({ includedGrantIds: summary.includedGrantIds, characters: summary.characters, truncated: summary.truncated, ...authorized.metrics, rawEventHistoryAvailable: false, readStores: SAFE_PROMPT_READ_STORES }),
    });
  }
}
