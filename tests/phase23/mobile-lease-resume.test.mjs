import assert from 'node:assert/strict';
import test from 'node:test';
import { V3RuntimeGuard } from '../../beta/runtime-guard.mjs';
import { LeaseHeartbeat } from '../../production/lease-heartbeat.mjs';
import { ProductionAuthoringGate } from '../../production/authoring-gate.mjs';
import { ProductionActiveStartupSession } from '../../production/active-startup.mjs';
import { MemoryV3Database } from '../../storage/memory-v3-database.mjs';

const prerequisites = Object.freeze({ productionHealthValid: true, previewExcluded: true, identityResolved: true, compositionServicesReady: true, uniqueListenersReady: true, uniqueGenerationInterceptorReady: true, callIntegrationReady: true, shellMountHealthy: true, heartbeatQualified: true });
const idFactory = (...ids) => { let index = 0; return () => ids[index++] || `lease-${index}`; };

class Scheduler {
  callback = null;
  setInterval = callback => { this.callback = callback; return 1; };
  clearInterval = () => { this.callback = null; };
  fire() { return this.callback?.(); }
}

async function owner({ registry = MemoryV3Database.createRegistry(), ownerId = 'mobile-owner', ids = ['mobile-a', 'mobile-b'] } = {}) {
  let now = 1_000; const database = new MemoryV3Database({ registry }); await database.open();
  const guard = new V3RuntimeGuard({ database, ownerId, clock: () => now, leaseDurationMs: 100, leaseIdFactory: idFactory(...ids) }); await guard.acquire();
  const gate = new ProductionAuthoringGate({ runtimeGuard: guard }); const scheduler = new Scheduler(); const heartbeat = new LeaseHeartbeat({ runtimeGuard: guard, authoringGate: gate, intervalMs: 10, setIntervalFn: scheduler.setInterval, clearIntervalFn: scheduler.clearInterval });
  await heartbeat.start(); await gate.open(prerequisites); return { registry, database, guard, gate, scheduler, heartbeat, advance: value => { now += value; } };
}

test('a suspended mobile tab reacquires its expired uncontested lease and keeps authoring open', async () => {
  const context = await owner(); const firstLease = context.guard.leaseId; context.advance(101);
  const tick = await context.scheduler.fire();
  assert.equal(tick.renewed, true); assert.equal(tick.reacquired, true); assert.notEqual(context.guard.leaseId, firstLease); assert.equal(context.gate.state, 'open'); assert.equal(context.heartbeat.running, true);
  await context.heartbeat.stop(); context.database.close();
});

test('a suspended tab still fails closed when another window took the expired lease', async () => {
  const context = await owner(); context.advance(101); const otherDatabase = new MemoryV3Database({ registry: context.registry }); await otherDatabase.open();
  const other = new V3RuntimeGuard({ database: otherDatabase, ownerId: 'other-window', clock: () => 1_101, leaseDurationMs: 100, leaseIdFactory: idFactory('other-lease') }); assert.equal((await other.acquire()).acquired, true);
  const tick = await context.scheduler.fire();
  assert.equal(tick.renewed, false); assert.equal(context.gate.state, 'closed'); assert.equal(context.heartbeat.running, false); assert.equal(context.guard.ownsLease, false);
  otherDatabase.close(); context.database.close();
});

test('a write action can wake an expired mobile lease and reopen the normal authoring gate', async () => {
  const context = await owner(); context.advance(101); context.gate.close('heartbeat-renew-expired'); await context.heartbeat.stop();
  const session = new ProductionActiveStartupSession({ ownerId: 'mobile-owner' });
  session.runtime = { role: 'owner', composition: { runtimeGuard: context.guard, authoringGate: context.gate, heartbeat: context.heartbeat, listenerOwner: { status: { registered: true } }, generationOwner: { status: { delegateActive: true } } } };
  session.identity = { scope: { storyId: 'story', branchId: 'branch' } }; session.mountManager = { status: { healthy: true } }; session.launcherOwner = { reconcile() {} }; session.finalHealth = { checks: prerequisites }; session.started = true;
  assert.equal(await session.ensureAuthoringReady(), true); assert.equal(context.gate.state, 'open'); assert.equal(context.heartbeat.running, true); assert.equal(context.guard.ownsLease, true);
  await context.heartbeat.stop(); context.database.close();
});
