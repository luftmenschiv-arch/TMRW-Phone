import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalAppMigrationItems } from '../../migration/preview37/personal-app-translator.mjs';
import { PREVIEW37_PERSONAL_CLASSIFICATION } from '../../migration/preview37/constants.mjs';

const scope = Object.freeze({
  sourceScopeKey: 'card::story::branch',
  phones: Object.freeze({
    user: Object.freeze({
      notes: Object.freeze([{ id: 'n1', title: 'Plan', text: 'Private', source: 'manual' }, { id: 'nmock', title: 'Sample', text: 'x', source: 'mock-generated' }]),
      gallery: Object.freeze([{ id: 'g1', label: 'Door', assetRef: 'asset-1', source: 'manual', provenance: { source: 'user-authored', takenAt: 'story-day-1' } }, { id: 'g-bad', label: 'Missing ref', source: 'manual' }]),
      search: Object.freeze([{ id: 's1', query: 'blue door', source: 'user-authored' }, { id: 's-suggest', query: 'trending', source: 'manual', suggestion: true }]),
      wallet: Object.freeze([{ id: 'w1', entryKind: 'transaction', label: 'Explicit gift', amount: 20, currency: 'USD', source: 'story-canonical' }, { id: 'w-default', entryKind: 'balance', label: 'Balance', amount: 9999, currency: 'USD' }]),
      shop: Object.freeze([{ id: 'p1', recordType: 'catalog-item', name: 'Ticket', price: 0, currency: 'USD', source: 'story-canonical' }, { id: 'o1', recordType: 'order', shopItemId: 'p1', quantity: 1, unitPrice: 0, currency: 'USD', source: 'user-authored' }, { id: 'o-paid', recordType: 'order', shopItemId: 'p1', quantity: 1, unitPrice: 10, currency: 'USD', source: 'user-authored' }]),
      calendar: Object.freeze([{ id: 'c1', itemKind: 'reminder', title: 'Meet', due: { kind: 'absolute', localTime: '18:30' }, source: 'manual' }, { id: 'c-mock', itemKind: 'reminder', title: 'Decorative', due: { kind: 'ordinal', targetOrdinal: 2 }, source: 'sample' }]),
      maps: Object.freeze([{ id: 'm1', mode: 'check-in', label: 'Cafe', source: 'manual' }, { id: 'm2', mode: 'live', label: 'Road', audienceIds: ['member-1'], source: 'manual' }]),
      weather: Object.freeze([{ id: 'weather-mock', condition: 'sunny', temperatureC: 30, source: 'mock' }]),
      health: Object.freeze([{ id: 'health-mock', metric: 'steps', value: 9999, source: 'generated' }]),
      files: Object.freeze([{ id: 'file-mock', name: 'voice.wav' }]),
    }),
  }),
});

function withUserPhone(patch) {
  const next = structuredClone(scope);
  next.phones.user = { ...next.phones.user, ...patch };
  return next;
}

test('P23 Preview personal translator classifies eligible, ambiguous, and mock rows conservatively per family', async () => {
  const items = await createPersonalAppMigrationItems({ scope, memberIds: new Set(['user', 'member-1']) });
  const byId = id => items.find(row => row.sourceRecordId.endsWith(`:${id}`));
  for (const id of ['n1', 'g1', 's1', 'w1', 'p1', 'o1', 'c1', 'm1']) assert.equal(byId(id)?.classification, PREVIEW37_PERSONAL_CLASSIFICATION.ELIGIBLE, id);
  assert.equal(byId('nmock')?.classification, PREVIEW37_PERSONAL_CLASSIFICATION.MOCK);
  assert.equal(byId('c-mock')?.classification, PREVIEW37_PERSONAL_CLASSIFICATION.MOCK);
  for (const id of ['g-bad', 's-suggest', 'w-default', 'o-paid', 'm2']) assert.equal(byId(id)?.classification, PREVIEW37_PERSONAL_CLASSIFICATION.AMBIGUOUS, id);
});

test('P23 Preview personal translator never inventories Weather, Health, or Files generator rows as migration items', async () => {
  const items = await createPersonalAppMigrationItems({ scope, memberIds: new Set(['user', 'member-1']) });
  assert.equal(items.some(row => /weather|health|file/.test(row.sourceType)), false);
});

