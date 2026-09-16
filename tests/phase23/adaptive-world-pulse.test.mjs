import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPhase15 } from '../phase15/social-fixtures.mjs';
import { AdaptiveWorldPulseService } from '../../application/playable-bootstrap/adaptive-world-pulse.mjs';

test('adaptive pulse primes a Thai-netizen feed and refresh consumes a persistent batch without adding phones', async () => {
  const c = await setupPhase15({ castSize: 1, manifestId: 'adaptive-world-pulse' });
  const context = { name2: 'Story', chat: [{ is_user: true, mes: 'เมื่อคืนไปเจอเรื่องลับที่ร้านกาแฟ' }] };
  const pulse = new AdaptiveWorldPulseService({ database: c.database, socialService: c.social, getContext: () => context, now: () => '2026-09-17T08:00:00.000Z' });
  const rosterBefore = await c.viewModels.deviceRoster(c.scope);
  const prime = await pulse.prime({ scope: c.scope, minimum: 6 });
  assert.equal(prime.ready, true); assert.equal(prime.created.length, 6);
  let feed = await c.social.listFeed({ scope: c.scope, viewerAccountId: c.user.accountId, limit: 20 });
  assert.equal(feed.items.length, 6); assert.ok(feed.items.every(row => /ร้านกาแฟ|มุง|จับตา|บรรยากาศ/u.test(row.text)));
  const next = await pulse.refresh({ scope: c.scope, count: 3 });
  assert.equal(next.created.length, 3); assert.ok(next.remainingBuffered >= 0);
  feed = await c.social.listFeed({ scope: c.scope, viewerAccountId: c.user.accountId, limit: 20 }); assert.equal(feed.items.length, 9);
  const labels = await c.database.transaction(['accounts'], 'readonly', async transaction => Promise.all([...new Set(feed.items.map(row => row.authorAccountId))].map(id => transaction.store('accounts').get(id))));
  assert.ok(labels.some(row => /ป้าข้างบ้าน|วงน้ำชา|ชาวเน็ต/u.test(row.label)));
  assert.equal((await c.viewModels.deviceRoster(c.scope)).length, rosterBefore.length, 'ambient NPC identities must not become Their Phone devices');
});
