import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { TmrwPhoneShell } from '../../ui/shell.mjs';
import { homeViewModel } from '../../ui/home.mjs';
import { setupPhase17 } from '../phase17/notification-fixtures.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
function find(node, predicate) { if (predicate(node)) return node; for (const child of node?.children || []) { const hit = find(child, predicate); if (hit) return hit; } return null; }
function findAll(node, predicate, out = []) { if (predicate(node)) out.push(node); for (const child of node?.children || []) findAll(child, predicate, out); return out; }
function allText(node, out = []) { if (node?.textContent) out.push(String(node.textContent)); for (const child of node?.children || []) allText(child, out); return out.join(' '); }
function shellFor(c) { return new TmrwPhoneShell({ document: c.document, viewModels: c.viewModels, controller: c.controller, messageService: c.messages, callService: c.calls, callCoordinator: c.viewModels.callCoordinator, socialService: c.social, notificationService: c.notifications, scope: c.scope, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, selectedDeviceId: c.user.deviceId }); }

const EXPECTED_CURRENT_APPS = Object.freeze(['contacts','messages','calls','feed','insungram','live','notifications','gallery','search','maps','calendar','notes','files','wallet','shop','weather','health','theme','guide','settings','diagnostics']);

test('P23 real-device launcher uses designed icon tiles and a compact canonical phone overview instead of raw text buttons', async () => {
  const c = await setupPhase17({ castSize: 2, manifestId: 'p23-home-designed-launcher' });
  const shell = shellFor(c); await shell.mount(c.target);
  assert.equal(shell.root.dataset.route, 'launcher');
  const nav = shell.root.children[2]; const buttons = findAll(nav, node => node.dataset?.route);
  assert.ok(buttons.length >= 8);
  for (const button of buttons) {
    assert.equal(button.className, 'tmrw-v3-home-app');
    assert.equal(button.children[0]?.className, 'tmrw-v3-home-app-icon');
    assert.equal(button.children[1]?.className, 'tmrw-v3-home-app-label');
    assert.equal(button.children[2]?.className, 'tmrw-v3-home-app-badge');
    assert.ok(String(button.attributes.get('aria-label') || '').length > 0);
  }
  const panel = shell.root.children[3].children[0];
  assert.equal(panel.dataset.route, 'launcher');
  assert.match(panel.className, /tmrw-v3-home-overview/);
  assert.ok(find(panel, node => node.className === 'tmrw-v3-home-hero'));
  assert.ok(find(panel, node => node.className === 'tmrw-v3-home-perspective-title'));
  assert.doesNotMatch(allText(panel), /^My Phone Device status:/);
});

test('P23 home model keeps every accepted real app wired with consistent product labels; diagnostics remains developer-gated', () => {
  const base = { messagingEnabled: true, callsEnabled: true, socialEnabled: true, liveEnabled: true, notificationsEnabled: true, phoneWorldEnabled: true, calendarEnabled: true, commerceEnabled: true, badges: {} };
  const normal = homeViewModel({ ...base, developerMode: false });
  const developer = homeViewModel({ ...base, developerMode: true });
  assert.deepEqual(normal.map(app => app.id), EXPECTED_CURRENT_APPS.filter(id => id !== 'diagnostics'));
  assert.deepEqual(developer.map(app => app.id), EXPECTED_CURRENT_APPS);
  assert.ok(developer.every(app => /^[\x20-\x7E]+$/.test(app.label)), 'launcher labels must use the current English product-language contract');
  assert.ok(developer.every(app => app.available === true && app.disposition));
});

test('P23 designed home preserves My Phone / Their Phones switching, canonical no-write behavior, and Back navigation', async () => {
  const c = await setupPhase17({ castSize: 2, manifestId: 'p23-home-perspective-navigation' });
  const shell = shellFor(c); await shell.mount(c.target); const writes = c.database.diagnostics.writeCount;
  await shell.selectDevice(c.alice.deviceId);
  assert.equal(c.database.diagnostics.writeCount, writes);
  assert.equal(shell.root.dataset.route, 'launcher');
  const selected = find(shell.root, node => node.dataset?.deviceId === c.alice.deviceId); assert.ok(selected);
  assert.match(allText(shell.root.children[3]), new RegExp(String(selected.textContent).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const contacts = find(shell.root, node => node.dataset?.route === 'contacts'); contacts.click(); await settle(); await settle();
  assert.equal(shell.root.dataset.route, 'contacts');
  const panel = shell.root.children[3].children[0]; const back = find(panel, node => node.dataset?.navAction === 'back'); assert.ok(back); back.click(); await settle(); await settle();
  assert.equal(shell.root.dataset.route, 'launcher');
  assert.equal(shell.root.children[2].hidden, false);
});

test('P23 designed launcher has a deterministic 390×844 no-horizontal-overflow contract and bounded vertical app scrolling', async () => {
  const css = await fs.readFile(new URL('../../ui/styles.css', import.meta.url), 'utf8');
  const packageCss = await fs.readFile(new URL('../../production/package/style.css', import.meta.url), 'utf8');
  assert.match(css, /tmrw-v3-shell\[data-route=launcher\][\s\S]*?grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /tmrw-v3-shell\[data-route=launcher\][\s\S]*?overflow-x:hidden;overflow-y:auto/);
  assert.match(css, /tmrw-v3-home-app\{[^}]*min-width:0/);
  assert.match(css, /@media\(max-width:430px\)[\s\S]*?\.tmrw-v3-home-app-icon\{width:50px;height:50px/);
  assert.match(packageCss, /#tmrw-v3-phone-root > \.tmrw-v3-shell\[data-route="launcher"\][\s\S]*?height:\s*calc\(100dvh - var\(--tmrw-v3-viewport-gap\) - var\(--tmrw-v3-viewport-gap\)\);[\s\S]*?overflow:\s*hidden/);
  const viewportWidth = 390; const viewportHeight = 844; const rootGap = 8; const mobilePadding = 14; const columnGap = 6; const columns = 4; const iconWidth = 50;
  const shellWidth = viewportWidth - (rootGap * 2); const innerWidth = shellWidth - (mobilePadding * 2); const columnWidth = (innerWidth - (columnGap * (columns - 1))) / columns;
  assert.equal(shellWidth, 374); assert.equal(innerWidth, 346); assert.equal(columnWidth, 82); assert.ok(columnWidth >= iconWidth);
  assert.equal(viewportHeight - (rootGap * 2), 828);
});
