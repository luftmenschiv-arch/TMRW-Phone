import { setupPhase14, phase14Projectors } from '../phase14/director-fixtures.mjs';
import { createPhase15EventTypeRegistry } from '../../domain/social/social-event-types.mjs';
import { createSocialProjector } from '../../domain/social/social-projector.mjs';
import { SocialService } from '../../domain/social/social-service.mjs';
import { InsungramService } from '../../domain/social/insungram-service.mjs';
import { DisabledSocialAiJobBoundary } from '../../domain/social/social-ai-job.mjs';
import { PhoneShellViewModels } from '../../ui/view-models.mjs';

export const socialSource = (recordId, authority = 'phase15-fixture') => ({ authority, kind: 'test', recordId, version: '1' });
export function phase15Projectors() { return [...phase14Projectors(), createSocialProjector()]; }
export async function setupPhase15(options = {}) {
  const context = await setupPhase14({ ...options, eventTypes: options.eventTypes || createPhase15EventTypeRegistry(), projectors: options.projectors || phase15Projectors() });
  const social = new SocialService({ database: context.database, eventEngine: context.engine });
  const insungram = new InsungramService({ messageService: context.messages, socialService: social });
  const viewModels = new PhoneShellViewModels({ database: context.database, phoneStateService: context.phones, contactService: context.contacts, settingsService: context.settings, messageService: context.messages, callService: context.calls, socialService: social, insungramService: insungram });
  return { ...context, social, insungram, socialAi: new DisabledSocialAiJobBoundary(), viewModels };
}
export const postFrom = (context, author = context.user, overrides = {}) => context.social.createPost({ scope: overrides.scope || context.scope, authorAccountId: author.accountId, actualAuthorActorId: author.actorId, actualAuthorInstanceId: author.instanceId, deviceId: author.deviceId, text: overrides.text || 'canonical social post', assetRefs: overrides.assetRefs || [], audience: overrides.audience || { kind: 'public' }, source: socialSource(overrides.key || 'post'), idempotencyKey: overrides.key || 'post', causeEventIds: overrides.causeEventIds || [] });
export const commentFrom = (context, postId, author = context.alice, overrides = {}) => context.social.createComment({ scope: overrides.scope || context.scope, postId, parentCommentId: overrides.parentCommentId || null, authorAccountId: author.accountId, actualAuthorActorId: author.actorId, actualAuthorInstanceId: author.instanceId, deviceId: author.deviceId, text: overrides.text || 'canonical comment', source: socialSource(overrides.key || 'comment'), idempotencyKey: overrides.key || 'comment' });
