export class Milestone1BetaOnboarding {
  #migration; #health;
  constructor({ migrationCoordinator, healthCheck }) { if (!migrationCoordinator || !healthCheck) throw new TypeError('Milestone 1 onboarding requires migration and health services'); this.#migration = migrationCoordinator; this.#health = healthCheck; }
  async inspect() { const [migrationPlan, health] = await Promise.all([this.#migration.dryRun(), this.#health.read()]); return Object.freeze({ optInRequired: true, defaultRuntime: 'preview37', migrationPlan, gateF: health?.status || 'unverified', authoringEnabled: false, autoMigrationRan: false }); }
  async copyPreviewExplicitly(plan, options = {}) { return this.#migration.commit(plan, options); }
}
