import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { TmrwPhoneShell } from '../../ui/shell.mjs';
import { homeViewModel } from '../../ui/home.mjs';
import { GUIDE_TOPIC_CONTENT } from '../../ui/guide.mjs';
import { renderApprovedCallSurface } from '../../ui/calls/approved-call-surface.mjs';
import { FakeDocument } from '../phase7/fake-dom.mjs';
import { setupPhase17 } from '../phase17/notification-fixtures.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function find(node, predicate) { if (predicate(node)) return node; for (const child of node?.children || []) { const hit = find(child, predicate); if (hit) return hit; } return null; }
function findAll(node, predicate, out = []) { if (predicate(node)) out.push(node); for (const child of node?.children || []) findAll(child, predicate, out); return out; }
function allText(node, out = []) { if (node?.textContent) out.push(String(node.textContent)); for (const child of node?.children || []) allText(child, out); return out.join(' '); }
function shellFor(c, extras = {}) { return new TmrwPhoneShell({ document: c.document, viewModels: c.viewModels, controller: c.controller, messageService: c.messages, callService: c.calls, callCoordinator: c.viewModels.callCoordinator, socialService: c.social, notificationService: c.notifications, scope: c.scope, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, selectedDeviceId: c.user.deviceId, ...extras }); }

const EXPECTED_CURRENT_APPS = Object.freeze(['contacts','messages','calls','feed','insungram','live','notifications','gallery','search','maps','calendar','notes','files','wallet','shop','weather','health','theme','guide','settings','diagnostics']);

test('P23 direct Preview37 shell mounts the retained phone chrome and first home page around real Production app routes', async () => {
  const c = await setupPhase17({ castSize: 2, manifestId: 'p23-preview37-shell' });
  const shell = shellFor(c); await shell.mount(c.target);
  assert.equal(shell.root.dataset.route, 'launcher');
  assert.equal(shell.root.className, 'tmrw-v3-shell');
  const status = find(shell.root, node => String(node.className || '').includes('tmrw-phone-status'));
  const pager = find(shell.root, node => node.dataset?.role === 'home-pages');
  const firstPage = pager?.children?.[0];
  const dock = find(shell.root, node => String(node.className || '').includes('tmrw-phone-dock'));
  const close = find(shell.root, node => node.dataset?.action === 'close-phone');
  const sheet = find(shell.root, node => String(node.className || '').includes('tmrw-v3-preview-sheet-layer'));
  assert.ok(status && pager && firstPage && dock && close && sheet);
  assert.match(pager.className, /tmrw-phone-app-pages/);
  assert.match(pager.className, /tmrw-phone-full-home-pages/);
  assert.match(firstPage.className, /tmrw-phone-app-page/);
  assert.match(firstPage.className, /tmrw-phone-home-panel--main/);
  assert.ok(find(firstPage, node => String(node.className || '').includes('tmrw-phone-owner-pill')));
  assert.ok(find(firstPage, node => String(node.className || '').includes('tmrw-phone-clock-block')));
  assert.ok(find(firstPage, node => String(node.className || '').includes('tmrw-phone-app-grid')));
  assert.equal(dock.children.length, 4);
  assert.match(close.className, /tmrw-phone-home-lock-button/);
  assert.equal(sheet.hidden, true);
  const buttons = findAll(pager, node => Boolean(node.dataset?.route));
  assert.ok(buttons.length >= 6);
  assert.ok(buttons.every(button => String(button.className || '').includes('tmrw-phone-app')));
  assert.ok(buttons.every(button => String(button.children?.[0]?.className || '').includes('tmrw-phone-app-icon')));
  assert.doesNotMatch(allText(shell.root), /Device status:|Viewing: .*Their Phone|TMRW—Phone Preview/);
});

test('P23 current-release home model retains every functional app and Preview37-visible launcher naming', () => {
  const base = { messagingEnabled: true, callsEnabled: true, socialEnabled: true, liveEnabled: true, notificationsEnabled: true, phoneWorldEnabled: true, calendarEnabled: true, commerceEnabled: true, badges: {} };
  const normal = homeViewModel({ ...base, developerMode: false });
  const developer = homeViewModel({ ...base, developerMode: true });
  assert.deepEqual(normal.map(app => app.id), EXPECTED_CURRENT_APPS.filter(id => id !== 'diagnostics'));
  assert.deepEqual(developer.map(app => app.id), EXPECTED_CURRENT_APPS);
  assert.equal(developer.find(app => app.id === 'shop')?.label, 'ร้านค้า');
  assert.equal(developer.find(app => app.id === 'wallet')?.label, 'กระเป๋าเงิน');
  assert.equal(developer.find(app => app.id === 'theme')?.label, 'Themes');
  assert.ok(developer.every(app => app.available === true && app.disposition));
});

