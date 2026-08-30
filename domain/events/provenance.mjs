import { optionalText, requireText, requireTimestamp } from '../identity/identity-record.mjs';

export function createEventProvenance(input, committedAt) {
  const source = input || {};
  const authority = requireText(source.authority, 'source.authority');
  const kind = requireText(source.kind, 'source.kind');
  const recordId = optionalText(source.recordId, 'source.recordId');
  const sourceVersion = optionalText(source.version, 'source.version');
  const sourceOccurredAt = source.occurredAt ? requireTimestamp(source.occurredAt, 'source.occurredAt') : null;
  return Object.freeze({
    authority,
    kind,
    recordId,
    sourceVersion,
    sourceOccurredAt,
    committedAt: requireTimestamp(committedAt, 'committedAt'),
  });
}
