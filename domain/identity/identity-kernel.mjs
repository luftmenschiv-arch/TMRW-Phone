import { V3UnitOfWork } from '../../storage/unit-of-work.mjs';
import { createAccount } from './account.mjs';
import { createActor } from './actor.mjs';
import { createBranch } from './branch.mjs';
import { createCharacterCard, createCharacterCardMembership } from './character-card.mjs';
import { createCharacterInstance } from './character-instance.mjs';
import { ACTOR_CONTROL, isPlayerControlled } from './control-authority.mjs';
import { createDevice } from './device.mjs';
import { deterministicIdentityId } from './id.mjs';
import { createIdentityMapping, createLegacyIdentityDryRun } from './identity-mapping.mjs';
import { freezeRecord, identityRecord, normalizedStrings, requireText } from './identity-record.mjs';
import { createStory } from './story.mjs';

const IDENTITY_STORES = Object.freeze([
  'characterCards', 'characterCardActors', 'actors', 'instances', 'stories', 'branches',
  'devices', 'accounts', 'identityMappings', 'identityBatches',
]);

const invariantFields = Object.freeze({
  characterCards: ['sourceAuthority', 'sourceCardId'],
  characterCardActors: ['cardId', 'actorId'],
  actors: ['sourceAuthority', 'sourceActorId', 'control', 'controlKey'],
  instances: ['actorId', 'storyId', 'branchId'],
  stories: ['sourceAuthority', 'sourceStoryId', 'characterCardId'],
  branches: ['storyId', 'sourceAuthority', 'sourceRouteId', 'parentBranchId'],
  devices: ['storyId', 'branchId', 'ownerInstanceId', 'deviceKey'],
  accounts: ['storyId', 'branchId', 'ownerInstanceId', 'accountKey'],
  identityMappings: ['sourceAuthority', 'sourceType', 'sourceId', 'scopeKey', 'canonicalType', 'canonicalId', 'parentCanonicalId'],
});

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertStableRecord(storeName, existing, next) {
  for (const field of invariantFields[storeName] || []) {
    if (!sameValue(existing[field], next[field])) throw new Error(`Stable identity invariant changed for ${storeName}.${field}`);
  }
}

function presentationAliases(existing, requested) {
  return normalizedStrings([...(existing?.aliases || []), ...(requested || [])]);
}

function accountSpecs(owner) {
  if (!owner.accounts) return [{ key: 'primary', kind: 'phone', label: owner.displayName, isPrimary: true }];
  if (!Array.isArray(owner.accounts) || owner.accounts.length < 1) throw new TypeError('Each identity owner must have at least one Account');
  const keys = owner.accounts.map(row => requireText(row.key, 'account.key'));
  if (new Set(keys).size !== keys.length) throw new TypeError('Account keys must be unique per owner');
  return owner.accounts;
}

function validateSeed(input) {
  requireText(input?.manifestId, 'manifestId');
  requireText(input?.sourceAuthority, 'sourceAuthority');
  requireText(input?.card?.sourceCardId, 'card.sourceCardId');
  requireText(input?.card?.displayName, 'card.displayName');
  requireText(input?.story?.sourceStoryId, 'story.sourceStoryId');
  requireText(input?.story?.title, 'story.title');
  requireText(input?.branch?.sourceRouteId, 'branch.sourceRouteId');
  requireText(input?.branch?.label, 'branch.label');
  requireText(input?.user?.displayName, 'user.displayName');
  if (!Array.isArray(input?.cast) || input.cast.length < 1) throw new TypeError('A Character Card must provide a dynamic cast of one or more members');
  const sourceIds = input.cast.map(row => requireText(row.sourceActorId, 'cast.sourceActorId'));
  if (new Set(sourceIds).size !== sourceIds.length) throw new TypeError('Cast members require unique stable source Actor IDs');
}

function createBatch({ id, manifestId, operation, changes, result, now }) {
  return freezeRecord({
    ...identityRecord({ entityType: 'identity-batch', id, createdAt: now, updatedAt: now, manifestId }),
    manifestId,
    phase: 2,
    operation,
    status: 'active',
    legacyDataRead: false,
    legacyDataWritten: false,
    changes,
    result,
  });
}

export class V3IdentityKernel {
  #database;
  #unitOfWork;
  #now;

  constructor({ database, now = () => new Date().toISOString() }) {
    if (!database) throw new TypeError('An open isolated v3 database is required');
    this.#database = database;
    this.#unitOfWork = new V3UnitOfWork(database);
    this.#now = now;
  }

