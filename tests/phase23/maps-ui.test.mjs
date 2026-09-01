import test from 'node:test';
import assert from 'node:assert/strict';
import { TmrwPhoneShell } from '../../ui/shell.mjs';
import { PhoneShellViewModels } from '../../ui/view-models.mjs';
import { setupPhoneWorldFoundation, ownedInput, utilitySource } from './phone-world-foundation-fixtures.mjs';
import { PHONE_WORLD_EVENT_TYPES } from '../../domain/utilities/phone-world-event-types.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(predicate, attempts = 40) { for (let i = 0; i < attempts; i += 1) { if (await predicate()) return; await settle(); } throw new Error('Timed out waiting for Maps UI'); }
function find(node, predicate) { if (predicate(node)) return node; for (const child of node.children || []) { const hit = find(child, predicate); if (hit) return hit; } return null; }
function findAll(node, predicate, out = []) { if (predicate(node)) out.push(node); for (const child of node.children || []) findAll(child, predicate, out); return out; }
function fireInput(node, value) { node.value = value; for (const listener of node.listeners.get('input') || []) listener({ currentTarget: node }); }
function vm(c) { return new PhoneShellViewModels({ database: c.database, phoneStateService: c.phones, contactService: c.contacts, settingsService: c.settings, phoneWorldService: c.phoneWorld }); }
function shell(c) { return new TmrwPhoneShell({ document: c.document, viewModels: vm(c), controller: c.controller, scope: c.scope, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, selectedDeviceId: c.user.deviceId }); }
async function openMaps(s) { const route = find(s.root, node => node.dataset?.route === 'maps'); assert.ok(route); route.click(); await waitFor(() => s.root.children[3]?.children[0]?.dataset?.route === 'maps' && !find(s.root.children[3], node => node.textContent === 'Loading Maps…')); return s.root.children[3].children[0]; }
async function addContact(c, person, number, name) { await c.contacts.discoverNumber({ scope: c.scope, ownerAccountId: c.user.accountId, number }); await c.contacts.linkContact({ scope: c.scope, ownerAccountId: c.user.accountId, number, targetActorId: person.actorId, targetInstanceId: person.instanceId, savedName: name }); }

async function typeLocation(s, value) { const input = find(s.root, node => node.attributes?.get?.('aria-label') === 'Story-world location label'); assert.ok(input); fireInput(input, value); await waitFor(() => find(s.root, node => node.dataset?.locationAction === 'check-in')?.disabled === false); }

test('C2-3 Maps is truthful/empty without data, Check In is owner-private, and no fake GPS controls exist', async () => {
  const c = await setupPhoneWorldFoundation({ castSize: 2, manifestId: 'c2-3-checkin' }); await addContact(c, c.alice, '5552001', 'Alice');
  const s = shell(c); await s.mount(c.target); let panel = await openMaps(s);
  assert.equal(find(panel, node => /GPS/i.test(String(node.textContent || ''))), null);
  assert.ok(find(panel, node => node.textContent === 'ยังไม่มีตำแหน่งที่แชร์ไว้'));
  assert.deepEqual(findAll(panel, node => Boolean(node.dataset?.locationAction)).map(node => node.dataset.locationAction).sort(), ['check-in', 'live', 'share']);
  await typeLocation(s, 'Library'); find(s.root, node => node.dataset?.locationAction === 'check-in').click();
  await waitFor(async () => (await c.phoneWorld.listVisibleLocations({ scope: c.scope, viewerAccountId: c.user.accountId })).some(row => row.label === 'Library'));
  assert.equal((await c.phoneWorld.listVisibleLocations({ scope: c.scope, viewerAccountId: c.alice.accountId })).some(row => row.label === 'Library'), false);
});

