import { identityScopeKey } from '../domain/identity/identity-mapping.mjs';
import { requireText } from '../domain/identity/identity-record.mjs';
import { V3UnitOfWork } from '../storage/unit-of-work.mjs';

function requireScope(scope) {
  return Object.freeze({
    storyId: requireText(scope?.storyId, 'scope.storyId'),
    branchId: requireText(scope?.branchId, 'scope.branchId'),
  });
}

function exactOne(rows, label) {
  if (rows.length === 1) return rows[0];
  if (rows.length === 0) throw new Error(`Production identity unresolved: missing ${label}`);
  throw new Error(`Production identity unresolved: ambiguous ${label}`);
}

function presentationLabels(actor, instance) {
  return new Set([
    actor?.displayName,
    ...(actor?.aliases || []),
    instance?.displayNameOverride,
    ...(instance?.aliases || []),
  ].filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()));
}

export class ProductionIdentityBindingResolver {
  #kernel;
  #unitOfWork;

  constructor({ identityKernel, database }) {
    if (!identityKernel || typeof identityKernel.getActor !== 'function' || typeof identityKernel.getCharacterInstanceForActor !== 'function') {
      throw new TypeError('ProductionIdentityBindingResolver requires the existing V3IdentityKernel');
    }
    if (!database) throw new TypeError('ProductionIdentityBindingResolver requires the existing v3 database facade');
    this.#kernel = identityKernel;
    this.#unitOfWork = new V3UnitOfWork(database);
  }

