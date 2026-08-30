export class AssistantPhoneActionImport {
  #coordinator;
  constructor({ coordinator }) { if (!coordinator) throw new TypeError('AssistantPhoneActionImport requires the handoff coordinator'); this.#coordinator = coordinator; }
  import(input) { return this.#coordinator.processSource(input); }
}
