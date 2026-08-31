import test from 'node:test';
import assert from 'node:assert/strict';
import { TmrwPhoneShell } from '../../ui/shell.mjs';
import { PhoneShellViewModels } from '../../ui/view-models.mjs';
import { PHONE_THEMES } from '../../ui/themes.mjs';
import { setupPhoneWorldFoundation } from './phone-world-foundation-fixtures.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(predicate, attempts = 30) { for (let i = 0; i < attempts; i += 1) { if (await predicate()) return; await settle(); } throw new Error('Timed out waiting for Theme UI'); }
function find(node, predicate) { if (predicate(node)) return node; for (const child of node.children || []) { const hit = find(child, predicate); if (hit) return hit; } return null; }
function findAll(node, predicate, out = []) { if (predicate(node)) out.push(node); for (const child of node.children || []) findAll(child, predicate, out); return out; }
function viewModels(c) { return new PhoneShellViewModels({ database: c.database, phoneStateService: c.phones, contactService: c.contacts, settingsService: c.settings, phoneWorldService: c.phoneWorld }); }
function shell(c) { return new TmrwPhoneShell({ document: c.document, viewModels: viewModels(c), controller: c.controller, scope: c.scope, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, selectedDeviceId: c.user.deviceId }); }

test('C2-2 Theme exposes exactly bounded real choices, applies immediately, persists on reopen, and creates no canonical Story Event', async () => {
  const c = await setupPhoneWorldFoundation({ castSize: 1, manifestId: 'c2-2-theme' });
  const beforeEvents = (await c.utilityEngine.listEvents(c.scope)).length;
  const first = shell(c); await first.mount(c.target); assert.equal(first.root.dataset.theme, 'light-blue');
  const route = find(first.root, node => node.dataset?.route === 'theme'); assert.ok(route); route.click(); await waitFor(() => first.root.children[3]?.children[0]?.dataset?.route === 'theme');
  const choices = findAll(first.root, node => Boolean(node.dataset?.themeChoice)); assert.equal(choices.length, PHONE_THEMES.length); assert.equal(choices.length, 3); assert.ok(choices.every(button => String(button.attributes.get('aria-label')).startsWith('Use ')));
  const slate = choices.find(button => button.dataset.themeChoice === 'soft-slate'); slate.click(); await waitFor(() => first.root.dataset.theme === 'soft-slate');
  assert.equal((await c.settings.get({ scope: c.scope, playerInstanceId: c.user.instanceId })).themeId, 'soft-slate');
  assert.equal((await c.utilityEngine.listEvents(c.scope)).length, beforeEvents);
  first.dispose();

  const second = shell(c); await second.mount(c.target); assert.equal(second.root.dataset.theme, 'soft-slate');
  const backRoute = find(second.root, node => node.dataset?.route === 'theme'); assert.ok(backRoute); backRoute.click(); await waitFor(() => second.root.children[3]?.children[0]?.dataset?.route === 'theme'); const back = find(second.root, node => node.dataset?.navAction === 'back'); assert.ok(back); back.click(); await waitFor(() => second.root.children[3]?.children[0]?.dataset?.route === 'launcher');
});

test('C2-2 Theme safely falls back unknown legacy values without mutating story canon', async () => {
  const c = await setupPhoneWorldFoundation({ castSize: 1, manifestId: 'c2-2-theme-fallback' }); const beforeEvents = (await c.utilityEngine.listEvents(c.scope)).length;
  const saved = await c.settings.setTheme({ scope: c.scope, playerInstanceId: c.user.instanceId, themeId: 'unknown-legacy-theme' }); assert.equal(saved.themeId, 'light-blue');
  const read = await c.settings.get({ scope: c.scope, playerInstanceId: c.user.instanceId }); assert.equal(read.themeId, 'light-blue'); assert.equal((await c.utilityEngine.listEvents(c.scope)).length, beforeEvents);
});

test('C2-2 Theme CSS has distinct bounded visual effects and keeps touch controls readable', async () => {
  const css = await import('node:fs/promises').then(fs => fs.readFile(new URL('../../ui/styles.css', import.meta.url), 'utf8'));
  for (const id of PHONE_THEMES.map(theme => theme.id)) assert.match(css, new RegExp(`tmrw-v3-shell\\[data-theme=${id}\\]`));
  assert.match(css, /tmrw-v3-theme-choices button\{width:100%;white-space:normal/);
  assert.match(css, /\.tmrw-v3-shell button\{min-height:44px/);
});