test('P23 Preview37 horizontal pager keeps six real apps per page and synchronizes page dots from clicks and scroll', async () => {
  const c = await setupPhase17({ castSize: 2, manifestId: 'p23-preview37-pager' });
  const shell = shellFor(c); await shell.mount(c.target);
  const pager = find(shell.root, node => node.dataset?.role === 'home-pages');
  const dots = find(shell.root, node => String(node.className || '').includes('tmrw-phone-page-dots'));
  assert.ok(pager && dots);
  const pages = [...pager.children];
  assert.ok(pages.length >= 2);
  assert.equal(dots.children.length, pages.length);
  for (const page of pages) assert.ok(findAll(page, node => Boolean(node.dataset?.route)).length <= 6);
  pager.clientWidth = 320;
  dots.children[1].click();
  assert.equal(pager.scrollLeft, 320);
  assert.equal(dots.children[1].attributes.get('aria-current'), 'true');
  pager.scrollLeft = 0;
  for (const listener of pager.listeners.get('scroll') || []) listener({ currentTarget: pager });
  await wait(90);
  assert.equal(dots.children[0].attributes.get('aria-current'), 'true');
  assert.equal(dots.children[1].attributes.get('aria-current'), 'false');
});

test('P23 Close, Back, dock and owner sheet use Production lifecycle/navigation with zero phone-domain writes', async () => {
  const c = await setupPhase17({ castSize: 2, manifestId: 'p23-preview37-interactions' });
  let closeCount = 0;
  const shell = shellFor(c, { onClose: () => { closeCount += 1; } }); await shell.mount(c.target);
  const writes = c.database.diagnostics.writeCount;
  const firstPage = find(shell.root, node => String(node.className || '').includes('tmrw-phone-home-panel--main'));
  const owner = find(firstPage, node => node.dataset?.action === 'open-phone-selector'); owner.click();
  const sheet = find(shell.root, node => String(node.className || '').includes('tmrw-v3-preview-sheet-layer'));
  assert.equal(sheet.hidden, false);
  const theirPhone = find(sheet, node => node.dataset?.deviceId === c.alice.deviceId); assert.ok(theirPhone); theirPhone.click(); await settle(); await settle();
  assert.equal(c.database.diagnostics.writeCount, writes);
  assert.equal(shell.root.dataset.route, 'launcher');
  const dock = find(shell.root, node => String(node.className || '').includes('tmrw-phone-dock'));
  assert.equal(dock.children.length, 4);
  dock.children[2].click(); await settle(); await settle();
  assert.equal(shell.root.dataset.route, 'search');
  const panel = find(shell.root, node => node.dataset?.route === 'search');
  const back = find(panel, node => node.dataset?.navAction === 'back'); assert.ok(back); back.click(); await settle(); await settle();
  assert.equal(shell.root.dataset.route, 'launcher');
  const close = find(shell.root, node => node.dataset?.action === 'close-phone'); close.click(); await settle();
  assert.equal(closeCount, 1);
  assert.equal(c.database.diagnostics.writeCount, writes);
});

