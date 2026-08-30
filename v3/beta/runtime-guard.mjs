import { V3_RUNTIME_LEASE_KEY } from '../storage/schema.mjs';

function secureLeaseId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 12).join('')}-${hex.slice(12).join('')}`;
  }
  throw new Error('Secure leaseId generation is unavailable');
}

export class V3RuntimeGuard {
  #database;
  #ownerId;
  #clock;
  #leaseDurationMs;
  #leaseIdFactory;
  #leaseId = null;
  #ownsLease = false;

  constructor({ database, ownerId, clock = () => Date.now(), leaseDurationMs = 30_000, leaseIdFactory = secureLeaseId }) {
    if (!ownerId) throw new TypeError('A stable per-window ownerId is required');
    if (typeof clock !== 'function') throw new TypeError('A lease clock function is required');
    if (!Number.isFinite(leaseDurationMs) || leaseDurationMs <= 0) throw new TypeError('A positive finite leaseDurationMs is required');
    if (typeof leaseIdFactory !== 'function') throw new TypeError('A secure leaseId factory is required');
    this.#database = database;
    this.#ownerId = ownerId;
    this.#clock = clock;
    this.#leaseDurationMs = leaseDurationMs;
    this.#leaseIdFactory = leaseIdFactory;
  }

  get ownerId() {
    return this.#ownerId;
  }

  get leaseId() {
    return this.#leaseId;
  }

  get ownsLease() {
    return this.#ownsLease;
  }

  #now() {
    const now = this.#clock();
    if (typeof now !== 'number' || !Number.isFinite(now)) throw new Error('Lease clock is not a finite epoch millisecond value');
    return now;
  }

  #newLeaseId(currentLeaseId = null) {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const leaseId = this.#leaseIdFactory();
      if (typeof leaseId !== 'string' || leaseId.length === 0) continue;
      if (leaseId === this.#leaseId || leaseId === currentLeaseId) continue;
      return leaseId;
    }
    throw new Error('Unable to create a fresh lease generation');
  }

  validateLeaseRecord(record, now = this.#now()) {
    if (typeof now !== 'number' || !Number.isFinite(now)) return { valid: false, reason: 'invalid-clock' };
    if (!record || typeof record !== 'object') return { valid: false, reason: 'missing-lease' };
    if (typeof record.ownerId !== 'string' || !record.ownerId || typeof record.leaseId !== 'string' || !record.leaseId) {
      return { valid: false, reason: 'malformed-lease' };
    }
    const expiresAt = Number(record.expiresAt);
    if (!Number.isFinite(expiresAt)) return { valid: false, reason: 'malformed-lease' };
    if (record.ownerId !== this.#ownerId) return { valid: false, reason: 'owner-mismatch', expiresAt };
    if (!this.#leaseId || record.leaseId !== this.#leaseId) return { valid: false, reason: 'generation-mismatch', expiresAt };
    if (expiresAt <= now) return { valid: false, reason: 'expired', expiresAt };
    return { valid: true, reason: 'valid', expiresAt, ownerId: record.ownerId, leaseId: record.leaseId };
  }

  async acquire() {
    const now = this.#now();
    try {
      const result = await this.#database.transaction(['metadata'], 'readwrite', async tx => {
        const store = tx.store('metadata');
        const current = await store.get(V3_RUNTIME_LEASE_KEY);

        if (current) {
          const expiresAt = Number(current.expiresAt);
          if (!Number.isFinite(expiresAt)) {
            return { acquired: false, ownerId: current.ownerId ?? null, leaseId: current.leaseId ?? null, expiresAt: current.expiresAt ?? null, generationChanged: false, reason: 'malformed-lease' };
          }
          if (expiresAt > now) {
            if (this.#leaseId && current.ownerId === this.#ownerId && current.leaseId === this.#leaseId) {
              return { acquired: true, ownerId: this.#ownerId, leaseId: this.#leaseId, expiresAt, generationChanged: false, reason: 'existing-generation' };
            }
            return {
              acquired: false,
              ownerId: current.ownerId ?? null,
              leaseId: current.leaseId ?? null,
              expiresAt,
              generationChanged: false,
              reason: current.ownerId === this.#ownerId ? 'generation-mismatch' : 'foreign-owner',
            };
          }
        }

        const leaseId = this.#newLeaseId(current?.leaseId ?? null);
        const lease = {
          key: V3_RUNTIME_LEASE_KEY,
          ownerId: this.#ownerId,
          leaseId,
          acquiredAt: now,
          renewedAt: now,
          expiresAt: now + this.#leaseDurationMs,
          phase: 1,
        };
        await store.put(lease);
        return { acquired: true, ownerId: this.#ownerId, leaseId, expiresAt: lease.expiresAt, generationChanged: true, reason: current ? 'expired-replaced' : 'acquired' };
      });

      if (result.acquired) {
        if (result.generationChanged) this.#leaseId = result.leaseId;
        this.#ownsLease = true;
      } else {
        this.#ownsLease = false;
      }
      return result;
    } catch (error) {
      this.#ownsLease = false;
      throw error;
    }
  }

  async renew() {
    const now = this.#now();
    if (!this.#leaseId) {
      this.#ownsLease = false;
      return { renewed: false, ownerId: this.#ownerId, leaseId: null, expiresAt: null, reason: 'missing-local-generation' };
    }
    try {
      const result = await this.#database.transaction(['metadata'], 'readwrite', async tx => {
        const store = tx.store('metadata');
        const current = await store.get(V3_RUNTIME_LEASE_KEY);
        const validation = this.validateLeaseRecord(current, now);
        if (!validation.valid) {
          return { renewed: false, ownerId: this.#ownerId, leaseId: this.#leaseId, expiresAt: validation.expiresAt ?? current?.expiresAt ?? null, reason: validation.reason };
        }
        const lease = {
          key: V3_RUNTIME_LEASE_KEY,
          ownerId: this.#ownerId,
          leaseId: this.#leaseId,
          acquiredAt: current.acquiredAt,
          renewedAt: now,
          expiresAt: now + this.#leaseDurationMs,
          phase: current.phase ?? 1,
        };
        await store.put(lease);
        return { renewed: true, ownerId: this.#ownerId, leaseId: this.#leaseId, expiresAt: lease.expiresAt, reason: 'renewed' };
      });
      this.#ownsLease = result.renewed;
      return result;
    } catch (error) {
      this.#ownsLease = false;
      throw error;
    }
  }

  async validateLease() {
    const now = this.#now();
    if (!this.#leaseId) {
      this.#ownsLease = false;
      return { valid: false, ownerId: this.#ownerId, leaseId: null, expiresAt: null, reason: 'missing-local-generation' };
    }
    try {
      const result = await this.#database.transaction(['metadata'], 'readonly', async tx => {
        const current = await tx.store('metadata').get(V3_RUNTIME_LEASE_KEY);
        const validation = this.validateLeaseRecord(current, now);
        return { ...validation, ownerId: this.#ownerId, leaseId: this.#leaseId, expiresAt: validation.expiresAt ?? current?.expiresAt ?? null };
      });
      this.#ownsLease = result.valid;
      return result;
    } catch (error) {
      this.#ownsLease = false;
      throw error;
    }
  }

  async release() {
    if (!this.#leaseId || !this.#database.isOpen) {
      this.#ownsLease = false;
      return false;
    }
    try {
      const released = await this.#database.transaction(['metadata'], 'readwrite', async tx => {
        const store = tx.store('metadata');
        const current = await store.get(V3_RUNTIME_LEASE_KEY);
        if (!current || current.ownerId !== this.#ownerId || current.leaseId !== this.#leaseId) return false;
        await store.delete(V3_RUNTIME_LEASE_KEY);
        return true;
      });
      this.#ownsLease = false;
      return released;
    } catch (error) {
      this.#ownsLease = false;
      throw error;
    }
  }
}
