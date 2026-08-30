import { V3KnowledgeError } from '../../storage/errors.mjs';
import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { requireEventScope } from '../events/event-validator.mjs';
import { requireText } from '../identity/identity-record.mjs';
import { normalizeAudiencePolicy } from './audience-policy.mjs';
import { normalizeKnowledgeClaim } from './claim.mjs';
import { normalizeDisclosureObservation } from './disclosure-observation.mjs';
import { prepareEvidenceFragment } from './evidence-fragment.mjs';
import { deriveKnowledgeId } from './knowledge-id.mjs';
import { KNOWLEDGE_EVENT_TYPES, normalizeDisclosureBundle } from './knowledge-event-types.mjs';
import { SafePromptContextCompiler } from './prompt-context-compiler.mjs';
import { VisibilityRepository } from './visibility-repository.mjs';

function uniqueReferences(references) {
  const seen = new Set();
  return Object.freeze((references || []).filter(reference => {
    const key = `${reference.entityType}:${reference.id}:${reference.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

function bundleReferences(bundle) {
  const rows = [];
  for (const id of bundle.audience.actorIds) rows.push({ entityType: 'actor', id, role: 'audience-actor' });
  for (const id of bundle.audience.instanceIds) rows.push({ entityType: 'character-instance', id, role: 'audience-instance' });
  for (const id of bundle.audience.deviceIds) rows.push({ entityType: 'device', id, role: 'audience-device' });
  for (const id of bundle.audience.accountIds) rows.push({ entityType: 'account', id, role: 'audience-account' });
  for (const observation of bundle.observations) {
    rows.push({ entityType: 'actor', id: observation.targetActorId, role: 'knowledge-target-actor' });
    rows.push({ entityType: 'character-instance', id: observation.targetInstanceId, role: 'knowledge-target-instance' });
    if (observation.evidence.sourceActorId) rows.push({ entityType: 'actor', id: observation.evidence.sourceActorId, role: 'knowledge-source-actor' });
    if (observation.evidence.sourceDeviceId) rows.push({ entityType: 'device', id: observation.evidence.sourceDeviceId, role: 'knowledge-source-device' });
    if (observation.evidence.sourceAccountId) rows.push({ entityType: 'account', id: observation.evidence.sourceAccountId, role: 'knowledge-source-account' });
  }
  if (['actor', 'character-instance', 'device', 'account'].includes(bundle.claim.subject.kind)) rows.push({ entityType: bundle.claim.subject.kind, id: bundle.claim.subject.id, role: 'claim-subject' });
  return rows;
}

export async function prepareDisclosureBundle({ scope: inputScope, bundle, stableKey }) {
  const scope = requireEventScope(inputScope);
  const base = requireText(stableKey, 'stableKey');
  const claimId = bundle?.claim?.claimId || await deriveKnowledgeId('claim', scope, `${base}:claim`);
  const policyId = bundle?.audience?.policyId || await deriveKnowledgeId('policy', scope, `${base}:audience`);
  const claim = normalizeKnowledgeClaim({ ...bundle.claim, claimId });
  const audience = normalizeAudiencePolicy({ ...bundle.audience, policyId });
  const fragmentAliases = new Map();
  const fragments = [];
  for (const [index, input] of (bundle.fragments || []).entries()) {
    const alias = input.fragmentId || input.key || `fragment-${index + 1}`;
    const fragmentId = input.fragmentId || await deriveKnowledgeId('fragment', scope, `${base}:${alias}`);
    fragmentAliases.set(alias, fragmentId);
    fragments.push(await prepareEvidenceFragment({ ...input, fragmentId, claimId }));
  }
  const observations = [];
  for (const [index, input] of (bundle.observations || []).entries()) {
    const observationId = input.observationId || await deriveKnowledgeId('observation', scope, `${base}:observation-${index + 1}`);
    const fragmentIds = (input.fragmentIds || input.fragmentKeys || []).map(id => fragmentAliases.get(id) || id);
    observations.push(normalizeDisclosureObservation({ ...input, observationId, fragmentIds }));
  }
  return normalizeDisclosureBundle({ claim, audience, fragments, observations });
}

export class KnowledgeService {
  #database;
  #events;
  #unitOfWork;
  #visibility;
  #compiler;

  constructor({ database, eventEngine }) {
    if (!database || !eventEngine) throw new TypeError('KnowledgeService requires the isolated v3 database and canonical Event engine');
    this.#database = database;
    this.#events = eventEngine;
    this.#unitOfWork = new V3UnitOfWork(database);
    this.#visibility = new VisibilityRepository(database);
    this.#compiler = new SafePromptContextCompiler(database);
  }

  async disclose({ scope: inputScope, bundle, bundles = null, references = [], source, producer, idempotencyKey, sourceEventIds = [] }) {
    const scope = requireEventScope(inputScope);
    const inputs = bundles || [bundle];
    const disclosures = [];
    for (const [index, input] of inputs.entries()) disclosures.push(await prepareDisclosureBundle({ scope, bundle: input, stableKey: `${source?.authority || producer}:${source?.recordId || idempotencyKey}:${index}` }));
    const causes = [...new Set([
      ...sourceEventIds,
      ...disclosures.flatMap(item => item.fragments.map(fragment => fragment.sourceEventId)),
      ...disclosures.flatMap(item => item.observations.map(observation => observation.evidence.sourceEventId)),
    ].filter(Boolean))];
    return this.#events.append({
      scope,
      eventType: KNOWLEDGE_EVENT_TYPES.DISCLOSURE,
      payload: { disclosures },
      references: uniqueReferences([...references, ...disclosures.flatMap(bundleReferences)]),
      causes,
      source,
      producer,
      idempotencyKey,
    });
  }

  queryAuthorizedKnowledge(input) {
    return this.#visibility.queryAuthorizedKnowledge(input);
  }

  compileSafePromptContext(input) {
    return this.#compiler.compile(input);
  }

  async forkFromSnapshot({ parentScope: parentInput, childScope: childInput, instanceIdMap, deviceIdMap = {}, accountIdMap = {}, pendingIdMap = {}, source, producer, idempotencyKey }) {
    const parentScope = requireEventScope(parentInput);
    const childScope = requireEventScope(childInput);
    if (parentScope.storyId !== childScope.storyId) throw new V3KnowledgeError('Knowledge fork must remain inside one Story');
    const relation = await this.#unitOfWork.readonly({ stores: ['branches'], privileged: true }, async repositories => ({
      parent: await repositories.branches.get(parentScope.branchId), child: await repositories.branches.get(childScope.branchId),
    }));
    if (!relation.parent || !relation.child || relation.child.parentBranchId !== relation.parent.id) throw new V3KnowledgeError('Child Branch identity does not point to the requested parent');
    const parentRows = await this.#unitOfWork.readonly({ stores: ['knowledgeGrants', 'knowledgeClaims', 'audiencePolicies', 'evidenceFragments'], scope: parentScope }, async repositories => {
      const grants = await repositories.knowledgeGrants.list();
      return Promise.all(grants.filter(row => row.status === 'active').map(async grant => ({
        grant,
        claim: await repositories.knowledgeClaims.get(`knowledge-claim:${parentScope.storyId}:${parentScope.branchId}:${grant.claimId}`),
        audience: await repositories.audiencePolicies.get(`audience-policy:${parentScope.storyId}:${parentScope.branchId}:${grant.policyId}`),
        fragment: await repositories.evidenceFragments.get(`evidence-fragment:${parentScope.storyId}:${parentScope.branchId}:${grant.fragmentId}`),
      })));
    });
    const mapIds = (ids, mapping, field) => ids.map(id => {
      if (!mapping[id]) throw new V3KnowledgeError(`Knowledge fork lacks ${field} mapping for ${id}`);
      return mapping[id];
    });
    const mapSubject = subject => {
      if (subject.kind === 'character-instance') return { ...subject, id: mapIds([subject.id], instanceIdMap, 'Character Instance')[0] };
      if (subject.kind === 'device') return { ...subject, id: mapIds([subject.id], deviceIdMap, 'Device')[0] };
      if (subject.kind === 'account') return { ...subject, id: mapIds([subject.id], accountIdMap, 'Account')[0] };
      if (subject.kind === 'pending-world-event') return { ...subject, id: mapIds([subject.id], pendingIdMap, 'Pending World Event')[0] };
      return subject;
    };
    const disclosures = parentRows.filter(row => row.claim?.effectiveStatus === 'current' && row.audience?.effectiveStatus === 'current' && row.fragment?.effectiveStatus === 'current').map(row => ({
      claim: { claimId: row.claim.claimId, claimType: row.claim.claimType, subject: mapSubject(row.claim.subject), safeSummary: row.claim.safeSummary, certainty: row.claim.certainty, currentness: row.claim.currentness },
      audience: {
        policyId: row.audience.policyId, kind: row.audience.kind, actorIds: row.audience.actorIds,
        instanceIds: mapIds(row.audience.instanceIds, instanceIdMap, 'Character Instance'),
        deviceIds: mapIds(row.audience.deviceIds, deviceIdMap, 'Device'),
        accountIds: mapIds(row.audience.accountIds, accountIdMap, 'Account'),
        membershipSnapshotId: row.audience.membershipSnapshotId,
      },
      fragments: [{ fragmentId: row.fragment.fragmentId, claimId: row.fragment.claimId, kind: row.fragment.kind, safeText: row.fragment.safeText, contentDigest: row.fragment.contentDigest, sourceField: row.fragment.sourceField, sourceEventId: null }],
      observations: [{
        observationId: `fork:${row.grant.grantId}`,
        targetActorId: row.grant.targetActorId,
        targetInstanceId: instanceIdMap[row.grant.targetInstanceId],
        fragmentIds: [row.fragment.fragmentId],
        confidence: row.grant.confidence,
        evidence: { ...row.grant.evidence, sourceEventId: null, sourceDeviceId: row.grant.evidence.sourceDeviceId ? deviceIdMap[row.grant.evidence.sourceDeviceId] : null, sourceAccountId: row.grant.evidence.sourceAccountId ? accountIdMap[row.grant.evidence.sourceAccountId] : null, provenanceAuthority: 'tmrw-v3-branch-fork', provenanceRecordId: row.grant.grantId },
      }],
    }));
    if (disclosures.some(item => !item.observations[0].targetInstanceId)) throw new V3KnowledgeError('Knowledge fork lacks a target Character Instance mapping');
    if (disclosures.length === 0) return Object.freeze({ event: null, replayed: false, emptySnapshot: true });
    const normalized = disclosures.map(normalizeDisclosureBundle);
    return this.#events.append({
      scope: childScope,
      eventType: KNOWLEDGE_EVENT_TYPES.BRANCH_FORK,
      payload: { disclosures: normalized, inheritedFrom: { storyId: parentScope.storyId, branchId: parentScope.branchId } },
      references: uniqueReferences(normalized.flatMap(bundleReferences)),
      causes: [],
      source,
      producer,
      idempotencyKey,
    });
  }
}