test('P23 recovered Call UI authority presents incoming, outgoing, active and ended Production call states without demo Voice/data', async () => {
  const document = new FakeDocument();
  const base = { callSessionId: 'call-1', counterpartLabel: 'Alice', counterpartAccountId: 'account-alice', title: 'Call with Alice' };
  const incoming = renderApprovedCallSurface({ document, island: { ...base, kind: 'incoming', state: 'ringing', actions: [{ id: 'accept', enabled: true }, { id: 'decline', enabled: true }] } });
  const outgoing = renderApprovedCallSurface({ document, island: { ...base, kind: 'outgoing', state: 'ringing', actions: [{ id: 'cancel', enabled: true }] } });
  const active = renderApprovedCallSurface({ document, island: { ...base, kind: 'active', state: 'active', canonicalDurationMs: null, durationLabel: 'เชื่อมต่ออยู่', transcript: [{ transcriptEntryId: 't1', speakerAccountId: 'account-alice', text: 'สวัสดี' }], actions: [{ id: 'end', enabled: true }] } });
  const ended = renderApprovedCallSurface({ document, island: { ...base, kind: 'ended', state: 'ended', durationLabel: '01:42', actions: [] } });
  for (const surface of [incoming, outgoing, active, ended]) assert.equal(surface.dataset.presentationAuthority, 'v3/design/call-ui-authority');
  assert.ok(find(incoming, node => node.dataset?.callAction === 'accept'));
  assert.ok(find(incoming, node => node.dataset?.callAction === 'decline'));
  assert.ok(find(outgoing, node => node.dataset?.callAction === 'cancel'));
  assert.ok(find(active, node => node.dataset?.callAction === 'minimize'));
  assert.ok(find(active, node => node.dataset?.callAction === 'end'));
  const speaker = find(active, node => node.dataset?.callAction === 'speaker'); const mute = find(active, node => node.dataset?.callAction === 'mute');
  assert.equal(speaker?.disabled, true); assert.equal(mute?.disabled, true);
  assert.ok(find(active, node => String(node.className || '').includes('tmrw-call-authority-subtitle-text')));
  assert.ok(find(ended, node => String(node.className || '').includes('tmrw-call-authority-ended-row')));
  assert.ok(find(ended, node => node.dataset?.callAction === 'close-ended'));
  const source = await fs.readFile(new URL('../../ui/calls/approved-call-surface.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Arin|unsplash|sessionStorage/i);
});

test('P23 direct Preview port imports zero Preview mock widgets/data and normal-user copy stays free of implementation explanations', async () => {
  const paths = ['shell.mjs','gallery.mjs','files.mjs','maps.mjs','calendar.mjs','wallet.mjs','shop.mjs','weather.mjs','health.mjs','notes.mjs','search.mjs'];
  const sources = (await Promise.all(paths.map(name => fs.readFile(new URL(`../../ui/${name}`, import.meta.url), 'utf8')))).join('\n');
  assert.doesNotMatch(sources, /TMRW-Phone-Preview|tmrw-phone-music-card|Now Playing|fake Wallet|mock Gallery/i);
  const guideCopy = Object.values(GUIDE_TOPIC_CONTENT).join(' ');
  assert.doesNotMatch(guideCopy, /canonical|Character Knowledge|background Social|provider credentials|API keys|Guide state/i);
  const shellSource = await fs.readFile(new URL('../../ui/shell.mjs', import.meta.url), 'utf8');
  for (const phrase of ['Current phone access mode:', 'Developer Diagnostics', 'Canonical duration is committed', 'UNKNOWN FUNDS', 'INSUFFICIENT KNOWN FUNDS', 'Guide state is player UI state']) assert.equal(shellSource.includes(phrase), false, phrase);
});

test('P23 direct Preview shell has a deterministic 390×844 no-overflow contract inside the Production viewport root', async () => {
  const css = await fs.readFile(new URL('../../ui/styles.css', import.meta.url), 'utf8');
  const packageCss = await fs.readFile(new URL('../../production/package/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.tmrw-phone-app-pages\{width:100%;display:flex;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory/);
  assert.match(css, /\.tmrw-phone-app-page\{flex:0 0 100%;min-width:100%;min-height:282px/);
  assert.match(css, /\.tmrw-phone-home-panel \.tmrw-phone-app-grid\{[^}]*grid-template-columns:repeat\(3,1fr\)/);
  assert.match(css, /\.tmrw-phone-dock\{[^}]*left:28px;right:28px;bottom:20px;height:76px/);
  assert.match(css, /@media\(max-width:430px\)\{\.tmrw-v3-shell\{width:100%;height:100%;max-height:100%;border-width:6px/);
  assert.match(packageCss, /--tmrw-v3-viewport-gap:\s*clamp\(8px, 2vw, 24px\)/);
  assert.match(packageCss, /#tmrw-v3-phone-root > \.tmrw-v3-shell\[data-route="launcher"\][\s\S]*?height:\s*calc\(100dvh - var\(--tmrw-v3-viewport-gap\) - var\(--tmrw-v3-viewport-gap\)\);[\s\S]*?overflow:\s*hidden/);
  const viewportWidth = 390; const viewportHeight = 844; const rootGap = 8; const border = 6; const pagePadding = 30; const columnGap = 13; const columns = 3; const iconWidth = 62;
  const shellOuterWidth = viewportWidth - rootGap * 2; const shellOuterHeight = viewportHeight - rootGap * 2; const shellInnerWidth = shellOuterWidth - border * 2; const appGridWidth = shellInnerWidth - pagePadding * 2; const columnWidth = (appGridWidth - columnGap * (columns - 1)) / columns;
  assert.equal(shellOuterWidth, 374); assert.equal(shellOuterHeight, 828); assert.equal(shellInnerWidth, 362); assert.equal(appGridWidth, 302); assert.equal(columnWidth, 92); assert.ok(columnWidth >= iconWidth);
});