test('P23 Preview personal translator requires exact phone-owner mapping and stable explicit provenance', async () => {
  const items = await createPersonalAppMigrationItems({ scope, memberIds: new Set(['member-1']) });
  assert.ok(items.length > 0);
  assert.equal(items.every(row => row.classification !== PREVIEW37_PERSONAL_CLASSIFICATION.ELIGIBLE), true);
  assert.equal(items.every(row => row.reasonCode === 'personal-app-phone-owner-unmapped' || row.classification === PREVIEW37_PERSONAL_CLASSIFICATION.MOCK), true);
});

test('P23 Preview Wallet translator quarantines missing/invalid currency, non-finite amounts, and ambiguous provenance', async () => {
  const wallet = [
    { id: 'w-missing-currency', entryKind: 'transaction', label: 'Missing currency', amount: 1, source: 'story-canonical' },
    { id: 'w-invalid-currency', entryKind: 'transaction', label: 'Invalid currency', amount: 1, currency: { code: 'USD' }, source: 'story-canonical' },
    { id: 'w-nan', entryKind: 'transaction', label: 'NaN amount', amount: NaN, currency: 'USD', source: 'story-canonical' },
    { id: 'w-infinity', entryKind: 'transaction', label: 'Infinite amount', amount: Infinity, currency: 'USD', source: 'story-canonical' },
    { id: 'w-unproven', entryKind: 'transaction', label: 'Unknown provenance', amount: 1, currency: 'USD' },
  ];
  const items = await createPersonalAppMigrationItems({ scope: withUserPhone({ wallet, shop: [] }), memberIds: new Set(['user', 'member-1']) });
  const walletItems = items.filter(row => row.sourceType === 'wallet'); assert.equal(walletItems.length, 5); assert.equal(walletItems.every(row => row.classification === PREVIEW37_PERSONAL_CLASSIFICATION.AMBIGUOUS), true);
  const byId = id => walletItems.find(row => row.sourceRecordId.endsWith(`:${id}`));
  for (const id of ['w-missing-currency', 'w-invalid-currency', 'w-nan', 'w-infinity']) assert.equal(byId(id)?.reasonCode, 'legacy-semantics-ambiguous', id);
  assert.equal(byId('w-unproven')?.reasonCode, 'legacy-provenance-unproven');
});

test('P23 Preview Calendar translator enforces organizer and exact mapped invitation audience', async () => {
  const calendar = [
    { id: 'invite-good', itemKind: 'invitation', title: 'Good invite', due: { kind: 'ordinal', targetOrdinal: 5 }, participantIds: ['member-1'], organizer: true, source: 'user-authored' },
    { id: 'invite-no-organizer', itemKind: 'invitation', title: 'No organizer', due: { kind: 'ordinal', targetOrdinal: 6 }, participantIds: ['member-1'], source: 'user-authored' },
    { id: 'invite-foreign', itemKind: 'invitation', title: 'Foreign', due: { kind: 'ordinal', targetOrdinal: 7 }, participantIds: ['member-foreign'], organizer: true, source: 'user-authored' },
  ];
  const items = await createPersonalAppMigrationItems({ scope: withUserPhone({ calendar }), memberIds: new Set(['user', 'member-1']) });
  const byId = id => items.find(row => row.sourceRecordId.endsWith(`:${id}`)); const good = byId('invite-good');
  assert.equal(good?.classification, PREVIEW37_PERSONAL_CLASSIFICATION.ELIGIBLE); assert.deepEqual(good?.data.participantSourceIds, ['member-1']);
  assert.equal(byId('invite-no-organizer')?.reasonCode, 'legacy-semantics-ambiguous'); assert.equal(byId('invite-foreign')?.reasonCode, 'calendar-participant-unmapped');
});

test('P23 Preview malformed records have deterministic accounting and never become eligible', async () => {
  const notes = [null, 'bad-record', [], { title: 'No stable id', text: 'x', source: 'user-authored' }];
  const items = await createPersonalAppMigrationItems({ scope: withUserPhone({ notes }), memberIds: new Set(['user', 'member-1']) });
  const noteItems = items.filter(row => row.sourceType === 'note'); assert.equal(noteItems.length, 4); assert.equal(noteItems.every(row => row.classification === PREVIEW37_PERSONAL_CLASSIFICATION.AMBIGUOUS), true);
  assert.deepEqual(noteItems.map(row => row.reasonCode), ['malformed-legacy-record', 'malformed-legacy-record', 'malformed-legacy-record', 'legacy-record-missing-stable-id']);
  assert.equal(new Set(noteItems.map(row => row.sourceRecordId)).size, 4); assert.equal(noteItems.every(row => row.data === null), true);
});
