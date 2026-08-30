import { createPrivilegedRepository, createRepository, PRIVILEGED_STORAGE_CAPABILITY } from './repositories.mjs';

export class V3UnitOfWork {
  #database;

  constructor(database) {
    this.#database = database;
  }

  async readonly({ stores, scope = null, privileged = false }, work) {
    return this.#run({ stores, scope, mode: 'readonly', privileged }, work);
  }

  async readwrite({ stores, scope = null, privileged = false }, work) {
    return this.#run({ stores, scope, mode: 'readwrite', privileged }, work);
  }

  async #run({ stores, scope, mode, privileged }, work) {
    return this.#database.transaction(stores, mode, transaction => {
      const repositories = Object.fromEntries(stores.map(storeName => [storeName, privileged
        ? createPrivilegedRepository({ storeName, transaction, capability: PRIVILEGED_STORAGE_CAPABILITY })
        : createRepository({ storeName, transaction, scope })]));
      return work(repositories, transaction);
    });
  }
}
