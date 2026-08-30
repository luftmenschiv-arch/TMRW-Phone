import { Preview37MigrationManifest } from './manifest.mjs';

export class Preview37MigrationRollback {
  #manifest; #events; #kernel;
  constructor({ database, eventEngine, identityKernel, manifest = null }) {
    if (!database || !eventEngine || !identityKernel) throw new TypeError('Preview migration rollback requires v3 migration services');
    this.#manifest = manifest || new Preview37MigrationManifest({ database }); this.#events = eventEngine; this.#kernel = identityKernel;
  }
  async rollback(batchId) {
    const batch = await this.#manifest.getBatch(batchId); if (!batch) throw new Error('Unknown Preview migration batch');
    await this.#manifest.deactivate(batchId);
    const imports = await this.#manifest.importsForBatch(batchId); const events = [];
    for (const row of imports) {
      const item = await this.#manifest.getItem(batchId, row.sourceRecordId); const canonicalScope = item?.canonical?.identity ? { storyId: item.canonical.identity.storyId, branchId: item.canonical.identity.branchId } : null;
      let scope = canonicalScope;
      if (!scope && item?.canonical?.thread) scope = { storyId: item.canonical.thread.storyId, branchId: item.canonical.thread.branchId };
      if (!scope && item?.canonical?.message) scope = { storyId: item.canonical.message.storyId, branchId: item.canonical.message.branchId };
      if (!scope && item?.canonical?.session) scope = { storyId: item.canonical.session.storyId, branchId: item.canonical.session.branchId };
      if (!scope) continue;
      const event = await this.#events.getEvent(scope, row.canonicalEventId); if (event?.status === 'active') events.push({ row, scope, event });
    }
    events.sort((a, b) => b.event.sequence - a.event.sequence);
    try {
      for (const entry of events) await this.#events.retract({ scope: entry.scope, eventId: entry.event.id, expectedRevision: entry.event.revision, producer: 'preview37-migration-rollback', idempotencyKey: `rollback:${batchId}:${entry.event.id}`, reason: 'Automated rollback of Preview 37 copy migration', cascade: false });
      for (const manifestId of [...(batch.identityManifestIds || [])].reverse()) await this.#kernel.rollbackIdentityBatch(manifestId);
      return Object.freeze({ batchId, retractedEvents: events.length, identityBatchesRolledBack: (batch.identityManifestIds || []).length, previewWrites: 0 });
    } catch (error) {
      await this.#manifest.deactivate(batchId, 'rollback-failed'); throw error;
    }
  }
}
