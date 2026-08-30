import { requireText } from '../identity/identity-record.mjs';
import { normalizeSocialAudience } from '../social/audience.mjs';

export const LIVE_STATUS = Object.freeze({ CREATED: 'created', ACTIVE: 'active', ENDED: 'ended' });
const statuses = new Set(Object.values(LIVE_STATUS));
const bounded = (value, field, max) => { const text = String(value ?? '').trim(); if (!text || text.length > max) throw new TypeError(`${field} must contain 1-${max} characters`); return text; };

export function normalizeLiveSession(input) {
  const status = requireText(input?.status, 'live.status'); if (!statuses.has(status)) throw new TypeError(`Unsupported Live status: ${status}`);
  return Object.freeze({ sessionId: requireText(input?.sessionId, 'sessionId'), hostAccountId: requireText(input?.hostAccountId, 'hostAccountId'), actualActorId: requireText(input?.actualActorId, 'actualActorId'), actualAuthorId: requireText(input?.actualAuthorId, 'actualAuthorId'), actualInstanceId: requireText(input?.actualInstanceId, 'actualInstanceId'), deviceId: requireText(input?.deviceId, 'deviceId'), deviceOwnerActorId: requireText(input?.deviceOwnerActorId, 'deviceOwnerActorId'), currentHolderActorId: requireText(input?.currentHolderActorId, 'currentHolderActorId'), accountOwnerActorId: requireText(input?.accountOwnerActorId, 'accountOwnerActorId'), title: bounded(input?.title, 'title', 160), topic: bounded(input?.topic, 'topic', 120), description: String(input?.description ?? '').trim().slice(0, 1000), status, audience: normalizeSocialAudience(input?.audience), createdStoryTimeRef: Object.freeze(structuredClone(input?.createdStoryTimeRef)), startedStoryTimeRef: input?.startedStoryTimeRef ? Object.freeze(structuredClone(input.startedStoryTimeRef)) : null, endedStoryTimeRef: input?.endedStoryTimeRef ? Object.freeze(structuredClone(input.endedStoryTimeRef)) : null, archiveAvailability: input?.archiveAvailability === 'available' ? 'available' : 'unavailable', aiJobId: input?.aiJobId || null });
}
export const liveSessionHeadId = (scope, sessionId) => `live-session:${scope.storyId}:${scope.branchId}:${sessionId}`;
