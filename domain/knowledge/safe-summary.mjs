import { V3KnowledgeError } from '../../storage/errors.mjs';

export function buildSafeKnowledgeSummary(items, { maxCharacters = 8000 } = {}) {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > 50000) throw new V3KnowledgeError('Safe summary character budget must be 1-50000');
  const lines = [];
  const includedGrantIds = [];
  const represented = new Set();
  let used = 0;
  for (const item of items) {
    const representationKey = `${item.claimId}:${item.fragmentKind}:${item.safeText}`;
    if (represented.has(representationKey)) continue;
    const qualifier = item.confidence === 'confirmed' && item.certainty === 'confirmed' ? '' : ` [${item.confidence}/${item.certainty}]`;
    const line = `- ${item.safeText}${qualifier}`;
    if (used + line.length + (lines.length ? 1 : 0) > maxCharacters) break;
    lines.push(line);
    represented.add(representationKey);
    includedGrantIds.push(item.grantId);
    used += line.length + (lines.length > 1 ? 1 : 0);
  }
  return Object.freeze({ text: lines.join('\n'), includedGrantIds: Object.freeze(includedGrantIds), characters: used, truncated: includedGrantIds.length < items.length });
}