  dryRunLegacyMappings(candidates) {
    return createLegacyIdentityDryRun(candidates);
  }

  async seedIdentityGraph(input) {
    validateSeed(input);
    const manifestId = requireText(input.manifestId, 'manifestId');
    const sourceAuthority = requireText(input.sourceAuthority, 'sourceAuthority');
    const now = this.#now();
    const batchId = await deterministicIdentityId('identity-batch', { sourceAuthority: 'tmrw-v3-phase2', stableSourceId: manifestId });
    const existingBatch = await this.#unitOfWork.readonly({ stores: ['identityBatches'] }, repositories => repositories.identityBatches.getByIndex('by_manifest', manifestId));
    if (existingBatch?.status === 'active') {
      const cardId = await deterministicIdentityId('character-card', { sourceAuthority, stableSourceId: input.card.sourceCardId });
      const requestedActorIds = new Set(await Promise.all(input.cast.map(row => deterministicIdentityId('actor', { sourceAuthority, stableSourceId: row.sourceActorId }))));
      await this.#unitOfWork.readwrite({ stores: ['characterCardActors'] }, async repositories => {
        const memberships = await repositories.characterCardActors.listByIndex('by_card_status', [cardId, 'active']);
        const removed = await repositories.characterCardActors.listByIndex('by_card_status', [cardId, 'removed']);
        for (const membership of [...memberships, ...removed]) {
          const status = requestedActorIds.has(membership.actorId) ? 'active' : 'removed';
          if (membership.status === status) continue;
          await repositories.characterCardActors.put(createCharacterCardMembership({
            ...membership,
            status,
            updatedAt: now,
            manifestId,
            existingManifestIds: membership.manifestIds,
          }));
        }
      });
      return existingBatch.result;
    }

    const cardId = await deterministicIdentityId('character-card', { sourceAuthority, stableSourceId: input.card.sourceCardId });
    const storyId = await deterministicIdentityId('story', { sourceAuthority, stableSourceId: input.story.sourceStoryId, scopeParts: [cardId] });
    const branchId = await deterministicIdentityId('branch', { sourceAuthority, stableSourceId: input.branch.sourceRouteId, scopeParts: [storyId] });
    const userActorId = await deterministicIdentityId('actor', { sourceAuthority: 'tmrw-player', stableSourceId: 'local-player-v1' });
    const owners = [
      { ...input.user, sourceAuthority: 'tmrw-player', sourceActorId: 'local-player-v1', control: ACTOR_CONTROL.PLAYER, controlKey: 'local-player-v1' },
      ...input.cast.map(row => ({ ...row, sourceAuthority, control: ACTOR_CONTROL.AI, controlKey: `${sourceAuthority}:${row.sourceActorId}` })),
    ];
    const identities = [];
    for (const owner of owners) {
      const actorId = owner.control === ACTOR_CONTROL.PLAYER ? userActorId : await deterministicIdentityId('actor', { sourceAuthority, stableSourceId: owner.sourceActorId });
      const instanceId = await deterministicIdentityId('character-instance', { sourceAuthority: 'tmrw-v3', stableSourceId: actorId, scopeParts: [storyId, branchId] });
      const deviceId = await deterministicIdentityId('device', { sourceAuthority: 'tmrw-v3', stableSourceId: 'primary', scopeParts: [instanceId] });
      const accounts = [];
      for (const spec of accountSpecs(owner)) {
        accounts.push({
          ...spec,
          id: await deterministicIdentityId('account', { sourceAuthority: 'tmrw-v3', stableSourceId: spec.key, scopeParts: [instanceId] }),
        });
      }
      identities.push({ owner, actorId, instanceId, deviceId, accounts });
    }

    const result = Object.freeze({
      cardId, storyId, branchId, userActorId,
      userInstanceId: identities[0].instanceId,
      actorIds: Object.freeze(identities.map(row => row.actorId)),
      characterActorIds: Object.freeze(identities.slice(1).map(row => row.actorId)),
      instanceIds: Object.freeze(identities.map(row => row.instanceId)),
      deviceIds: Object.freeze(identities.map(row => row.deviceId)),
      accountIds: Object.freeze(identities.flatMap(row => row.accounts.map(account => account.id))),
    });
    const scope = { storyId, branchId };

    await this.#unitOfWork.readwrite({ stores: IDENTITY_STORES, scope }, async repositories => {
      const changes = new Map();
      const putTracked = async (storeName, nextFactory) => {
        const repository = repositories[storeName];
        const id = nextFactory.id;
        const before = await repository.get(id);
        const next = nextFactory.create(before);
        if (before) assertStableRecord(storeName, before, next);
        if (!changes.has(`${storeName}:${id}`)) changes.set(`${storeName}:${id}`, { storeName, id, before: before || null });
        await repository.put(next);
        return next;
      };

      await putTracked('characterCards', { id: cardId, create: existing => createCharacterCard({
        id: cardId, sourceAuthority, sourceCardId: input.card.sourceCardId, displayName: input.card.displayName,
        aliases: presentationAliases(existing, input.card.aliases), createdAt: existing?.createdAt || now, updatedAt: now,
        manifestId, existingManifestIds: existing?.manifestIds || [],
      }) });
      await putTracked('stories', { id: storyId, create: existing => createStory({
        id: storyId, characterCardId: cardId, sourceAuthority, sourceStoryId: input.story.sourceStoryId, title: input.story.title,
        createdAt: existing?.createdAt || now, updatedAt: now, manifestId, existingManifestIds: existing?.manifestIds || [],
      }) });
      await putTracked('branches', { id: branchId, create: existing => createBranch({
        id: branchId, storyId, sourceAuthority, sourceRouteId: input.branch.sourceRouteId, label: input.branch.label,
        parentBranchId: input.branch.parentBranchId || null, createdAt: existing?.createdAt || now, updatedAt: now,
        manifestId, existingManifestIds: existing?.manifestIds || [],
      }) });

      const activeMemberships = await repositories.characterCardActors.listByIndex('by_card_status', [cardId, 'active']);
      const requestedActorIds = new Set(identities.slice(1).map(row => row.actorId));
      for (const membership of activeMemberships.filter(row => !requestedActorIds.has(row.actorId))) {
        await putTracked('characterCardActors', { id: membership.id, create: existing => createCharacterCardMembership({
          ...existing, status: 'removed', updatedAt: now, manifestId, existingManifestIds: existing.manifestIds,
        }) });
      }

      for (const identity of identities) {
        const { owner, actorId, instanceId, deviceId } = identity;
        await putTracked('actors', { id: actorId, create: existing => createActor({
          id: actorId, sourceAuthority: owner.sourceAuthority, sourceActorId: owner.sourceActorId, displayName: owner.displayName,
          aliases: presentationAliases(existing, owner.aliases), control: owner.control, controlKey: owner.controlKey,
          createdAt: existing?.createdAt || now, updatedAt: now, manifestId, existingManifestIds: existing?.manifestIds || [],
        }) });
        if (owner.control === ACTOR_CONTROL.AI) {
          const membershipId = await deterministicIdentityId('card-membership', { sourceAuthority: 'tmrw-v3', stableSourceId: `${cardId}:${actorId}` });
          await putTracked('characterCardActors', { id: membershipId, create: existing => createCharacterCardMembership({
            id: membershipId, cardId, actorId, status: 'active', createdAt: existing?.createdAt || now, updatedAt: now,
            manifestId, existingManifestIds: existing?.manifestIds || [],
          }) });
        }
        await putTracked('instances', { id: instanceId, create: existing => createCharacterInstance({
          id: instanceId, actorId, storyId, branchId, displayNameOverride: owner.displayNameOverride,
          aliases: presentationAliases(existing, owner.instanceAliases), createdAt: existing?.createdAt || now, updatedAt: now,
          manifestId, existingManifestIds: existing?.manifestIds || [],
        }) });
        await putTracked('devices', { id: deviceId, create: existing => createDevice({
          id: deviceId, storyId, branchId, ownerInstanceId: instanceId, deviceKey: 'primary', kind: 'phone',
          label: `${owner.displayName} Phone`, isPrimary: true, createdAt: existing?.createdAt || now, updatedAt: now,
          manifestId, existingManifestIds: existing?.manifestIds || [],
        }) });
        for (const account of identity.accounts) {
          await putTracked('accounts', { id: account.id, create: existing => createAccount({
            id: account.id, storyId, branchId, ownerInstanceId: instanceId, accountKey: account.key,
            kind: account.kind || 'phone', label: account.label || `${owner.displayName} ${account.key}`,
            deviceIds: [deviceId], isPrimary: account.isPrimary !== false, createdAt: existing?.createdAt || now, updatedAt: now,
            manifestId, existingManifestIds: existing?.manifestIds || [],
          }) });
        }

        const mappingSourceType = owner.control === ACTOR_CONTROL.PLAYER ? 'player-actor' : 'actor';
        const mappingSourceId = owner.sourceActorId;
        const mappingId = await deterministicIdentityId('identity-mapping', { sourceAuthority: owner.sourceAuthority, stableSourceId: `${mappingSourceType}:${mappingSourceId}` });
        await putTracked('identityMappings', { id: mappingId, create: existing => createIdentityMapping({
          id: mappingId, sourceAuthority: owner.sourceAuthority, sourceType: mappingSourceType, sourceId: mappingSourceId,
          canonicalType: 'actor', canonicalId: actorId, createdAt: existing?.createdAt || now, updatedAt: now,
          manifestId, existingManifestIds: existing?.manifestIds || [],
        }) });
        const instanceMappingId = await deterministicIdentityId('identity-mapping', {
          sourceAuthority: owner.sourceAuthority,
          stableSourceId: `character-instance:${owner.sourceActorId}`,
          scopeParts: [storyId, branchId],
        });
        await putTracked('identityMappings', { id: instanceMappingId, create: existing => createIdentityMapping({
          id: instanceMappingId, sourceAuthority: owner.sourceAuthority, sourceType: 'character-instance', sourceId: owner.sourceActorId,
          canonicalType: 'character-instance', canonicalId: instanceId, parentCanonicalId: actorId, storyId, branchId,
          createdAt: existing?.createdAt || now, updatedAt: now, manifestId, existingManifestIds: existing?.manifestIds || [],
        }) });
      }

      for (const mappingInput of [
        { sourceType: 'character-card', sourceId: input.card.sourceCardId, canonicalType: 'character-card', canonicalId: cardId },
        { sourceType: 'story', sourceId: input.story.sourceStoryId, canonicalType: 'story', canonicalId: storyId, parentCanonicalId: cardId },
        { sourceType: 'branch', sourceId: input.branch.sourceRouteId, canonicalType: 'branch', canonicalId: branchId, parentCanonicalId: storyId, storyId, branchId },
      ]) {
        const mappingId = await deterministicIdentityId('identity-mapping', { sourceAuthority, stableSourceId: `${mappingInput.sourceType}:${mappingInput.sourceId}`, scopeParts: mappingInput.storyId ? [storyId, branchId] : [] });
        await putTracked('identityMappings', { id: mappingId, create: existing => createIdentityMapping({
          id: mappingId, sourceAuthority, ...mappingInput, createdAt: existing?.createdAt || now, updatedAt: now,
          manifestId, existingManifestIds: existing?.manifestIds || [],
        }) });
      }

      const batch = createBatch({ id: batchId, manifestId, operation: 'seed-identity-graph', changes: [...changes.values()], result, now });
      await repositories.identityBatches.put(batch);
    });
    return result;
  }

  async getActor(actorId) {
    return this.#unitOfWork.readonly({ stores: ['actors'] }, repositories => repositories.actors.get(actorId));
  }

  async getActorBySource(sourceAuthority, sourceActorId) {
    return this.#unitOfWork.readonly({ stores: ['actors'] }, repositories => repositories.actors.getByIndex('by_source_actor', [sourceAuthority, sourceActorId]));
  }

  async getCharacterInstanceForActor(actorId, scope) {
    return this.#unitOfWork.readonly({ stores: ['instances'], scope }, repositories => repositories.instances.getByIndex('by_actor_scope', [actorId, scope.storyId, scope.branchId]));
  }

  async listCastInstances(cardId, scope) {
    return this.#unitOfWork.readonly({ stores: ['characterCardActors', 'instances'], scope }, async repositories => {
      const memberships = await repositories.characterCardActors.listByIndex('by_card_status', [cardId, 'active']);
      const instances = await Promise.all(memberships.map(row => repositories.instances.getByIndex('by_actor_scope', [row.actorId, scope.storyId, scope.branchId])));
      return instances.filter(Boolean);
    });
  }

  async resolveDeviceOwnership(deviceId, scope) {
    return this.#unitOfWork.readonly({ stores: ['devices', 'instances', 'actors'], scope }, async repositories => {
      const device = await repositories.devices.get(deviceId);
      if (!device) return null;
      const instance = await repositories.instances.get(device.ownerInstanceId);
      const actor = instance ? await repositories.actors.get(instance.actorId) : null;
      if (!instance || !actor) throw new Error('Device ownership identity chain is incomplete');
      return Object.freeze({ device, ownerInstance: instance, ownerActor: actor, perspective: isPlayerControlled(actor) ? 'my-phone' : 'their-phone' });
    });
  }

  async listAccountsForOwner(ownerInstanceId, scope) {
    return this.#unitOfWork.readonly({ stores: ['accounts'], scope }, repositories => repositories.accounts.listByIndex('by_owner_scope', [scope.storyId, scope.branchId, ownerInstanceId]));
  }

  async rollbackIdentityBatch(manifestId) {
    requireText(manifestId, 'manifestId');
    const now = this.#now();
    return this.#unitOfWork.readwrite({ stores: IDENTITY_STORES, privileged: true }, async repositories => {
      const batch = await repositories.identityBatches.getByIndex('by_manifest', manifestId);
      if (!batch) throw new Error(`Unknown identity manifest: ${manifestId}`);
      if (batch.status === 'rolled-back') return batch;
      for (const change of [...batch.changes].reverse()) {
        const current = await repositories[change.storeName].get(change.id);
        if (!current) throw new Error(`Identity rollback dependency is missing: ${change.storeName}/${change.id}`);
        if (current.manifestIds?.at(-1) !== manifestId) {
          throw new Error(`Identity rollback is blocked by a newer batch at ${change.storeName}/${change.id}`);
        }
      }
      for (const change of [...batch.changes].reverse()) {
        if (change.before) await repositories[change.storeName].put(change.before);
        else await repositories[change.storeName].delete(change.id);
      }
      const rolledBack = freezeRecord({ ...batch, status: 'rolled-back', rolledBackAt: now, updatedAt: now });
      await repositories.identityBatches.put(rolledBack);
      return rolledBack;
    });
  }

  async forkBranch({ manifestId, parentScope, sourceRouteId, label }) {
    requireText(manifestId, 'manifestId');
    requireText(parentScope?.storyId, 'parentScope.storyId');
    requireText(parentScope?.branchId, 'parentScope.branchId');
    requireText(sourceRouteId, 'sourceRouteId');
    requireText(label, 'label');
    const snapshot = await this.#unitOfWork.readonly({ stores: ['characterCards', 'characterCardActors', 'actors', 'instances', 'stories', 'branches', 'accounts'], privileged: true }, async repositories => {
      const story = await repositories.stories.get(parentScope.storyId);
      const parentBranch = await repositories.branches.get(parentScope.branchId);
      if (!story || !parentBranch || parentBranch.storyId !== story.id) throw new Error('The parent Story/Branch identity scope does not exist');
      const card = await repositories.characterCards.get(story.characterCardId);
      const memberships = await repositories.characterCardActors.listByIndex('by_card_status', [card.id, 'active']);
      const scopedInstances = (await repositories.instances.listByIndex('by_story_branch', [story.id, parentBranch.id]));
      const owners = [];
      for (const instance of scopedInstances) {
        const actor = await repositories.actors.get(instance.actorId);
        const accounts = await repositories.accounts.listByIndex('by_owner_scope', [story.id, parentBranch.id, instance.id]);
        owners.push({ actor, instance, accounts });
      }
      return { story, parentBranch, card, memberships, owners };
    });
    const player = snapshot.owners.find(row => isPlayerControlled(row.actor));
    if (!player) throw new Error('The parent Branch has no player-controlled Character Instance');
    const ownerByActor = new Map(snapshot.owners.map(row => [row.actor.id, row]));
    const toSeedOwner = row => ({
      sourceActorId: row.actor.sourceActorId,
      displayName: row.actor.displayName,
      aliases: row.actor.aliases,
      displayNameOverride: row.instance.displayNameOverride,
      instanceAliases: row.instance.aliases,
      accounts: row.accounts.map(account => ({ key: account.accountKey, kind: account.kind, label: account.label, isPrimary: account.isPrimary })),
    });
    return this.seedIdentityGraph({
      manifestId,
      sourceAuthority: snapshot.story.sourceAuthority,
      card: { sourceCardId: snapshot.card.sourceCardId, displayName: snapshot.card.displayName, aliases: snapshot.card.aliases },
      story: { sourceStoryId: snapshot.story.sourceStoryId, title: snapshot.story.title },
      branch: { sourceRouteId, label, parentBranchId: snapshot.parentBranch.id },
      user: toSeedOwner(player),
      cast: snapshot.memberships.map(membership => {
        const owner = ownerByActor.get(membership.actorId);
        if (!owner) throw new Error('The parent Branch is missing a cast Character Instance');
        return toSeedOwner(owner);
      }),
    });
  }

  async inspectCounts() {
    return this.#unitOfWork.readonly({ stores: IDENTITY_STORES, privileged: true }, async repositories => Object.fromEntries(await Promise.all(IDENTITY_STORES.map(async storeName => [storeName, await repositories[storeName].count()]))));
  }
}

export function createV3IdentityKernel(options) {
  return new V3IdentityKernel(options);
}
