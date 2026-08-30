import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { V3EventConflictError, V3EventValidationError } from '../../storage/errors.mjs';
import { requireText } from '../identity/identity-record.mjs';
import { createCanonicalEventHead, createEventRevision } from './event-envelope.mjs';
import { createEventProvenance } from './provenance.mjs';
import { normalizeCauseEventIds, planCausalRetraction, validateAndCreateCausalEdges } from './causality.mjs';
import { assertEventJson, assertScopeAndReferences, normalizeEventReferences, requireEventScope } from './event-validator.mjs';
import {
  assertIdempotentReplay,
  createIdempotencyRecord,
  deriveCanonicalEventId,
  deriveIdempotencyRecordId,
  requestDigest,
} from './idempotency.mjs';
import { restoreCanonicalEvent, retractCanonicalEvent, reviseCanonicalEvent } from './revision-retraction.mjs';
import { applyProjectorsIncrementally, catchUpProjectors, rebuildProjectors } from '../projections/projection-runner.mjs';

const BASE_EVENT_WRITE_STORES = Object.freeze([
  'stories', 'branches', 'actors', 'instances', 'devices', 'accounts',
  'events', 'eventRevisions', 'eventCausalEdges', 'eventIdempotency', 'eventSequences',
  'projections', 'projectionCheckpoints',
]);

const sequenceId = scope => `event-sequence:${scope.storyId}:${scope.branchId}`;

function resultRecord(event, cascadedEventIds = [], correctionEvent = null) {
  return Object.freeze({
    eventId: event.id,
    revisionAtCommit: event.revision,
    statusAtCommit: event.status,
    cascadedEventIds: [...cascadedEventIds],
    correctionEventId: correctionEvent?.id || null,
  });
}

async function currentCommitSequence(repositories, scope) {
  return (await repositories.eventSequences.get(sequenceId(scope)))?.currentCommitSequence || 0;
}

async function allocateCommitSequence(repositories, scope, updatedAt) {
  const id = sequenceId(scope);
  const current = await repositories.eventSequences.get(id);
  const previous = current?.currentCommitSequence || 0;
  const next = previous + 1;
  await repositories.eventSequences.put(Object.freeze({
    id,
    storyId: scope.storyId,
    branchId: scope.branchId,
    currentCommitSequence: next,
    updatedAt,
    phase: 3,
  }));
  return { previous, next };
}

function normalizeProducer(value) {
  return requireText(value, 'producer');
}

function normalizeIdempotencyKey(value) {
  return requireText(value, 'idempotencyKey');
}

async function replayResult(repositories, storedResult) {
  const event = await repositories.events.get(storedResult.eventId);
  if (!event) throw new V3EventConflictError('Idempotency record points to a missing canonical Event');
  const correctionEvent = storedResult.correctionEventId ? await repositories.events.get(storedResult.correctionEventId) : null;
  if (storedResult.correctionEventId && !correctionEvent) throw new V3EventConflictError('Idempotency record points to a missing Director correction Event');
  return Object.freeze({ event, correctionEvent, replayed: true, cascadedEventIds: Object.freeze([...(storedResult.cascadedEventIds || [])]) });
}

async function prepareCorrection({ correction, scope, producer, idempotencyKey, committedAt, eventTypes }) {
  if (!correction) return null;
  const eventType = requireText(correction.eventType, 'correction.eventType');
  const payload = assertEventJson(correction.payload, 'correction.payload');
  const references = normalizeEventReferences(correction.references || []);
  const provenance = createEventProvenance(correction.source, committedAt);
  eventTypes.assertPayload(eventType, payload);
  const correctionKey = `${idempotencyKey}:correction`;
  const semanticInput = { scope, eventType, payload, references, causes: [], source: { authority: provenance.authority, kind: provenance.kind, recordId: provenance.recordId, sourceVersion: provenance.sourceVersion, sourceOccurredAt: provenance.sourceOccurredAt } };
  const [appendDigest, eventId] = await Promise.all([
    requestDigest(semanticInput),
    deriveCanonicalEventId({ scope, source: { authority: provenance.authority, recordId: provenance.recordId }, producer, idempotencyKey: correctionKey }),
  ]);
  return Object.freeze({ eventType, payload, references, provenance, appendDigest, eventId });
}

