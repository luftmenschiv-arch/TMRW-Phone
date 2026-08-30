function freezeReport(stage, checks) {
  const normalized = Object.freeze(Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, value === true])));
  const blockers = Object.freeze(Object.entries(normalized).filter(([, passed]) => !passed).map(([key]) => key));
  return Object.freeze({ stage, ready: blockers.length === 0, blockers, checks: normalized, authoringEnabled: false });
}

async function maybeReadGateF(healthCheck, provided) {
  if (provided && typeof provided === 'object') return provided;
  if (healthCheck && typeof healthCheck.read === 'function') return healthCheck.read();
  return null;
}

export class ProductionCompositionHealth {
  #previewControl;
  #milestone1HealthCheck;

  constructor({ previewControl, milestone1HealthCheck = null }) {
    if (!previewControl || typeof previewControl.findPreview37 !== 'function' || typeof previewControl.verifyPreview37Excluded !== 'function') {
      throw new TypeError('ProductionCompositionHealth requires SillyTavernExtensionControl');
    }
    if (milestone1HealthCheck && typeof milestone1HealthCheck.read !== 'function') {
      throw new TypeError('milestone1HealthCheck must expose read()');
    }
    this.#previewControl = previewControl;
    this.#milestone1HealthCheck = milestone1HealthCheck;
  }

  async preflight({ onboarding = null } = {}) {
    const preview = this.#previewControl.findPreview37();
    const gateF = await maybeReadGateF(this.#milestone1HealthCheck, onboarding?.gateFReport);
    const gateFStatus = onboarding?.gateF ?? gateF?.status ?? 'unverified';
    return freezeReport('preflight', {
      previewResolved: Boolean(preview),
      previewEnabled: preview?.enabled === true && this.#previewControl.isPreview37Disabled() === false,
      optInRequired: onboarding?.optInRequired === true,
      previewIsDefault: onboarding?.defaultRuntime === 'preview37',
      migrationDryRunOnly: onboarding?.autoMigrationRan === false,
      migrationPlanPresent: Boolean(onboarding?.migrationPlan && typeof onboarding.migrationPlan === 'object'),
      migrationPlanNotFatal: onboarding?.migrationPlan?.fatal !== true,
      gateFPassed: gateFStatus === 'pass',
    });
  }

  async startup({ requested = false, cleanReloadProven = false, exclusionProof = null, schemaReady = false, gateFReport = null } = {}) {
    const exclusion = this.#previewControl.verifyPreview37Excluded(exclusionProof || {});
    const gateF = await maybeReadGateF(this.#milestone1HealthCheck, gateFReport);
    return freezeReport('startup', {
      requestedIntentPresent: requested === true,
      cleanReloadProven: cleanReloadProven === true,
      previewExcluded: exclusion.excluded === true,
      schemaReady: schemaReady === true,
      gateFPassed: gateF?.status === 'pass',
    });
  }

  async readyToOpenAuthoring(evidence = {}) {
    const startup = await this.startup(evidence);
    return freezeReport('authoring', {
      productionHealthValid: startup.ready === true,
      previewExcluded: startup.checks.previewExcluded === true,
      validLeaseGeneration: evidence.leaseValid === true,
      identityResolved: evidence.identityResolved === true,
      compositionServicesReady: evidence.compositionServicesReady === true,
      uniqueListenersReady: evidence.uniqueListenersReady === true,
      uniqueGenerationInterceptorReady: evidence.uniqueGenerationInterceptorReady === true,
      callIntegrationReady: evidence.callIntegrationReady === true,
      shellMountHealthy: evidence.shellMountHealthy === true,
      heartbeatQualified: evidence.heartbeatQualified === true,
    });
  }
}
