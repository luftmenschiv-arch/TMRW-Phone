export class BetaRollbackController {
  #lifecycle; #migrationRollback;
  constructor({ lifecycle, migrationRollback = null }) { if (!lifecycle) throw new TypeError('Beta rollback requires the v3 lifecycle'); this.#lifecycle = lifecycle; this.#migrationRollback = migrationRollback; }
  async returnToPreview37() { const status = await this.#lifecycle.disable(); return Object.freeze({ runtime: 'preview37', v3Preserved: true, previewRestoreRequired: false, status }); }
  async rollbackMigration(batchId) { if (!this.#migrationRollback) throw new Error('Migration rollback is unavailable'); return this.#migrationRollback.rollback(batchId); }
}
