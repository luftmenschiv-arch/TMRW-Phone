import { V3UnitOfWork } from '../storage/unit-of-work.mjs';
import { requireEventScope } from '../domain/events/event-validator.mjs';

export class HandoffQueryRepository {
  #unitOfWork;
  #metrics = Object.freeze({ operation: 'none' });
  constructor({ database }) { if (!database) throw new TypeError('HandoffQueryRepository requires isolated v3 storage'); this.#unitOfWork = new V3UnitOfWork(database); }
  get lastOperationMetrics() { return structuredClone(this.#metrics); }
  async getLink(scopeInput, { sourceAuthority, sourceMessageId, actionKey }) {
    const scope = requireEventScope(scopeInput);
    const row = await this.#unitOfWork.readonly({ stores: ['handoffLinks'], scope }, repositories => repositories.handoffLinks.getByIndex('by_scope_source_lineage', [scope.storyId, scope.branchId, sourceAuthority, sourceMessageId, actionKey]));
    this.#metrics = Object.freeze({ operation: 'get-handoff-link', directIndexReads: 1, eventHistoryScans: 0, storiesScanned: 0, branchesScanned: 0 }); return row;
  }
  async listLinksForSource(scopeInput, { sourceAuthority, sourceMessageId }) {
    const scope = requireEventScope(scopeInput);
    const rows = await this.#unitOfWork.readonly({ stores: ['handoffLinks'], scope }, repositories => repositories.handoffLinks.listByIndex('by_scope_source_message', [scope.storyId, scope.branchId, sourceAuthority, sourceMessageId]));
    this.#metrics = Object.freeze({ operation: 'list-source-handoff-links', directIndexRows: rows.length, eventHistoryScans: 0, storiesScanned: 0, branchesScanned: 0 }); return Object.freeze(rows);
  }
  async getCursor(scopeInput, sourceAuthority) {
    const scope = requireEventScope(scopeInput);
    const row = await this.#unitOfWork.readonly({ stores: ['handoffSourceCursors'], scope }, repositories => repositories.handoffSourceCursors.getByIndex('by_scope_source', [scope.storyId, scope.branchId, sourceAuthority]));
    this.#metrics = Object.freeze({ operation: 'get-handoff-cursor', directIndexReads: 1, eventHistoryScans: 0, storiesScanned: 0, branchesScanned: 0 }); return row;
  }
}
