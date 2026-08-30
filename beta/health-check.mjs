import { V3UnitOfWork } from '../storage/unit-of-work.mjs';

export const MILESTONE1_HEALTH_KEY = 'milestone1-beta-health';
export const GATE_F_CRITERIA = Object.freeze([
  'migration-rollback', 'exact-context-privacy', 'send-regenerate-swipe-edit-delete',
  'dynamic-cast', 'story-branch-isolation', 'text-calls', 'pocket-shadow',
  'preview-active-guard', 'single-pocket-injector', 'canonical-drafts-unsend-reactions-stickers',
  'text-voicemail', 'event-scoped-ai-jobs', 'real-sillytavern-authoring-integration',
  'real-indexeddb', 'warm-open-under-budget', 'steady-interaction-under-50ms',
  'repeated-session-heap-stability', 'closed-idle-zero-work', 'clean-and-migrated-fixtures',
]);

const validStatus = new Set(['pass', 'blocked', 'unverified']);
const normalizeEvidence = (criterion, value = {}) => Object.freeze({ criterion, status: validStatus.has(value.status) ? value.status : 'unverified', source: String(value.source || 'no-evidence'), detail: String(value.detail || '') });

export class Milestone1HealthCheck {
  #unitOfWork; #now;
  constructor({ database, now = () => new Date().toISOString() }) { if (!database) throw new TypeError('Milestone 1 health check requires isolated v3 storage'); this.#unitOfWork = new V3UnitOfWork(database); this.#now = now; }
  async evaluate(evidence = {}, { selectedMigrationBatchId = null, consentedDiagnostics = false } = {}) {
    const criteria = GATE_F_CRITERIA.map(criterion => normalizeEvidence(criterion, evidence[criterion])); const blockers = criteria.filter(row => row.status !== 'pass'); const status = blockers.length ? 'blocked' : 'pass';
    const report = Object.freeze({ key: MILESTONE1_HEALTH_KEY, entityType: 'milestone1-beta-health', phase: 13, gate: 'STOP-GATE-F', status, authoringEnabled: status === 'pass', selectedMigrationBatchId, rollbackPointer: selectedMigrationBatchId, consentedDiagnostics: Boolean(consentedDiagnostics), criteria, blockers: blockers.map(row => row.criterion), updatedAt: this.#now() });
    await this.#unitOfWork.readwrite({ stores: ['metadata'], privileged: true }, repositories => repositories.metadata.put(report)); return report;
  }
  async read() { return this.#unitOfWork.readonly({ stores: ['metadata'], privileged: true }, repositories => repositories.metadata.get(MILESTONE1_HEALTH_KEY)); }
}
