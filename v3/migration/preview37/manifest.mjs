import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import {
  MIGRATION_BATCH_STATUS,
  MIGRATION_IMPORT_STATUS,
  MIGRATION_ITEM_STATE,
  PREVIEW37_MAX_QUARANTINE,
  PREVIEW37_MIGRATION_VERSION,
  PREVIEW37_SOURCE_AUTHORITY,
  migrationActivationId,
  migrationImportId,
  migrationItemId,
} from './constants.mjs';

const STORES = Object.freeze([
  'previewMigrationBatches', 'previewMigrationItems', 'previewMigrationMappings',
  'previewMigrationQuarantine', 'previewMigrationImports', 'previewMigrationActivation',
]);

const clone = value => value == null ? value : structuredClone(value);
const nowIso = () => new Date().toISOString();

export class Preview37MigrationManifest {
  #unitOfWork;
  #now;
  constructor({ database, now = nowIso }) {
    if (!database) throw new TypeError('Preview migration manifest requires isolated v3 storage');
    this.#unitOfWork = new V3UnitOfWork(database);
    this.#now = now;
  }

  async getBatch(batchId) {
    return this.#unitOfWork.readonly({ stores: ['previewMigrationBatches'], privileged: true }, repositories => repositories.previewMigrationBatches.get(batchId));
  }

  async getItem(batchId, sourceRecordId) {
    return this.#unitOfWork.readonly({ stores: ['previewMigrationItems'], privileged: true }, repositories => repositories.previewMigrationItems.get(migrationItemId(batchId, sourceRecordId)));
  }

  async listItems(batchId) {
    return this.#unitOfWork.readonly({ stores: ['previewMigrationItems'], privileged: true }, repositories => repositories.previewMigrationItems.listByIndex('by_batch_status', [batchId, 'committed']));
  }

