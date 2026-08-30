import { V3KnowledgeError } from '../../storage/errors.mjs';
import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { requireText } from '../identity/identity-record.mjs';
import { requireEventScope } from '../events/event-validator.mjs';
import { audiencePermitsActor } from './audience-policy.mjs';
import { audiencePolicyHeadId, evidenceFragmentHeadId, knowledgeClaimHeadId, KNOWLEDGE_GRANT_PROJECTOR_ID } from './grant-projector.mjs';
import { MAX_KNOWLEDGE_ORDINAL } from './knowledge-grant.mjs';
import { projectionCheckpointId } from '../projections/projection-checkpoint.mjs';

export const SAFE_PROMPT_READ_STORES = Object.freeze([
  'actors', 'instances', 'knowledgeGrants', 'knowledgeClaims', 'audiencePolicies', 'evidenceFragments', 'projectionCheckpoints',
  'previewMigrationImports',
]);

const MAX_QUERY_LIMIT = 200;
const MAX_SCAN_LIMIT = 512;

export class VisibilityRepository {
  #unitOfWork;

  constructor(database) {
    this.#unitOfWork = new V3UnitOfWork(database);
  }

  async queryAuthorizedKnowledge({ scope: inputScope, actorId: inputActorId, instanceId: inputInstanceId, purpose = 'model-prompt', limit = 50, claimTypes = null }) {
    const scope = requireEventScope(inputScope);
    const actorId = requireText(inputActorId, 'actorId');
    const instanceId = requireText(inputInstanceId, 'instanceId');
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_QUERY_LIMIT) throw new V3KnowledgeError(`Knowledge query limit must be 1-${MAX_QUERY_LIMIT}`);
    const allowedTypes = claimTypes == null ? null : new Set(claimTypes.map((value, index) => requireText(value, `claimTypes[${index}]`)));
    const scanLimit = Math.min(MAX_SCAN_LIMIT, Math.max(limit, limit * 4));
    return this.#unitOfWork.readonly({ stores: SAFE_PROMPT_READ_STORES, scope }, async repositories => {
      const [actor, instance, checkpoint] = await Promise.all([
        repositories.actors.get(actorId),
        repositories.instances.get(instanceId),
        repositories.projectionCheckpoints.get(projectionCheckpointId(scope, KNOWLEDGE_GRANT_PROJECTOR_ID)),
      ]);
      if (!actor || !instance || instance.actorId !== actor.id) throw new V3KnowledgeError('Safe Knowledge query Actor/Character Instance mismatch');
      const grants = await repositories.knowledgeGrants.listByIndexRange('by_scope_instance_active_recent', {
        lower: [scope.storyId, scope.branchId, instanceId, 'active', 0],
        upper: [scope.storyId, scope.branchId, instanceId, 'active', MAX_KNOWLEDGE_ORDINAL],
      }, { limit: scanLimit });
      const items = [];
      let dependencyReads = 0;
      let migrationActivationReads = 0;
      for (const grant of grants) {
        if (grant.targetActorId !== actorId || items.length >= limit) continue;
        if (grant.evidence?.provenanceAuthority === 'preview37') {
          const imported = await repositories.previewMigrationImports.getByIndex('by_event', grant.sourceDisclosureEventId);
          migrationActivationReads += 1;
          if (imported?.status !== 'active') continue;
        }
        const [claim, audience, fragment] = await Promise.all([
          repositories.knowledgeClaims.get(knowledgeClaimHeadId(scope, grant.claimId)),
          repositories.audiencePolicies.get(audiencePolicyHeadId(scope, grant.policyId)),
          repositories.evidenceFragments.get(evidenceFragmentHeadId(scope, grant.fragmentId)),
        ]);
        dependencyReads += 3;
        if (!claim || !audience || !fragment) continue;
        if (claim.effectiveStatus !== 'current' || audience.effectiveStatus !== 'current' || fragment.effectiveStatus !== 'current') continue;
        if (claim.currentness === 'invalidated' || fragment.claimId !== claim.claimId) continue;
        if (allowedTypes && !allowedTypes.has(claim.claimType)) continue;
        if (!audiencePermitsActor(audience, { actorId, instanceId, consumerKind: 'actor-model' })) continue;
        items.push(Object.freeze({
          grantId: grant.grantId,
          claimId: claim.claimId,
          claimType: claim.claimType,
          subject: structuredClone(claim.subject),
          safeSummary: claim.safeSummary,
          fragmentId: fragment.fragmentId,
          fragmentKind: fragment.kind,
          safeText: fragment.safeText,
          certainty: claim.certainty,
          currentness: claim.currentness,
          confidence: grant.confidence,
          evidenceBasis: grant.evidence.basis,
          acquisitionOrdinal: grant.acquisitionOrdinal,
          sourceDisclosureEventId: grant.sourceDisclosureEventId,
        }));
      }
      return Object.freeze({
        scope,
        actorId,
        instanceId,
        purpose: requireText(purpose, 'purpose'),
        authorizationRevision: checkpoint?.lastCommitSequence || 0,
        items: Object.freeze(items),
        metrics: Object.freeze({ candidateGrantsRead: grants.length, dependencyRecordsRead: dependencyReads, migrationActivationReads, canonicalEventsRead: 0, branchesScanned: 0, actorsScanned: 0, writes: 0, boundedScanLimit: scanLimit }),
      });
    });
  }
}
