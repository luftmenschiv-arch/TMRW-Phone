import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPhase9 } from '../phase9/call-fixtures.mjs';
import { CanonicalEventEngine } from '../../domain/events/event-transaction.mjs';
import { createPhase23EventTypeRegistry } from '../../domain/utilities/phone-world-event-types.mjs';
import { createPhoneWorldProjector } from '../../domain/utilities/phone-world-projector.mjs';
import { PhoneWorldService } from '../../domain/utilities/phone-world-service.mjs';
import { InitialPhoneSeedService } from '../../application/playable-bootstrap/initial-phone-seed.mjs';

test('initial seed makes every phone useful, keeps My Phone wallet user-owned, and replays safely', async () => {
  const c = await setupPhase9({ castSize: 2, manifestId: 'initial-phone-seed' });
  const engine = new CanonicalEventEngine({ database: c.database, eventTypes: createPhase23EventTypeRegistry(), projectors: [createPhoneWorldProjector()], now: () => '2026-09-17T07:00:00.000Z' });
  await engine.catchUp(c.scope);
  const world = new PhoneWorldService({ database: c.database, eventEngine: engine });
  const seed = new InitialPhoneSeedService({ database: c.database, phoneWorldService: world, now: () => '2026-09-17T07:00:00.000Z' });
  const input = { scope: c.scope, fingerprint: 'story-head-a', context: { name2: 'Tokyo ensemble', chat: [{ is_user: true, mes: 'ไปซื้อกาแฟกันไหม' }, { is_user: false, mes: 'ได้สิ เดี๋ยวฉันพาไป' }] } };
  const first = await seed.seed(input);
  assert.equal(first.devices, 3);
  for (const person of [c.user, c.alice, c.bob]) {
    assert.equal((await world.listNotes({ scope: c.scope, deviceId: person.deviceId })).length, 1);
    assert.equal((await world.listShopItems({ scope: c.scope, deviceId: person.deviceId })).length, 3);
    assert.equal((await world.listWeather({ scope: c.scope, deviceId: person.deviceId })).length, 1);
    assert.equal((await world.listHealth({ scope: c.scope, deviceId: person.deviceId })).length, 2);
  }
  assert.equal((await world.listWallet({ scope: c.scope, deviceId: c.user.deviceId })).length, 0, 'My Phone balance stays explicit-user controlled');
  assert.equal((await world.listWallet({ scope: c.scope, deviceId: c.alice.deviceId }))[0].currency, 'JPY');
  const before = (await engine.listEvents(c.scope)).length;
  input.context.chat.push({ is_user: false, mes: 'presentation changed but the canonical fingerprint did not' });
  const replay = await seed.seed(input);
  assert.equal(replay.writes, 0);
  assert.equal((await engine.listEvents(c.scope)).length, before);
});

test('initial seed can target only the phones approved by the current cast manifest', async () => {
  const c = await setupPhase9({ castSize: 3, manifestId: 'initial-phone-seed-selected' });
  const engine = new CanonicalEventEngine({ database: c.database, eventTypes: createPhase23EventTypeRegistry(), projectors: [createPhoneWorldProjector()], now: () => '2026-09-17T07:00:00.000Z' });
  await engine.catchUp(c.scope);
  const world = new PhoneWorldService({ database: c.database, eventEngine: engine });
  const seed = new InitialPhoneSeedService({ database: c.database, phoneWorldService: world, now: () => '2026-09-17T07:00:00.000Z' });
  const result = await seed.seed({ scope: c.scope, fingerprint: 'selected-head', deviceIds: [c.user.deviceId, c.alice.deviceId], context: { name2: 'Current scene' } });
  assert.equal(result.devices, 2);
  assert.equal((await world.listNotes({ scope: c.scope, deviceId: c.user.deviceId })).length, 1);
  assert.equal((await world.listNotes({ scope: c.scope, deviceId: c.alice.deviceId })).length, 1);
  assert.equal((await world.listNotes({ scope: c.scope, deviceId: c.bob.deviceId })).length, 0);
});
