import { setupPhase10 } from '../phase10/handoff-fixtures.mjs';
import { PocketShadowAdapter } from '../../adapters/pocket/pocket-shadow-adapter.mjs';
import { PocketShadowDiagnostics } from '../../adapters/pocket/diagnostics.mjs';
import { digest } from '../../adapters/pocket/hash.mjs';

export async function setupPhase11({ config = undefined, ...options } = {}) {
  const context = await setupPhase10(options); let current = config === undefined ? pocketConfig() : config; let reads = 0;
  const adapter = new PocketShadowAdapter({ database: context.database, readConfig: async () => { reads += 1; return current === null ? { available: false, reason: 'fixture unavailable' } : { available: true, sourceAuthority: 'pocket-phone', sourceVersion: '0.9.6-fixture', config: structuredClone(current) }; } });
  return { ...context, adapter, diagnostics: new PocketShadowDiagnostics({ database: context.database }), get reads() { return reads; }, setConfig: value => { current = value; }, configDigest: async () => digest(current) };
}

export function pocketConfig({ duplicateNames = false } = {}) { return {
  contacts: [{ id: 'pocket-alice', name: duplicateNames ? 'Same Name' : 'Alice', avatar: 'alice.png' }, { id: 'pocket-bob', name: duplicateNames ? 'Same Name' : 'Bob', avatar: 'bob.png' }],
  threads: { 'pocket-alice::route-main': [{ id: 'pdm-1', from: 'them', text: 'POCKET-PRIVATE', ts: 1 }], 'pocket-bob': [{ id: 'pdm-2', from: 'them', text: 'POCKET-LEGACY', ts: 2 }], 'group-1': [{ id: 'pgm-1', from: 'pocket-alice', text: 'POCKET-GROUP', ts: 3 }] },
  groups: [{ id: 'group-1', name: 'Group One', members: ['pocket-alice', 'pocket-bob'] }],
  callLog: [{ cid: 'pocket-alice', chatId: 'route-main', startISO: '2026-01-01T00:00:00.000Z', durText: '1:00', incoming: true, transcript: [{ from: 'them', text: 'POCKET-CALL' }] }],
}; }

export async function registerExactContactAndRoute(context, { contactId = 'pocket-alice', routeKey = 'pocket-alice::route-main', person = context.alice, canonical = {} } = {}) {
  await context.adapter.identityMapper.registerExplicit({ sourceType: 'pocket-contact', sourceId: contactId, scope: context.scope, canonical: { actorId: person.actorId, instanceId: person.instanceId, accountId: person.accountId, ...canonical } });
  await context.adapter.identityMapper.registerExplicit({ sourceType: 'pocket-route', sourceId: routeKey, scope: context.scope, canonical });
}

export async function recordCounts(context) { return context.database.transaction(['events', 'knowledgeClaims', 'audiencePolicies', 'knowledgeGrants', 'clockCheckpoints', 'threads', 'messages', 'callSessions'], 'readonly', async tx => Object.freeze({ events: await tx.store('events').count(), knowledgeClaims: await tx.store('knowledgeClaims').count(), audiencePolicies: await tx.store('audiencePolicies').count(), knowledgeGrants: await tx.store('knowledgeGrants').count(), clockCheckpoints: await tx.store('clockCheckpoints').count(), threads: await tx.store('threads').count(), messages: await tx.store('messages').count(), calls: await tx.store('callSessions').count() })); }
