import { MIGRATION_ITEM_STATE, PREVIEW37_SOURCE_AUTHORITY } from './constants.mjs';

const text = value => String(value ?? '').trim();

export function mapPreviewScope({ card, scope }) {
  if (!text(card?.cardKey) || !text(scope?.storyKey) || !text(scope?.branchKey)) return Object.freeze({ state: MIGRATION_ITEM_STATE.AMBIGUOUS, reasonCode: 'missing-story-branch-scope', sourceScopeKey: scope?.sourceScopeKey || null });
  if (!Array.isArray(card.cast) || card.cast.length < 1) return Object.freeze({ state: MIGRATION_ITEM_STATE.AMBIGUOUS, reasonCode: 'missing-cast', sourceScopeKey: scope.sourceScopeKey });
  const invalid = card.cast.some(member => !text(member.sourceMemberId) || !text(member.sourceActorId) || !text(member.sourceInstanceId));
  if (invalid) return Object.freeze({ state: MIGRATION_ITEM_STATE.AMBIGUOUS, reasonCode: 'unstable-preview-identity', sourceScopeKey: scope.sourceScopeKey });
  for (const field of ['sourceMemberId', 'sourceActorId', 'sourceInstanceId']) if (new Set(card.cast.map(member => member[field])).size !== card.cast.length) return Object.freeze({ state: MIGRATION_ITEM_STATE.CONFLICT, reasonCode: `duplicate-${field}`, sourceScopeKey: scope.sourceScopeKey });
  return Object.freeze({
    state: MIGRATION_ITEM_STATE.READY,
    reasonCode: null,
    sourceScopeKey: scope.sourceScopeKey,
    sourceAuthority: PREVIEW37_SOURCE_AUTHORITY,
    cardSourceId: card.cardKey,
    storySourceId: `${card.cardKey}:${scope.storyKey}`,
    branchSourceId: scope.branchKey,
  });
}

