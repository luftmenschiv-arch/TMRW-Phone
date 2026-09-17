import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayableBootstrapService } from '../../application/playable-bootstrap/playable-bootstrap-service.mjs';
import { PLAYABLE_BOOTSTRAP_STATUS } from '../../ui/settings-beta.mjs';
import { setupPhase9 } from '../phase9/call-fixtures.mjs';

test('Quick Start expands one card into many phones and Deep Backfill checkpoints bounded history', async () => {
  const c = await setupPhase9({ castSize: 1, manifestId: 'playable-bootstrap-service' });
  const context = {
    chatId: 'existing-long-chat', characterId: 0, name1: 'Player', name2: 'Ensemble Card',
    characters: [{ name: 'Ensemble Card', data: { extensions: { tmrw_phone: { cast: ['Character 1', 'Alice', 'Bob'] } } } }],
    chat: Array.from({ length: 130 }, (_, index) => ({ is_user: index % 2 === 0, name: index % 2 ? 'Character 1' : 'Player', mes: `turn ${index}` })),
  };
  const reconciled = [];
  const service = new PlayableBootstrapService({ database: c.database, identityKernel: c.kernel, phoneStateService: c.phones, settingsService: c.settings, runtimeIntegration: { reconcileHistory: async input => { reconciled.push([input.startOrdinal, input.endOrdinal]); return { processed: (input.endOrdinal || 0) - input.startOrdinal }; } }, getContext: () => context, now: () => '2026-09-17T05:00:00.000Z' });
  const stages = []; const result = await service.run({ scope: c.scope, playerInstanceId: c.user.instanceId, recentMessages: 40, onProgress: state => stages.push(state.stage) });
  assert.equal(result.state.status, PLAYABLE_BOOTSTRAP_STATUS.READY); assert.equal(result.state.castCount, 3); assert.equal(result.state.processedOrdinal, 130);
  assert.ok(stages.includes('quick-ready')); assert.ok(stages.includes('deep-backfill')); assert.equal(stages.at(-1), 'ready');
  const cast = await c.kernel.listCastInstances(c.identity.cardId, c.scope); assert.equal(cast.length, 3);
  const roster = await c.viewModels.deviceRoster(c.scope); assert.equal(roster.length, 4); assert.deepEqual(roster.filter(row => row.kind === 'their-phone').map(row => row.label).sort(), ['Alice', 'Bob', 'Character 1']);
  assert.ok(reconciled.some(([start, end]) => start === 90 && end === 130)); assert.ok(reconciled.some(([start, end]) => start === 0 && end <= 90));
  const before = await c.kernel.inspectCounts(); const replay = await service.run({ scope: c.scope, playerInstanceId: c.user.instanceId, recentMessages: 40 }); const after = await c.kernel.inspectCounts();
  assert.equal(replay.identityManifestId, result.identityManifestId); assert.equal(after.actors, before.actors); assert.equal(after.devices, before.devices); assert.equal((await service.status({ scope: c.scope, playerInstanceId: c.user.instanceId })).status, PLAYABLE_BOOTSTRAP_STATUS.READY);
});

test('failed bootstrap persists retryable failure without erasing the previous checkpoint shape', async () => {
  const c = await setupPhase9({ castSize: 1, manifestId: 'playable-bootstrap-failure' });
  const service = new PlayableBootstrapService({ database: c.database, identityKernel: c.kernel, phoneStateService: c.phones, settingsService: c.settings, getContext: () => ({ chat: [], characters: [], characterId: -1 }), now: () => '2026-09-17T05:00:00.000Z' });
  await assert.rejects(() => service.run({ scope: c.scope, playerInstanceId: c.user.instanceId }), /No important character/);
  const state = await service.status({ scope: c.scope, playerInstanceId: c.user.instanceId }); assert.equal(state.status, PLAYABLE_BOOTSTRAP_STATUS.FAILED); assert.match(state.lastError, /No important character/);
});

test('retrying with a revised cast initializes only missing phones without replaying old lifecycle events', async () => {
  const c = await setupPhase9({ castSize: 1, manifestId: 'playable-bootstrap-revised-cast' });
  const context = {
    chatId: 'revised-cast-chat', characterId: 0, name1: 'Player', name2: 'Ensemble Card',
    characters: [{ name: 'Ensemble Card', data: { extensions: { tmrw_phone: { cast: ['Character 1'] } } } }],
    chat: [{ is_user: false, name: 'Character 1', mes: 'first timeline' }],
  };
  let tick = 0;
  const service = new PlayableBootstrapService({ database: c.database, identityKernel: c.kernel, phoneStateService: c.phones, settingsService: c.settings, getContext: () => context, now: () => `2026-09-17T05:00:0${tick++}.000Z` });
  await service.run({ scope: c.scope, playerInstanceId: c.user.instanceId, deepBackfill: false });

  const playerStateBefore = await c.phones.getPhoneState(c.scope, c.user.deviceId);
  context.characters[0].data.extensions.tmrw_phone.cast = ['Character 1', 'New Scene Actor'];
  context.chat.push({ is_user: false, name: 'New Scene Actor', mes: 'I joined this timeline.' });

  const result = await service.run({ scope: c.scope, playerInstanceId: c.user.instanceId, deepBackfill: false });
  assert.equal(result.state.status, PLAYABLE_BOOTSTRAP_STATUS.READY);
  assert.equal(result.state.castCount, 2);
  assert.deepEqual((await c.viewModels.deviceRoster(c.scope)).filter(row => row.kind === 'their-phone').map(row => row.label).sort(), ['Character 1', 'New Scene Actor']);
  assert.deepEqual(await c.phones.getPhoneState(c.scope, c.user.deviceId), playerStateBefore);
});

