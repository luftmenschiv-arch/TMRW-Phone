import { requireEventScope } from '../events/event-validator.mjs';

export function dryRunLegacyKnowledgeProposal(input) {
  let scope;
  try { scope = requireEventScope(input?.scope); } catch (error) {
    return Object.freeze({ status: 'quarantined', reason: 'missing-or-ambiguous-story-branch-scope', writesAuthorized: false, detail: error.message });
  }
  if (!input?.stableFactId || !input?.safeSummary) return Object.freeze({ status: 'quarantined', reason: 'missing-stable-fact-provenance', scope, writesAuthorized: false });
  if (!Array.isArray(input?.explicitKnowerInstanceIds) || input.explicitKnowerInstanceIds.length === 0) {
    return Object.freeze({ status: 'quarantined', reason: 'missing-or-ambiguous-knower-evidence', scope, writesAuthorized: false });
  }
  return Object.freeze({
    status: 'proposed',
    scope,
    claim: Object.freeze({ stableFactId: String(input.stableFactId), safeSummary: String(input.safeSummary), currentness: 'uncertain', certainty: 'reported' }),
    explicitKnowerInstanceIds: Object.freeze([...new Set(input.explicitKnowerInstanceIds.map(String))]),
    writesAuthorized: false,
    requiresValidation: true,
  });
}