test('C2-3 Maps Share Location uses identified Contact audience only and incoming shares project to the recipient account', async () => {
  const c = await setupPhoneWorldFoundation({ castSize: 3, manifestId: 'c2-3-share' }); await addContact(c, c.alice, '5552002', 'Alice'); await addContact(c, c.bob, '5552003', 'Bob');
  const s = shell(c); await s.mount(c.target); await openMaps(s); await typeLocation(s, 'Cafe');
  const aliceChoice = find(s.root, node => node.dataset?.locationAudience === c.alice.accountId); assert.ok(aliceChoice); aliceChoice.click(); await waitFor(() => find(s.root, node => node.dataset?.locationAction === 'share')?.disabled === false); find(s.root, node => node.dataset?.locationAction === 'share').click();
  await waitFor(async () => (await c.phoneWorld.listVisibleLocations({ scope: c.scope, viewerAccountId: c.alice.accountId })).some(row => row.label === 'Cafe'));
  assert.equal((await c.phoneWorld.listVisibleLocations({ scope: c.scope, viewerAccountId: c.bob.accountId })).some(row => row.label === 'Cafe'), false);

  await c.phoneWorld.setLocation({ scope: c.scope, ...ownedInput(c.alice), recordId: 'alice-share-user', mode: 'shared', label: 'Alice meeting point', audienceAccountIds: [c.user.accountId], source: utilitySource('alice-share-user'), idempotencyKey: 'alice-share-user' });
  await s.renderActive(); const incoming = find(s.root, node => node.dataset?.locationRecordId === 'alice-share-user'); assert.ok(incoming); assert.equal(find(incoming, node => node.tagName === 'strong')?.textContent, 'Alice meeting point'); assert.equal(find(incoming, node => node.tagName === 'small')?.textContent, 'shared · active');
});

test('C2-3 Live Location records explicit 30-minute expiry metadata and owning phone alone can end it one-shot', async () => {
  const c = await setupPhoneWorldFoundation({ castSize: 2, manifestId: 'c2-3-live' }); await addContact(c, c.alice, '5552004', 'Alice'); const s = shell(c); await s.mount(c.target); await openMaps(s); await typeLocation(s, 'On the way');
  find(s.root, node => node.dataset?.locationAudience === c.alice.accountId).click(); await waitFor(() => find(s.root, node => node.dataset?.locationAction === 'live')?.disabled === false); find(s.root, node => node.dataset?.locationAction === 'live').click();
  let live; await waitFor(async () => { live = (await c.phoneWorld.listVisibleLocations({ scope: c.scope, viewerAccountId: c.user.accountId })).find(row => row.mode === 'live'); return Boolean(live); });
  assert.match(live.expiresAt || '', /^\d{4}-\d{2}-\d{2}T/); const end = find(s.root, node => node.dataset?.locationAction === 'end-live' && node.dataset?.locationRecordId === live.recordId); assert.ok(end); end.click(); end.click();
  await waitFor(async () => (await c.phoneWorld.listVisibleLocations({ scope: c.scope, viewerAccountId: c.user.accountId })).find(row => row.recordId === live.recordId)?.status === 'ended');
  const events = (await c.utilityEngine.listEvents(c.scope)).filter(event => event.eventType === PHONE_WORLD_EVENT_TYPES.LOCATION_STATE && event.payload.record.recordId === live.recordId); assert.equal(events.length, 2);
  const aliceView = await c.phoneWorld.listVisibleLocations({ scope: c.scope, viewerAccountId: c.alice.accountId }); assert.equal(aliceView.find(row => row.recordId === live.recordId)?.status, 'ended');
});

test('C2-3 Maps rejects foreign viewers, hides unauthorized Their Phone state, and clears draft/audience on device switch', async () => {
  const c = await setupPhoneWorldFoundation({ castSize: 2, manifestId: 'c2-3-privacy' }); await addContact(c, c.alice, '5552005', 'Alice'); const s = shell(c); await s.mount(c.target); await openMaps(s); await typeLocation(s, 'Draft location'); find(s.root, node => node.dataset?.locationAudience === c.alice.accountId).click();
  await s.selectDevice(c.alice.deviceId); assert.equal(find(s.root, node => node.dataset?.locationRecordId), null); assert.ok(find(s.root, node => node.textContent === 'โทรศัพท์เครื่องนี้ยังล็อกอยู่'));
  await s.selectDevice(c.user.deviceId); const input = find(s.root, node => node.attributes?.get?.('aria-label') === 'Story-world location label'); assert.equal(input.value, ''); assert.ok(findAll(s.root, node => node.dataset?.locationAudience).every(node => node.attributes.get('aria-pressed') === 'false'));
  await assert.rejects(c.phoneWorld.listVisibleLocations({ scope: c.scope, viewerAccountId: 'account_foreign' }), /Unknown scoped.*Account/i);
});

test('C2-3 Maps CSS stays mobile-bounded and uses real touch controls', async () => {
  const css = await import('node:fs/promises').then(fs => fs.readFile(new URL('../../ui/styles.css', import.meta.url), 'utf8'));
  assert.match(css, /tmrw-v3-maps\{min-width:0;display:grid/); assert.match(css, /tmrw-v3-location-composer input\{width:100%;min-height:44px/); assert.match(css, /tmrw-v3-location-actions button.*white-space:normal/); assert.match(css, /\.tmrw-v3-shell button\{min-height:44px/);
});
