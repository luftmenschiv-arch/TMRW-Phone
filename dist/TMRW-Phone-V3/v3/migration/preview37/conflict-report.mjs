import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { MIGRATION_ITEM_STATE, PREVIEW37_SOURCE_AUTHORITY } from './constants.mjs';

export class Preview37ConflictReporter {
  #unitOfWork;
  constructor({ database }) { this.#unitOfWork = new V3UnitOfWork(database); }
  async classify(item) {
    if (item.state !== MIGRATION_ITEM_STATE.READY) return item;
    const prior = await this.#unitOfWork.readonly({ stores: ['previewMigrationItems'], privileged: true }, repositories => repositories.previewMigrationItems.listByIndex('by_source_current', [PREVIEW37_SOURCE_AUTHORITY, item.sourceRecordId, true]));
    if (!prior.length) return item;
    if (prior.some(row => row.sourceFingerprint === item.sourceFingerprint && ['committed', 'active'].includes(row.status))) return Object.freeze({ ...item, state: MIGRATION_ITEM_STATE.ALREADY_MIGRATED, reasonCode: 'unchanged-source-already-migrated' });
    return Object.freeze({ ...item, state: MIGRATION_ITEM_STATE.CONFLICT, reasonCode: 'preview-source-changed-after-canonical-import' });
  }
}

