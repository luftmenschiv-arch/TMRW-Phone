import test from 'node:test';
import assert from 'node:assert/strict';
import { identityScopeKey } from '../../domain/identity/identity-mapping.mjs';
import { V3IdentityKernel } from '../../domain/identity/identity-kernel.mjs';
import { ProductionSillyTavernContextAdapter } from '../../production/context-source-adapter.mjs';
import { ProductionIdentityBindingResolver } from '../../production/identity-binding-resolver.mjs';
import { MemoryV3Database } from '../../storage/memory-v3-database.mjs';
import { identitySeed } from '../phase2/identity-fixtures.mjs';

const NOW = () => '2026-08-29T05:30:00.000Z';

async function seedIdentity({
  database = new MemoryV3Database(),
  kernel = null,
  castSize = 2,
  manifestId = `s06-${castSize}`,
  cardSourceId = `s06-card-${castSize}`,
  storySourceId = `s06-story-${castSize}`,
  routeSourceId = `s06-route-${castSize}`,
  cast = null,
} = {}) {
  if (!database.isOpen) await database.open();
  const identityKernel = kernel || new V3IdentityKernel({ database, now: NOW });
  const seed = { ...identitySeed({ castSize, manifestId, cardSourceId, storySourceId, routeSourceId, cast }), sourceAuthority: 'sillytavern' };
  const identity = await identityKernel.seedIdentityGraph(seed);
  return { database, kernel: identityKernel, identity, seed, scope: { storyId: identity.storyId, branchId: identity.branchId } };
}

function contextAdapter(database, currentRef) {
  return new ProductionSillyTavernContextAdapter({
    database,
    getContext: () => currentRef.current,
    sourceIdentityResolver: context => context.stableSourceIdentity,
  });
}

function stableIdentity(seed) {
  return {
    characterCardSourceId: seed.card.sourceCardId,
    storySourceId: seed.story.sourceStoryId,
    routeSourceId: seed.branch.sourceRouteId,
  };
}

async function addBranchAliasMapping(database, { storyId, branchId, sourceId }) {
  await database.transaction(['identityMappings'], 'readwrite', async transaction => {
    await transaction.store('identityMappings').put({
      id: `s06-ambiguous-${branchId}`,
      status: 'active',
      sourceAuthority: 'sillytavern',
      sourceType: 'branch',
      sourceId,
      canonicalType: 'branch',
      canonicalId: branchId,
      parentCanonicalId: storyId,
      storyId,
      branchId,
      scopeKey: identityScopeKey(storyId, branchId),
    });
  });
}

test('exact real-context source IDs resolve mapped Story/Branch with zero canonical writes', async () => {
  const setup = await seedIdentity();
  const ref = { current: { chat: [], stableSourceIdentity: stableIdentity(setup.seed), name2: 'Display Only', chatId: 'display-chat-name' } };
  const adapter = contextAdapter(setup.database, ref);
  const before = setup.database.diagnostics.writeCommits;
  assert.deepEqual(await adapter.resolveScope(), setup.scope);
  assert.equal(setup.database.diagnostics.writeCommits, before);
});

test('display/card/chat renames never become identity keys and preserve the same exact mapped scope', async () => {
  const setup = await seedIdentity();
  const stable = stableIdentity(setup.seed);
  const ref = { current: { chat: [], stableSourceIdentity: stable, name2: 'Old Name', chatId: 'old-chat', characterId: 0, characters: [{ name: 'Old Name', avatar: 'old.png' }] } };
  const adapter = contextAdapter(setup.database, ref);
  const first = await adapter.resolveScope();
  ref.current = { chat: [], stableSourceIdentity: stable, name2: 'Renamed Character', chatId: 'renamed-chat', characterId: 11, characters: [{ name: 'Completely Different', avatar: 'renamed.png' }] };
  const second = await adapter.resolveScope();
  assert.deepEqual(second, first);
});

test('missing stable source identifiers fail closed even when display/chat/index fallback values exist', async () => {
  const setup = await seedIdentity();
  const ref = { current: { chat: [], name2: 'Character 1', chatId: setup.seed.story.sourceStoryId, characterId: 0, groupId: null, characters: [{ avatar: setup.seed.card.sourceCardId }] } };
  const adapter = contextAdapter(setup.database, ref);
  await assert.rejects(() => adapter.resolveScope(), /explicit stable source identifiers|must be a non-empty string/i);
});

