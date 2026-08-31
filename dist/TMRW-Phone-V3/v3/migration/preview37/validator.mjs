import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { previewDigest } from './digest.mjs';

export class Preview37MigrationValidator {
  #unitOfWork;
  constructor({ database }) { this.#unitOfWork = new V3UnitOfWork(database); }
  async validate({ plan, batchId }) {
    const rows = await this.#unitOfWork.readonly({ stores: ['previewMigrationItems', 'previewMigrationImports', 'events'], privileged: true }, async repositories => {
      const items = [];
      for (const status of ['committed', 'active']) items.push(...await repositories.previewMigrationItems.listByIndex('by_batch_status', [batchId, status]));
      const imports = [];
      for (const status of ['pending', 'staged', 'active']) imports.push(...await repositories.previewMigrationImports.listByIndex('by_batch_status', [batchId, status]));
      const missingEvents = [];
      for (const row of imports) if (!await repositories.events.get(row.canonicalEventId)) missingEvents.push(row.canonicalEventId);
      return { items, imports, missingEvents };
    });
    const expectedReady = plan.items.filter(item => item.state === 'ready').length;
    const committedSourceIds = new Set(rows.items.map(item => item.sourceRecordId));
    const missingItems = plan.items.filter(item => item.state === 'ready' && !committedSourceIds.has(item.sourceRecordId)).map(item => item.sourceRecordId);
    const eventIds = rows.imports.map(row => row.canonicalEventId);
    const semanticErrors = rows.items.flatMap(item => {
      if (item.sourceType === 'identity-scope' && !item.canonical?.identity) return [`${item.sourceRecordId}:identity-missing`];
      if (item.sourceType === 'thread' && !item.canonical?.thread) return [`${item.sourceRecordId}:thread-missing`];
      if (item.sourceType === 'message' && !item.canonical?.message) return [`${item.sourceRecordId}:message-missing`];
      if (item.sourceType === 'call' && !item.canonical?.session) return [`${item.sourceRecordId}:call-session-missing`];
      if (['note', 'gallery', 'search-history', 'wallet', 'shop-item', 'shop-order', 'calendar-personal', 'location-personal'].includes(item.sourceType) && !item.canonical?.record) return [`${item.sourceRecordId}:personal-record-missing`];
      return [];
    });
    const targetCounts = Object.freeze(rows.items.reduce((counts, item) => ({ ...counts, [item.sourceType]: (counts[item.sourceType] || 0) + 1 }), {}));
    const canonicalImportDigest = await previewDigest(eventIds.slice().sort());
    const passed = missingItems.length === 0 && rows.missingEvents.length === 0 && semanticErrors.length === 0 && eventIds.length === new Set(eventIds).size;
    return Object.freeze({ passed, expectedReady, committedItems: rows.items.length, canonicalImports: rows.imports.length,
      missingItems: Object.freeze(missingItems), missingEvents: Object.freeze(rows.missingEvents), duplicateCanonicalEventIds: eventIds.length - new Set(eventIds).size,
      semanticErrors: Object.freeze(semanticErrors), targetCounts, canonicalImportDigest,
      sourceFingerprint: plan.sourceFingerprint, planFingerprint: plan.planFingerprint });
  }
}
