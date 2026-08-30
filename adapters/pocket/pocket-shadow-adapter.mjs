import { PocketConfigReader } from './config-reader.mjs';
import { detectPocketCapabilities } from './capability-detector.mjs';
import { PocketIdentityMapper } from './identity-mapper.mjs';
import { PocketRouteResolver } from './route-resolver.mjs';
import { PocketNormalizer } from './normalizer.mjs';
import { PocketParityReporter } from './parity-reporter.mjs';
import { PocketShadowStore } from './shadow-store.mjs';
import { PocketSourceCursorRepository } from './source-cursor.mjs';
import { POCKET_MATCH_STATE } from './constants.mjs';

export class PocketShadowAdapter {
  #reader; #normalizer; #parity; #shadow; #cursor; #mapper; #metrics = Object.freeze({ operation: 'none' });
  constructor({ database, readConfig }) { this.#reader = new PocketConfigReader({ readConfig }); this.#mapper = new PocketIdentityMapper({ database }); this.#normalizer = new PocketNormalizer({ identityMapper: this.#mapper, routeResolver: new PocketRouteResolver({ identityMapper: this.#mapper }) }); this.#parity = new PocketParityReporter({ database }); this.#shadow = new PocketShadowStore({ database }); this.#cursor = new PocketSourceCursorRepository({ database }); }
  get lastOperationMetrics() { return structuredClone(this.#metrics); }
  get identityMapper() { return this.#mapper; }
  async scan({ maxObservations, failStage = null } = {}) {
    const snapshot = await this.#reader.read(); if (!snapshot.available) { this.#metrics = Object.freeze({ operation: 'pocket-shadow-scan', sourceReads: 1, sourceWrites: 0, canonicalEventWrites: 0, knowledgeWrites: 0, audienceWrites: 0, clockWrites: 0, eventHistoryScans: 0, storiesScanned: 0, branchesScanned: 0, activeTimers: 0, activePollers: 0 }); return Object.freeze({ status: 'unavailable', snapshot, observations: Object.freeze([]), parity: Object.freeze([]) }); }
    const capabilities = detectPocketCapabilities(snapshot); const cursor = await this.#cursor.get(snapshot.sourceAuthority); if (cursor?.sourceFingerprint === snapshot.sourceFingerprint) { const cached = await this.#shadow.loadCurrent(snapshot.sourceAuthority); this.#metrics = Object.freeze({ operation: 'pocket-shadow-scan-replay', sourceReads: 1, sourceWrites: 0, sourceRecordsTraversed: 0, observationsNormalized: 0, observationsWritten: 0, canonicalEventWrites: 0, knowledgeWrites: 0, audienceWrites: 0, clockWrites: 0, eventHistoryScans: 0, storiesScanned: 0, branchesScanned: 0, activeTimers: 0, activePollers: 0 }); return Object.freeze({ status: capabilities.status, snapshot: Object.freeze({ available: true, sourceAuthority: snapshot.sourceAuthority, sourceVersion: snapshot.sourceVersion, sourceFingerprint: snapshot.sourceFingerprint }), capabilities, observations: cached.observations, parity: cached.parity, persisted: Object.freeze({ skipped: true, observationsWritten: 0, quarantineWritten: 0, cursorAdvanced: false }) }); }
    if (failStage === 'normalization') throw new Error('Injected Pocket normalization failure'); const normalized = await this.#normalizer.normalize(snapshot, { maxObservations }); const parity = []; for (const observation of normalized.observations) { if (failStage === 'comparison') throw new Error('Injected Pocket comparison failure'); parity.push(await this.#parity.compare(observation)); }
    const observations = normalized.observations.map((observation, index) => parity[index]?.comparison === 'conflicting' ? Object.freeze({ ...observation, matchState: POCKET_MATCH_STATE.CONFLICT, reason: parity[index].reason }) : observation); const persisted = await this.#shadow.refresh({ snapshot, capabilities, observations, parity, sourceRecordsTraversed: normalized.sourceRecordsTraversed, truncated: normalized.truncated, failAfterWrites: failStage === 'persistence' ? 1 : null });
    this.#metrics = Object.freeze({ operation: 'pocket-shadow-scan', sourceReads: 1, sourceWrites: 0, sourceRecordsTraversed: normalized.sourceRecordsTraversed, observationsNormalized: observations.length, observationsWritten: persisted.observationsWritten, canonicalEventWrites: 0, knowledgeWrites: 0, audienceWrites: 0, clockWrites: 0, eventHistoryScans: 0, storiesScanned: 0, branchesScanned: 0, activeTimers: 0, activePollers: 0 }); return Object.freeze({ status: capabilities.status, snapshot: Object.freeze({ available: true, sourceAuthority: snapshot.sourceAuthority, sourceVersion: snapshot.sourceVersion, sourceFingerprint: snapshot.sourceFingerprint }), capabilities, observations: Object.freeze(observations), parity: Object.freeze(parity), persisted });
  }
}