test('missing and ambiguous Story/Branch mappings fail closed without current/main fallback', async () => {
  const first = await seedIdentity({ manifestId: 's06-amb-a', cardSourceId: 's06-amb-card', storySourceId: 's06-amb-story', routeSourceId: 's06-route-main' });
  const second = await seedIdentity({ database: first.database, kernel: first.kernel, manifestId: 's06-amb-b', cardSourceId: 's06-amb-card', storySourceId: 's06-amb-story', routeSourceId: 's06-route-other' });
  const ref = { current: { chat: [], stableSourceIdentity: stableIdentity(first.seed) } };
  const adapter = contextAdapter(first.database, ref);
  ref.current.stableSourceIdentity = { ...stableIdentity(first.seed), storySourceId: 'missing-story' };
  await assert.rejects(() => adapter.resolveScope(), /missing Story mapping/i);
  ref.current.stableSourceIdentity = stableIdentity(first.seed);
  await addBranchAliasMapping(first.database, { storyId: first.identity.storyId, branchId: second.identity.branchId, sourceId: first.seed.branch.sourceRouteId });
  await assert.rejects(() => adapter.resolveScope(), /ambiguous Branch mapping/i);
});

test('same card new Story and same Story fork Branch resolve distinct exact canonical scopes', async () => {
  const a = await seedIdentity({ manifestId: 's06-switch-a', cardSourceId: 's06-switch-card', storySourceId: 's06-story-a', routeSourceId: 's06-main-a' });
  const b = await seedIdentity({ database: a.database, kernel: a.kernel, manifestId: 's06-switch-b', cardSourceId: 's06-switch-card', storySourceId: 's06-story-b', routeSourceId: 's06-main-b' });
  const fork = await seedIdentity({ database: a.database, kernel: a.kernel, manifestId: 's06-switch-fork', cardSourceId: 's06-switch-card', storySourceId: 's06-story-a', routeSourceId: 's06-fork' });
  const ref = { current: { chat: [], stableSourceIdentity: stableIdentity(a.seed) } };
  const adapter = contextAdapter(a.database, ref);
  const scopeA = await adapter.resolveScope();
  ref.current.stableSourceIdentity = stableIdentity(b.seed);
  const scopeB = await adapter.resolveScope();
  ref.current.stableSourceIdentity = stableIdentity(fork.seed);
  const forkScope = await adapter.resolveScope();
  assert.notEqual(scopeA.storyId, scopeB.storyId);
  assert.equal(scopeA.storyId, forkScope.storyId);
  assert.notEqual(scopeA.branchId, forkScope.branchId);
});

test('Actor and Character Instance remain distinct; Branch switching reuses Actor and changes Instance', async () => {
  const main = await seedIdentity({ manifestId: 's06-binding-main', cardSourceId: 's06-binding-card', storySourceId: 's06-binding-story', routeSourceId: 's06-binding-main' });
  const fork = await seedIdentity({ database: main.database, kernel: main.kernel, manifestId: 's06-binding-fork', cardSourceId: 's06-binding-card', storySourceId: 's06-binding-story', routeSourceId: 's06-binding-fork' });
  const resolver = new ProductionIdentityBindingResolver({ identityKernel: main.kernel, database: main.database });
  const sourceActorId = main.seed.cast[0].sourceActorId;
  const mainBinding = await resolver.resolveActorBinding({ scope: main.scope, sourceActorId });
  const forkBinding = await resolver.resolveActorBinding({ scope: fork.scope, sourceActorId });
  assert.notEqual(mainBinding.actorId, mainBinding.instanceId);
  assert.equal(mainBinding.actorId, forkBinding.actorId);
  assert.notEqual(mainBinding.instanceId, forkBinding.instanceId);
});

test('player, Account, Device and Their Phone ownership resolve only through the canonical ownership graph', async () => {
  const setup = await seedIdentity();
  const resolver = new ProductionIdentityBindingResolver({ identityKernel: setup.kernel, database: setup.database });
  const player = await resolver.resolvePlayerIdentity({ scope: setup.scope });
  const character = await resolver.resolveActorBinding({ scope: setup.scope, sourceActorId: setup.seed.cast[0].sourceActorId });
  const playerOwner = await setup.kernel.resolveDeviceOwnership(player.deviceId, setup.scope);
  const characterOwner = await setup.kernel.resolveDeviceOwnership(character.deviceId, setup.scope);
  assert.equal(playerOwner.perspective, 'my-phone');
  assert.equal(playerOwner.ownerInstance.id, player.instanceId);
  assert.equal(characterOwner.perspective, 'their-phone');
  assert.equal(characterOwner.ownerActor.id, character.actorId);
  assert.equal(characterOwner.ownerInstance.id, character.instanceId);
});

