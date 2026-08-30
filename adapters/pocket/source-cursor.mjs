import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
export class PocketSourceCursorRepository {
  #unitOfWork;
  constructor({ database }) { this.#unitOfWork = new V3UnitOfWork(database); }
  async get(sourceAuthority) { return this.#unitOfWork.readonly({ stores: ['pocketShadowCursors'], privileged: true }, repositories => repositories.pocketShadowCursors.get(`pocket-shadow-cursor:${sourceAuthority}`)); }
}
