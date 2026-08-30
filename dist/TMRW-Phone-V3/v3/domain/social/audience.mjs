import { requireText } from '../identity/identity-record.mjs';

export const SOCIAL_AUDIENCE = Object.freeze({ PUBLIC: 'public', FOLLOWERS: 'followers', CLOSE_FRIENDS: 'close-friends', SELECTED: 'selected' });
const kinds = new Set(Object.values(SOCIAL_AUDIENCE));
const unique = values => Object.freeze([...new Set((values || []).map(String).map(value => value.trim()).filter(Boolean))].sort());

export function normalizeSocialAudience(input) {
  const kind = requireText(input?.kind, 'socialAudience.kind');
  if (!kinds.has(kind)) throw new TypeError(`Unsupported social audience: ${kind}`);
  const recipientAccountIds = unique(input?.recipientAccountIds);
  if ([SOCIAL_AUDIENCE.CLOSE_FRIENDS, SOCIAL_AUDIENCE.SELECTED].includes(kind) && recipientAccountIds.length === 0) throw new TypeError(`${kind} audience requires an explicit recipient snapshot`);
  return Object.freeze({ kind, recipientAccountIds, snapshotSourceEventId: input?.snapshotSourceEventId || null });
}

export function socialAudiencePermits(audienceInput, viewerAccountId) {
  const audience = normalizeSocialAudience(audienceInput);
  return audience.kind === SOCIAL_AUDIENCE.PUBLIC || audience.recipientAccountIds.includes(requireText(viewerAccountId, 'viewerAccountId'));
}