for (const castSize of [1, 2, 12]) {
  test(`dynamic Cast ${castSize} resolves every exact alias with no fixed-cardinality assumption`, async () => {
    const setup = await seedIdentity({ castSize, manifestId: `s06-cast-${castSize}`, cardSourceId: `s06-cast-card-${castSize}`, storySourceId: `s06-cast-story-${castSize}`, routeSourceId: `s06-cast-route-${castSize}` });
    const resolver = new ProductionIdentityBindingResolver({ identityKernel: setup.kernel, database: setup.database });
    const labels = Array.from({ length: castSize }, (_, index) => `C${index + 1}`);
    const bindings = await resolver.resolveMentionBindings({ scope: setup.scope, labels });
    assert.equal(Object.keys(bindings).length, castSize);
    assert.equal(new Set(Object.values(bindings).map(rows => rows[0].actorId)).size, castSize);
    assert.equal(new Set(Object.values(bindings).map(rows => rows[0].instanceId)).size, castSize);
  });
}

test('same-name/alias ambiguity fails closed while stable source Actor IDs still resolve exactly', async () => {
  const cast = [
    { sourceActorId: 'alex-a', displayName: 'Alex', aliases: ['Shared'] },
    { sourceActorId: 'alex-b', displayName: 'Alex', aliases: ['Shared'] },
  ];
  const setup = await seedIdentity({ castSize: 2, manifestId: 's06-alias-ambiguous', cardSourceId: 's06-alias-card', storySourceId: 's06-alias-story', routeSourceId: 's06-alias-route', cast });
  const resolver = new ProductionIdentityBindingResolver({ identityKernel: setup.kernel, database: setup.database });
  await assert.rejects(() => resolver.resolveMentionBindings({ scope: setup.scope, labels: ['Alex'] }), /ambiguous mention Alex/i);
  await assert.rejects(() => resolver.resolveMentionBindings({ scope: setup.scope, labels: ['Shared'] }), /ambiguous mention Shared/i);
  const a = await resolver.resolveActorBinding({ scope: setup.scope, sourceActorId: 'alex-a' });
  const b = await resolver.resolveActorBinding({ scope: setup.scope, sourceActorId: 'alex-b' });
  assert.notEqual(a.actorId, b.actorId);
});

test('missing Actor/Instance mapping and unresolved destination labels fail closed', async () => {
  const setup = await seedIdentity();
  const resolver = new ProductionIdentityBindingResolver({ identityKernel: setup.kernel, database: setup.database });
  await assert.rejects(() => resolver.resolveActorBinding({ scope: setup.scope, sourceActorId: 'missing-actor' }), /missing active actor mapping/i);
  await assert.rejects(() => resolver.resolveMentionBindings({ scope: setup.scope, labels: ['Nobody Here'] }), /missing mention Nobody Here/i);
});

test('Account/Device ambiguity or an unresolved explicit device key blocks instead of using order/position guessing', async () => {
  const cast = [{
    sourceActorId: 'multi-account',
    displayName: 'Multi Account',
    aliases: ['Multi'],
    accounts: [
      { key: 'work', kind: 'phone', label: 'Work', isPrimary: false },
      { key: 'personal', kind: 'phone', label: 'Personal', isPrimary: false },
    ],
  }];
  const setup = await seedIdentity({ castSize: 1, manifestId: 's06-multi-account', cardSourceId: 's06-multi-card', storySourceId: 's06-multi-story', routeSourceId: 's06-multi-route', cast });
  const resolver = new ProductionIdentityBindingResolver({ identityKernel: setup.kernel, database: setup.database });
  await assert.rejects(() => resolver.resolveActorBinding({ scope: setup.scope, sourceActorId: 'multi-account' }), /primary Account/i);
  await assert.rejects(() => resolver.resolveActorBinding({ scope: setup.scope, sourceActorId: 'multi-account', accountKey: 'work', deviceKey: 'missing-device' }), /Device key missing-device/i);
  const exact = await resolver.resolveActorBinding({ scope: setup.scope, sourceActorId: 'multi-account', accountKey: 'work', deviceKey: 'primary' });
  assert.ok(exact.accountId);
  assert.ok(exact.deviceId);
});