  async persistPlan(plan) {
    const existing = await this.getBatch(plan.batchId);
    if (existing) {
      if (existing.sourceFingerprint !== plan.sourceFingerprint) throw new Error('Migration batch identity conflicts with a different source');
      if (existing.planFingerprint === plan.planFingerprint) return existing;
      if (existing.status !== MIGRATION_BATCH_STATUS.FAILED) throw new Error('Migration batch identity conflicts with a different plan');
      return this.#reconcileFailedDependencyPlan(existing, plan);
    }
    const at = this.#now();
    return this.#unitOfWork.readwrite({ stores: STORES, privileged: true }, async repositories => {
      const counts = Object.fromEntries(Object.entries(plan.counts));
      const batch = Object.freeze({
        id: plan.batchId, entityType: 'preview37-migration-batch', sourceAuthority: PREVIEW37_SOURCE_AUTHORITY,
        migrationVersion: PREVIEW37_MIGRATION_VERSION, sourceFingerprint: plan.sourceFingerprint,
        sourceVersion: plan.sourceVersion, sourceLocation: plan.sourceLocation, planFingerprint: plan.planFingerprint,
        status: MIGRATION_BATCH_STATUS.PLANNED, checkpointOrdinal: -1, activationStatus: 'inactive',
        counts, classificationCounts: clone(plan.classificationCounts || {}), validation: null, priorActiveBatchId: null, identityManifestIds: [],
        createdAt: at, updatedAt: at, phase: 12,
      });
      await repositories.previewMigrationBatches.put(batch);
      let quarantined = 0;
      for (const [ordinal, item] of plan.items.entries()) {
        const row = Object.freeze({
          id: migrationItemId(plan.batchId, item.sourceRecordId), entityType: 'preview37-migration-item',
          batchId: plan.batchId, sourceAuthority: PREVIEW37_SOURCE_AUTHORITY, sourceRecordId: item.sourceRecordId,
          sourceScopeKey: item.sourceScopeKey, sourceType: item.sourceType, sourceFingerprint: item.sourceFingerprint,
          planState: item.state, status: item.state, reasonCode: item.reasonCode, classification: item.classification || null, ordinal, current: false,
          canonical: null, error: null, createdAt: at, updatedAt: at, phase: 12,
        });
        await repositories.previewMigrationItems.put(row);
        if (!['ready', 'already-migrated'].includes(item.state) && quarantined < PREVIEW37_MAX_QUARANTINE) {
          quarantined += 1;
          await repositories.previewMigrationQuarantine.put(Object.freeze({
            id: `${row.id}:quarantine`, entityType: 'preview37-migration-quarantine', batchId: plan.batchId,
            sourceAuthority: PREVIEW37_SOURCE_AUTHORITY, sourceRecordId: item.sourceRecordId,
            sourceScopeKey: item.sourceScopeKey, sourceType: item.sourceType, sourceFingerprint: item.sourceFingerprint,
            state: item.state, reasonCode: item.reasonCode || 'unsafe-preview-record', classification: item.classification || null, current: true,
            candidates: [], createdAt: at, updatedAt: at, phase: 12,
          }));
        }
      }
      return batch;
    });
  }

  async #reconcileFailedDependencyPlan(existing, plan) {
    const at = this.#now();
    return this.#unitOfWork.readwrite({ stores: STORES, privileged: true }, async repositories => {
      const rows = (await repositories.previewMigrationItems.list()).filter(row => row.batchId === existing.id);
      if (rows.length !== plan.items.length) throw new Error('Failed Preview migration plan shape changed incompatibly');
      const byId = new Map(rows.map(row => [row.sourceRecordId, row]));
      let quarantined = 0;
      for (const [ordinal, item] of plan.items.entries()) {
        const row = byId.get(item.sourceRecordId);
        if (!row) throw new Error(`Failed Preview migration plan gained an unrecognized source record: ${item.sourceRecordId}`);
        if (row.sourceFingerprint !== item.sourceFingerprint || row.sourceType !== item.sourceType || row.sourceScopeKey !== item.sourceScopeKey || (row.classification || null) !== (item.classification || null)) {
          throw new Error(`Failed Preview migration source identity changed incompatibly: ${item.sourceRecordId}`);
        }
        const samePlan = row.planState === item.state && (row.reasonCode || null) === (item.reasonCode || null);
        if (row.status === 'committed' || row.status === 'active') {
          if (!samePlan) throw new Error(`Committed Preview migration item changed plan classification: ${item.sourceRecordId}`);
          continue;
        }
        if (samePlan) continue;
        const dependencyBlock = row.planState === MIGRATION_ITEM_STATE.READY
          && ![MIGRATION_ITEM_STATE.READY, MIGRATION_ITEM_STATE.ALREADY_MIGRATED].includes(item.state)
          && String(item.reasonCode || '').startsWith('parent-thread-')
          && !row.canonical;
        if (!dependencyBlock) throw new Error(`Failed Preview migration plan changed outside dependency-safe reconciliation: ${item.sourceRecordId}`);
        const next = Object.freeze({ ...row, planState: item.state, status: item.state, reasonCode: item.reasonCode, classification: item.classification || null, ordinal, error: null, updatedAt: at });
        await repositories.previewMigrationItems.put(next);
        if (quarantined < PREVIEW37_MAX_QUARANTINE) {
          quarantined += 1;
          await repositories.previewMigrationQuarantine.put(Object.freeze({
            id: `${next.id}:quarantine`, entityType: 'preview37-migration-quarantine', batchId: plan.batchId,
            sourceAuthority: PREVIEW37_SOURCE_AUTHORITY, sourceRecordId: item.sourceRecordId,
            sourceScopeKey: item.sourceScopeKey, sourceType: item.sourceType, sourceFingerprint: item.sourceFingerprint,
            state: item.state, reasonCode: item.reasonCode || 'unsafe-preview-record', classification: item.classification || null, current: true,
            candidates: [], createdAt: row.createdAt || at, updatedAt: at, phase: 12,
          }));
        }
      }
      const current = await repositories.previewMigrationBatches.get(existing.id);
      const nextBatch = Object.freeze({ ...current, planFingerprint: plan.planFingerprint, counts: Object.fromEntries(Object.entries(plan.counts)), classificationCounts: clone(plan.classificationCounts || {}), status: MIGRATION_BATCH_STATUS.PLANNED, error: null, updatedAt: at });
      await repositories.previewMigrationBatches.put(nextBatch);
      return nextBatch;
    });
  }

  async start(batchId) { return this.#updateBatch(batchId, { status: MIGRATION_BATCH_STATUS.MIGRATING }); }
  async markValidating(batchId) { return this.#updateBatch(batchId, { status: MIGRATION_BATCH_STATUS.VALIDATING }); }
  async markFailed(batchId, error) { return this.#updateBatch(batchId, { status: MIGRATION_BATCH_STATUS.FAILED, error: String(error?.message || error) }); }
  async markCancelled(batchId) { return this.#updateBatch(batchId, { status: MIGRATION_BATCH_STATUS.CANCELLED }); }

  async #updateBatch(batchId, patch) {
    return this.#unitOfWork.readwrite({ stores: ['previewMigrationBatches'], privileged: true }, async repositories => {
      const current = await repositories.previewMigrationBatches.get(batchId);
      if (!current) throw new Error('Unknown Preview migration batch');
      const next = Object.freeze({ ...current, ...clone(patch), updatedAt: this.#now() });
      await repositories.previewMigrationBatches.put(next);
      return next;
    });
  }

  async recordImport({ batchId, sourceRecordId, sourceFingerprint, sourceScopeKey, operationKey, canonicalEventId, canonicalType }) {
    const id = migrationImportId(canonicalEventId);
    const at = this.#now();
    return this.#unitOfWork.readwrite({ stores: ['previewMigrationImports'], privileged: true }, async repositories => {
      const existing = await repositories.previewMigrationImports.get(id);
      if (existing) {
        if (existing.sourceRecordId !== sourceRecordId || existing.operationKey !== operationKey) throw new Error('Canonical import identity conflicts with an existing Preview record');
        return existing;
      }
      const row = Object.freeze({ id, entityType: 'preview37-migration-import', batchId, sourceAuthority: PREVIEW37_SOURCE_AUTHORITY,
        sourceRecordId, sourceFingerprint, sourceScopeKey, operationKey, canonicalEventId, canonicalType,
        status: MIGRATION_IMPORT_STATUS.PENDING, createdAt: at, updatedAt: at, phase: 12 });
      await repositories.previewMigrationImports.put(row);
      return row;
    });
  }

  async recordMappings(batchId, sourceScopeKey, mappings) {
    const at = this.#now();
    return this.#unitOfWork.readwrite({ stores: ['previewMigrationMappings'], privileged: true }, async repositories => {
      for (const mapping of mappings) await repositories.previewMigrationMappings.put(Object.freeze({
        id: `${batchId}:mapping:${mapping.sourceType}:${mapping.sourceId}`, entityType: 'preview37-migration-mapping',
        batchId, sourceAuthority: PREVIEW37_SOURCE_AUTHORITY, sourceScopeKey, sourceType: mapping.sourceType,
        sourceId: mapping.sourceId, canonicalType: mapping.canonicalType, canonicalId: mapping.canonicalId,
        evidence: mapping.evidence || 'stable-preview-id', createdAt: at, updatedAt: at, phase: 12,
      }));
    });
  }

  async stageImport(canonicalEventId) {
    return this.#unitOfWork.readwrite({ stores: ['previewMigrationImports'], privileged: true }, async repositories => {
      const row = await repositories.previewMigrationImports.get(migrationImportId(canonicalEventId));
      if (!row) throw new Error('Preview import registration is missing');
      if (row.status === MIGRATION_IMPORT_STATUS.ACTIVE) return row;
      const next = Object.freeze({ ...row, status: MIGRATION_IMPORT_STATUS.STAGED, updatedAt: this.#now() });
      await repositories.previewMigrationImports.put(next); return next;
    });
  }

  async commitItem(batchId, sourceRecordId, canonical) {
    return this.#unitOfWork.readwrite({ stores: ['previewMigrationItems', 'previewMigrationBatches'], privileged: true }, async repositories => {
      const id = migrationItemId(batchId, sourceRecordId); const item = await repositories.previewMigrationItems.get(id);
      const batch = await repositories.previewMigrationBatches.get(batchId);
      if (!item || !batch) throw new Error('Migration item or batch is missing');
      if (item.status === 'committed') return item;
      const updatedAt = this.#now(); const next = Object.freeze({ ...item, status: 'committed', canonical: clone(canonical), error: null, updatedAt });
      await repositories.previewMigrationItems.put(next);
      const manifests = canonical?.identityManifestId ? [...new Set([...(batch.identityManifestIds || []), canonical.identityManifestId])] : batch.identityManifestIds;
      await repositories.previewMigrationBatches.put(Object.freeze({ ...batch, checkpointOrdinal: Math.max(batch.checkpointOrdinal, item.ordinal), identityManifestIds: manifests, updatedAt }));
      return next;
    });
  }

  async activate(batchId, validation) {
    return this.#unitOfWork.readwrite({ stores: ['previewMigrationBatches', 'previewMigrationItems', 'previewMigrationImports', 'previewMigrationActivation'], privileged: true }, async repositories => {
      const batch = await repositories.previewMigrationBatches.get(batchId);
      if (!batch || validation?.passed !== true) throw new Error('Only a validated Preview migration batch may be activated');
      const at = this.#now(); const pointerId = migrationActivationId(); const prior = await repositories.previewMigrationActivation.get(pointerId);
      for (const row of await repositories.previewMigrationImports.listByIndex('by_batch_status', [batchId, MIGRATION_IMPORT_STATUS.STAGED])) {
        await repositories.previewMigrationImports.put(Object.freeze({ ...row, status: MIGRATION_IMPORT_STATUS.ACTIVE, updatedAt: at }));
      }
      for (const row of await repositories.previewMigrationItems.listByIndex('by_batch_status', [batchId, 'committed'])) {
        const previous = await repositories.previewMigrationItems.listByIndex('by_source_current', [PREVIEW37_SOURCE_AUTHORITY, row.sourceRecordId, true]);
        for (const old of previous.filter(value => value.id !== row.id)) await repositories.previewMigrationItems.put(Object.freeze({ ...old, current: false, updatedAt: at }));
        await repositories.previewMigrationItems.put(Object.freeze({ ...row, current: true, status: 'active', updatedAt: at }));
      }
      const pointer = Object.freeze({ id: pointerId, entityType: 'preview37-migration-activation', sourceAuthority: PREVIEW37_SOURCE_AUTHORITY,
        batchId, priorBatchId: prior?.batchId || null, status: 'active', updatedAt: at, phase: 12 });
      await repositories.previewMigrationActivation.put(pointer);
      const next = Object.freeze({ ...batch, status: MIGRATION_BATCH_STATUS.COMPLETED, activationStatus: 'active', priorActiveBatchId: prior?.batchId || null, validation: clone(validation), completedAt: at, updatedAt: at });
      await repositories.previewMigrationBatches.put(next); return next;
    });
  }

  async deactivate(batchId, status = MIGRATION_BATCH_STATUS.ROLLED_BACK) {
    return this.#unitOfWork.readwrite({ stores: ['previewMigrationBatches', 'previewMigrationImports', 'previewMigrationActivation'], privileged: true }, async repositories => {
      const batch = await repositories.previewMigrationBatches.get(batchId); if (!batch) throw new Error('Unknown migration batch'); const at = this.#now();
      for (const state of [MIGRATION_IMPORT_STATUS.ACTIVE, MIGRATION_IMPORT_STATUS.STAGED, MIGRATION_IMPORT_STATUS.PENDING]) for (const row of await repositories.previewMigrationImports.listByIndex('by_batch_status', [batchId, state])) await repositories.previewMigrationImports.put(Object.freeze({ ...row, status: MIGRATION_IMPORT_STATUS.ROLLED_BACK, updatedAt: at }));
      const pointer = await repositories.previewMigrationActivation.get(migrationActivationId());
      if (pointer?.batchId === batchId) await repositories.previewMigrationActivation.put(Object.freeze({ ...pointer, batchId: batch.priorActiveBatchId || null, status: batch.priorActiveBatchId ? 'active' : 'inactive', updatedAt: at }));
      const next = Object.freeze({ ...batch, status, activationStatus: 'inactive', updatedAt: at }); await repositories.previewMigrationBatches.put(next); return next;
    });
  }

  async importsForBatch(batchId) {
    return this.#unitOfWork.readonly({ stores: ['previewMigrationImports'], privileged: true }, async repositories => {
      const rows = [];
      for (const status of Object.values(MIGRATION_IMPORT_STATUS)) rows.push(...await repositories.previewMigrationImports.listByIndex('by_batch_status', [batchId, status]));
      return rows;
    });
  }
}