  async #mapping({ sourceAuthority, sourceType, sourceId, scopeKey = '*' }) {
    const query = [
      requireText(sourceAuthority, 'sourceAuthority'),
      requireText(sourceType, 'sourceType'),
      requireText(sourceId, 'sourceId'),
      requireText(scopeKey, 'scopeKey'),
    ];
    const mapping = await this.#unitOfWork.readonly({ stores: ['identityMappings'] }, repositories => repositories.identityMappings.getByIndex('by_source_identity', query));
    if (!mapping || mapping.status !== 'active') {
      throw new Error(`Production identity unresolved: missing active ${sourceType} mapping for ${sourceAuthority}:${sourceId}`);
    }
    return mapping;
  }

  async #selectAccount(instanceId, scope, { accountId = null, accountKey = null } = {}) {
    const accounts = await this.#kernel.listAccountsForOwner(instanceId, scope);
    if (accountId) return exactOne(accounts.filter(row => row.id === accountId), `Account ${accountId}`);
    if (accountKey) return exactOne(accounts.filter(row => row.accountKey === accountKey), `Account key ${accountKey}`);
    if (accounts.length === 1) return accounts[0];
    const primary = accounts.filter(row => row.isPrimary === true);
    return exactOne(primary, 'primary Account');
  }

  async #selectDevice(actorId, instanceId, account, scope, { deviceId = null, deviceKey = null } = {}) {
    let selectedId = null;
    if (deviceId) {
      if (!account.deviceIds?.includes(deviceId)) throw new Error(`Production identity unresolved: Device ${deviceId} is not attached to Account ${account.id}`);
      selectedId = deviceId;
    } else if (deviceKey) {
      const device = await this.#unitOfWork.readonly({ stores: ['devices'], scope }, repositories => repositories.devices.getByIndex('by_owner_device_key', [scope.storyId, scope.branchId, instanceId, deviceKey]));
      if (!device || !account.deviceIds?.includes(device.id)) throw new Error(`Production identity unresolved: Device key ${deviceKey} is not attached to Account ${account.id}`);
      selectedId = device.id;
    } else {
      const ids = [...new Set(account.deviceIds || [])];
      if (ids.length === 1) selectedId = ids[0];
      else {
        const ownership = (await Promise.all(ids.map(id => this.#kernel.resolveDeviceOwnership(id, scope)))).filter(Boolean);
        const primary = ownership.filter(row => row.device.isPrimary === true);
        selectedId = exactOne(primary, `primary Device for Account ${account.id}`).device.id;
      }
    }
    if (!selectedId) throw new Error(`Production identity unresolved: Account ${account.id} has no exact Device`);
    const ownership = await this.#kernel.resolveDeviceOwnership(selectedId, scope);
    if (!ownership || ownership.ownerInstance.id !== instanceId || ownership.ownerActor.id !== actorId) {
      throw new Error(`Production identity unresolved: Device ${selectedId} ownership does not match Actor/Instance binding`);
    }
    return ownership.device;
  }

  async #bindingForCanonical({ actor, instance, scope, accountId = null, accountKey = null, deviceId = null, deviceKey = null }) {
    const account = await this.#selectAccount(instance.id, scope, { accountId, accountKey });
    const device = await this.#selectDevice(actor.id, instance.id, account, scope, { deviceId, deviceKey });
    return Object.freeze({ actorId: actor.id, instanceId: instance.id, accountId: account.id, deviceId: device.id });
  }

  async resolveCanonicalAccountBinding({ scope: inputScope, accountId, sourceAuthority = null, sourceActorId = null, activeCharacterSourceId = null, allowLegacySingleCharacterPlaceholder = false }) {
    const scope = requireScope(inputScope);
    const canonicalAccountId = requireText(accountId, 'accountId');
    const chain = await this.#unitOfWork.readonly({ stores: ['accounts', 'instances', 'actors'], scope }, async repositories => {
      const account = await repositories.accounts.get(canonicalAccountId);
      const instance = account && await repositories.instances.get(account.ownerInstanceId);
      const actor = instance && await repositories.actors.get(instance.actorId);
      return account && instance && actor ? { account, instance, actor } : null;
    });
    if (!chain || chain.account.storyId !== scope.storyId || chain.account.branchId !== scope.branchId || chain.instance.storyId !== scope.storyId || chain.instance.branchId !== scope.branchId) {
      throw new Error(`Production identity unresolved: canonical Account ${canonicalAccountId} is unavailable in this Story/Branch`);
    }
    if (activeCharacterSourceId != null) {
      const activeSourceId = requireText(activeCharacterSourceId, 'activeCharacterSourceId');
      const migratedPrefix = `${activeSourceId}:actor_`;
      const migratedMatch = chain.actor.sourceAuthority === 'preview37'
        && chain.actor.sourceActorId.startsWith(migratedPrefix)
        && /^[a-z0-9]+$/u.test(chain.actor.sourceActorId.slice(migratedPrefix.length));
      const directMatch = chain.actor.sourceAuthority === 'sillytavern' && chain.actor.sourceActorId === activeSourceId;
      if (!directMatch && !migratedMatch) {
        throw new Error('Production identity unresolved: active character does not match the Call counterpart');
      }
    }
    const legacyPlaceholder = allowLegacySingleCharacterPlaceholder === true
      && chain.actor.displayName === 'Character card'
      && /^character:Character card:actor_[a-z0-9]+$/u.test(chain.actor.sourceActorId);
    if (!legacyPlaceholder && sourceAuthority != null && chain.actor.sourceAuthority !== requireText(sourceAuthority, 'sourceAuthority')) {
      throw new Error('Production identity unresolved: active character authority does not match the Call counterpart');
    }
    if (!legacyPlaceholder && sourceActorId != null && chain.actor.sourceActorId !== requireText(sourceActorId, 'sourceActorId')) {
      throw new Error('Production identity unresolved: active character does not match the Call counterpart');
    }
    return this.#bindingForCanonical({ actor: chain.actor, instance: chain.instance, scope, accountId: chain.account.id });
  }

  async resolveActorBinding({ scope: inputScope, sourceAuthority = 'sillytavern', sourceActorId, sourceType = 'actor', accountId = null, accountKey = null, deviceId = null, deviceKey = null }) {
    const scope = requireScope(inputScope);
    const authority = requireText(sourceAuthority, 'sourceAuthority');
    const sourceId = requireText(sourceActorId, 'sourceActorId');
    const actorMapping = await this.#mapping({ sourceAuthority: authority, sourceType, sourceId });
    if (actorMapping.canonicalType !== 'actor') throw new Error('Production identity unresolved: source Actor mapping does not target canonical Actor');
    const actor = await this.#kernel.getActor(actorMapping.canonicalId);
    if (!actor || actor.sourceAuthority !== authority || actor.sourceActorId !== sourceId) {
      throw new Error('Production identity unresolved: canonical Actor does not match stable source identity');
    }

    const instanceMapping = await this.#mapping({
      sourceAuthority: authority,
      sourceType: 'character-instance',
      sourceId,
      scopeKey: identityScopeKey(scope.storyId, scope.branchId),
    });
    if (instanceMapping.canonicalType !== 'character-instance' || instanceMapping.parentCanonicalId !== actor.id) {
      throw new Error('Production identity unresolved: Character Instance mapping does not belong to the mapped Actor');
    }
    const instance = await this.#kernel.getCharacterInstanceForActor(actor.id, scope);
    if (!instance || instance.id !== instanceMapping.canonicalId || instance.actorId !== actor.id) {
      throw new Error('Production identity unresolved: exact Story/Branch Character Instance is missing or mismatched');
    }
    return this.#bindingForCanonical({ actor, instance, scope, accountId, accountKey, deviceId, deviceKey });
  }

  async resolvePlayerIdentity({ scope, accountId = null, accountKey = null, deviceId = null, deviceKey = null }) {
    return this.resolveActorBinding({
      scope,
      sourceAuthority: 'tmrw-player',
      sourceActorId: 'local-player-v1',
      sourceType: 'player-actor',
      accountId,
      accountKey,
      deviceId,
      deviceKey,
    });
  }

  async resolveMentionBindings({ scope: inputScope, labels, accountKey = null, deviceKey = null }) {
    const scope = requireScope(inputScope);
    if (!Array.isArray(labels)) throw new TypeError('Mention labels must be an array');
    const requested = [...new Set(labels.map(label => requireText(label, 'mention label')))];
    if (requested.length === 0) return Object.freeze({});

    const story = await this.#unitOfWork.readonly({ stores: ['stories'] }, repositories => repositories.stories.get(scope.storyId));
    if (!story) throw new Error('Production identity unresolved: Story does not exist');
    const instances = await this.#kernel.listCastInstances(story.characterCardId, scope);
    const candidates = [];
    for (const instance of instances) {
      const actor = await this.#kernel.getActor(instance.actorId);
      if (!actor) throw new Error(`Production identity unresolved: Actor ${instance.actorId} is missing for Character Instance ${instance.id}`);
      candidates.push({ actor, instance, labels: presentationLabels(actor, instance) });
    }

    const result = {};
    for (const label of requested) {
      const matches = candidates.filter(candidate => candidate.labels.has(label));
      const match = exactOne(matches, `mention ${label}`);
      const binding = await this.#bindingForCanonical({ actor: match.actor, instance: match.instance, scope, accountKey, deviceKey });
      result[label] = Object.freeze([binding]);
    }
    return Object.freeze(result);
  }
}
