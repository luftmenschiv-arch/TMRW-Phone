function truthy(value) { return value === true; }

export class ProductionShutdownController {
  #runtime;
  #mountManager;
  #launcherOwner;
  #runtimeArbiter;
  #backgroundJobs;
  #shutdownPromise = null;
  #order = [];
  #errors = [];
  #lastPreviewResult = null;

  constructor({ productionRuntime, mountManager, launcherOwner, runtimeArbiter = null, backgroundJobs = [] }) {
    if (!productionRuntime || productionRuntime.role !== 'owner' || !productionRuntime.composition || typeof productionRuntime.dispose !== 'function') {
      throw new TypeError('ProductionShutdownController requires the S08 owner composition root');
    }
    if (!mountManager || typeof mountManager.blockActions !== 'function' || typeof mountManager.disposeShellForShutdown !== 'function' || typeof mountManager.removeRootForShutdown !== 'function') {
      throw new TypeError('ProductionShutdownController requires the S09 ProductionMountManager shutdown boundary');
    }
    if (!launcherOwner || typeof launcherOwner.block !== 'function' || typeof launcherOwner.dispose !== 'function') {
      throw new TypeError('ProductionShutdownController requires the S09 ProductionLauncherOwner');
    }
    if (runtimeArbiter && (typeof runtimeArbiter.returnToPreview37 !== 'function' || typeof runtimeArbiter.inspect !== 'function')) {
      throw new TypeError('runtimeArbiter must be the accepted ProductionRuntimeArbiter');
    }
    if (!Array.isArray(backgroundJobs)) throw new TypeError('backgroundJobs must be an array');
    this.#runtime = productionRuntime;
    this.#mountManager = mountManager;
    this.#launcherOwner = launcherOwner;
    this.#runtimeArbiter = runtimeArbiter;
    this.#backgroundJobs = [...backgroundJobs];
  }

  get status() {
    const runtimeStatus = this.#runtime.status;
    const heartbeat = this.#runtime.composition.heartbeat?.status || {};
    const listener = this.#runtime.composition.listenerOwner?.status || {};
    const interceptor = this.#runtime.composition.generationOwner?.status || {};
    const mount = this.#mountManager.status;
    const launcher = this.#launcherOwner.status;
    const quiesced = runtimeStatus?.disposed === true
      && runtimeStatus?.databaseOpen === false
      && runtimeStatus?.ownsLease === false
      && this.#runtime.composition.authoringGate?.state === 'closed'
      && listener.registered !== true
      && interceptor.delegateActive !== true
      && heartbeat.running !== true
      && mount.mounted !== true
      && mount.rootId == null
      && launcher.mounted !== true;
    return Object.freeze({
      quiesced,
      order: Object.freeze([...this.#order]),
      errors: Object.freeze([...this.#errors]),
      runtimeDisposed: runtimeStatus?.disposed === true,
      databaseOpen: runtimeStatus?.databaseOpen === true,
      ownsLease: runtimeStatus?.ownsLease === true,
      gateState: this.#runtime.composition.authoringGate?.state ?? null,
      listenerRegistered: listener.registered === true,
      interceptorDelegateActive: interceptor.delegateActive === true,
      heartbeatRunning: heartbeat.running === true,
      phoneMounted: mount.mounted === true,
      phoneRootId: mount.rootId,
      launcherMounted: launcher.mounted === true,
      preview: this.#lastPreviewResult,
    });
  }

  async #step(name, work) {
    try {
      await work();
    } catch (error) {
      this.#errors.push(`${name}: ${String(error?.message || error)}`);
    } finally {
      this.#order.push(name);
    }
  }

  async shutdown({ reason = 'production-shutdown' } = {}) {
    if (this.#shutdownPromise) return this.#shutdownPromise;
    this.#shutdownPromise = (async () => {
      await this.#step('1-close-authoring-gate', async () => {
        this.#runtime.composition.authoringGate.close(reason);
      });
      await this.#step('2-block-launcher-phone-actions', async () => {
        this.#launcherOwner.block(reason);
        this.#mountManager.blockActions(reason);
      });
      await this.#step('3-wait-canonical-quiescence', async () => {
        const database = this.#runtime.composition.normalDatabase;
        if (!database || typeof database.waitForQuiescence !== 'function') throw new Error('normal fenced DB lacks quiescence boundary');
        await database.waitForQuiescence();
      });
      await this.#step('4-deactivate-generation-interceptor', async () => {
        this.#runtime.composition.generationOwner.deactivateDelegate();
      });
      await this.#step('5-unregister-runtime-listeners', async () => {
        this.#runtime.composition.listenerOwner.unregister();
      });
      await this.#step('6-stop-background-canonical-jobs', async () => {
        for (const job of this.#backgroundJobs) {
          if (!job) continue;
          if (typeof job.stop === 'function') await job.stop();
          else if (typeof job.dispose === 'function') await job.dispose();
          else throw new Error('background job lacks stop/dispose');
        }
        if (truthy(this.#runtime.services.socialAi?.enabled) || truthy(this.#runtime.services.liveAi?.enabled)) {
          throw new Error('autonomous Social/Live jobs unexpectedly enabled');
        }
      });
      await this.#step('7-stop-heartbeat-resume', async () => {
        await this.#runtime.composition.heartbeat.stop();
      });
      await this.#step('8-dispose-phone-shell', async () => {
        await this.#mountManager.disposeShellForShutdown();
      });
      await this.#step('9-close-phone-controller-state', async () => {
        await this.#runtime.services.phoneController.disableBeta();
      });
      await this.#step('10-remove-v3-root-launcher', async () => {
        this.#mountManager.removeRootForShutdown();
        this.#launcherOwner.dispose();
      });
      await this.#step('11-12-release-lease-close-db', async () => {
        const final = await this.#runtime.dispose(reason);
        const order = final?.disposalOrder || this.#runtime.status?.disposalOrder || [];
        const leaseIndex = order.indexOf('lease-release');
        const dbIndex = order.indexOf('raw-database');
        if (leaseIndex < 0 || dbIndex < 0 || leaseIndex >= dbIndex) throw new Error('runtime activation did not release matching lease before raw DB close');
      });
      await this.#step('13-clear-composition-references', async () => {
        if (this.#runtime.status?.disposed !== true) throw new Error('production composition did not reach disposed state');
      });
      return this.status;
    })();
    return this.#shutdownPromise;
  }

  async handleAuthorityLoss(reason = 'production-authority-lost') {
    this.#runtime.composition.authoringGate.close(reason);
    return this.shutdown({ reason });
  }

  async returnToPreview37() {
    if (!this.#runtimeArbiter) throw new Error('Return to Preview requires the accepted ProductionRuntimeArbiter');
    const shutdown = await this.shutdown({ reason: 'return-to-preview' });
    if (!shutdown.quiesced) {
      return Object.freeze({ restored: false, failedSafe: true, reason: 'v3-not-quiesced', shutdown, arbiter: this.#runtimeArbiter.inspect() });
    }
    const result = await this.#runtimeArbiter.returnToPreview37();
    const arbiter = this.#runtimeArbiter.inspect();
    const failedSafe = arbiter.state === 'FAILED_SAFE';
    this.#lastPreviewResult = Object.freeze({ result, arbiter, restored: !failedSafe });
    return Object.freeze({ restored: !failedSafe, failedSafe, shutdown, result, arbiter });
  }
}
