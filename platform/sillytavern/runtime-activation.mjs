export class Milestone1RuntimeActivation {
  #health; #runtime;
  constructor({ healthCheck, runtimeIntegration }) { if (!healthCheck?.read || !runtimeIntegration?.register || !runtimeIntegration?.unregister) throw new TypeError('Milestone 1 runtime activation requires Gate F health and the SillyTavern adapter'); this.#health = healthCheck; this.#runtime = runtimeIntegration; }
  async activate({ role, resources }) { const health = await this.#health.read(); if (role !== 'enabled-owner' || health?.status !== 'pass') return Object.freeze({ authoringEnabled: false, reason: health?.status || 'gate-unverified' }); const registered = this.#runtime.register(); if (!registered) throw new Error('SillyTavern v3 authoring adapter could not acquire exactly-one registration'); resources.add('adapters', 'sillytavern-v3-authoring', () => this.#runtime.unregister()); return Object.freeze({ authoringEnabled: true, reason: 'gate-f-pass' }); }
}
