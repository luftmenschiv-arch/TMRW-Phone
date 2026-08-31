import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { deriveCanonicalEventId } from '../../domain/events/idempotency.mjs';
import { CALL_ACTION } from '../../domain/calls/call-state-machine.mjs';
import { inventoryPreview37 } from './inventory.mjs';
import { createIdentityMigrationItem, canonicalPeopleFromIdentity } from './identity-translator.mjs';
import { createThreadMigrationItem } from './thread-translator.mjs';
import { createMessageMigrationItem } from './message-translator.mjs';
import { createCallMigrationItem } from './call-translator.mjs';
import { createPersonalAppMigrationItems } from './personal-app-translator.mjs';
import { Preview37PersonalAppImporter } from './personal-app-importer.mjs';
import { Preview37ConflictReporter } from './conflict-report.mjs';
import { Preview37MigrationManifest } from './manifest.mjs';
import { Preview37MigrationValidator } from './validator.mjs';
import { MIGRATION_BATCH_STATUS, MIGRATION_ITEM_STATE, PREVIEW37_MIGRATION_VERSION, PREVIEW37_SOURCE_AUTHORITY, migrationBatchId } from './constants.mjs';
import { previewDigest } from './digest.mjs';

const SOURCE_KIND = 'preview37-copy-migration';
const PRODUCER = 'preview37-migration';
const userKeys = new Set(['user', '{{user}}', '__user__', 'local-player-v1']);
const sourceFor = (recordId, fingerprint) => Object.freeze({ authority: PREVIEW37_SOURCE_AUTHORITY, kind: SOURCE_KIND, recordId, version: fingerprint });
const countStates = items => Object.freeze(items.reduce((counts, item) => ({ ...counts, [item.state]: (counts[item.state] || 0) + 1 }), {}));
const countClassifications = items => Object.freeze(items.reduce((counts, item) => item.classification ? ({ ...counts, [item.classification]: (counts[item.classification] || 0) + 1 }) : counts, {}));
const PERSONAL_SOURCE_TYPES = Object.freeze(new Set(['note', 'gallery', 'search-history', 'wallet', 'shop-item', 'shop-order', 'calendar-personal', 'location-personal']));
const PERSONAL_IMPORT_PRIORITY = Object.freeze({ 'shop-item': 10, note: 20, gallery: 30, 'search-history': 40, wallet: 50, 'calendar-personal': 60, 'location-personal': 70, 'shop-order': 80 });
function personalImportOrder(a, b) {
  const priority = (PERSONAL_IMPORT_PRIORITY[a.sourceType] || 999) - (PERSONAL_IMPORT_PRIORITY[b.sourceType] || 999); if (priority) return priority;
  if (a.sourceType === 'wallet' && b.sourceType === 'wallet' && Number.isSafeInteger(a.data?.legacySequence) && Number.isSafeInteger(b.data?.legacySequence) && a.data.legacySequence !== b.data.legacySequence) return a.data.legacySequence - b.data.legacySequence;
  return a.sourceRecordId.localeCompare(b.sourceRecordId);
}

function peopleIndex(people) {
  const map = new Map();
  for (const person of people) map.set(person.sourceMemberId, person);
  const user = people[0]; for (const key of userKeys) map.set(key, user);
  return map;
}

function mappingsForIdentity(item, identity, people) {
  const rows = [
    { sourceType: 'character-card', sourceId: item.data.card.sourceCardId, canonicalType: 'character-card', canonicalId: identity.cardId },
    { sourceType: 'story', sourceId: item.data.story.sourceStoryId, canonicalType: 'story', canonicalId: identity.storyId },
    { sourceType: 'branch', sourceId: item.data.branch.sourceRouteId, canonicalType: 'branch', canonicalId: identity.branchId },
  ];
  for (const person of people) {
    rows.push({ sourceType: 'actor', sourceId: person.sourceMemberId, canonicalType: 'actor', canonicalId: person.actorId });
    rows.push({ sourceType: 'character-instance', sourceId: person.sourceMemberId, canonicalType: 'character-instance', canonicalId: person.instanceId });
    rows.push({ sourceType: 'device', sourceId: person.sourceMemberId, canonicalType: 'device', canonicalId: person.deviceId });
    rows.push({ sourceType: 'account', sourceId: person.sourceMemberId, canonicalType: 'account', canonicalId: person.accountId });
  }
  return rows;
}

