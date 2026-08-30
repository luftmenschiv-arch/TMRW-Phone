function freezeStatus(session) {
  return Object.freeze({
    disposed: session.disposed,
    disposing: session.disposing,
    stage: session.stage,
    constructionOrder: Object.freeze([...session.constructionOrder]),
    disposalOrder: Object.freeze([...session.disposalOrder]),
    lastError: session.lastError,
    cleanupErrors: Object.freeze([...session.cleanupErrors]),
  });
}

export function createProductionActivation({ stageObserver = null, onDisposed = null } = {}) {
  if (stageObserver !== null && typeof stageObserver !== 'function') throw new TypeError('stageObserver must be a function');
  if (onDisposed !== null && typeof onDisposed !== 'function') throw new TypeError('onDisposed must be a function');

  const resources = [];
  const session = {
    disposed: false,
    disposing: false,
    stage: 'created',
    constructionOrder: [],
    disposalOrder: [],
    lastError: null,
    cleanupErrors: [],
  };
  let gate = null;
  let disposePromise = null;

  const api = {
    get status() { return freezeStatus(session); },

    setAuthoringGate(authoringGate) {
      if (authoringGate && (typeof authoringGate.close !== 'function' || typeof authoringGate.allows !== 'function')) {
        throw new TypeError('Production activation requires a ProductionAuthoringGate');
      }
      gate = authoringGate;
      return api.status;
    },

    async mark(stage, details = null) {
      if (session.disposed || session.disposing) throw new Error('Cannot advance a disposed production activation');
      if (typeof stage !== 'string' || !stage) throw new TypeError('Production activation stage is required');
      session.stage = stage;
      session.constructionOrder.push(stage);
      if (stageObserver) await stageObserver(stage, details);
      return api.status;
    },

    addResource(stage, dispose) {
      if (session.disposed || session.disposing) throw new Error('Cannot register a resource on a disposed production activation');
      if (typeof stage !== 'string' || !stage) throw new TypeError('Resource stage is required');
      if (typeof dispose !== 'function') throw new TypeError('Resource disposer must be a function');
      resources.push({ stage, dispose });
      return true;
    },

    async dispose(reason = 'production-runtime-disposed') {
      if (session.disposed) return api.status;
      if (disposePromise) return disposePromise;
      disposePromise = (async () => {
        session.disposing = true;
        try { gate?.close(reason); } catch (error) { session.cleanupErrors.push(String(error?.message || error)); }
        for (const resource of [...resources].reverse()) {
          try {
            await resource.dispose();
          } catch (error) {
            session.cleanupErrors.push(`${resource.stage}: ${String(error?.message || error)}`);
          } finally {
            session.disposalOrder.push(resource.stage);
          }
        }
        resources.length = 0;
        session.disposed = true;
        session.disposing = false;
        session.stage = 'disposed';
        if (onDisposed) {
          try { await onDisposed(api.status); } catch (error) { session.cleanupErrors.push(`onDisposed: ${String(error?.message || error)}`); }
        }
        return api.status;
      })();
      return disposePromise;
    },

    async fail(stage, error) {
      session.lastError = `${stage}: ${String(error?.message || error || 'unknown production activation failure')}`;
      try { gate?.close(`production-activation-failed:${stage}`); } catch {}
      const status = await api.dispose(`production-activation-failed:${stage}`);
      const failure = error instanceof Error ? error : new Error(String(error || `Production activation failed at ${stage}`));
      failure.productionActivationStage = stage;
      failure.productionActivationStatus = status;
      throw failure;
    },
  };

  return Object.freeze(api);
}
