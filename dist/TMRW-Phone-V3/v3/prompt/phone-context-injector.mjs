import { requireEventScope } from '../domain/events/event-validator.mjs';
import { requireText } from '../domain/identity/identity-record.mjs';

const PHONE_CLAIM_TYPES = Object.freeze(['messaging.message-content.v1', 'messaging.sticker-content.v1', 'calls.session.v1', 'calls.transcript-content.v1', 'calls.voicemail-content.v1', 'calls.consequence.v1']);

export class PhoneContextInjector {
  #knowledge;
  #metrics = Object.freeze({ operation: 'none' });
  constructor({ knowledgeService }) { if (!knowledgeService) throw new TypeError('PhoneContextInjector requires the Phase 5 Knowledge service'); this.#knowledge = knowledgeService; }
  get lastOperationMetrics() { return structuredClone(this.#metrics); }
  async build({ scope: inputScope, actorId, instanceId, limit = 30, maxCharacters = 6000 }) {
    const scope = requireEventScope(inputScope); const context = await this.#knowledge.compileSafePromptContext({ scope, actorId: requireText(actorId, 'actorId'), instanceId: requireText(instanceId, 'instanceId'), purpose: 'model-prompt', limit, maxCharacters, claimTypes: PHONE_CLAIM_TYPES });
    this.#metrics = Object.freeze({ operation: 'build-safe-phone-context', authorizedItemsRead: context.items.length, rawEventsRead: 0, writes: 0, storiesScanned: 0, branchesScanned: 0, activeTimers: 0, activePollers: 0 });
    return Object.freeze({ origin: 'tmrw-phone-context', storyId: scope.storyId, branchId: scope.branchId, actorId, instanceId, text: context.text, items: context.items, audit: Object.freeze({ ...context.audit, rawEventHistoryAvailable: false, canonicalWrites: 0 }) });
  }
}