export class Preview37CopyMigrationCoordinator {
  #database; #reader; #kernel; #phones; #messages; #calls; #manifest; #validator; #conflicts; #unitOfWork; #personalImporter;
  #metrics = Object.freeze({ operation: 'none' });
  constructor({ database, rawReader, identityKernel, phoneStateService, messageService, callService, phoneWorldService = null, calendarService = null, manifest = null, validator = null }) {
    if (!database || !rawReader || !identityKernel || !phoneStateService || !messageService || !callService) throw new TypeError('Preview copy migration requires isolated v3 services and a read-only source reader');
    this.#database = database; this.#reader = rawReader; this.#kernel = identityKernel; this.#phones = phoneStateService; this.#messages = messageService; this.#calls = callService;
    this.#manifest = manifest || new Preview37MigrationManifest({ database }); this.#validator = validator || new Preview37MigrationValidator({ database });
    this.#conflicts = new Preview37ConflictReporter({ database }); this.#unitOfWork = new V3UnitOfWork(database); this.#personalImporter = new Preview37PersonalAppImporter({ phoneWorldService, calendarService, manifest: this.#manifest });
  }
  get lastOperationMetrics() { return structuredClone(this.#metrics); }

  async dryRun({ userDisplayName = '{{user}}' } = {}) {
    const before = await this.#writeCommits(); const snapshot = await this.#reader.read(); const inventory = await inventoryPreview37(snapshot);
    const batchId = migrationBatchId(snapshot.sourceFingerprint || await previewDigest({ available: false })); const items = []; const scopePlans = []; const parentThreadByMessage = new Map();
    if (inventory.available && !inventory.fatal) for (const scope of inventory.scopes) {
      const card = inventory.cards.find(row => row.cardKey === scope.cardKey);
      const identityItem = await createIdentityMigrationItem({ batchId, card, scope, userDisplayName }); const memberIds = new Set(['user', '{{user}}', '__user__', 'local-player-v1', ...card.cast.map(member => member.sourceMemberId)]);
      const threadItems = [];
      for (const thread of scope.threads) {
        const threadItem = await createThreadMigrationItem({ scope, thread, memberIds }); threadItems.push({ thread, item: threadItem }); items.push(threadItem);
        for (const message of thread.messages) {
          const messageItem = await createMessageMigrationItem({ scope, thread, message, memberIds });
          parentThreadByMessage.set(messageItem.sourceRecordId, threadItem.sourceRecordId);
          items.push(messageItem);
        }
      }
      for (const call of scope.calls) items.push(await createCallMigrationItem({ scope, call, memberIds }));
      items.push(...await createPersonalAppMigrationItems({ scope, memberIds }));
      items.unshift(identityItem); scopePlans.push(Object.freeze({ scope, card, identitySourceRecordId: identityItem.sourceRecordId, threadSourceRecordIds: Object.freeze(threadItems.map(row => row.item.sourceRecordId)) }));
    }
    const classified = [];
    for (const item of items) classified.push(await this.#conflicts.classify(item));
    const dependencyResolved = await this.#resolveMessageThreadDependencies(classified, parentThreadByMessage);
    const planBasis = { sourceFingerprint: snapshot.sourceFingerprint || 'absent', items: dependencyResolved.map(item => ({ sourceRecordId: item.sourceRecordId, sourceFingerprint: item.sourceFingerprint, sourceType: item.sourceType, state: item.state, reasonCode: item.reasonCode || null, classification: item.classification || null })) };
    const plan = Object.freeze({ batchId, sourceAuthority: PREVIEW37_SOURCE_AUTHORITY, sourceFingerprint: snapshot.sourceFingerprint || 'absent', sourceVersion: snapshot.sourceVersion || 'absent', sourceLocation: snapshot.sourceLocation || 'unavailable',
      planFingerprint: await previewDigest(planBasis), available: inventory.available, fatal: inventory.fatal, issues: inventory.issues, inventory: Object.freeze({ sourceRecordCount: inventory.sourceRecordCount, cards: inventory.cards.length, scopes: inventory.scopes.length, deferredCounts: inventory.deferredCounts }),
      counts: countStates(dependencyResolved), classificationCounts: countClassifications(dependencyResolved), items: Object.freeze(dependencyResolved), scopePlans: Object.freeze(scopePlans), generatedAt: null });
    const after = await this.#writeCommits(); if (after !== before) throw new Error('Preview migration dry run performed an unexpected v3 write');
    this.#metrics = Object.freeze({ operation: 'dry-run', previewReads: 1, previewWrites: 0, canonicalWrites: 0, sourceRecords: inventory.sourceRecordCount, itemsPlanned: dependencyResolved.length, fullCanonicalEventScans: 0, storiesScannedPerItem: 0, branchesScannedPerItem: 0 });
    return plan;
  }

  async commit(plan, { failAfterItems = null, cancelAfterItems = null } = {}) {
    if (plan.fatal) throw new Error('Preview migration plan is fatally invalid');
    const current = await this.#reader.read(); if ((current.sourceFingerprint || 'absent') !== plan.sourceFingerprint) throw new Error('Preview source changed after dry run; create a new migration plan');
    const existing = await this.#manifest.getBatch(plan.batchId); if (existing?.status === MIGRATION_BATCH_STATUS.COMPLETED) { await this.#assertCompletedReplayCompatible(existing, plan); return Object.freeze({ batch: existing, replayed: true, validation: existing.validation }); }
    await this.#manifest.persistPlan(plan); await this.#manifest.start(plan.batchId);
    let processed = 0; let canonicalOperations = 0;
    try {
      for (const scopePlan of plan.scopePlans) {
        const identityItem = plan.items.find(item => item.sourceRecordId === scopePlan.identitySourceRecordId);
        if (!identityItem || ![MIGRATION_ITEM_STATE.READY, MIGRATION_ITEM_STATE.ALREADY_MIGRATED].includes(identityItem.state)) continue;
        const identityRow = await this.#manifest.getItem(plan.batchId, identityItem.sourceRecordId);
        let identity = identityRow?.canonical?.identity;
        if (!identity) {
          identity = await this.#kernel.seedIdentityGraph(identityItem.data); canonicalOperations += 1;
          const people = canonicalPeopleFromIdentity(identityItem, identity);
          await this.#manifest.recordMappings(plan.batchId, scopePlan.scope.sourceScopeKey, mappingsForIdentity(identityItem, identity, people));
          const phoneEvents = await this.#phones.initializeScope({ storyId: identity.storyId, branchId: identity.branchId });
          for (const result of phoneEvents) {
            await this.#manifest.recordImport({ batchId: plan.batchId, sourceRecordId: identityItem.sourceRecordId, sourceFingerprint: identityItem.sourceFingerprint, sourceScopeKey: scopePlan.scope.sourceScopeKey, operationKey: `phone-lifecycle:${result.event.id}`, canonicalEventId: result.event.id, canonicalType: result.event.eventType });
            await this.#manifest.stageImport(result.event.id); canonicalOperations += 1;
          }
          await this.#manifest.commitItem(plan.batchId, identityItem.sourceRecordId, { identity, people, identityManifestId: identityItem.data.manifestId, eventIds: phoneEvents.map(result => result.event.id) });
        }
        const committedIdentity = await this.#manifest.getItem(plan.batchId, identityItem.sourceRecordId); const people = committedIdentity.canonical.people; const bySource = peopleIndex(people); const scope = { storyId: identity.storyId, branchId: identity.branchId };
        const personalItems = plan.items.filter(row => row.sourceScopeKey === scopePlan.scope.sourceScopeKey && PERSONAL_SOURCE_TYPES.has(row.sourceType) && row.state === MIGRATION_ITEM_STATE.READY).slice().sort(personalImportOrder);
        for (const item of personalItems) {
          const saved = await this.#manifest.getItem(plan.batchId, item.sourceRecordId); if (saved?.canonical?.record) continue;
          const imported = await this.#personalImporter.importItem({ plan, item, scope, bySource }); canonicalOperations += imported.canonicalOperations;
          await this.#checkpointFaults(++processed, failAfterItems, cancelAfterItems);
        }
        const threadBySource = new Map();
        for (const item of plan.items.filter(row => row.sourceScopeKey === scopePlan.scope.sourceScopeKey && row.sourceType === 'thread')) {
          if (![MIGRATION_ITEM_STATE.READY, MIGRATION_ITEM_STATE.ALREADY_MIGRATED].includes(item.state)) continue; const saved = await this.#manifest.getItem(plan.batchId, item.sourceRecordId);
          if (saved?.canonical?.thread) { threadBySource.set(item.data.threadId, saved.canonical); continue; }
          if (item.state === MIGRATION_ITEM_STATE.ALREADY_MIGRATED) {
            const canonical = await this.#currentCanonicalThread(item);
            if (!canonical?.thread) throw new Error('Already migrated Thread requires its canonical mapping');
            await this.#manifest.commitItem(plan.batchId, item.sourceRecordId, canonical);
            threadBySource.set(item.data.threadId, canonical);
            continue;
          }
          const participants = item.data.participantSourceIds.map(id => bySource.get(id)?.accountId); if (participants.some(id => !id)) throw new Error('Thread identity mapping became incomplete');
          const source = sourceFor(item.sourceRecordId, item.sourceFingerprint); const key = `preview37:${item.sourceRecordId}:thread`; const expected = await deriveCanonicalEventId({ scope, source, producer: PRODUCER, idempotencyKey: key });
          await this.#manifest.recordImport({ batchId: plan.batchId, sourceRecordId: item.sourceRecordId, sourceFingerprint: item.sourceFingerprint, sourceScopeKey: item.sourceScopeKey, operationKey: key, canonicalEventId: expected, canonicalType: 'messaging.thread-created.v1' });
          const result = await this.#messages.createThread({ scope, kind: item.data.kind, participantAccountIds: participants, threadKey: item.data.threadId, sourceMode: 'preview37-copy', source, producer: PRODUCER, idempotencyKey: key });
          if (result.event) await this.#manifest.stageImport(result.event.id); const canonical = { thread: result.thread, eventIds: result.event ? [result.event.id] : [expected] }; await this.#manifest.commitItem(plan.batchId, item.sourceRecordId, canonical); threadBySource.set(item.data.threadId, canonical); canonicalOperations += 1;
          await this.#checkpointFaults(++processed, failAfterItems, cancelAfterItems);
        }
        for (const item of plan.items.filter(row => row.sourceScopeKey === scopePlan.scope.sourceScopeKey && row.sourceType === 'message')) {
          if (item.state !== MIGRATION_ITEM_STATE.READY) continue; const saved = await this.#manifest.getItem(plan.batchId, item.sourceRecordId); if (saved?.canonical?.message) continue;
          const thread = threadBySource.get(item.data.threadSourceId)?.thread; if (!thread) throw new Error('Message migration requires its canonical Thread');
          let snapshot = await this.#messages.getLatestMembershipSnapshot({ scope, threadId: thread.threadId }); const source = sourceFor(item.sourceRecordId, item.sourceFingerprint); const eventIds = [];
          if (thread.kind === 'group') {
            const membershipIds = item.data.membershipSourceIds.map(id => bySource.get(id)?.accountId); if (membershipIds.some(id => !id)) throw new Error('Group membership mapping became incomplete');
            const membershipSource = sourceFor(`${item.sourceRecordId}:membership`, item.sourceFingerprint); const membershipKey = `preview37:${item.sourceRecordId}:membership`; const membershipEventId = await deriveCanonicalEventId({ scope, source: membershipSource, producer: PRODUCER, idempotencyKey: membershipKey });
            await this.#manifest.recordImport({ batchId: plan.batchId, sourceRecordId: item.sourceRecordId, sourceFingerprint: item.sourceFingerprint, sourceScopeKey: item.sourceScopeKey, operationKey: membershipKey, canonicalEventId: membershipEventId, canonicalType: 'messaging.membership-snapshot.v1' });
            const membership = await this.#messages.createMembershipSnapshot({ scope, threadId: thread.threadId, memberAccountIds: membershipIds, source: membershipSource, producer: PRODUCER, idempotencyKey: membershipKey }); snapshot = membership.snapshot; eventIds.push(membership.event?.id || membershipEventId); await this.#manifest.stageImport(membership.event?.id || membershipEventId);
          }
          const sender = bySource.get(item.data.senderSourceId); const author = bySource.get(item.data.actualAuthorSourceId); const device = bySource.get(item.data.deviceSourceId) || author; if (!sender || !author || !device) throw new Error('Message provenance mapping became incomplete');
          const key = `preview37:${item.sourceRecordId}:message`; const expected = await deriveCanonicalEventId({ scope, source, producer: PRODUCER, idempotencyKey: key });
          await this.#manifest.recordImport({ batchId: plan.batchId, sourceRecordId: item.sourceRecordId, sourceFingerprint: item.sourceFingerprint, sourceScopeKey: item.sourceScopeKey, operationKey: key, canonicalEventId: expected, canonicalType: 'messaging.message-sent.v1' });
          const result = await this.#messages.sendMessage({ scope, threadId: thread.threadId, membershipSnapshotId: snapshot.snapshotId, senderAccountId: sender.accountId, actualAuthorActorId: author.actorId, actualAuthorInstanceId: author.instanceId, deviceId: device.deviceId, text: item.data.text, sourceMode: 'preview37-copy', source, producer: PRODUCER, idempotencyKey: key });
          eventIds.push(result.event.id); await this.#manifest.stageImport(result.event.id); await this.#manifest.commitItem(plan.batchId, item.sourceRecordId, { message: result.message, eventIds }); canonicalOperations += eventIds.length;
          await this.#checkpointFaults(++processed, failAfterItems, cancelAfterItems);
        }
        for (const item of plan.items.filter(row => row.sourceScopeKey === scopePlan.scope.sourceScopeKey && row.sourceType === 'call')) {
          if (item.state !== MIGRATION_ITEM_STATE.READY) continue; const saved = await this.#manifest.getItem(plan.batchId, item.sourceRecordId); if (saved?.canonical?.session) continue;
          const caller = bySource.get(item.data.callerSourceId); const called = bySource.get(item.data.calleeSourceId); if (!caller || !called) throw new Error('Call identity mapping became incomplete');
          const eventIds = []; const source = sourceFor(item.sourceRecordId, item.sourceFingerprint); const initiateKey = `preview37:${item.sourceRecordId}:call-initiate`; const initiateEventId = await deriveCanonicalEventId({ scope, source, producer: PRODUCER, idempotencyKey: initiateKey });
          await this.#manifest.recordImport({ batchId: plan.batchId, sourceRecordId: item.sourceRecordId, sourceFingerprint: item.sourceFingerprint, sourceScopeKey: item.sourceScopeKey, operationKey: initiateKey, canonicalEventId: initiateEventId, canonicalType: 'calls.session-initiated.v1' });
          let result = await this.#calls.initiate({ scope, participantAccountIds: [caller.accountId, called.accountId], callingAccountId: caller.accountId, calledAccountId: called.accountId, actualActorId: caller.actorId, actualInstanceId: caller.instanceId, deviceId: caller.deviceId, sourceMode: 'preview37-copy', source, producer: PRODUCER, idempotencyKey: initiateKey }); eventIds.push(result.event?.id || initiateEventId); await this.#manifest.stageImport(result.event?.id || initiateEventId);
          if (item.data.status === 'completed') {
            const acceptSource = sourceFor(`${item.sourceRecordId}:accept`, item.sourceFingerprint); const acceptKey = `preview37:${item.sourceRecordId}:accept`; const acceptId = await deriveCanonicalEventId({ scope, source: acceptSource, producer: PRODUCER, idempotencyKey: acceptKey }); await this.#manifest.recordImport({ batchId: plan.batchId, sourceRecordId: item.sourceRecordId, sourceFingerprint: item.sourceFingerprint, sourceScopeKey: item.sourceScopeKey, operationKey: acceptKey, canonicalEventId: acceptId, canonicalType: 'calls.session-transitioned.v1' });
            let transition = await this.#calls.transition({ scope, callSessionId: result.session.callSessionId, action: CALL_ACTION.ACCEPT, actualActorId: called.actorId, actualInstanceId: called.instanceId, deviceId: called.deviceId, source: acceptSource, producer: PRODUCER, idempotencyKey: acceptKey }); eventIds.push(transition.event.id); await this.#manifest.stageImport(transition.event.id);
            const endSource = sourceFor(`${item.sourceRecordId}:end`, item.sourceFingerprint); const endKey = `preview37:${item.sourceRecordId}:end`; const endId = await deriveCanonicalEventId({ scope, source: endSource, producer: PRODUCER, idempotencyKey: endKey }); await this.#manifest.recordImport({ batchId: plan.batchId, sourceRecordId: item.sourceRecordId, sourceFingerprint: item.sourceFingerprint, sourceScopeKey: item.sourceScopeKey, operationKey: endKey, canonicalEventId: endId, canonicalType: 'calls.session-transitioned.v1' });
            transition = await this.#calls.transition({ scope, callSessionId: result.session.callSessionId, action: CALL_ACTION.END, actualActorId: caller.actorId, actualInstanceId: caller.instanceId, deviceId: caller.deviceId, measuredDurationMs: item.data.durationMs, source: endSource, producer: PRODUCER, idempotencyKey: endKey }); eventIds.push(transition.event.id); await this.#manifest.stageImport(transition.event.id); result = { ...result, session: transition.session };
          } else {
            const missSource = sourceFor(`${item.sourceRecordId}:miss`, item.sourceFingerprint); const missKey = `preview37:${item.sourceRecordId}:miss`; const missId = await deriveCanonicalEventId({ scope, source: missSource, producer: PRODUCER, idempotencyKey: missKey }); await this.#manifest.recordImport({ batchId: plan.batchId, sourceRecordId: item.sourceRecordId, sourceFingerprint: item.sourceFingerprint, sourceScopeKey: item.sourceScopeKey, operationKey: missKey, canonicalEventId: missId, canonicalType: 'calls.session-transitioned.v1' }); const transition = await this.#calls.transition({ scope, callSessionId: result.session.callSessionId, action: CALL_ACTION.MISS, actualActorId: called.actorId, actualInstanceId: called.instanceId, deviceId: called.deviceId, source: missSource, producer: PRODUCER, idempotencyKey: missKey }); eventIds.push(transition.event.id); await this.#manifest.stageImport(transition.event.id); result = { ...result, session: transition.session };
          }
          await this.#manifest.commitItem(plan.batchId, item.sourceRecordId, { session: result.session, eventIds }); canonicalOperations += eventIds.length; await this.#checkpointFaults(++processed, failAfterItems, cancelAfterItems);
        }
      }
      await this.#manifest.markValidating(plan.batchId); const validation = await this.#validator.validate({ plan, batchId: plan.batchId }); if (!validation.passed) throw new Error(`Preview migration validation failed: ${validation.missingItems.length} missing items`);
      const batch = await this.#manifest.activate(plan.batchId, validation); this.#metrics = Object.freeze({ operation: 'commit', sourceRecords: plan.inventory.sourceRecordCount, itemsProcessed: processed, canonicalOperations, fullCanonicalEventScans: 0, storiesScannedPerItem: 0, branchesScannedPerItem: 0, previewWrites: 0 });
      return Object.freeze({ batch, validation, replayed: false });
    } catch (error) { if (error?.code === 'PREVIEW37_CANCELLED') await this.#manifest.markCancelled(plan.batchId); else await this.#manifest.markFailed(plan.batchId, error); throw error; }
  }

  async #currentCanonicalThread(item) {
    const rows = await this.#unitOfWork.readonly({ stores: ['previewMigrationItems'], privileged: true }, repositories => repositories.previewMigrationItems.listByIndex('by_source_current', [PREVIEW37_SOURCE_AUTHORITY, item.sourceRecordId, true]));
    const valid = rows.filter(row => row.sourceFingerprint === item.sourceFingerprint && ['committed', 'active'].includes(row.status) && row.canonical?.thread?.threadId);
    return valid.length === 1 ? valid[0].canonical : null;
  }

  async #resolveMessageThreadDependencies(items, parentThreadByMessage) {
    const resolved = [...items];
    for (let index = 0; index < resolved.length; index += 1) {
      const item = resolved[index];
      if (item.sourceType !== 'thread' || item.state !== MIGRATION_ITEM_STATE.ALREADY_MIGRATED) continue;
      if (await this.#currentCanonicalThread(item)) continue;
      resolved[index] = Object.freeze({ ...item, state: MIGRATION_ITEM_STATE.CONFLICT, reasonCode: 'canonical-thread-mapping-missing', data: null });
    }
    const byId = new Map(resolved.map(item => [item.sourceRecordId, item]));
    for (let index = 0; index < resolved.length; index += 1) {
      const item = resolved[index];
      if (item.sourceType !== 'message' || ![MIGRATION_ITEM_STATE.READY, MIGRATION_ITEM_STATE.ALREADY_MIGRATED].includes(item.state)) continue;
      const parentId = parentThreadByMessage.get(item.sourceRecordId);
      const parent = parentId ? byId.get(parentId) : null;
      if (parent && [MIGRATION_ITEM_STATE.READY, MIGRATION_ITEM_STATE.ALREADY_MIGRATED].includes(parent.state)) continue;
      const state = parent && [MIGRATION_ITEM_STATE.AMBIGUOUS, MIGRATION_ITEM_STATE.CONFLICT, MIGRATION_ITEM_STATE.UNSUPPORTED, MIGRATION_ITEM_STATE.QUARANTINED].includes(parent.state)
        ? parent.state
        : MIGRATION_ITEM_STATE.CONFLICT;
      const reasonCode = !parent
        ? 'parent-thread-plan-missing'
        : parent.reasonCode === 'canonical-thread-mapping-missing'
          ? 'parent-thread-canonical-mapping-missing'
          : `parent-thread-${parent.state}:${parent.reasonCode || 'non-migratable'}`;
      resolved[index] = Object.freeze({ ...item, state, reasonCode, data: null });
    }
    return Object.freeze(resolved);
  }

  async #assertCompletedReplayCompatible(existing, plan) {
    if (existing.migrationVersion !== PREVIEW37_MIGRATION_VERSION || existing.sourceFingerprint !== plan.sourceFingerprint) throw new Error('Completed Preview migration batch identity is incompatible with this plan');
    const priorRows = await this.#unitOfWork.readonly({ stores: ['previewMigrationItems'], privileged: true }, repositories => repositories.previewMigrationItems.list());
    const prior = priorRows.filter(row => row.batchId === existing.id); if (prior.length !== plan.items.length) throw new Error('Completed Preview migration plan shape changed; create a new migration version');
    const byId = new Map(prior.map(row => [row.sourceRecordId, row]));
    for (const item of plan.items) {
      const row = byId.get(item.sourceRecordId); if (!row) throw new Error(`Completed Preview migration plan gained an unrecognized source record: ${item.sourceRecordId}`);
      if (row.sourceFingerprint !== item.sourceFingerprint || row.sourceType !== item.sourceType || row.sourceScopeKey !== item.sourceScopeKey || (row.classification || null) !== (item.classification || null)) throw new Error(`Completed Preview migration classification/source identity changed: ${item.sourceRecordId}`);
      const priorReason = row.reasonCode || null; const nextReason = item.reasonCode || null;
      const exact = row.planState === item.state && priorReason === nextReason;
      const replayTransition = row.planState === MIGRATION_ITEM_STATE.READY && item.state === MIGRATION_ITEM_STATE.ALREADY_MIGRATED && nextReason === 'unchanged-source-already-migrated';
      if (!exact && !replayTransition) throw new Error(`Completed Preview migration state/reason changed incompatibly: ${item.sourceRecordId}`);
    }
  }

  async #checkpointFaults(processed, failAfter, cancelAfter) {
    if (cancelAfter != null && processed >= cancelAfter) { const error = new Error('Preview migration cancelled at a committed checkpoint'); error.code = 'PREVIEW37_CANCELLED'; throw error; }
    if (failAfter != null && processed >= failAfter) throw new Error('Injected Preview migration failure');
  }
  async #writeCommits() { return this.#database.diagnostics?.writeCommits ?? this.#unitOfWork.readonly({ stores: ['metadata'], privileged: true }, () => 0); }
}
