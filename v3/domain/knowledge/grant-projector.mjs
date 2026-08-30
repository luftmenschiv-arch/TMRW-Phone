import { V3KnowledgeError } from '../../storage/errors.mjs';
import { canonicalJson } from '../events/idempotency.mjs';
import { defineProjector } from '../projections/projection-runner.mjs';
import { audiencePermitsActor } from './audience-policy.mjs';
import { scopedKnowledgeHeadId } from './knowledge-id.mjs';
import { createKnowledgeGrant } from './knowledge-grant.mjs';
import { disclosuresForKnowledgeProjection } from './knowledge-event-types.mjs';

export const KNOWLEDGE_GRANT_PROJECTOR_ID = 'tmrw-knowledge-grants-v1';
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;
const STORE_BY_KIND = Object.freeze({ claim: 'knowledgeClaims', audience: 'audiencePolicies', fragment: 'evidenceFragments', grant: 'knowledgeGrants' });
const PREFIX_ORDER = Object.freeze({ claim: 0, audience: 1, fragment: 2, grant: 3 });

export const knowledgeClaimHeadId = (scope, claimId) => scopedKnowledgeHeadId('knowledge-claim', scope, claimId);
export const audiencePolicyHeadId = (scope, policyId) => scopedKnowledgeHeadId('audience-policy', scope, policyId);
export const evidenceFragmentHeadId = (scope, fragmentId) => scopedKnowledgeHeadId('evidence-fragment', scope, fragmentId);

function projectKnowledgeEvent(event) {
  const payload = disclosuresForKnowledgeProjection(event);
  if (!payload) return [];
  const records = new Map();
  const add = (recordKind, recordId, record) => {
    const key = `${recordKind}:${recordId}`;
    const existing = records.get(key);
    if (existing && canonicalJson(existing.record) !== canonicalJson(record)) throw new V3KnowledgeError(`Conflicting ${recordKind} ${recordId} inside one canonical Knowledge Event`);
    if (!existing) records.set(key, { recordKind, recordId, record });
  };
  for (const disclosure of payload.disclosures) {
    add('claim', disclosure.claim.claimId, disclosure.claim);
    add('audience', disclosure.audience.policyId, disclosure.audience);
    for (const fragment of disclosure.fragments) add('fragment', fragment.fragmentId, fragment);
    for (const observation of disclosure.observations) {
      if (!audiencePermitsActor(disclosure.audience, { actorId: observation.targetActorId, instanceId: observation.targetInstanceId })) continue;
      for (const fragmentId of observation.fragmentIds) {
        const fragment = disclosure.fragments.find(item => item.fragmentId === fragmentId);
        const grant = createKnowledgeGrant({ scope: { storyId: event.storyId, branchId: event.branchId }, event, claim: disclosure.claim, audience: disclosure.audience, fragment, observation });
        add('grant', grant.grantId, grant);
      }
    }
  }
  return [...records.values()].map(item => ({
    kind: `knowledge-${item.recordKind}-source`,
    projectionKey: `${item.recordKind}:${item.recordId}:${event.id}`,
    groupKey: `${item.recordKind}:${item.recordId}`,
    data: item,
  }));
}

async function groupRows(repositories, scope, groupKey) {
  return repositories.projections.listByIndexRange('by_scope_projector_group_sequence', {
    lower: [scope.storyId, scope.branchId, KNOWLEDGE_GRANT_PROJECTOR_ID, groupKey, 0],
    upper: [scope.storyId, scope.branchId, KNOWLEDGE_GRANT_PROJECTOR_ID, groupKey, MAX_SEQUENCE],
  });
}

function variantState(rows) {
  const variants = new Map();
  for (const row of rows) {
    const encoded = canonicalJson(row.data.record);
    if (!variants.has(encoded)) variants.set(encoded, { record: row.data.record, rows: [] });
    variants.get(encoded).rows.push(row);
  }
  return [...variants.values()];
}

async function materializeSimple({ repositories, scope, recordKind, recordId, rows, updatedAt }) {
  const store = repositories[STORE_BY_KIND[recordKind]];
  const idKind = { claim: 'knowledge-claim', audience: 'audience-policy', fragment: 'evidence-fragment' }[recordKind];
  const id = scopedKnowledgeHeadId(idKind, scope, recordId);
  if (rows.length === 0) {
    await store.delete(id);
    return { rowsWritten: 0 };
  }
  const variants = variantState(rows);
  const selected = variants[0].record;
  const effectiveStatus = variants.length === 1
    ? (recordKind === 'claim' && selected.currentness === 'invalidated' ? 'invalidated' : 'current')
    : 'conflicted';
  const head = {
    ...structuredClone(selected), id, storyId: scope.storyId, branchId: scope.branchId,
    effectiveStatus, supportCount: rows.length, conflictVariantCount: variants.length,
    sourceEventIds: [...new Set(rows.map(row => row.sourceEventId))].sort(),
    subjectKind: selected.subject?.kind, subjectId: selected.subject?.id,
    updatedAt, phase: 5,
  };
  await store.put(Object.freeze(head));
  return { rowsWritten: 1 };
}

