export const SOCIAL_AI_JOB_TYPES = Object.freeze(['social.post', 'social.comment', 'social.reply', 'social.reaction']);
export class DisabledSocialAiJobBoundary {
  get enabled() { return false; }
  prepare(input = {}) {
    return Object.freeze({
      scheduled: false,
      reason: 'autonomous-social-generation-disabled',
      requestedType: SOCIAL_AI_JOB_TYPES.includes(input.jobType) ? input.jobType : null,
      sourceEventId: input.sourceEventId || null,
      storyId: input.storyId || null,
      branchId: input.branchId || null,
      actorId: input.actorId || null,
      accountId: input.accountId || null,
      requiresSourceEvent: true,
      requiresAuthorizedContext: true,
      validationCommitBoundaryRequired: true,
    });
  }
  schedule() { throw new Error('Autonomous social generation is disabled in Phase 15'); }
}
