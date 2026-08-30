export class MainRpSwipeRevisionCoordinator {
  #coordinator;
  constructor({ coordinator }) { if (!coordinator) throw new TypeError('MainRpSwipeRevisionCoordinator requires the handoff coordinator'); this.#coordinator = coordinator; }
  applyRevision(input) { return this.#coordinator.processSource(input); }
  retractSource(input) { return this.#coordinator.retractSource(input); }
}