async function materializeGrant({ repositories, scope, recordId, rows, updatedAt }) {
  const id = scopedKnowledgeHeadId('knowledge-grant', scope, recordId);
  if (rows.length === 0) {
    await repositories.knowledgeGrants.delete(id);
    return { rowsWritten: 0 };
  }
  const variants = variantState(rows);
  if (variants.length !== 1) throw new V3KnowledgeError(`Conflicting derived Knowledge Grant: ${recordId}`);
  const grant = variants[0].record;
  const [actor, instance, claim, audience, fragment] = await Promise.all([
    repositories.actors.get(grant.targetActorId),
    repositories.instances.get(grant.targetInstanceId),
    repositories.knowledgeClaims.get(knowledgeClaimHeadId(scope, grant.claimId)),
    repositories.audiencePolicies.get(audiencePolicyHeadId(scope, grant.policyId)),
    repositories.evidenceFragments.get(evidenceFragmentHeadId(scope, grant.fragmentId)),
  ]);
  if (!actor || !instance || instance.actorId !== actor.id) throw new V3KnowledgeError('Knowledge Grant target Actor/Character Instance mismatch');
  if (!claim || !audience || !fragment || fragment.claimId !== claim.claimId) throw new V3KnowledgeError('Knowledge Grant dependency is missing or inconsistent');
  if (!audiencePermitsActor(audience, { actorId: actor.id, instanceId: instance.id })) throw new V3KnowledgeError('Knowledge Grant target is no longer allowed by Audience policy');
  await repositories.knowledgeGrants.put(Object.freeze({ ...grant, id, updatedAt, phase: 5 }));
  return { rowsWritten: 1 };
}

async function materializeGroup(repositories, scope, groupKey, updatedAt) {
  const separator = groupKey.indexOf(':');
  const recordKind = groupKey.slice(0, separator);
  const recordId = groupKey.slice(separator + 1);
  const rows = await groupRows(repositories, scope, groupKey);
  const result = recordKind === 'grant'
    ? await materializeGrant({ repositories, scope, recordId, rows, updatedAt })
    : await materializeSimple({ repositories, scope, recordKind, recordId, rows, updatedAt });
  return { sourceRowsRead: rows.length, rowsWritten: result.rowsWritten };
}

function orderedGroups(rows) {
  return [...new Set(rows.map(row => row.groupKey).filter(Boolean))].sort((left, right) => {
    const leftKind = left.slice(0, left.indexOf(':'));
    const rightKind = right.slice(0, right.indexOf(':'));
    return PREFIX_ORDER[leftKind] - PREFIX_ORDER[rightKind] || left.localeCompare(right);
  });
}

async function applyAggregate({ repositories, scope, previousRows, currentRows, updatedAt }) {
  let sourceRowsRead = 0;
  let rowsWritten = 0;
  for (const group of orderedGroups([...previousRows, ...currentRows])) {
    const result = await materializeGroup(repositories, scope, group, updatedAt);
    sourceRowsRead += result.sourceRowsRead;
    rowsWritten += result.rowsWritten;
  }
  return { sourceRowsRead, rowsWritten, eventHistoryScans: 0 };
}

async function rebuildAggregate({ repositories, scope, updatedAt }) {
  for (const storeName of Object.values(STORE_BY_KIND)) {
    for (const row of await repositories[storeName].list()) await repositories[storeName].delete(row.id);
  }
  const rows = await repositories.projections.listByIndex('by_scope_projector', [scope.storyId, scope.branchId, KNOWLEDGE_GRANT_PROJECTOR_ID]);
  let sourceRowsRead = 0;
  let rowsWritten = 0;
  for (const group of orderedGroups(rows)) {
    const result = await materializeGroup(repositories, scope, group, updatedAt);
    sourceRowsRead += result.sourceRowsRead;
    rowsWritten += result.rowsWritten;
  }
  return { sourceRowsRead, rowsWritten };
}

export function createKnowledgeGrantProjector() {
  return defineProjector({
    id: KNOWLEDGE_GRANT_PROJECTOR_ID,
    version: 1,
    stores: ['actors', 'instances', 'knowledgeClaims', 'audiencePolicies', 'evidenceFragments', 'knowledgeGrants'],
    project: projectKnowledgeEvent,
    applyAggregate,
    rebuildAggregate,
  });
}
