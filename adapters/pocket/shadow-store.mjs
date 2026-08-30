import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { POCKET_OBSERVATION_TYPE } from './constants.mjs';
import { quarantineRows } from './quarantine.mjs';

const id = (kind, authority, value = null) => value == null ? `${kind}:${authority}` : `${kind}:${authority}:${value}`;
export class PocketShadowStore {
  #unitOfWork;
  constructor({ database }) { this.#unitOfWork = new V3UnitOfWork(database); }
  async loadCurrent(sourceAuthority) {
    return this.#unitOfWork.readonly({ stores: ['pocketShadowObservations', 'pocketShadowParity'], privileged: true }, async repositories => {
      const observations = await repositories.pocketShadowObservations.listByIndex('by_source_current', [sourceAuthority, true]); const parity = (await repositories.pocketShadowParity.listByIndex('by_source', sourceAuthority)).filter(row => row.current);
      return Object.freeze({ observations: Object.freeze(observations), parity: Object.freeze(parity) });
    });
  }
  async refresh({ snapshot, capabilities, observations, parity, sourceRecordsTraversed, truncated, failAfterWrites = null }) {
    const authority = snapshot.sourceAuthority; const cursorId = id('pocket-shadow-cursor', authority); const cursor = await this.#unitOfWork.readonly({ stores: ['pocketShadowCursors'], privileged: true }, repositories => repositories.pocketShadowCursors.get(cursorId));
    if (cursor?.sourceFingerprint === snapshot.sourceFingerprint) return Object.freeze({ skipped: true, observationsWritten: 0, quarantineWritten: 0, cursorAdvanced: false });
    const quarantines = quarantineRows(observations); const currentIds = new Set(observations.map(row => id('pocket-shadow-observation', authority, row.observationId))); const quarantineIds = new Set(quarantines.map(row => row.id)); const parityIds = new Set(parity.map(row => id('pocket-shadow-parity', authority, row.observationId))); const callRows = observations.filter(row => row.observationType === POCKET_OBSERVATION_TYPE.CALL_LOG).map(row => Object.freeze({ id: id('pocket-call-fingerprint', authority, row.content.fingerprint), sourceAuthority: authority, fingerprint: row.content.fingerprint, routeKey: row.sourceMetadata.routeKey, observationId: row.observationId, nonCanonical: true, phase: 11 }));
    return this.#unitOfWork.readwrite({ stores: ['pocketShadowCapabilities', 'pocketShadowCursors', 'pocketShadowObservations', 'pocketShadowQuarantine', 'pocketShadowParity', 'pocketCallFingerprints'], privileged: true }, async repositories => {
      let writes = 0; const maybeFail = () => { writes += 1; if (failAfterWrites != null && writes >= failAfterWrites) throw new Error('Injected Pocket shadow persistence failure'); };
      await repositories.pocketShadowCapabilities.put(Object.freeze({ id: id('pocket-shadow-capabilities', authority), sourceAuthority: authority, sourceVersion: snapshot.sourceVersion, sourceFingerprint: snapshot.sourceFingerprint, status: capabilities.status, capabilities: capabilities.capabilities, issues: capabilities.issues, updatedAt: 'phase11', nonCanonical: true })); maybeFail();
      for (const row of observations) { await repositories.pocketShadowObservations.put(Object.freeze({ id: id('pocket-shadow-observation', authority, row.observationId), ...row, storyId: row.scope?.storyId || null, branchId: row.scope?.branchId || null, current: true, nonCanonical: true, phase: 11, updatedAt: 'phase11' })); maybeFail(); }
      for (const row of quarantines) { await repositories.pocketShadowQuarantine.put(row); maybeFail(); }
      for (const row of parity) { await repositories.pocketShadowParity.put(Object.freeze({ id: id('pocket-shadow-parity', authority, row.observationId), sourceAuthority: authority, ...row, current: true, nonCanonical: true, phase: 11, updatedAt: 'phase11' })); maybeFail(); }
      for (const row of callRows) { await repositories.pocketCallFingerprints.put(row); maybeFail(); }
      if (!truncated) {
        for (const row of await repositories.pocketShadowObservations.listByIndex('by_source_current', [authority, true])) if (!currentIds.has(row.id)) await repositories.pocketShadowObservations.delete(row.id);
        for (const row of await repositories.pocketShadowQuarantine.listByIndex('by_current', true)) if (row.sourceAuthority === authority && !quarantineIds.has(row.id)) await repositories.pocketShadowQuarantine.delete(row.id);
        for (const row of await repositories.pocketShadowParity.listByIndex('by_source', authority)) if (!parityIds.has(row.id)) await repositories.pocketShadowParity.delete(row.id);
        for (const row of await repositories.pocketCallFingerprints.listByIndex('by_source', authority)) if (!callRows.some(call => call.id === row.id)) await repositories.pocketCallFingerprints.delete(row.id);
      }
      await repositories.pocketShadowCursors.put(Object.freeze({ id: cursorId, sourceAuthority: authority, sourceVersion: snapshot.sourceVersion, sourceFingerprint: snapshot.sourceFingerprint, sourceRecordsTraversed, observedCount: observations.length, truncated, completedAt: 'phase11', nonCanonical: true, phase: 11 })); maybeFail();
      return Object.freeze({ skipped: false, observationsWritten: observations.length, quarantineWritten: quarantines.length, cursorAdvanced: true });
    });
  }
  async clearSource(sourceAuthority) { return this.#unitOfWork.readwrite({ stores: ['pocketShadowCapabilities', 'pocketShadowCursors', 'pocketShadowObservations', 'pocketShadowQuarantine', 'pocketShadowParity', 'pocketCallFingerprints'], privileged: true }, async repositories => { for (const store of ['pocketShadowObservations', 'pocketShadowQuarantine', 'pocketShadowParity', 'pocketCallFingerprints']) for (const row of await repositories[store].list()) if (row.sourceAuthority === sourceAuthority) await repositories[store].delete(row.id); await repositories.pocketShadowCapabilities.delete(id('pocket-shadow-capabilities', sourceAuthority)); await repositories.pocketShadowCursors.delete(id('pocket-shadow-cursor', sourceAuthority)); return Object.freeze({ cleared: true, sourceAuthority }); }); }
}