async function appendPreparedCorrection({ repositories, scope, prepared, projectors, committedAt }) {
  if (!prepared) return { event: null, metrics: { projectionsDeleted: 0, projectionsWritten: 0, aggregateSourceRowsRead: 0, aggregateRowsWritten: 0 } };
  await assertScopeAndReferences({ repositories, scope, references: prepared.references });
  if (await repositories.events.get(prepared.eventId)) throw new V3EventConflictError('Director correction Event already exists without its operation idempotency record');
  const sequence = await allocateCommitSequence(repositories, scope, committedAt);
  const event = createCanonicalEventHead({ id: prepared.eventId, scope, eventType: prepared.eventType, sequence: sequence.next, commitSequence: sequence.next, payload: prepared.payload, references: prepared.references, provenance: prepared.provenance, causes: [], committedAt, appendDigest: prepared.appendDigest });
  await repositories.events.put(event);
  await repositories.eventRevisions.put(createEventRevision({ event, operation: 'append', commitSequence: sequence.next, committedAt, reason: 'director-intervention' }));
  const metrics = await applyProjectorsIncrementally({ repositories, scope, event, projectors, expectedPriorCommitSequence: sequence.previous, commitSequence: sequence.next, updatedAt: committedAt });
  return { event, metrics };
}

export class CanonicalEventEngine {
  #unitOfWork;
  #eventTypes;
  #projectors;
  #transactionStores;
  #now;
  #lastMetrics = Object.freeze({ operation: 'none' });

  constructor({ database, eventTypes, projectors = [], now = () => new Date().toISOString() }) {
    if (!database) throw new TypeError('An open isolated v3 database is required');
    if (!eventTypes || typeof eventTypes.assertPayload !== 'function') throw new TypeError('A canonical Event type registry is required');
    if (!Array.isArray(projectors)) throw new TypeError('projectors must be an array');
    const projectorIds = projectors.map(projector => requireText(projector?.id, 'projector.id'));
    if (new Set(projectorIds).size !== projectorIds.length) throw new TypeError('Projector IDs must be unique');
    this.#unitOfWork = new V3UnitOfWork(database);
    this.#eventTypes = eventTypes;
    this.#projectors = Object.freeze([...projectors]);
    this.#transactionStores = Object.freeze([...new Set([...BASE_EVENT_WRITE_STORES, ...projectors.flatMap(projector => projector.stores || [])])]);
    this.#now = now;
  }

