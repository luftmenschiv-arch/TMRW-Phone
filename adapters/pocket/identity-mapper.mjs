import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { POCKET_MATCH_STATE, POCKET_SOURCE_AUTHORITY } from './constants.mjs';

function key(authority, type, id) { return `pocket-shadow-map:${authority}:${type}:${id}`; }
function required(value, field) { const text = String(value || '').trim(); if (!text) throw new TypeError(`${field} is required`); return text; }
export class PocketIdentityMapper {
  #unitOfWork;
  constructor({ database }) { if (!database) throw new TypeError('PocketIdentityMapper requires isolated v3 storage'); this.#unitOfWork = new V3UnitOfWork(database); }
  async registerExplicit(input) {
    const sourceAuthority = required(input.sourceAuthority || POCKET_SOURCE_AUTHORITY, 'sourceAuthority'); const sourceType = required(input.sourceType, 'sourceType'); const sourceId = required(input.sourceId, 'sourceId'); const scope = input.scope;
    if (!scope?.storyId || !scope?.branchId) throw new TypeError('Explicit Pocket mappings require Story and Branch scope');
    const status = input.status || POCKET_MATCH_STATE.EXACT; if (![POCKET_MATCH_STATE.EXACT, POCKET_MATCH_STATE.POSSIBLE].includes(status)) throw new TypeError('A Pocket mapping must be exact or explicitly possible');
    const canonical = Object.freeze(structuredClone(input.canonical || {}));
    await this.#unitOfWork.readonly({ stores: ['actors', 'instances', 'accounts', 'devices', 'threads', 'messages', 'callSessions'], scope }, async repositories => {
      const checks = [['actorId', 'actors', canonical.actorId], ['instanceId', 'instances', canonical.instanceId], ['accountId', 'accounts', canonical.accountId], ['deviceId', 'devices', canonical.deviceId]];
      for (const [field, store, value] of checks) if (value && !await repositories[store].get(value)) throw new TypeError(`Explicit Pocket mapping targets missing canonical ${field}`);
      if (canonical.threadId && !await repositories.threads.getByIndex('by_scope_thread', [scope.storyId, scope.branchId, canonical.threadId])) throw new TypeError('Explicit Pocket mapping targets missing canonical threadId');
      if (canonical.messageId && !await repositories.messages.getByIndex('by_scope_message', [scope.storyId, scope.branchId, canonical.messageId])) throw new TypeError('Explicit Pocket mapping targets missing canonical messageId');
      if (canonical.callSessionId && !await repositories.callSessions.getByIndex('by_scope_session', [scope.storyId, scope.branchId, canonical.callSessionId])) throw new TypeError('Explicit Pocket mapping targets missing canonical callSessionId');
    });
    const row = Object.freeze({ id: key(sourceAuthority, sourceType, sourceId), sourceAuthority, sourceType, sourceId, storyId: scope.storyId, branchId: scope.branchId, status, evidence: 'explicit-user-or-dev-mapping', canonical, createdAt: input.createdAt || 'phase11', updatedAt: input.updatedAt || 'phase11', phase: 11 });
    return this.#unitOfWork.readwrite({ stores: ['pocketShadowMappings'], privileged: true }, async repositories => { await repositories.pocketShadowMappings.put(row); return row; });
  }
  async resolve({ sourceAuthority = POCKET_SOURCE_AUTHORITY, sourceType, sourceId }) {
    const row = await this.#unitOfWork.readonly({ stores: ['pocketShadowMappings'], privileged: true }, repositories => repositories.pocketShadowMappings.get(key(sourceAuthority, sourceType, sourceId)));
    if (!row) return Object.freeze({ state: POCKET_MATCH_STATE.UNRESOLVED, reason: 'No explicit canonical mapping exists.' });
    if (!row.storyId || !row.branchId || !row.canonical || typeof row.canonical !== 'object') return Object.freeze({ state: POCKET_MATCH_STATE.AMBIGUOUS, reason: 'Explicit mapping lacks complete Story/Branch or canonical identity.' });
    return Object.freeze({ state: row.status, reason: row.status === POCKET_MATCH_STATE.EXACT ? null : 'Explicit mapping is marked possible, not promotable.', scope: Object.freeze({ storyId: row.storyId, branchId: row.branchId }), canonical: structuredClone(row.canonical), mappingId: row.id });
  }
}
