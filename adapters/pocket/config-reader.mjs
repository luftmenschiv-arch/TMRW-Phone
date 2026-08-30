import { digest } from './hash.mjs';
import { POCKET_SOURCE_AUTHORITY } from './constants.mjs';

export class PocketConfigReader {
  #readConfig;
  #metrics = Object.freeze({ operation: 'none' });
  constructor({ readConfig }) { if (typeof readConfig !== 'function') throw new TypeError('PocketConfigReader requires an injected read-only config function'); this.#readConfig = readConfig; }
  get lastOperationMetrics() { return structuredClone(this.#metrics); }
  async read() {
    const result = await this.#readConfig();
    if (!result || result.available === false) { this.#metrics = Object.freeze({ operation: 'read-pocket-config', sourceReads: 1, sourceWrites: 0, available: false }); return Object.freeze({ available: false, sourceAuthority: POCKET_SOURCE_AUTHORITY, reason: result?.reason || 'Pocket configuration is unavailable.' }); }
    if (!result.config || typeof result.config !== 'object' || Array.isArray(result.config)) throw new TypeError('Pocket config source returned an unsupported root shape');
    const config = structuredClone(result.config); const sourceVersion = String(result.sourceVersion || config.schemaVersion || config.version || 'unknown'); const sourceFingerprint = await digest(config);
    this.#metrics = Object.freeze({ operation: 'read-pocket-config', sourceReads: 1, sourceWrites: 0, available: true });
    return Object.freeze({ available: true, sourceAuthority: String(result.sourceAuthority || POCKET_SOURCE_AUTHORITY), sourceVersion, sourceFingerprint, config });
  }
}