test('identity resolution is read-only: context, Actor, mention, Account and Device lookup create zero canonical writes', async () => {
  const setup = await seedIdentity({ castSize: 2, manifestId: 's06-readonly', cardSourceId: 's06-readonly-card', storySourceId: 's06-readonly-story', routeSourceId: 's06-readonly-route' });
  const ref = { current: { chat: [], stableSourceIdentity: stableIdentity(setup.seed) } };
  const adapter = contextAdapter(setup.database, ref);
  const resolver = new ProductionIdentityBindingResolver({ identityKernel: setup.kernel, database: setup.database });
  const before = setup.database.diagnostics.writeCommits;
  const scope = await adapter.resolveScope();
  await resolver.resolvePlayerIdentity({ scope });
  await resolver.resolveActorBinding({ scope, sourceActorId: setup.seed.cast[0].sourceActorId });
  await resolver.resolveMentionBindings({ scope, labels: ['C1', 'C2'] });
  assert.equal(setup.database.diagnostics.writeCommits, before);
});

test('stable Actor source identity survives a display-name rename without creating or rebinding canonical Actor identity', async () => {
  const first = await seedIdentity({ castSize: 1, manifestId: 's06-rename-a', cardSourceId: 's06-rename-card', storySourceId: 's06-rename-story', routeSourceId: 's06-rename-route', cast: [{ sourceActorId: 'rename-actor', displayName: 'Original Name', aliases: ['Original Alias'] }] });
  const resolver = new ProductionIdentityBindingResolver({ identityKernel: first.kernel, database: first.database });
  const beforeRename = await resolver.resolveActorBinding({ scope: first.scope, sourceActorId: 'rename-actor' });
  await seedIdentity({ database: first.database, kernel: first.kernel, castSize: 1, manifestId: 's06-rename-b', cardSourceId: 's06-rename-card', storySourceId: 's06-rename-story', routeSourceId: 's06-rename-route', cast: [{ sourceActorId: 'rename-actor', displayName: 'Renamed Character', aliases: ['New Alias'] }] });
  const afterRename = await resolver.resolveActorBinding({ scope: first.scope, sourceActorId: 'rename-actor' });
  assert.equal(afterRename.actorId, beforeRename.actorId);
  assert.equal(afterRename.instanceId, beforeRename.instanceId);
});

test('an existing Actor record cannot bypass a missing exact scoped Character Instance mapping', async () => {
  const setup = await seedIdentity({ castSize: 1, manifestId: 's06-missing-instance', cardSourceId: 's06-mi-card', storySourceId: 's06-mi-story', routeSourceId: 's06-mi-route' });
  const sourceActorId = setup.seed.cast[0].sourceActorId;
  const resolver = new ProductionIdentityBindingResolver({ identityKernel: setup.kernel, database: setup.database });
  const canonicalBeforeRemoval = await resolver.resolveActorBinding({ scope: setup.scope, sourceActorId });
  await setup.database.transaction(['identityMappings'], 'readwrite', async transaction => {
    const store = transaction.store('identityMappings');
    const mapping = await store.getByIndex('by_source_identity', ['sillytavern', 'character-instance', sourceActorId, identityScopeKey(setup.scope.storyId, setup.scope.branchId)]);
    assert.ok(mapping);
    await store.delete(mapping.id);
  });
  await assert.rejects(() => resolver.resolveActorBinding({ scope: setup.scope, sourceActorId }), /missing active character-instance mapping/i);
  const callCounterpart = await resolver.resolveCanonicalAccountBinding({ scope: setup.scope, accountId: canonicalBeforeRemoval.accountId, sourceAuthority: 'sillytavern', sourceActorId });
  assert.deepEqual(callCounterpart, canonicalBeforeRemoval, 'an exact canonical Call participant may resolve without the obsolete scoped source mapping');
});

test('S06 source remains adapter-only and contains no listener/interceptor/mount/launcher/composition-root ownership', async () => {
  const fs = await import('node:fs/promises');
  for (const relative of ['production/context-source-adapter.mjs', 'production/identity-binding-resolver.mjs']) {
    const source = await fs.readFile(new URL(`../../${relative}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /eventSource\.on|generateInterceptor|tmrwV3GenerateInterceptor|TmrwPhoneShell|launcher|composition-root|createTmrwV3ProductionRuntime/i);
  }
});
