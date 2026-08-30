import { V3PendingWorldEventError } from '../../storage/errors.mjs';
import { canonicalJson, sha256Hex } from '../events/idempotency.mjs';
import { optionalText, requireText } from '../identity/identity-record.mjs';

export const PENDING_WORLD_STATUS = Object.freeze({
  PENDING: 'pending',
  DUE: 'due',
  RESOLVED: 'resolved',
  CANCELLED: 'cancelled',
  CONFLICTED: 'conflicted',
});

export const PENDING_TRANSITIONS = Object.freeze(new Set([PENDING_WORLD_STATUS.RESOLVED, PENDING_WORLD_STATUS.CANCELLED]));

export async function derivePendingWorldEventId({ scope, sourceAuthority, sourceRecordId, producer, idempotencyKey }) {
  const source = sourceRecordId ? ['source', requireText(sourceAuthority, 'sourceAuthority'), sourceRecordId] : ['producer', requireText(producer, 'producer'), requireText(idempotencyKey, 'idempotencyKey')];
  const seed = canonicalJson(['tmrw-v3-pending-world-v1', scope.storyId, scope.branchId, ...source]);
  return `pending_${(await sha256Hex(seed)).slice(0, 32)}`;
}

export function normalizePendingDue(input) {
  if (input === null || input === undefined) return null;
  const kind = requireText(input.kind, 'pending.due.kind');
  if (kind === 'absolute') {
    const localDate = optionalText(input.localDate, 'pending.due.localDate');
    const localTime = requireText(input.localTime, 'pending.due.localTime');
    if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(localTime)) throw new V3PendingWorldEventError('Absolute Pending due time must be HH:mm or HH:mm:ss');
    return Object.freeze({ kind, localDate, localTime: localTime.length === 5 ? `${localTime}:00` : localTime, timezone: optionalText(input.timezone, 'pending.due.timezone'), precision: localDate ? 'date-time' : 'time-only' });
  }
  if (kind === 'relative-offset') {
    const targetElapsedMs = Number(input.targetElapsedMs);
    if (!Number.isSafeInteger(targetElapsedMs) || targetElapsedMs < 0) throw new V3PendingWorldEventError('Relative Pending targetElapsedMs must be non-negative');
    return Object.freeze({ kind, targetElapsedMs });
  }
  if (kind === 'ordinal') {
    const targetOrdinal = Number(input.targetOrdinal);
    if (!Number.isSafeInteger(targetOrdinal) || targetOrdinal < 0) throw new V3PendingWorldEventError('Pending targetOrdinal must be non-negative');
    return Object.freeze({ kind, targetOrdinal });
  }
  throw new V3PendingWorldEventError(`Unsupported Pending due kind: ${kind}`);
}

export function normalizePendingCreate(input) {
  const relevantActorIds = [...new Set((input?.relevantActorIds || []).map((id, index) => requireText(id, `relevantActorIds[${index}]`)))];
  const relevantInstanceIds = [...new Set((input?.relevantInstanceIds || []).map((id, index) => requireText(id, `relevantInstanceIds[${index}]`)))];
  if (relevantActorIds.length === 0 && relevantInstanceIds.length === 0) throw new V3PendingWorldEventError('Pending World Event requires at least one relevant Actor or Character Instance');
  return Object.freeze({
    pendingId: requireText(input?.pendingId, 'pendingId'),
    category: requireText(input?.category, 'pending.category'),
    summary: optionalText(input?.summary, 'pending.summary'),
    relevantActorIds: Object.freeze(relevantActorIds),
    relevantInstanceIds: Object.freeze(relevantInstanceIds),
    due: normalizePendingDue(input?.due),
    sourceEventId: optionalText(input?.sourceEventId, 'pending.sourceEventId'),
    awarenessPolicyRef: optionalText(input?.awarenessPolicyRef, 'pending.awarenessPolicyRef'),
    initialStatus: PENDING_WORLD_STATUS.PENDING,
  });
}

export function normalizePendingTransition(input) {
  const status = requireText(input?.status, 'pending.transition.status');
  if (!PENDING_TRANSITIONS.has(status)) throw new V3PendingWorldEventError(`Unsupported explicit Pending transition: ${status}`);
  return Object.freeze({
    pendingId: requireText(input?.pendingId, 'pendingId'),
    status,
    reason: optionalText(input?.reason, 'pending.transition.reason'),
  });
}

function localScalar(localDate, localTime) {
  if (!localTime) return null;
  const [hour, minute, second = 0] = localTime.split(':').map(Number);
  if (!localDate) return ((hour * 60 + minute) * 60 + second) * 1000;
  const [year, month, day] = localDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

export function derivePendingDueStatus(pending, clock) {
  if (!pending?.due) return PENDING_WORLD_STATUS.PENDING;
  if (pending.due.kind === 'ordinal') return clock.ordinal >= pending.due.targetOrdinal ? PENDING_WORLD_STATUS.DUE : PENDING_WORLD_STATUS.PENDING;
  if (pending.due.kind === 'relative-offset') return clock.timelineElapsedMs >= pending.due.targetElapsedMs ? PENDING_WORLD_STATUS.DUE : PENDING_WORLD_STATUS.PENDING;
  if (clock.mode === 'conflicted' || clock.mode === 'unknown') return PENDING_WORLD_STATUS.CONFLICTED;
  const due = localScalar(pending.due.localDate, pending.due.localTime);
  const current = localScalar(clock.displayLocalDate, clock.displayLocalTime);
  if (due === null || current === null || Boolean(pending.due.localDate) !== Boolean(clock.displayLocalDate)) return PENDING_WORLD_STATUS.CONFLICTED;
  return current >= due ? PENDING_WORLD_STATUS.DUE : PENDING_WORLD_STATUS.PENDING;
}
