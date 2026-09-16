import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPhase9 } from '../phase9/call-fixtures.mjs';
import { CanonicalEventEngine } from '../../domain/events/event-transaction.mjs';
import { createPhase23EventTypeRegistry } from '../../domain/utilities/phone-world-event-types.mjs';
import { createPhoneWorldProjector } from '../../domain/utilities/phone-world-projector.mjs';
import { PhoneWorldService } from '../../domain/utilities/phone-world-service.mjs';
import { WalletRpEvidenceService } from '../../application/playable-bootstrap/wallet-rp-evidence.mjs';

test('explicit RP money evidence updates My Phone once, revises safely, and ignores vague prose', async () => {
  const c = await setupPhase9({ castSize: 1, manifestId: 'wallet-rp-evidence' });
  const engine = new CanonicalEventEngine({ database: c.database, eventTypes: createPhase23EventTypeRegistry(), projectors: [createPhoneWorldProjector()], now: () => '2026-09-17T08:10:00.000Z' }); await engine.catchUp(c.scope);
  const world = new PhoneWorldService({ database: c.database, eventEngine: engine }); const evidence = new WalletRpEvidenceService({ database: c.database, phoneWorldService: world });
  const source = { sourceAuthority: 'sillytavern-main-rp', sourceMessageId: 'chat:12', sourceVersionId: '1:a', sourceOrdinal: 12, role: 'user', text: 'ฉันเอาเงินไปเปย์สาว 1,200 บาท' };
  const first = await evidence.evaluate({ scope: c.scope, source }); const replay = await evidence.evaluate({ scope: c.scope, source });
  assert.equal(first.amount, -1200); assert.equal(first.currency, 'THB'); assert.equal(replay.replayed, true);
  let rows = await world.listWallet({ scope: c.scope, deviceId: c.user.deviceId }); assert.equal(rows.length, 1); assert.equal(rows[0].amount, -1200);
  const revised = await evidence.evaluate({ scope: c.scope, source: { ...source, sourceVersionId: '2:b', text: 'ฉันเอาเงินไปเปย์สาว 900 บาท' } }); assert.equal(revised.amount, -900);
  rows = await world.listWallet({ scope: c.scope, deviceId: c.user.deviceId }); assert.equal(rows.length, 1); assert.equal(rows[0].amount, -900);
  const vague = await evidence.evaluate({ scope: c.scope, source: { ...source, sourceMessageId: 'chat:13', sourceVersionId: '1:c', text: 'วันนี้ใช้เงินเยอะจัง' } }); assert.equal(vague.applied, false);
  const assistant = await evidence.evaluate({ scope: c.scope, source: { ...source, role: 'assistant', sourceMessageId: 'chat:14', sourceVersionId: '1:d', text: 'เขาโอนให้คุณ 500 เยน' } }); assert.equal(assistant.amount, 500); assert.equal(assistant.currency, 'JPY');
});
