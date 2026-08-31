import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PhoneShellViewModels } from '../../ui/view-models.mjs';
import { TmrwPhoneShell } from '../../ui/shell.mjs';
import { setupPhase17 } from '../phase17/notification-fixtures.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(predicate, label) { for (let index = 0; index < 120; index += 1) { if (await predicate()) return; await settle(); } throw new Error(`${label} did not settle`); }
function find(node, predicate) { if (predicate(node)) return node; for (const child of node?.children || []) { const hit = find(child, predicate); if (hit) return hit; } return null; }
function allText(node, out = []) { if (node?.textContent) out.push(String(node.textContent)); for (const child of node?.children || []) allText(child, out); return out.join(' '); }
function proxyWith(target, overrides = {}) { return new Proxy(target, { get(base, property) { if (Object.prototype.hasOwnProperty.call(overrides, property)) return overrides[property]; const value = base[property]; return typeof value === 'function' ? value.bind(base) : value; } }); }
function modelsFor(c, contacts) { return new PhoneShellViewModels({ database: c.database, phoneStateService: c.phones, contactService: contacts, settingsService: c.settings, messageService: c.messages, callService: c.calls, socialService: c.social, insungramService: c.insungram, liveService: c.live, notificationService: c.notifications }); }
function shellFor(c, viewModels) { return new TmrwPhoneShell({ document: c.document, viewModels, controller: c.controller, messageService: c.messages, callService: c.calls, callCoordinator: viewModels.callCoordinator, socialService: c.social, notificationService: c.notifications, scope: c.scope, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, selectedDeviceId: c.user.deviceId }); }

async function seedPrivateContacts(c) {
  await c.contacts.discoverNumber({ scope: c.scope, ownerAccountId: c.user.accountId, number: '1001' });
  await c.contacts.linkContact({ scope: c.scope, ownerAccountId: c.user.accountId, number: '1001', targetActorId: c.alice.actorId, targetInstanceId: c.alice.instanceId, savedName: 'USER PRIVATE CONTACT' });
  await c.contacts.discoverNumber({ scope: c.scope, ownerAccountId: c.alice.accountId, number: '2002' });
  await c.contacts.linkContact({ scope: c.scope, ownerAccountId: c.alice.accountId, number: '2002', targetActorId: c.user.actorId, targetInstanceId: c.user.instanceId, savedName: 'ALICE PRIVATE CONTACT' });
}

test('P23-E data-bearing current-release routes clear prior presentation through the shared loading boundary', async () => {
  const source = await fs.readFile(new URL('../../ui/shell.mjs', import.meta.url), 'utf8');
  const loading = source.match(/const loadingRoutes = \[([^\]]+)\]/)?.[1] || '';
  for (const route of ['contacts', 'messages', 'calls', 'notifications', 'gallery', 'files', 'maps', 'calendar', 'wallet', 'shop', 'weather', 'health', 'notes', 'search', 'guide', 'settings', 'diagnostics', 'feed', 'insungram', 'live']) assert.match(loading, new RegExp(`['\"]${route}['\"]`), `${route} must clear old app presentation before hydration`);
});

test('P23-E authorized perspective switch clears old Contacts before slow next-device hydration', async () => {
  const c = await setupPhase17({ castSize: 2, manifestId: 'p23e-contact-switch' }); await seedPrivateContacts(c); await c.overrides.grant({ scope: c.scope, deviceId: c.alice.deviceId, action: 'inspect', playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId });
  let releaseAlice = null; const contacts = proxyWith(c.contacts, { listContacts: input => input.ownerAccountId === c.alice.accountId && !releaseAlice ? new Promise((resolve, reject) => { releaseAlice = () => c.contacts.listContacts(input).then(resolve, reject); }) : c.contacts.listContacts(input) });
  const viewModels = modelsFor(c, contacts); const shell = shellFor(c, viewModels); await shell.mount(c.target); find(shell.root, node => node.dataset?.route === 'contacts').click(); await waitFor(() => /USER PRIVATE CONTACT/.test(allText(shell.root)), 'user Contacts');
  const switching = shell.selectDevice(c.alice.deviceId); await waitFor(() => /Loading Contacts/.test(allText(shell.root)), 'Contacts loading'); assert.doesNotMatch(allText(shell.root), /USER PRIVATE CONTACT/); releaseAlice(); await switching; assert.match(allText(shell.root), /ALICE PRIVATE CONTACT/); assert.doesNotMatch(allText(shell.root), /USER PRIVATE CONTACT/);
});

test('P23-E authorized to unauthorized switch clears old Contacts and exposes only access state', async () => {
  const c = await setupPhase17({ castSize: 2, manifestId: 'p23e-contact-denied' }); await seedPrivateContacts(c); const shell = shellFor(c, modelsFor(c, c.contacts)); await shell.mount(c.target); find(shell.root, node => node.dataset?.route === 'contacts').click(); await waitFor(() => /USER PRIVATE CONTACT/.test(allText(shell.root)), 'user Contacts'); await shell.selectDevice(c.alice.deviceId); assert.doesNotMatch(allText(shell.root), /USER PRIVATE CONTACT|ALICE PRIVATE CONTACT/); assert.match(allText(shell.root), /Contacts are unavailable until access is granted|access/i);
});

test('P23-E shared shell mobile contract keeps app content vertically scrollable and long technical/private text wrap-safe', async () => {
  const css = await fs.readFile(new URL('../../ui/styles.css', import.meta.url), 'utf8'); assert.match(css, /\.tmrw-v3-content\{[^}]*overflow-y:auto/); assert.match(css, /\.tmrw-v3-content,\.tmrw-v3-panel[^\{]*\{[^}]*min-width:0[^}]*max-width:100%/); assert.match(css, /\.tmrw-v3-panel pre\{[^}]*white-space:pre-wrap[^}]*overflow-wrap:anywhere/); assert.match(css, /\.tmrw-v3-app-back\{[^}]*width:44px[^}]*min-width:44px/);
});
