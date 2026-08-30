export class SillyTavernCallContinuationDriver {
  #generate;
  #getContext;

  constructor({ Generate, getContext }) {
    if (typeof Generate !== 'function' || typeof getContext !== 'function') {
      throw new TypeError('SillyTavernCallContinuationDriver requires the installed Generate API and getContext');
    }
    this.#generate = Generate;
    this.#getContext = getContext;
  }

  latestVisibleRole() {
    const chat = this.#getContext()?.chat || [];
    for (let index = chat.length - 1; index >= 0; index -= 1) {
      const row = chat[index];
      if (!row || row.is_system || row.extra?.is_hidden === true) continue;
      return row.is_user ? 'user' : 'assistant';
    }
    return null;
  }

  generateStory() {
    return this.#generate('normal');
  }

  continueStory() {
    return this.#generate('continue');
  }
}
