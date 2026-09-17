import assert from 'node:assert/strict';
import test from 'node:test';
import { V3RuntimeGuard } from '../../beta/runtime-guard.mjs';
import { ProductionAuthoringGate } from '../../production/authoring-gate.mjs';
import { createFencedV3Database } from '../../production/fenced-database.mjs';
import { MemoryV3Database } from '../../storage/memory-v3-database.mjs';

const prerequisites = Object.freeze({
  productionHealthValid: true,
  previewExcluded: true,
  identityResolved: true,
  compositionServicesReady: true,
  uniqueListenersReady: true,
  uniqueGenerationInterceptorReady: true,
  callIntegrationReady: true,
  shellMountHealthy: true,
  heartbeatQualified: true,
});

test('a rejected domain operation aborts only that action and keeps the proven authoring lease open', async () => {
  const raw = new MemoryV3Database();
  await raw.open();
  const guard = new V3RuntimeGuard({ database: raw, ownerId: 'mobile-window', leaseIdFactory: () => 'mobile-lease' });
  assert.equal((await guard.acquire()).acquired, true);
  const gate = new ProductionAuthoringGate({ runtimeGuard: guard });
  assert.equal((await gate.open(prerequisites)).opened, true);
  const wrapped = {
    get databaseName() { return raw.databaseName; },
    get schemaVersion() { return raw.schemaVersion; },
    get isOpen() { return raw.isOpen; },
    get diagnostics() { return raw.diagnostics; },
    open: () => raw.open(),
    close: () => raw.close(),
    transaction: async (stores, mode, work) => {
      try { return await raw.transaction(stores, mode, work); }
      catch { throw new Error('browser surfaced a wrapped transaction abort'); }
    },
  };
  const fenced = createFencedV3Database({ database: wrapped, runtimeGuard: guard, authoringFence: gate.createFence(), capability: 'normal' });
  await assert.rejects(fenced.transaction(['migrations'], 'readwrite', async () => { throw new Error('domain validation failed'); }), /wrapped transaction abort/);
  assert.equal(gate.state, 'open');
  await fenced.transaction(['migrations'], 'readwrite', tx => tx.store('migrations').put({ id: 'next-valid-action', status: 'applied' }));
  const saved = await raw.transaction(['migrations'], 'readonly', tx => tx.store('migrations').get('next-valid-action'));
  assert.equal(saved.status, 'applied');
  raw.close();
});