test('optional seed and world-feed enrichment failures do not block a playable phone', async () => {
  const c = await setupPhase9({ castSize: 1, manifestId: 'playable-bootstrap-optional-enrichment' });
  const context = { chatId:'optional-enrichment-chat',characterId:0,name1:'Player',name2:'Character 1',characters:[{name:'Character 1'}],chat:[{is_user:false,name:'Character 1',mes:'current story'}] };
  const service = new PlayableBootstrapService({
    database:c.database,identityKernel:c.kernel,phoneStateService:c.phones,settingsService:c.settings,getContext:()=>context,
    runtimeIntegration:{reconcileHistory:async()=>({processed:1})},
    initialPhoneSeedService:{seed:async()=>{throw new Error('optional seed unavailable');}},
    adaptiveWorldPulseService:{prepareWorld:async()=>{throw new Error('optional feed unavailable');},prime:async()=>{throw new Error('must not reach');}},
    now:()=> '2026-09-17T14:10:00.000Z',
  });
  const result=await service.run({scope:c.scope,playerInstanceId:c.user.instanceId,deepBackfill:false});
  assert.equal(result.state.status,PLAYABLE_BOOTSTRAP_STATUS.READY);
  assert.deepEqual(result.enrichmentWarnings.map(row=>row.stage),['initial-seed','world-pulse']);
  assert.equal((await service.status({scope:c.scope,playerInstanceId:c.user.instanceId})).status,PLAYABLE_BOOTSTRAP_STATUS.READY);
});

test('same-head manual update repairs enrichment without replaying the full chat history', async () => {
  const c = await setupPhase9({ castSize: 1, manifestId: 'playable-bootstrap-same-head-repair' });
  const context = { chatId:'same-head-repair-chat',characterId:0,name1:'Player',name2:'Character 1',characters:[{name:'Character 1'}],chat:Array.from({length:72},(_,index)=>({is_user:index%2===0,name:index%2?'Character 1':'Player',mes:`turn ${index}`})) };
  let reconcileCalls=0;let seedCalls=0;let prepareCalls=0;let primeCalls=0;
  const service = new PlayableBootstrapService({
    database:c.database,identityKernel:c.kernel,phoneStateService:c.phones,settingsService:c.settings,getContext:()=>context,
    runtimeIntegration:{reconcileHistory:async()=>{reconcileCalls+=1;return {processed:72};}},
    initialPhoneSeedService:{seed:async()=>{seedCalls+=1;return {writes:0};}},
    adaptiveWorldPulseService:{prepareWorld:async({force})=>{prepareCalls+=1;assert.equal(force,prepareCalls===1);return {};},prime:async()=>{primeCalls+=1;return {ready:true};}},
    now:()=> '2026-09-17T15:00:00.000Z',
  });
  const first=await service.run({scope:c.scope,playerInstanceId:c.user.instanceId,deepBackfill:false});
  const retry=await service.run({scope:c.scope,playerInstanceId:c.user.instanceId,deepBackfill:false});
  assert.equal(first.replayed,false);assert.equal(retry.replayed,true);
  assert.equal(reconcileCalls,1,'same-head retry must not rescan chat history');
  assert.equal(seedCalls,2,'same-head retry must recheck idempotent app seeds');
  assert.equal(prepareCalls,2,'same-head retry must recheck world context');
  assert.equal(primeCalls,2,'same-head retry must refill missing feed data');
  assert.equal(retry.state.status,PLAYABLE_BOOTSTRAP_STATUS.READY);
});

test('explicit first-time selection is remembered and removes unselected phone owners', async () => {
  const c = await setupPhase9({ castSize: 1, manifestId: 'playable-bootstrap-explicit-selection' });
  const context = {
    chatId: 'explicit-selection-chat', characterId: 0, name1: 'Player', name2: 'Ensemble Card',
    characters: [{ name: 'Ensemble Card', data: { extensions: { tmrw_phone: { cast: ['Character 1', 'Nurse', 'Professor'] } } } }],
    chat: [{ is_user: false, name: 'Character 1', mes: 'current story' }],
  };
  const service = new PlayableBootstrapService({ database: c.database, identityKernel: c.kernel, phoneStateService: c.phones, settingsService: c.settings, getContext: () => context, now: () => '2026-09-17T16:00:00.000Z' });
  const manifest = await service.preview();
  const selected = manifest.cast.find(row => row.displayName === 'Character 1');
  assert.ok(selected);
  const result = await service.run({ scope: c.scope, playerInstanceId: c.user.instanceId, approvedSourceActorIds: [selected.sourceActorId], selectionConfirmed: true, deepBackfill: false });
  assert.equal(result.state.selectionConfirmed, true);
  assert.deepEqual(result.state.selectedSourceActorIds, [selected.sourceActorId]);
  assert.deepEqual((await c.viewModels.deviceRoster(c.scope)).filter(row => row.kind === 'their-phone').map(row => row.label), ['Character 1']);
});
