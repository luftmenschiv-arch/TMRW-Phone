import assert from 'node:assert/strict';
import test from 'node:test';
import { V3RuntimeGuard } from '../../beta/runtime-guard.mjs';
import { MemoryV3Database } from '../../storage/memory-v3-database.mjs';
import { V3Database } from '../../storage/v3-database.mjs';
import { V3_RUNTIME_LEASE_KEY } from '../../storage/schema.mjs';

function mutableClock(start = 1_000) {
  let value = start;
  return {
    now: () => value,
    set(next) { value = next; },
    advance(delta) { value += delta; },
  };
}

function idFactory(...ids) {
  let index = 0;
  return () => ids[index++] ?? `lease-generated-${index}`;
}

async function openMemory(registry = MemoryV3Database.createRegistry()) {
  const database = new MemoryV3Database({ registry });
  await database.open();
  return database;
}

async function readLease(database) {
  return database.transaction(['metadata'], 'readonly', tx => tx.store('metadata').get(V3_RUNTIME_LEASE_KEY));
}

async function writeLease(database, lease) {
  return database.transaction(['metadata'], 'readwrite', tx => tx.store('metadata').put(lease));
}

class FakeNameList {
  #names;
  constructor(names) { this.#names = names; }
  contains(name) { return this.#names.has(name); }
}

function keyFrom(record, keyPath) {
  return Array.isArray(keyPath) ? keyPath.map(key => record?.[key]) : record?.[keyPath];
}

function fakeRequest(work) {
  const request = { result: undefined, error: null, onsuccess: null, onerror: null };
  queueMicrotask(() => {
    try {
      request.result = work();
      request.onsuccess?.();
    } catch (error) {
      request.error = error;
      request.onerror?.();
    }
  });
  return request;
}

class FakeIndexedDbStore {
  #state;
  #transaction;
  constructor(state, transaction) { this.#state = state; this.#transaction = transaction; }
  get indexNames() { return new FakeNameList(this.#state.indexes); }
  createIndex(name) { this.#state.indexes.add(name); return this; }
  deleteIndex(name) { this.#state.indexes.delete(name); }
  get(key) { return fakeRequest(() => structuredClone(this.#state.records.get(JSON.stringify(key)))); }
  getAll() { return fakeRequest(() => [...this.#state.records.values()].map(structuredClone)); }
  openCursor() { return fakeRequest(() => null); }
  count() { return fakeRequest(() => this.#state.records.size); }
  put(record) {
    if (this.#transaction.mode === 'readonly') return fakeRequest(() => { throw new Error('Readonly transaction cannot write'); });
    return fakeRequest(() => {
      const key = keyFrom(record, this.#state.keyPath);
      this.#state.records.set(JSON.stringify(key), structuredClone(record));
      return key;
    });
  }
  delete(key) {
    if (this.#transaction.mode === 'readonly') return fakeRequest(() => { throw new Error('Readonly transaction cannot write'); });
    return fakeRequest(() => this.#state.records.delete(JSON.stringify(key)));
  }
  index() { throw new Error('Indexes are not required by S01 lease tests'); }
}

class FakeIndexedDbTransaction {
  #databaseState;
  #aborted = false;
  constructor(databaseState, storeNames, mode = 'readonly', { autoComplete = true } = {}) {
    this.#databaseState = databaseState;
    this.storeNames = storeNames;
    this.mode = mode;
    this.error = null;
    this.oncomplete = null;
    this.onabort = null;
    this.onerror = null;
    if (autoComplete) {
      setTimeout(() => {
        if (!this.#aborted) this.oncomplete?.();
      }, 0);
    }
  }
  objectStore(name) {
    const state = this.#databaseState.stores.get(name);
    if (!state) throw new Error(`Unknown object store ${name}`);
    return new FakeIndexedDbStore(state, this);
  }
  abort() {
    if (this.#aborted) return;
    this.#aborted = true;
    this.error = new Error('IndexedDB transaction aborted');
    queueMicrotask(() => this.onabort?.());
  }
}

class FakeNativeIndexedDbDatabase {
  #state;
  constructor(state) { this.#state = state; this.onversionchange = null; }
  get objectStoreNames() { return new FakeNameList(new Set(this.#state.stores.keys())); }
  createObjectStore(name, { keyPath }) {
    const state = { keyPath, indexes: new Set(), records: new Map() };
    this.#state.stores.set(name, state);
    return new FakeIndexedDbStore(state, { mode: 'readwrite' });
  }
  transaction(storeNames, mode) { return new FakeIndexedDbTransaction(this.#state, storeNames, mode); }
  close() {}
}

class FakeIndexedDbFactory {
  #state = { version: 0, stores: new Map() };
  open(_name, version) {
    const request = { result: null, transaction: null, error: null, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null };
    queueMicrotask(() => {
      try {
        const oldVersion = this.#state.version;
        const database = new FakeNativeIndexedDbDatabase(this.#state);
        request.result = database;
        if (oldVersion < version) {
          request.transaction = new FakeIndexedDbTransaction(this.#state, [], 'readwrite', { autoComplete: false });
          request.onupgradeneeded?.({ oldVersion, newVersion: version });
          this.#state.version = version;
        }
        queueMicrotask(() => request.onsuccess?.());
      } catch (error) {
        request.error = error;
        request.onerror?.();
      }
    });
    return request;
  }
}

test('ownerId remains stable and a first acquisition creates one canonical lease generation', async () => {
  const database = await openMemory();
  const clock = mutableClock(10_000);
  const guard = new V3RuntimeGuard({ database, ownerId: 'window-a', clock: clock.now, leaseDurationMs: 100, leaseIdFactory: idFactory('lease-a') });
  assert.equal(guard.ownerId, 'window-a');
  assert.equal(guard.leaseId, null);
  const result = await guard.acquire();
  assert.deepEqual(result, { acquired: true, ownerId: 'window-a', leaseId: 'lease-a', expiresAt: 10_100, generationChanged: true, reason: 'acquired' });
  assert.equal(guard.leaseId, 'lease-a');
  assert.equal(guard.ownsLease, true);
  const stored = await readLease(database);
  assert.deepEqual(stored, { key: V3_RUNTIME_LEASE_KEY, ownerId: 'window-a', leaseId: 'lease-a', acquiredAt: 10_000, renewedAt: 10_000, expiresAt: 10_100, phase: 1 });
  assert.equal('authoringEnabled' in stored, false);
  database.close();
});

test('default production lease generation uses a secure non-empty token and rotates after release', async () => {
  const database = await openMemory();
  const clock = mutableClock(20_000);
  const guard = new V3RuntimeGuard({ database, ownerId: 'window-secure', clock: clock.now, leaseDurationMs: 100 });
  await guard.acquire();
  const first = guard.leaseId;
  assert.equal(typeof first, 'string');
  assert.ok(first.length >= 16);
  assert.equal(await guard.release(), true);
  clock.advance(1);
  await guard.acquire();
  assert.notEqual(guard.leaseId, first);
  database.close();
});

test('valid foreign owner is denied without modifying the stored lease', async () => {
  const registry = MemoryV3Database.createRegistry();
  const aDb = await openMemory(registry); const bDb = await openMemory(registry);
  const clock = mutableClock(30_000);
  const a = new V3RuntimeGuard({ database: aDb, ownerId: 'a', clock: clock.now, leaseDurationMs: 100, leaseIdFactory: idFactory('la') });
  const b = new V3RuntimeGuard({ database: bDb, ownerId: 'b', clock: clock.now, leaseDurationMs: 100, leaseIdFactory: idFactory('lb') });
  await a.acquire();
  const before = await readLease(aDb);
  const denied = await b.acquire();
  assert.equal(denied.acquired, false);
  assert.equal(denied.reason, 'foreign-owner');
  assert.deepEqual(await readLease(aDb), before);
  assert.equal(b.ownsLease, false);
  aDb.close(); bDb.close();
});

test('repeated exact acquire is idempotent and never extends expiry', async () => {
  const database = await openMemory();
  const clock = mutableClock(40_000);
  const guard = new V3RuntimeGuard({ database, ownerId: 'a', clock: clock.now, leaseDurationMs: 100, leaseIdFactory: idFactory('la', 'unexpected') });
  const first = await guard.acquire();
  clock.advance(50);
  const second = await guard.acquire();
  assert.equal(second.acquired, true);
  assert.equal(second.generationChanged, false);
  assert.equal(second.reason, 'existing-generation');
  assert.equal(second.leaseId, first.leaseId);
  assert.equal(second.expiresAt, first.expiresAt);
  assert.equal((await readLease(database)).renewedAt, 40_000);
  database.close();
});

test('same owner cannot adopt a valid generation it does not locally possess', async () => {
  const registry = MemoryV3Database.createRegistry();
  const firstDb = await openMemory(registry); const secondDb = await openMemory(registry);
  const clock = mutableClock(50_000);
  const first = new V3RuntimeGuard({ database: firstDb, ownerId: 'same-owner', clock: clock.now, leaseDurationMs: 100, leaseIdFactory: idFactory('la') });
  const second = new V3RuntimeGuard({ database: secondDb, ownerId: 'same-owner', clock: clock.now, leaseDurationMs: 100, leaseIdFactory: idFactory('lb') });
  await first.acquire();
  const denied = await second.acquire();
  assert.equal(denied.acquired, false);
  assert.equal(denied.reason, 'generation-mismatch');
  assert.equal(second.leaseId, null);
  const validation = await second.validateLease();
  assert.equal(validation.valid, false);
  assert.equal(validation.reason, 'missing-local-generation');
  firstDb.close(); secondDb.close();
});

test('renew preserves leaseId/acquiredAt, advances renewedAt/expiry, and removes legacy authoringEnabled', async () => {
  const registry = MemoryV3Database.createRegistry();
  const database = await openMemory(registry);
  const clock = mutableClock(60_000);
  const guard = new V3RuntimeGuard({ database, ownerId: 'a', clock: clock.now, leaseDurationMs: 100, leaseIdFactory: idFactory('la') });
  await guard.acquire();
  const legacy = await readLease(database);
  await writeLease(database, { ...legacy, authoringEnabled: true });
  clock.advance(40);
  const renewed = await guard.renew();
  assert.equal(renewed.renewed, true);
  assert.equal(renewed.leaseId, 'la');
  const stored = await readLease(database);
  assert.equal(stored.acquiredAt, 60_000);
  assert.equal(stored.renewedAt, 60_040);
  assert.equal(stored.expiresAt, 60_140);
  assert.equal(stored.leaseId, 'la');
  assert.equal('authoringEnabled' in stored, false);
  database.close();
});

test('expired lease cannot be renewed and same runtime reacquires a new generation', async () => {
  const database = await openMemory();
  const clock = mutableClock(70_000);
  const guard = new V3RuntimeGuard({ database, ownerId: 'a', clock: clock.now, leaseDurationMs: 100, leaseIdFactory: idFactory('la', 'la2') });
  await guard.acquire();
  clock.set(70_100);
  const renewal = await guard.renew();
  assert.equal(renewal.renewed, false);
  assert.equal(renewal.reason, 'expired');
  assert.equal(guard.ownsLease, false);
  assert.equal((await readLease(database)).leaseId, 'la');
  const reacquired = await guard.acquire();
  assert.equal(reacquired.acquired, true);
  assert.equal(reacquired.leaseId, 'la2');
  assert.equal(reacquired.reason, 'expired-replaced');
  assert.notEqual(reacquired.leaseId, 'la');
  database.close();
});

test('foreign takeover after expiry creates a new generation; stale validation and stale release cannot affect it', async () => {
  const registry = MemoryV3Database.createRegistry();
  const aDb = await openMemory(registry); const bDb = await openMemory(registry);
  const clock = mutableClock(80_000);
  const a = new V3RuntimeGuard({ database: aDb, ownerId: 'a', clock: clock.now, leaseDurationMs: 100, leaseIdFactory: idFactory('la') });
  const b = new V3RuntimeGuard({ database: bDb, ownerId: 'b', clock: clock.now, leaseDurationMs: 100, leaseIdFactory: idFactory('lb') });
  await a.acquire();
  clock.set(80_100);
  const takeover = await b.acquire();
  assert.equal(takeover.acquired, true);
  assert.equal(takeover.leaseId, 'lb');
  assert.notEqual(takeover.leaseId, a.leaseId);
  const staleValidation = await a.validateLease();
  assert.equal(staleValidation.valid, false);
  assert.equal(staleValidation.reason, 'owner-mismatch');
  assert.equal(a.ownsLease, false);
  assert.equal(await a.release(), false);
  assert.equal((await readLease(bDb)).leaseId, 'lb');
  aDb.close(); bDb.close();
});

test('matching release deletes only its exact ownerId + leaseId generation and a later owner gets a fresh generation', async () => {
  const registry = MemoryV3Database.createRegistry();
  const aDb = await openMemory(registry); const cDb = await openMemory(registry);
  const clock = mutableClock(90_000);
  const a = new V3RuntimeGuard({ database: aDb, ownerId: 'a', clock: clock.now, leaseDurationMs: 100, leaseIdFactory: idFactory('la') });
  const c = new V3RuntimeGuard({ database: cDb, ownerId: 'c', clock: clock.now, leaseDurationMs: 100, leaseIdFactory: idFactory('lc') });
  await a.acquire();
  assert.equal(await a.release(), true);
  assert.equal(await readLease(aDb), undefined);
  const acquired = await c.acquire();
  assert.equal(acquired.leaseId, 'lc');
  assert.notEqual(acquired.leaseId, 'la');
  aDb.close(); cDb.close();
});

test('malformed or non-finite lease state fails closed instead of being treated as expired', async () => {
  const database = await openMemory();
  const clock = mutableClock(100_000);
  await writeLease(database, { key: V3_RUNTIME_LEASE_KEY, ownerId: 'a', leaseId: 'bad', expiresAt: Number.NaN });
  const guard = new V3RuntimeGuard({ database, ownerId: 'a', clock: clock.now, leaseDurationMs: 100, leaseIdFactory: idFactory('new') });
  const result = await guard.acquire();
  assert.equal(result.acquired, false);
  assert.equal(result.reason, 'malformed-lease');
  assert.equal(guard.leaseId, null);
  assert.equal((await readLease(database)).leaseId, 'bad');
  database.close();
});

test('pure validateLeaseRecord enforces exact owner + generation + strict expiry without trusting cached ownsLease', async () => {
  const database = await openMemory();
  const clock = mutableClock(110_000);
  const guard = new V3RuntimeGuard({ database, ownerId: 'a', clock: clock.now, leaseDurationMs: 100, leaseIdFactory: idFactory('la') });
  await guard.acquire();
  const stored = await readLease(database);
  assert.deepEqual(guard.validateLeaseRecord(stored, 110_050), { valid: true, reason: 'valid', expiresAt: 110_100, ownerId: 'a', leaseId: 'la' });
  assert.equal(guard.validateLeaseRecord({ ...stored, ownerId: 'b' }, 110_050).reason, 'owner-mismatch');
  assert.equal(guard.validateLeaseRecord({ ...stored, leaseId: 'other' }, 110_050).reason, 'generation-mismatch');
  assert.equal(guard.validateLeaseRecord(stored, 110_100).reason, 'expired');
  assert.equal(guard.validateLeaseRecord({ ...stored, expiresAt: 'not-time' }, 110_050).reason, 'malformed-lease');
  database.close();
});

test('database unavailability invalidates cached ownership instead of authorizing from local state', async () => {
  const database = await openMemory();
  const clock = mutableClock(120_000);
  const guard = new V3RuntimeGuard({ database, ownerId: 'a', clock: clock.now, leaseDurationMs: 100, leaseIdFactory: idFactory('la') });
  await guard.acquire();
  assert.equal(guard.ownsLease, true);
  database.close();
  await assert.rejects(guard.validateLease(), /not open/i);
  assert.equal(guard.ownsLease, false);
  assert.equal(await guard.release(), false);
});

test('invalid clock fails closed before lease mutation', async () => {
  const database = await openMemory();
  const guard = new V3RuntimeGuard({ database, ownerId: 'a', clock: () => Number.NaN, leaseDurationMs: 100, leaseIdFactory: idFactory('la') });
  await assert.rejects(guard.acquire(), /finite epoch/i);
  assert.equal(await readLease(database), undefined);
  database.close();
});

test('V3Database IndexedDB adapter preserves lease-generation fencing across two connections', async () => {
  const indexedDb = new FakeIndexedDbFactory();
  const aDb = new V3Database({ indexedDb }); const bDb = new V3Database({ indexedDb });
  await aDb.open(); await bDb.open();
  const clock = mutableClock(130_000);
  const a = new V3RuntimeGuard({ database: aDb, ownerId: 'indexed-a', clock: clock.now, leaseDurationMs: 100, leaseIdFactory: idFactory('indexed-la') });
  const b = new V3RuntimeGuard({ database: bDb, ownerId: 'indexed-b', clock: clock.now, leaseDurationMs: 100, leaseIdFactory: idFactory('indexed-lb') });
  assert.equal((await a.acquire()).acquired, true);
  assert.equal((await b.acquire()).reason, 'foreign-owner');
  clock.set(130_100);
  assert.equal((await b.acquire()).leaseId, 'indexed-lb');
  assert.equal((await a.validateLease()).valid, false);
  assert.equal(await a.release(), false);
  assert.equal((await readLease(bDb)).leaseId, 'indexed-lb');
  aDb.close(); bDb.close();
});