  get lastOperationMetrics() {
    return structuredClone(this.#lastMetrics);
  }

  get projectorCount() {
    return this.#projectors.length;
  }

  async append(input) {
    const scope = requireEventScope(input?.scope);
    const eventType = requireText(input?.eventType, 'eventType');
    const payload = assertEventJson(input?.payload, 'payload');
    const references = normalizeEventReferences(input?.references);
    const causes = normalizeCauseEventIds(input?.causes);
    const producer = normalizeProducer(input?.producer);
    const idempotencyKey = normalizeIdempotencyKey(input?.idempotencyKey);
    this.#eventTypes.assertPayload(eventType, payload);
    const committedAt = this.#now();
    const provenance = createEventProvenance(input?.source, committedAt);
    const semanticInput = { scope, eventType, payload, references, causes, source: { authority: provenance.authority, kind: provenance.kind, recordId: provenance.recordId, sourceVersion: provenance.sourceVersion, sourceOccurredAt: provenance.sourceOccurredAt } };
    const [semanticDigest, digest, eventId, idempotencyId] = await Promise.all([
      requestDigest(semanticInput),
      requestDigest({ operation: 'append', semanticInput }),
      deriveCanonicalEventId({ scope, source: { authority: provenance.authority, recordId: provenance.recordId }, producer, idempotencyKey }),
      deriveIdempotencyRecordId({ scope, producer, idempotencyKey }),
    ]);

    const committed = await this.#unitOfWork.readwrite({ stores: this.#transactionStores, scope }, async repositories => {
      const idempotency = await repositories.eventIdempotency.get(idempotencyId);
      const replay = assertIdempotentReplay(idempotency, { operation: 'append', digest });
      if (replay) return { response: await replayResult(repositories, replay), metrics: { operation: 'append-replay', sourceEventsScanned: 0 } };

      await assertScopeAndReferences({ repositories, scope, references });
      const existing = await repositories.events.get(eventId);
      if (existing) {
        if (existing.appendDigest !== semanticDigest) throw new V3EventConflictError('Stable source identity resolves to a conflicting canonical Event');
        const result = resultRecord(existing);
        await repositories.eventIdempotency.put(createIdempotencyRecord({ id: idempotencyId, scope, producer, idempotencyKey, operation: 'append', digest, result, committedAt }));
        return { response: Object.freeze({ event: existing, replayed: true, cascadedEventIds: Object.freeze([]) }), metrics: { operation: 'append-source-replay', sourceEventsScanned: 0 } };
      }

      const edges = await validateAndCreateCausalEdges({ repositories, scope, causeEventIds: causes, effectEventId: eventId, createdAt: committedAt });
      const sequence = await allocateCommitSequence(repositories, scope, committedAt);
      const event = createCanonicalEventHead({
        id: eventId, scope, eventType, sequence: sequence.next, commitSequence: sequence.next,
        payload, references, provenance, causes, committedAt, appendDigest: semanticDigest,
      });
      const revision = createEventRevision({ event, operation: 'append', commitSequence: sequence.next, committedAt });
      await repositories.events.put(event);
      await repositories.eventRevisions.put(revision);
      for (const edge of edges) await repositories.eventCausalEdges.put(edge);
      const projectionMetrics = await applyProjectorsIncrementally({
        repositories, scope, event, projectors: this.#projectors,
        expectedPriorCommitSequence: sequence.previous, commitSequence: sequence.next, updatedAt: committedAt,
      });
      const result = resultRecord(event);
      await repositories.eventIdempotency.put(createIdempotencyRecord({ id: idempotencyId, scope, producer, idempotencyKey, operation: 'append', digest, result, committedAt }));
      return {
        response: Object.freeze({ event, replayed: false, cascadedEventIds: Object.freeze([]) }),
        metrics: { operation: 'append', sourceEventsScanned: 0, directEventReads: causes.length, commitSequence: sequence.next, ...projectionMetrics },
      };
    });
    this.#lastMetrics = Object.freeze(committed.metrics);
    return committed.response;
  }

  async revise({ scope: inputScope, eventId, expectedRevision, payload: inputPayload, references: inputReferences, producer: inputProducer, idempotencyKey: inputKey, reason = null, correction = null }) {
    const scope = requireEventScope(inputScope);
    const canonicalEventId = requireText(eventId, 'eventId');
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new TypeError('expectedRevision must be a positive integer');
    const payload = assertEventJson(inputPayload, 'payload');
    const references = inputReferences === undefined ? null : normalizeEventReferences(inputReferences);
    const producer = normalizeProducer(inputProducer);
    const idempotencyKey = normalizeIdempotencyKey(inputKey);
    const committedAt = this.#now();
    const preparedCorrection = await prepareCorrection({ correction, scope, producer, idempotencyKey, committedAt, eventTypes: this.#eventTypes });
    const digest = await requestDigest({ operation: 'revise', scope, eventId: canonicalEventId, expectedRevision, payload, references, producer, idempotencyKey, reason, correction: preparedCorrection ? { eventId: preparedCorrection.eventId, payload: preparedCorrection.payload } : null });
    const idempotencyId = await deriveIdempotencyRecordId({ scope, producer, idempotencyKey });

    const committed = await this.#unitOfWork.readwrite({ stores: this.#transactionStores, scope }, async repositories => {
      const idempotency = await repositories.eventIdempotency.get(idempotencyId);
      const replay = assertIdempotentReplay(idempotency, { operation: 'revise', digest });
      if (replay) return { response: await replayResult(repositories, replay), metrics: { operation: 'revise-replay', sourceEventsScanned: 0 } };
      const current = await repositories.events.get(canonicalEventId);
      if (!current) throw new V3EventValidationError('Canonical Event does not exist in this Story/Branch');
      if (current.status !== 'active') throw new V3EventConflictError('A retracted Event cannot be revised');
      if (current.revision !== expectedRevision) throw new V3EventConflictError(`Expected revision ${expectedRevision}, found ${current.revision}`);
      const nextReferences = references || current.references;
      this.#eventTypes.assertPayload(current.eventType, payload);
      await assertScopeAndReferences({ repositories, scope, references: nextReferences });
      const sequence = await allocateCommitSequence(repositories, scope, committedAt);
      const next = reviseCanonicalEvent(current, { payload, references: nextReferences, commitSequence: sequence.next, committedAt });
      await repositories.events.put(next);
      await repositories.eventRevisions.put(createEventRevision({ event: next, operation: 'revise', commitSequence: sequence.next, committedAt, reason, priorRevision: current.revision }));
      let projectionMetrics = await applyProjectorsIncrementally({ repositories, scope, event: next, projectors: this.#projectors, expectedPriorCommitSequence: sequence.previous, commitSequence: sequence.next, updatedAt: committedAt });
      const appendedCorrection = await appendPreparedCorrection({ repositories, scope, prepared: preparedCorrection, projectors: this.#projectors, committedAt });
      projectionMetrics = { projectors: this.#projectors.length, projectionsDeleted: projectionMetrics.projectionsDeleted + appendedCorrection.metrics.projectionsDeleted, projectionsWritten: projectionMetrics.projectionsWritten + appendedCorrection.metrics.projectionsWritten, aggregateSourceRowsRead: projectionMetrics.aggregateSourceRowsRead + appendedCorrection.metrics.aggregateSourceRowsRead, aggregateRowsWritten: projectionMetrics.aggregateRowsWritten + appendedCorrection.metrics.aggregateRowsWritten };
      const result = resultRecord(next, [], appendedCorrection.event);
      await repositories.eventIdempotency.put(createIdempotencyRecord({ id: idempotencyId, scope, producer, idempotencyKey, operation: 'revise', digest, result, committedAt }));
      return { response: Object.freeze({ event: next, correctionEvent: appendedCorrection.event, replayed: false, cascadedEventIds: Object.freeze([]) }), metrics: { operation: 'revise', sourceEventsScanned: 0, directEventReads: 1, commitSequence: sequence.next, ...projectionMetrics } };
    });
    this.#lastMetrics = Object.freeze(committed.metrics);
    return committed.response;
  }

  async retract({ scope: inputScope, eventId, expectedRevision, producer: inputProducer, idempotencyKey: inputKey, reason, cascade = false, correction = null }) {
    const scope = requireEventScope(inputScope);
    const canonicalEventId = requireText(eventId, 'eventId');
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new TypeError('expectedRevision must be a positive integer');
    const normalizedReason = requireText(reason, 'reason');
    const producer = normalizeProducer(inputProducer);
    const idempotencyKey = normalizeIdempotencyKey(inputKey);
    const committedAt = this.#now();
    const preparedCorrection = await prepareCorrection({ correction, scope, producer, idempotencyKey, committedAt, eventTypes: this.#eventTypes });
    const digest = await requestDigest({ operation: 'retract', scope, eventId: canonicalEventId, expectedRevision, producer, idempotencyKey, reason: normalizedReason, cascade: Boolean(cascade), correction: preparedCorrection ? { eventId: preparedCorrection.eventId, payload: preparedCorrection.payload } : null });
    const idempotencyId = await deriveIdempotencyRecordId({ scope, producer, idempotencyKey });

    const committed = await this.#unitOfWork.readwrite({ stores: this.#transactionStores, scope }, async repositories => {
      const idempotency = await repositories.eventIdempotency.get(idempotencyId);
      const replay = assertIdempotentReplay(idempotency, { operation: 'retract', digest });
      if (replay) return { response: await replayResult(repositories, replay), metrics: { operation: 'retract-replay', sourceEventsScanned: 0 } };
      const root = await repositories.events.get(canonicalEventId);
      if (!root) throw new V3EventValidationError('Canonical Event does not exist in this Story/Branch');
      if (root.status !== 'active') throw new V3EventConflictError('Canonical Event is already retracted');
      if (root.revision !== expectedRevision) throw new V3EventConflictError(`Expected revision ${expectedRevision}, found ${root.revision}`);
      const eventIds = cascade ? await planCausalRetraction({ repositories, scope, rootEventId: root.id }) : [root.id];
      if (preparedCorrection?.payload?.affectedEventIds && JSON.stringify([...preparedCorrection.payload.affectedEventIds].sort()) !== JSON.stringify([...eventIds].sort())) throw new V3EventConflictError('Director dependency preview is stale; re-preview before Undo Canon');
      const retracted = [];
      let projectionMetrics = { projectors: this.#projectors.length, projectionsDeleted: 0, projectionsWritten: 0, aggregateSourceRowsRead: 0, aggregateRowsWritten: 0 };
      for (const targetId of eventIds) {
        const current = await repositories.events.get(targetId);
        if (!current || current.status === 'retracted') continue;
        const sequence = await allocateCommitSequence(repositories, scope, committedAt);
        const next = retractCanonicalEvent(current, { commitSequence: sequence.next, committedAt });
        await repositories.events.put(next);
        await repositories.eventRevisions.put(createEventRevision({ event: next, operation: 'retract', commitSequence: sequence.next, committedAt, reason: targetId === root.id ? normalizedReason : `causal-cascade:${root.id}`, priorRevision: current.revision }));
        const changed = await applyProjectorsIncrementally({ repositories, scope, event: next, projectors: this.#projectors, expectedPriorCommitSequence: sequence.previous, commitSequence: sequence.next, updatedAt: committedAt });
        projectionMetrics = {
          projectors: changed.projectors,
          projectionsDeleted: projectionMetrics.projectionsDeleted + changed.projectionsDeleted,
          projectionsWritten: projectionMetrics.projectionsWritten + changed.projectionsWritten,
          aggregateSourceRowsRead: projectionMetrics.aggregateSourceRowsRead + (changed.aggregateSourceRowsRead || 0),
          aggregateRowsWritten: projectionMetrics.aggregateRowsWritten + (changed.aggregateRowsWritten || 0),
        };
        retracted.push(next);
      }
      const rootAfter = retracted.find(event => event.id === root.id);
      const cascadedEventIds = retracted.filter(event => event.id !== root.id).map(event => event.id);
      const appendedCorrection = await appendPreparedCorrection({ repositories, scope, prepared: preparedCorrection, projectors: this.#projectors, committedAt });
      projectionMetrics = { projectors: this.#projectors.length, projectionsDeleted: projectionMetrics.projectionsDeleted + appendedCorrection.metrics.projectionsDeleted, projectionsWritten: projectionMetrics.projectionsWritten + appendedCorrection.metrics.projectionsWritten, aggregateSourceRowsRead: projectionMetrics.aggregateSourceRowsRead + appendedCorrection.metrics.aggregateSourceRowsRead, aggregateRowsWritten: projectionMetrics.aggregateRowsWritten + appendedCorrection.metrics.aggregateRowsWritten };
      const result = resultRecord(rootAfter, cascadedEventIds, appendedCorrection.event);
      await repositories.eventIdempotency.put(createIdempotencyRecord({ id: idempotencyId, scope, producer, idempotencyKey, operation: 'retract', digest, result, committedAt }));
      return { response: Object.freeze({ event: rootAfter, correctionEvent: appendedCorrection.event, replayed: false, cascadedEventIds: Object.freeze(cascadedEventIds) }), metrics: { operation: 'retract', sourceEventsScanned: 0, directEventReads: eventIds.length, cascaded: cascadedEventIds.length, ...projectionMetrics } };
    });
    this.#lastMetrics = Object.freeze(committed.metrics);
    return committed.response;
  }

  async restore({ scope: inputScope, eventId, expectedRevision, affectedEventIds = null, producer: inputProducer, idempotencyKey: inputKey, reason, correction = null }) {
    const scope = requireEventScope(inputScope);
    const canonicalEventId = requireText(eventId, 'eventId');
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new TypeError('expectedRevision must be a positive integer');
    const normalizedReason = requireText(reason, 'reason');
    const producer = normalizeProducer(inputProducer);
    const idempotencyKey = normalizeIdempotencyKey(inputKey);
    const committedAt = this.#now();
    const selectedIds = [...new Set((affectedEventIds || [canonicalEventId]).map((value, index) => requireText(value, `affectedEventIds[${index}]`)))];
    if (!selectedIds.includes(canonicalEventId)) throw new V3EventValidationError('Restore batch must include its root Event');
    const preparedCorrection = await prepareCorrection({ correction, scope, producer, idempotencyKey, committedAt, eventTypes: this.#eventTypes });
    const digest = await requestDigest({ operation: 'restore', scope, eventId: canonicalEventId, expectedRevision, selectedIds: [...selectedIds].sort(), producer, idempotencyKey, reason: normalizedReason, correction: preparedCorrection ? { eventId: preparedCorrection.eventId, payload: preparedCorrection.payload } : null });
    const idempotencyId = await deriveIdempotencyRecordId({ scope, producer, idempotencyKey });
    const committed = await this.#unitOfWork.readwrite({ stores: this.#transactionStores, scope }, async repositories => {
      const idempotency = await repositories.eventIdempotency.get(idempotencyId);
      const replay = assertIdempotentReplay(idempotency, { operation: 'restore', digest });
      if (replay) return { response: await replayResult(repositories, replay), metrics: { operation: 'restore-replay', sourceEventsScanned: 0 } };
      const root = await repositories.events.get(canonicalEventId);
      if (!root) throw new V3EventValidationError('Canonical Event does not exist in this Story/Branch');
      if (root.status !== 'retracted') throw new V3EventConflictError('Canonical Event is not retracted');
      if (root.revision !== expectedRevision) throw new V3EventConflictError(`Expected revision ${expectedRevision}, found ${root.revision}`);
      let projectionMetrics = { projectors: this.#projectors.length, projectionsDeleted: 0, projectionsWritten: 0, aggregateSourceRowsRead: 0, aggregateRowsWritten: 0 };
      const restored = [];
      for (const targetId of selectedIds) {
        const current = await repositories.events.get(targetId);
        if (!current) throw new V3EventValidationError(`Restore batch Event is missing: ${targetId}`);
        if (current.status === 'active') continue;
        const sequence = await allocateCommitSequence(repositories, scope, committedAt);
        const next = restoreCanonicalEvent(current, { commitSequence: sequence.next, committedAt });
        await repositories.events.put(next);
        await repositories.eventRevisions.put(createEventRevision({ event: next, operation: 'restore', commitSequence: sequence.next, committedAt, reason: targetId === root.id ? normalizedReason : `director-restore:${root.id}`, priorRevision: current.revision }));
        const changed = await applyProjectorsIncrementally({ repositories, scope, event: next, projectors: this.#projectors, expectedPriorCommitSequence: sequence.previous, commitSequence: sequence.next, updatedAt: committedAt });
        projectionMetrics = { projectors: changed.projectors, projectionsDeleted: projectionMetrics.projectionsDeleted + changed.projectionsDeleted, projectionsWritten: projectionMetrics.projectionsWritten + changed.projectionsWritten, aggregateSourceRowsRead: projectionMetrics.aggregateSourceRowsRead + (changed.aggregateSourceRowsRead || 0), aggregateRowsWritten: projectionMetrics.aggregateRowsWritten + (changed.aggregateRowsWritten || 0) };
        restored.push(next);
      }
      const rootAfter = restored.find(event => event.id === root.id) || root;
      const appendedCorrection = await appendPreparedCorrection({ repositories, scope, prepared: preparedCorrection, projectors: this.#projectors, committedAt });
      projectionMetrics = { projectors: this.#projectors.length, projectionsDeleted: projectionMetrics.projectionsDeleted + appendedCorrection.metrics.projectionsDeleted, projectionsWritten: projectionMetrics.projectionsWritten + appendedCorrection.metrics.projectionsWritten, aggregateSourceRowsRead: projectionMetrics.aggregateSourceRowsRead + appendedCorrection.metrics.aggregateSourceRowsRead, aggregateRowsWritten: projectionMetrics.aggregateRowsWritten + appendedCorrection.metrics.aggregateRowsWritten };
      const result = resultRecord(rootAfter, restored.filter(event => event.id !== root.id).map(event => event.id), appendedCorrection.event);
      await repositories.eventIdempotency.put(createIdempotencyRecord({ id: idempotencyId, scope, producer, idempotencyKey, operation: 'restore', digest, result, committedAt }));
      return { response: Object.freeze({ event: rootAfter, correctionEvent: appendedCorrection.event, replayed: false, cascadedEventIds: Object.freeze(result.cascadedEventIds) }), metrics: { operation: 'restore', sourceEventsScanned: 0, directEventReads: selectedIds.length, restored: restored.length, ...projectionMetrics } };
    });
    this.#lastMetrics = Object.freeze(committed.metrics);
    return committed.response;
  }

  async getEvent(scopeInput, eventId) {
    const scope = requireEventScope(scopeInput);
    return this.#unitOfWork.readonly({ stores: ['events'], scope }, repositories => repositories.events.get(requireText(eventId, 'eventId')));
  }

  async listEvents(scopeInput, { status = null } = {}) {
    const scope = requireEventScope(scopeInput);
    return this.#unitOfWork.readonly({ stores: ['events'], scope }, async repositories => {
      const events = status
        ? await repositories.events.listByIndex('by_scope_status_sequence', [scope.storyId, scope.branchId, status])
        : await repositories.events.list();
      return events.sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
    });
  }

  async listRevisions(scopeInput, eventId) {
    const scope = requireEventScope(scopeInput);
    return this.#unitOfWork.readonly({ stores: ['eventRevisions'], scope }, async repositories => {
      const rows = await repositories.eventRevisions.listByIndex('by_scope_event', [scope.storyId, scope.branchId, requireText(eventId, 'eventId')]);
      return rows.sort((left, right) => left.revision - right.revision);
    });
  }

  async listCausalDependents(scopeInput, eventId) {
    const scope = requireEventScope(scopeInput);
    return this.#unitOfWork.readonly({ stores: ['eventCausalEdges'], scope }, repositories => repositories.eventCausalEdges.listByIndex('by_scope_cause', [scope.storyId, scope.branchId, requireText(eventId, 'eventId')]));
  }

  async listProjections(scopeInput, projectorId) {
    const scope = requireEventScope(scopeInput);
    return this.#unitOfWork.readonly({ stores: ['projections'], scope }, repositories => repositories.projections.listByIndex('by_scope_projector', [scope.storyId, scope.branchId, requireText(projectorId, 'projectorId')]));
  }

  async rebuild(scopeInput) {
    const scope = requireEventScope(scopeInput);
    const updatedAt = this.#now();
    const metrics = await this.#unitOfWork.readwrite({ stores: [...new Set(['stories', 'branches', 'events', 'eventSequences', 'projections', 'projectionCheckpoints', ...this.#projectors.flatMap(projector => projector.stores || [])])], scope }, async repositories => {
      await assertScopeAndReferences({ repositories, scope, references: [] });
      const sequence = await currentCommitSequence(repositories, scope);
      return rebuildProjectors({ repositories, scope, projectors: this.#projectors, currentCommitSequence: sequence, updatedAt });
    });
    this.#lastMetrics = Object.freeze({ operation: 'rebuild', ...metrics });
    return this.lastOperationMetrics;
  }

  async catchUp(scopeInput) {
    const scope = requireEventScope(scopeInput);
    const updatedAt = this.#now();
    const metrics = await this.#unitOfWork.readwrite({ stores: [...new Set(['stories', 'branches', 'events', 'eventSequences', 'projections', 'projectionCheckpoints', ...this.#projectors.flatMap(projector => projector.stores || [])])], scope }, async repositories => {
      await assertScopeAndReferences({ repositories, scope, references: [] });
      const sequence = await currentCommitSequence(repositories, scope);
      return catchUpProjectors({ repositories, scope, projectors: this.#projectors, currentCommitSequence: sequence, updatedAt });
    });
    this.#lastMetrics = Object.freeze({ operation: 'catch-up', ...metrics });
    return this.lastOperationMetrics;
  }
}

export function createCanonicalEventEngine(options) {
  return new CanonicalEventEngine(options);
}
