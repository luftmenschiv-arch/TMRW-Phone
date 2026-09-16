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
